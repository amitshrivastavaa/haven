/**
 * The policy engine: PURE and synchronous. It never touches the DOM, never
 * performs IO, and holds no timers. Everything here is directly unit-testable,
 * which is why the rate limiter takes its clock by injection rather than
 * reading `Date.now` itself.
 *
 * Pipeline steps 1-4 live here. Step 5 (the approval card) needs the DOM and a
 * human, so it lives in `grenz.ts` / `ui.ts`.
 */

import type {
  Constraint,
  Decision,
  GrenzConfig,
  RateLimit,
  ReasonCode,
  ToolAnnotations,
  ToolPolicy,
} from "./types.ts";

export interface EngineResult {
  readonly decision: Decision;
  readonly reason: ReasonCode;
  readonly message: string;
}

/** `approve` is author-facing sugar; internally there is only `require_approval`. */
export function toDecision(action: ToolPolicy["action"]): Decision {
  return action === "approve" ? "require_approval" : action;
}

/**
 * A tool is WRITE-classified when the site says so: either it declared a
 * consequence (`effect`) or it gated the tool behind a human (`approve`).
 * This is the site's ground truth — the only ground truth we actually have.
 */
export function isWriteClassified(policy: ToolPolicy): boolean {
  return policy.effect !== undefined || policy.action === "approve";
}

/**
 * Steps 1 and 2: policy lookup, then annotation mismatch.
 *
 * Order matters. An unpolicied tool exits at step 1 with `no_matching_allow` —
 * it has no policy to contradict, so it can never produce `annotation_mismatch`
 * no matter what it claims about itself. Its false claim is still recorded on
 * the timeline entry; it just isn't the reason for the denial.
 */
export function evaluate(
  config: GrenzConfig,
  name: string,
  annotations?: ToolAnnotations,
): EngineResult {
  const policy = config.tools?.[name];

  if (!policy) {
    const fallback = config.defaultAction ?? "deny";
    return fallback === "allow"
      ? {
          decision: "allow",
          reason: "explicit_allow",
          message: `No policy for "${name}"; the default action is allow.`,
        }
      : {
          decision: "deny",
          reason: "no_matching_allow",
          message: `"${name}" is not in the policy and the default action is deny.`,
        };
  }

  if (policy.action === "deny") {
    return {
      decision: "deny",
      reason: "explicit_deny",
      message: `"${name}" is denied by policy.`,
    };
  }

  // Step 2. The site classified this as a write; the registration claims it
  // only reads. One of the two is lying, so neither gets the benefit of doubt.
  if (annotations?.readOnlyHint === true && isWriteClassified(policy)) {
    return {
      decision: "deny",
      reason: "annotation_mismatch",
      // `effect` is written for the approval card, where it is the consequence
      // of the call — "anyone outside can walk in". Quoting it here as though
      // it were a description of the write forced every site to choose between
      // a sentence that reads on the card and one that reads in this denial.
      // Given its own sentence, either shape works. It is also quoted without
      // surrounding punctuation, so a site's full stop no longer collides with
      // the frame's.
      message:
        `"${name}" registered with readOnlyHint: true, but the site's policy classifies it ` +
        `as a write.` +
        `${policy.effect ? ` The site says: ${policy.effect}` : ""}` +
        ` A tool's description must match what it does.`,
    };
  }

  return policy.action === "approve"
    ? {
        decision: "require_approval",
        reason: "approval_required",
        message: policy.effect ?? `"${name}" requires your approval.`,
      }
    : {
        decision: "allow",
        reason: "explicit_allow",
        message: `"${name}" is allowed by policy.`,
      };
}

/**
 * Step 3: argument constraints. Returns a denial, or null when input is clean.
 * Constraint keys name top-level arguments; unknown arguments are not policed
 * (validating against the tool's own `inputSchema` is the platform's job).
 */
export function checkConstraints(
  constraints: Readonly<Record<string, Constraint>> | undefined,
  input: unknown,
): EngineResult | null {
  if (!constraints) return null;
  const args = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;

  for (const [key, rule] of Object.entries(constraints)) {
    const value = args[key];

    if (value === undefined || value === null) {
      if (rule.required) return deny(`"${key}" is required.`);
      continue;
    }

    const len =
      typeof value === "string" ? value.length : Array.isArray(value) ? value.length : undefined;
    if (len !== undefined) {
      if (rule.maxLength !== undefined && len > rule.maxLength) {
        return deny(`"${key}" is ${len} long; the policy allows at most ${rule.maxLength}.`);
      }
      if (rule.minLength !== undefined && len < rule.minLength) {
        return deny(`"${key}" is ${len} long; the policy requires at least ${rule.minLength}.`);
      }
    }

    if (rule.enum && !rule.enum.includes(value as string | number)) {
      return deny(`"${key}" must be one of: ${rule.enum.join(", ")}.`);
    }

    // A bound the site wrote is a statement about a number, so a value that is
    // not one fails it rather than skipping it. Checking the type only when it
    // happens to be right made every numeric constraint bypassable by quoting
    // the value: `max: 8` let `"40"` through, and NaN passed both comparisons
    // because every comparison against NaN is false. The same applies to
    // `pattern`, which a number used to slip past entirely.
    if (rule.min !== undefined || rule.max !== undefined) {
      if (typeof value !== "number" || Number.isNaN(value)) {
        return deny(`"${key}" must be a number.`);
      }
      if (rule.min !== undefined && value < rule.min) return deny(`"${key}" must be at least ${rule.min}.`);
      if (rule.max !== undefined && value > rule.max) return deny(`"${key}" must be at most ${rule.max}.`);
    }

    if (rule.pattern !== undefined) {
      if (typeof value !== "string") return deny(`"${key}" must be text.`);
      // Anchored: a constraint that matches a substring is not a constraint.
      if (!new RegExp(`^(?:${rule.pattern})$`).test(value)) {
        return deny(`"${key}" does not match the required format.`);
      }
    }
  }
  return null;
}

function deny(message: string): EngineResult {
  return { decision: "deny", reason: "constraint", message };
}

const WINDOW_MS: Record<RateLimit["per"], number> = {
  second: 1_000,
  minute: 60_000,
  hour: 3_600_000,
};

/**
 * Step 4: sliding-window rate limit, per tool. State is per-Grenz-instance and
 * per-page — a guardrail against a runaway agent loop, not a defence against a
 * determined attacker who already controls the page.
 */
export class RateLimiter {
  readonly #hits = new Map<string, number[]>();
  readonly #now: () => number;

  constructor(now: () => number = Date.now) {
    this.#now = now;
  }

  /** Records the call and returns a denial only when the window is already full. */
  check(name: string, limit: RateLimit | undefined): EngineResult | null {
    if (!limit) return null;
    const now = this.#now();
    const since = now - WINDOW_MS[limit.per];
    const recent = (this.#hits.get(name) ?? []).filter((t) => t > since);

    if (recent.length >= limit.calls) {
      this.#hits.set(name, recent);
      return {
        decision: "deny",
        reason: "rate_limit",
        message: `"${name}" is limited to ${limit.calls} calls per ${limit.per}; that budget is spent.`,
      };
    }

    recent.push(now);
    this.#hits.set(name, recent);
    return null;
  }
}
