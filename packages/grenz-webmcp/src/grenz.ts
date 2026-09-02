/**
 * The Grenz instance: enforcement pipeline, audit timeline, and the surface the
 * demo and simulator talk to.
 *
 * The pure decision logic lives in `policy.ts`. This file is the part with
 * state and effects — the registry, the human, the clock.
 */

import { RateLimiter, checkConstraints, evaluate } from "./policy.ts";
import { findOutOfReach, watchFrames } from "./reconcile.ts";
import { mountApprovalCard, mountTimelineInto } from "./ui.ts";
import {
  attachWrapper,
  install,
  isInstalled,
  modelContext,
  registerAsFirstParty,
  registry,
  type RegistryEntry,
} from "./takeover.ts";
import type { PresenceMode, Verifier } from "./presence.ts";
import type {
  GrenzConfig,
  GrenzDenial,
  ReasonCode,
  RegisterOptions,
  TimelineEvent,
  ToolDescriptor,
  ToolPolicy,
} from "./types.ts";

export interface ApprovalRequest {
  readonly tool: string;
  readonly title: string;
  /** The site-declared consequence. The most important string on the card. */
  readonly effect: string;
  /**
   * The site's phrasing of this exact call, when its policy supplied one.
   * Absent means the card shows the raw arguments instead — never nothing.
   */
  readonly plain?: string;
  /** The site wants a person proved present, not merely a real click. */
  readonly presence?: PresenceMode;
  /** Where to check the proof, when the site named somewhere. */
  readonly verifier?: Verifier;
  readonly input: unknown;
  readonly timeoutMs: number;
  /** Aborts when the request is resolved elsewhere (timeout, agent hang-up). */
  readonly close: AbortSignal;
}

export interface ApprovalOutcome {
  readonly granted: boolean;
  /** "Approve for the rest of this session" was ticked. */
  readonly remember?: boolean;
  /**
   * Something that was not a person clicked Approve. Always accompanied by
   * `granted: false` — a request someone tried to self-approve is answered no,
   * not merely ignored, because ignoring leaves the card up to be attacked
   * again.
   */
  readonly synthetic?: boolean;
  /** How the presence ceremony went, when the policy asked for one. */
  readonly presence?: "proved" | "unverified" | "refused" | "unavailable";
}

export type Approver = (request: ApprovalRequest) => Promise<ApprovalOutcome>;

export interface GrenzInstance {
  /** The first-party registration path. Funnels into the same pipeline. */
  registerTool(tool: ToolDescriptor, options?: RegisterOptions): Promise<void>;
  /** Every tool Grenz can see, first- or third-party. Backs the simulator. */
  listTools(): RegistryEntry[];
  /** Invoke a tool through the full pipeline, as an agent would. */
  callTool(name: string, input?: unknown, signal?: AbortSignal): Promise<unknown>;
  getTimeline(): TimelineEvent[];
  subscribe(listener: (events: TimelineEvent[]) => void): () => void;
  mountTimeline(element: HTMLElement): () => void;
  clearTimeline(): void;
  /** Protection off = the wrapper passes calls straight through, still logging. */
  setEnabled(enabled: boolean): void;
  isEnabled(): boolean;
  /** Whether a native WebMCP registration surface was found and patched. */
  isTakeoverInstalled(): boolean;
  /**
   * Compare what the browser will offer an agent against what Grenz governs,
   * and record anything it has never seen. Runs on its own when a frame loads;
   * call it directly to force a pass. Resolves with the names reported by THIS
   * pass — a name already on the timeline is not reported twice.
   */
  auditTools(): Promise<string[]>;
  /** Tools carrying an "approve for the session" grant. */
  sessionGrants(): string[];
  revokeSessionGrants(): void;
  /** Swap the approval UI. The demo uses the default shadow-DOM card. */
  setApprover(approver: Approver): void;
}

const MAX_RESULT_CHARS = 240;

let eventSeq = 0;

