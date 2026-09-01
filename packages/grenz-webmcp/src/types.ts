/**
 * Public types for grenz-webmcp.
 *
 * Vocabulary is deliberately shared with the Grenz core policy engine
 * (`proxy/src/policy/types.ts` in the grenz repo): the same `Decision` union
 * and the same `ReasonCode` strings, so a browser timeline and a server audit
 * log describe the same event with the same word. Core is NOT a dependency —
 * it is server-side. Only the vocabulary travels.
 */

/** The three terminal decisions a policy can produce. Verbatim from core. */
export type Decision = "allow" | "deny" | "require_approval";

/**
 * Structured, machine-readable reason codes. Safe to log and safe to hand to
 * an agent: none of them ever carry a value drawn from request data.
 */
export type ReasonCode =
  // --- adopted verbatim from Grenz core ---
  | "explicit_allow"
  | "explicit_deny"
  | "approval_required"
  | "no_matching_allow"
  | "approval_granted"
  | "approval_denied"
  | "approval_expired"
  | "approval_abandoned"
  | "approval_remembered_grant"
  // --- browser-only, no core equivalent ---
  /** Registration's `readOnlyHint` contradicts the site's own classification. */
  | "annotation_mismatch"
  /**
   * A second registration tried to take a name the registry already holds.
   * Refused rather than overwritten: a call resolves by name at invoke time,
   * so replacing an entry would hand the newcomer the verdict the site wrote
   * for the tool it displaced.
   */
  | "name_collision"
  /** An argument violated a policy constraint. */
  | "constraint"
  /** Sliding-window rate limit exceeded. */
  | "rate_limit"
  /** Protection was switched off; the call ran ungoverned. Timeline-only. */
  /**
   * Something clicked Approve that was not a person. Browsers mark every event
   * they synthesise from real input `isTrusted: true`, and nothing running in
   * the page can forge that — so a script, a partner widget or an injected
   * tool trying to grant its own permission is detectable, and is treated as
   * an answer of no.
   */
  | "approval_synthetic"
  /** A person proved they were there. */
  | "approval_present"
  /** A ceremony ran, but nothing off-page checked the signature. */
  | "presence_unverified"
  /** The ceremony ran and was not satisfied. */
  | "presence_refused"
  /** The site required presence and this device cannot prove it. */
  | "presence_unavailable"
  | "unprotected";

/** Config sugar. `approve` is the author-facing spelling of `require_approval`. */
export type ToolAction = "allow" | "deny" | "approve";

/** Per-argument constraints, checked against the agent's input before execute. */
export interface Constraint {
  readonly maxLength?: number;
  readonly minLength?: number;
  readonly enum?: readonly (string | number)[];
  readonly min?: number;
  readonly max?: number;
  /** Anchored implicitly: the whole value must match. */
  readonly pattern?: string;
  readonly required?: boolean;
}

export interface RateLimit {
  readonly calls: number;
  readonly per: "second" | "minute" | "hour";
}

export interface ToolPolicy {
  readonly action: ToolAction;
  /**
   * Plain-language consequence, shown to the human on the approval card. Its
   * presence is also the site's declaration that this tool WRITES — which is
   * what an `readOnlyHint: true` registration would contradict.
   */
  readonly effect?: string;
  /**
   * The site's own words for what this specific call is asking to do.
   *
   * The approval card is read by a resident, not a developer, and
   * `{"doorId": "front"}` is not a sentence anyone should have to parse while
   * deciding whether to open their front door. Only the site can turn the
   * arguments into language — it wrote the tool, so it knows `front` is the
   * front door and that `targetC` is degrees.
   *
   * Trustworthy for the same reason `effect` is: this comes from the site's
   * policy entry for one named tool, so it can neither be supplied by the
   * agent nor describe a different tool than the one being called. What it
   * must never become is a summary that drops a value the human needs — if it
   * omits an argument that changes the decision, the card is lying with the
   * site's own voice. Return undefined to fall back to showing the arguments
   * as they arrived.
   */
  readonly describe?: (input: Record<string, unknown>) => string | undefined;
  /**
   * Require proof that a person is present, not just that the click was real.
   *
   * `isTrusted` already stops anything in the page from approving. This is the
   * next rung: a WebAuthn ceremony the platform draws rather than the DOM, so
   * there is no element to click and satisfying it takes a fingerprint, a face
   * or a key. An agent driving the mouse has none of those.
   *
   * "required" refuses the call when the device has no authenticator.
   * "preferred" falls back to the trusted click — and records that it did, so
   * the weaker check is never silent.
   */
  readonly presence?: PresenceMode;
  readonly constraints?: Readonly<Record<string, Constraint>>;
  readonly rateLimit?: RateLimit;
}

