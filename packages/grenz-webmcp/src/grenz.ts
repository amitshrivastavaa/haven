/**
 * The Grenz instance: enforcement pipeline, audit timeline, and the surface the
 * demo and simulator talk to.
 *
 * The pure decision logic lives in `policy.ts`. This file is the part with
 * state and effects — the registry, the human, the clock.
 */

import { RateLimiter, checkConstraints, evaluate } from "./policy.ts";
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
import type {
  GrenzConfig,
  GrenzDenial,
  ReasonCode,
  RegisterOptions,
  TimelineEvent,
  ToolDescriptor,
} from "./types.ts";

export interface ApprovalRequest {
  readonly tool: string;
  readonly title: string;
  /** The site-declared consequence. The most important string on the card. */
  readonly effect: string;
  readonly input: unknown;
  readonly timeoutMs: number;
  /** Aborts when the request is resolved elsewhere (timeout, agent hang-up). */
  readonly close: AbortSignal;
}

export interface ApprovalOutcome {
  readonly granted: boolean;
  /** "Approve for the rest of this session" was ticked. */
  readonly remember?: boolean;
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
          input,
          timeoutMs,
          close: closer.signal,
        })
          .then((o) =>
            finish({
              granted: o.granted,
              reason: o.granted ? "approval_granted" : "approval_denied",
              remember: o.remember,
            }),
          )
          .catch(() => finish({ granted: false, reason: "approval_denied" }));
      },
    );

    if (outcome.granted && outcome.remember) {
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
        ? `Third-party script registered "${tool.name}". ${verdict.decision === "deny" ? "It is governed but not permitted to run." : "Governed by policy."}`
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
      const mc = modelContext();
      if (mc) {
        // Route through the native surface so the patch is the single funnel —
        // no second code path to keep in sync with the takeover.
        await registerAsFirstParty(() => mc.registerTool(tool, options));
        return;
      }
      // No WebMCP on this page. The registry (and therefore the simulator) is
      // still the source of truth, so the demo works with the API absent.
      wrap(tool, options, false);
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
        tool: "grenz.protection",
        decision: next ? "allow" : "unprotected",
        reason: next ? "explicit_allow" : "unprotected",
        message: next
          ? "Grenz protection ON. Every tool call is governed again."
          : "Grenz protection OFF. Tool calls run ungoverned — this is what an unprotected page looks like.",
      });
    },
    isEnabled: () => enabled,
    isTakeoverInstalled: () => isInstalled(),
    sessionGrants: () => [...grants],
    revokeSessionGrants() {
      grants.clear();
    },
    setApprover(next) {
      approver = next;
    },
  };

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