export function grenz(config: GrenzConfig = {}): GrenzInstance {
  const clock = config.clock ?? (() => Date.now());
  const schedule =
    config.scheduler ??
    ((fn: () => void, ms: number) => {
      const id = setTimeout(fn, ms);
      return () => clearTimeout(id);
    });

  const rateLimiter = new RateLimiter(clock);
  const events: TimelineEvent[] = [];
  const listeners = new Set<(e: TimelineEvent[]) => void>();
  const grants = new Set<string>();
  let enabled = true;
  let approver: Approver | null = null;
  /** Names already reported as out of reach, so a re-audit is not a re-report. */
  const reported = new Set<string>();

  function emit(event: Omit<TimelineEvent, "id" | "at">): TimelineEvent {
    const full: TimelineEvent = { ...event, id: `e${++eventSeq}`, at: clock() };
    events.push(full);
    config.onEvent?.(full);
    for (const l of listeners) l([...events]);
    return full;
  }

  function denial(reason: ReasonCode, message: string): GrenzDenial {
    return { grenz: { decision: "deny", reason, message } };
  }

  function summarize(value: unknown): string {
    let text: string;
    try {
      text = typeof value === "string" ? value : JSON.stringify(value) ?? String(value);
    } catch {
      text = "[unserializable]";
    }
    return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}…` : text;
  }

  /** Steps 1-6, in order, on every agent call. */
  async function runPipeline(
    entry: RegistryEntry,
    input: unknown,
    ctx: { signal: AbortSignal },
  ): Promise<unknown> {
    const { name, annotations } = entry;

    // Protection off: the patch stays installed, the pipeline does not run.
    // We still say, on the record, what would have happened.
    if (!enabled) {
      const would = evaluate(config, name, annotations);
      emit({
        kind: "call",
        tool: name,
        decision: "unprotected",
        reason: "unprotected",
        message:
          would.decision === "allow"
            ? `Ran ungoverned. Grenz protection is OFF.`
            : `Ran ungoverned. Grenz protection is OFF — this would have been denied: ${would.reason}.`,
        input,
        foreign: entry.foreign,
        claimedReadOnly: annotations?.readOnlyHint === true,
      });
      return entry.original(input, ctx);
    }

    // Steps 1 + 2 — policy lookup, then annotation mismatch.
    const verdict = evaluate(config, name, annotations);
    if (verdict.decision === "deny") {
      emit({
        kind: "call",
        tool: name,
        decision: "deny",
        reason: verdict.reason,
        message: verdict.message,
        input,
        foreign: entry.foreign,
        claimedReadOnly: annotations?.readOnlyHint === true,
      });
      return denial(verdict.reason, verdict.message);
    }

    const policy = config.tools?.[name];

    // Step 3 — argument constraints.
    const violation = checkConstraints(policy?.constraints, input);
    if (violation) {
      emit({
        kind: "call",
        tool: name,
        decision: "deny",
        reason: violation.reason,
        message: violation.message,
        input,
        foreign: entry.foreign,
      });
      return denial(violation.reason, violation.message);
    }

    // Step 4 — rate limit.
    const limited = rateLimiter.check(name, policy?.rateLimit);
    if (limited) {
      emit({
        kind: "call",
        tool: name,
        decision: "deny",
        reason: limited.reason,
        message: limited.message,
        input,
        foreign: entry.foreign,
      });
      return denial(limited.reason, limited.message);
    }

    // Step 5 — the human.
    let approvalReason: ReasonCode = "explicit_allow";
    if (verdict.decision === "require_approval") {
      const outcome = await requestApproval(entry, input, verdict.message, ctx.signal);
      approvalReason = outcome.reason;
      if (outcome.reason === "approval_abandoned") {
        emit({
          kind: "call",
          tool: name,
          decision: "deny",
          reason: "approval_abandoned",
          message: "The agent cancelled the call while it was waiting for you.",
          input,
          foreign: entry.foreign,
        });
        // Per spec the caller's promise has already rejected with the abort
        // reason, so nobody is listening. Resolving anyway is free insurance
        // against that assumption being wrong — the alternative is a hang.
        return denial("approval_abandoned", "Cancelled by the agent while awaiting approval.");
      }
      if (!outcome.granted) {
        const message =
          outcome.reason === "approval_expired"
            ? "You did not respond in time, so Grenz denied it."
            : "You denied this.";
        emit({
          kind: "call",
          tool: name,
          decision: "deny",
          reason: outcome.reason,
          message,
          input,
          foreign: entry.foreign,
        });
        return denial(outcome.reason, message);
      }
    }

    // Step 6 — execute.
    try {
      const result = await entry.original(input, ctx);
      emit({
        kind: "call",
        tool: name,
        decision: verdict.decision === "require_approval" ? "require_approval" : "allow",
        reason: verdict.decision === "require_approval" ? approvalReason : "explicit_allow",
        message:
          verdict.decision === "require_approval"
            ? approvalReason === "approval_remembered_grant"
              ? "Auto-approved under the session grant you gave earlier."
              : "You approved this."
            : verdict.message,
        input,
        result: summarize(result),
        foreign: entry.foreign,
        untrustedContent: annotations?.untrustedContentHint === true,
      });
      return result;
    } catch (error) {
      // The tool's own failure is the tool's business — surface it unchanged,
      // but do not let it vanish from the audit log.
      emit({
        kind: "call",
        tool: name,
        decision: "allow",
        reason: "explicit_allow",
        message: `The tool threw: ${error instanceof Error ? error.message : String(error)}`,
        input,
        foreign: entry.foreign,
      });
      throw error;
    }
  }

  /**
   * A site's `describe` is ordinary application code and can throw or return
   * junk. It runs on the path to a security prompt, so a bad one must degrade
   * to the raw arguments rather than take the card down with it.
   */
  function describeInput(
    describe: ToolPolicy["describe"],
    input: unknown,
  ): string | undefined {
    if (!describe || input === null || typeof input !== "object") return undefined;
    try {
      const text = describe(input as Record<string, unknown>);
      return typeof text === "string" && text.trim() ? text : undefined;
    } catch {
      return undefined;
    }
  }

  async function requestApproval(
    entry: RegistryEntry,
    input: unknown,
    effect: string,
    agentSignal: AbortSignal,
  ): Promise<{ granted: boolean; reason: ReasonCode }> {
    // A session grant skips the card — but never silently. It is tagged as
    // remembered so the log never implies a human saw this specific call.
    if (grants.has(entry.name)) {
      return { granted: true, reason: "approval_remembered_grant" };
    }

    const timeoutMs = config.approval?.timeoutMs ?? 60_000;
    const closer = new AbortController();

    const outcome = await new Promise<{ granted: boolean; reason: ReasonCode; remember?: boolean }>(
      (resolve) => {
        let settled = false;
        const finish = (r: { granted: boolean; reason: ReasonCode; remember?: boolean }) => {
          if (settled) return;
          settled = true;
          cancelTimer();
          agentSignal?.removeEventListener("abort", onAgentAbort);
          closer.abort();
          resolve(r);
        };

        const cancelTimer = schedule(
          () => finish({ granted: false, reason: "approval_expired" }),
          timeoutMs,
        );

        const onAgentAbort = () => finish({ granted: false, reason: "approval_abandoned" });
        agentSignal?.addEventListener("abort", onAgentAbort, { once: true });
        if (agentSignal?.aborted) onAgentAbort();

        const ask = approver ?? defaultApprover;
        ask({
          tool: entry.name,
          title: entry.title,
          effect,
          plain: describeInput(config.tools?.[entry.name]?.describe, input),
          presence: config.tools?.[entry.name]?.presence,
          verifier: config.presence,
          input,
          timeoutMs,
          close: closer.signal,
        })
          .then((o) =>
            finish({
              granted: o.granted,
              reason: o.synthetic
                ? "approval_synthetic"
                : o.presence === "refused"
                  ? "presence_refused"
                  : o.presence === "unavailable"
                    ? "presence_unavailable"
                    : o.granted
                      ? o.presence === "proved"
                        ? "approval_present"
                        : o.presence === "unverified"
                          ? "presence_unverified"
                          : "approval_granted"
                      : "approval_denied",
              remember: o.remember,
            }),
          )
          .catch(() => finish({ granted: false, reason: "approval_denied" }));
      },
    );

    // A presence policy says a person must be proved here, for this call. A
    // session grant says later calls have no person at all, so the two cannot
    // both hold — and a checkbox beside the strongest check on the site must
    // not be able to retire it. Enforced here rather than only in the card,
    // because `setApprover` lets a site supply its own.
    if (outcome.granted && outcome.remember && !config.tools?.[entry.name]?.presence) {
      grants.add(entry.name);
      emit({
        kind: "grant",
        tool: entry.name,
        decision: "require_approval",
        reason: "approval_remembered_grant",
        message: `You approved "${entry.name}" for the rest of this session. Later calls will not ask again.`,
      });
    }
    return { granted: outcome.granted, reason: outcome.reason };
  }

  /**
   * Default approver: the library's own shadow-DOM card. With no document
   * (tests, SSR) it refuses — a missing UI must never become an auto-allow.
   */
  const defaultApprover: Approver = (request) =>
    typeof document === "undefined"
      ? Promise.resolve({ granted: false })
      : mountApprovalCard(request);

  // --- registration -------------------------------------------------------

  function wrap(
    tool: ToolDescriptor,
    options: RegisterOptions | undefined,
    foreign: boolean,
  ): ToolDescriptor {
    const governed: ToolDescriptor["execute"] = (input, ctx) => {
      const entry = registry().get(tool.name);
      if (!entry) {
        return Promise.resolve(
          denial("no_matching_allow", `"${tool.name}" is no longer registered.`),
        );
      }
      return runPipeline(entry, input, ctx ?? { signal: new AbortController().signal });
    };

    // A name the registry already holds is not the newcomer's to take.
    //
    // A governed call resolves its entry by NAME at invoke time, so
    // overwriting one hands the new implementation the verdict the site wrote
    // for the tool it displaced: register `get_house_state` a second time and
    // your code runs under that tool's `allow`, with no card and no denial.
    // Chrome rejects a duplicate registration itself (InvalidStateError), but
    // it does so AFTER this wrapper has run, so refusing here is what keeps
    // the registry and the platform agreeing about which tool is which.
    //
    // First registration wins. A legitimate remount is unaffected: the abort
    // handler below deletes the entry before the tool registers again.
    const held = registry().get(tool.name);
    if (held) {
      emit({
        kind: "register",
        tool: tool.name,
        decision: "deny",
        reason: "name_collision",
        message: `Something tried to register a second tool called "${tool.name}". The one already here is unchanged.`,
        foreign,
        claimedReadOnly: tool.annotations?.readOnlyHint === true,
        untrustedContent: tool.annotations?.untrustedContentHint === true,
        ...(foreign ? { description: tool.description, requestedFields: inputFields(tool) } : {}),
      });
      return {
        ...tool,
        execute: () =>
          Promise.resolve(
            denial("name_collision", `"${tool.name}" is already registered by someone else.`),
          ),
      };
    }

    const entry: RegistryEntry = {
      name: tool.name,
      title: tool.title ?? tool.name,
      description: tool.description,
      ...(tool.inputSchema ? { inputSchema: tool.inputSchema } : {}),
      ...(tool.annotations ? { annotations: tool.annotations } : {}),
      foreign,
      original: tool.execute,
      governed,
      registeredAt: clock(),
    };
    registry().set(tool.name, entry);

    // The spec removes a tool by aborting the signal it was registered with —
    // there is no unregister call to intercept — so mirror that into our own
    // registry or the simulator will keep listing ghosts.
    options?.signal?.addEventListener(
      "abort",
      () => {
        if (registry().get(tool.name) === entry) registry().delete(tool.name);
      },
      { once: true },
    );

    const verdict = evaluate(config, tool.name, tool.annotations);
    emit({
      kind: "register",
      tool: tool.name,
      decision: verdict.decision,
      reason: verdict.reason,
      message: foreign
        ? `A partner app added a tool called "${tool.name}". ${verdict.decision === "deny" ? "You can see it, but nothing here lets it run." : "It runs under your house rules."}`
        : `Registered "${tool.name}".`,
      foreign,
      claimedReadOnly: tool.annotations?.readOnlyHint === true,
      untrustedContent: tool.annotations?.untrustedContentHint === true,
      // Only for foreign tools: a site reading back its own descriptions is
      // noise, but what a third-party script told the agent is evidence.
      ...(foreign ? { description: tool.description, requestedFields: inputFields(tool) } : {}),
    });

    return { ...tool, execute: governed };
  }

  attachWrapper(wrap);
  install();

  const api: GrenzInstance = {
    async registerTool(tool, options) {
      // WebMCP can arrive late. ChatGPT's in-app browser injects it after
      // `grenz-install.js` has already run in <head>, so a takeover that found
      // nothing at startup has to be retried rather than given up on. Cheap:
      // `install()` short-circuits once anything is actually patched.
      if (!isInstalled()) install();

      const mc = modelContext();
      if (mc && isInstalled()) {
        // Route through the native surface so the patch is the single funnel —
        // no second code path to keep in sync with the takeover.
        await registerAsFirstParty(() => mc.registerTool(tool, options));
        return;
      }

      // Either there is no WebMCP, or there is one this build could not take
      // over. Both used to fall through to a bare `wrap()` whose result was
      // discarded, which was fine with no WebMCP and quietly wrong with it:
      // the tool reached the browser UNWRAPPED and never entered the registry,
      // so `listTools()` said zero and nothing on the page was governed at all.
      // Wrapping here keeps the registry honest either way, and the browser is
      // handed the governed tool rather than the raw one.
      const wrapped = wrap(tool, options, false);
      if (mc) await mc.registerTool(wrapped, options);
    },

    listTools: () => [...registry().values()],

    callTool(name, input, signal) {
      const entry = registry().get(name);
      if (!entry) {
        return Promise.resolve(denial("no_matching_allow", `No tool named "${name}" is registered.`));
      }
      return entry.governed(input, { signal: signal ?? new AbortController().signal });
    },

    getTimeline: () => [...events],
    subscribe(listener) {
      listeners.add(listener);
      listener([...events]);
      return () => listeners.delete(listener);
    },
    mountTimeline(element) {
      return mountTimelineInto(element, api);
    },
    clearTimeline() {
      events.length = 0;
      for (const l of listeners) l([]);
    },

    setEnabled(next) {
      if (next === enabled) return;
      enabled = next;
      emit({
        kind: "grant",
        tool: "protection",
        decision: next ? "allow" : "unprotected",
        reason: next ? "explicit_allow" : "unprotected",
        message: next
          ? "Protection is back on. Your house rules apply again."
          : "Protection is off. Anything the assistant asks for now happens, with nothing in the way.",
      });
    },
    isEnabled: () => enabled,
    isTakeoverInstalled: () => isInstalled(),

    async auditTools() {
      const found = await findOutOfReach(modelContext(), (name) => registry().has(name));
      const fresh: string[] = [];
      for (const tool of found) {
        if (reported.has(tool.name)) continue;
        reported.add(tool.name);
        fresh.push(tool.name);
        emit({
          kind: "register",
          tool: tool.name,
          // Not a denial. Grenz is not in this call's path, so there is no
          // decision to report — "unprotected" is the same word used when
          // someone switches protection off, and means the same thing here.
          decision: "unprotected",
          reason: "out_of_reach",
          message: tool.fromFrame
            ? `"${tool.name}" was registered by a frame on this page. Your rules never saw it, and cannot stop it.`
            : `"${tool.name}" is offered to agents but never passed through your rules.`,
          foreign: true,
          ...(tool.description ? { description: tool.description } : {}),
        });
      }
      return fresh;
    },
    sessionGrants: () => [...grants],
    revokeSessionGrants() {
      grants.clear();
    },
    setApprover(next) {
      approver = next;
    },
  };

  // A frame finishing its load is the one moment the parent can know new tools
  // may exist. Started after `api` is built so the first pass has something to
  // call. Never stopped: the page keeps this for its lifetime, like the takeover.
  watchFrames(() => void api.auditTools(), { scheduler: schedule });

  return api;
}

/**
 * The top-level property names of a tool's input schema, if it has any.
 * Deliberately shallow: the human reading the timeline needs to see that a
 * "diagnostics" tool asks for an alarm code, not to audit a JSON Schema.
 */
function inputFields(tool: ToolDescriptor): readonly string[] | undefined {
  const props = (tool.inputSchema as { properties?: Record<string, unknown> } | undefined)?.properties;
  if (!props) return undefined;
  const names = Object.keys(props);
  return names.length > 0 ? names : undefined;
}