export interface GrenzConfig {
  /**
   * Where a presence proof gets checked.
   *
   * Without one the ceremony still stops every attacker sharing the page, but
   * the signature goes unverified and a replay is not caught — so the trail
   * says `presence_unverified` rather than claiming a proof it did not check.
   */
  readonly presence?: Verifier;
  /** Anything not named in `tools` takes this. Default: "deny". */
  readonly defaultAction?: "deny" | "allow";
  readonly tools?: Readonly<Record<string, ToolPolicy>>;
  readonly approval?: { readonly timeoutMs?: number };
  /** Host-app hook, called for every timeline event as it is appended. */
  readonly onEvent?: (event: TimelineEvent) => void;
  /** Injected for tests. Defaults to `Date.now`. */
  readonly clock?: () => number;
  /**
   * Injected for tests. Returns a cancel function. Defaults to `setTimeout`.
   * Injected rather than fake-timed because Bun's fake timers are partial.
   */
  readonly scheduler?: (fn: () => void, ms: number) => () => void;
}

/**
 * `policy` records a change to the rules themselves. Loosening a rule is the
 * highest-value move an attacker can make — it buys every future call at once
 * — so it cannot be the one thing the trail does not show.
 */
import type { PresenceMode, Verifier } from "./presence.ts";

export type EventKind = "register" | "call" | "grant";

export interface TimelineEvent {
  readonly id: string;
  readonly at: number;
  readonly kind: EventKind;
  readonly tool: string;
  /** "unprotected" is not a Decision — the pipeline did not run. */
  readonly decision: Decision | "unprotected";
  readonly reason: ReasonCode;
  /** Human-readable, shown in the timeline UI. */
  readonly message: string;
  /** The agent's arguments, as given. Absent on `register` events. */
  readonly input?: unknown;
  /** Truncated JSON of the tool's own result, on a successful execute. */
  readonly result?: string;
  /** Registered without going through `g.registerTool` — i.e. via the takeover. */
  readonly foreign?: boolean;
  /** The tool's registration claimed `readOnlyHint: true`. */
  readonly claimedReadOnly?: boolean;
  /**
   * The tool declared `untrustedContentHint: true` — its result may carry
   * content the site does not vouch for. The spec names this as a mitigation
   * ("Untrusted Annotation for Tool Responses") but leaves acting on it to the
   * client, which means the human never sees it. Here they do.
   */
  readonly untrustedContent?: boolean;
  /**
   * The description the agent was given, recorded for third-party
   * registrations. Tool metadata is an injection surface in its own right
   * (arXiv:2606.06387 calls this "Tool Framing"), and it is otherwise
   * invisible to the human: the agent reads it, the user never does.
   */
  readonly description?: string;
  /**
   * Top-level input fields a third-party tool asked the agent to supply.
   * The spec calls over-parameterization a privacy threat in its own right —
   * a schema can sweet-talk an agent into volunteering things the task never
   * needed. Like `description`, this is recorded only for foreign tools: what
   * a site asks its own tools for is not evidence of anything.
   */
  readonly requestedFields?: readonly string[];
}

/** What a denied call resolves with. Never a rejection — see README. */
export interface GrenzDenial {
  readonly grenz: {
    readonly decision: "deny";
    readonly reason: ReasonCode;
    readonly message: string;
  };
}

// --- WebMCP surface (structural; the spec's own types are not shipped yet) ---

export interface ToolAnnotations {
  readonly readOnlyHint?: boolean;
  readonly untrustedContentHint?: boolean;
}

export interface ToolDescriptor {
  readonly name: string;
  readonly title?: string;
  readonly description: string;
  readonly inputSchema?: object;
  execute: (input: any, ctx: { signal: AbortSignal }) => Promise<unknown>;
  readonly annotations?: ToolAnnotations;
}

export interface RegisterOptions {
  readonly signal?: AbortSignal;
  readonly exposedTo?: string[];
}

export interface ModelContextLike {
  registerTool(tool: ToolDescriptor, options?: RegisterOptions): Promise<void>;
  getTools?: () => Promise<unknown[]>;
  executeTool?: (tool: unknown, input?: unknown) => Promise<string>;
}
