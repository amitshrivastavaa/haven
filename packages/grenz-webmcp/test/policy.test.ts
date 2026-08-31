import { describe, expect, test } from "bun:test";
import { RateLimiter, checkConstraints, evaluate, isWriteClassified } from "../src/policy.ts";
import type { GrenzConfig } from "../src/types.ts";

const config: GrenzConfig = {
  defaultAction: "deny",
  tools: {
    search_jobs: { action: "allow", rateLimit: { calls: 3, per: "minute" } },
    save_draft: { action: "allow" },
    export_all: { action: "allow", effect: "Downloads every application you have made." },
    submit_application: {
      action: "approve",
      effect: "Sends your application to the employer. This cannot be undone.",
      constraints: { coverLetter: { maxLength: 20 }, jobId: { required: true, pattern: "job-\\d+" } },
    },
    never: { action: "deny" },
  },
};

describe("step 1 — policy lookup", () => {
  test("denies an unpolicied tool by default", () => {
    const r = evaluate(config, "finalize_application");
    expect(r.decision).toBe("deny");
    expect(r.reason).toBe("no_matching_allow");
  });

  test("allows an unpolicied tool when defaultAction is allow", () => {
    const r = evaluate({ ...config, defaultAction: "allow" }, "finalize_application");
    expect(r.decision).toBe("allow");
  });

  test("deny beats everything else in the entry", () => {
    expect(evaluate(config, "never").reason).toBe("explicit_deny");
  });

  test("allow and approve resolve as written", () => {
    expect(evaluate(config, "search_jobs").decision).toBe("allow");
    expect(evaluate(config, "submit_application").decision).toBe("require_approval");
  });
});

describe("step 2 — annotation mismatch", () => {
  test("catches a write-classified tool claiming readOnlyHint", () => {
    const r = evaluate(config, "submit_application", { readOnlyHint: true });
    expect(r.decision).toBe("deny");
    expect(r.reason).toBe("annotation_mismatch");
  });

  test("an effect string alone is enough to classify a tool as a write", () => {
    expect(isWriteClassified({ action: "allow", effect: "x" })).toBe(true);
    const r = evaluate(config, "export_all", { readOnlyHint: true });
    expect(r.reason).toBe("annotation_mismatch");
  });

  test("a genuine read-only tool is untouched", () => {
    expect(evaluate(config, "search_jobs", { readOnlyHint: true }).decision).toBe("allow");
  });

  test("an unpolicied tool can never mismatch — it has no policy to contradict", () => {
    // This is the demo's attack scene. The claim is false, but the reason is
    // still `no_matching_allow`; overclaiming here would be a lie on camera.
    const r = evaluate(config, "finalize_application", { readOnlyHint: true });
    expect(r.reason).toBe("no_matching_allow");
  });
});

describe("step 3 — argument constraints", () => {
  const c = config.tools!.submit_application!.constraints;

  test("passes clean input", () => {
    expect(checkConstraints(c, { jobId: "job-42", coverLetter: "short" })).toBeNull();
  });

  test("catches maxLength with the specific numbers", () => {
    const r = checkConstraints(c, { jobId: "job-42", coverLetter: "x".repeat(21) });
    expect(r?.reason).toBe("constraint");
    expect(r?.message).toContain("21");
    expect(r?.message).toContain("20");
  });

  test("catches a missing required argument", () => {
    expect(checkConstraints(c, { coverLetter: "ok" })?.message).toContain("required");
  });

  test("patterns are anchored, so a substring match is still a violation", () => {
    expect(checkConstraints(c, { jobId: "not-a-job-42-really" })?.reason).toBe("constraint");
    expect(checkConstraints(c, { jobId: "job-42" })).toBeNull();
  });

  test("enum and numeric range", () => {
    const rules = { sort: { enum: ["asc", "desc"] }, limit: { min: 1, max: 50 } };
    expect(checkConstraints(rules, { sort: "sideways" })?.reason).toBe("constraint");
    expect(checkConstraints(rules, { limit: 99 })?.reason).toBe("constraint");
    expect(checkConstraints(rules, { sort: "asc", limit: 10 })).toBeNull();
  });

  test("non-object input does not throw", () => {
    expect(checkConstraints(c, undefined)?.reason).toBe("constraint"); // jobId required
    expect(checkConstraints(undefined, { anything: true })).toBeNull();
  });
});

describe("step 4 — sliding-window rate limit", () => {
  const limit = { calls: 3, per: "minute" } as const;

  test("allows up to the budget, then denies", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(() => now);
    expect(rl.check("search_jobs", limit)).toBeNull();
    expect(rl.check("search_jobs", limit)).toBeNull();
    expect(rl.check("search_jobs", limit)).toBeNull();
    expect(rl.check("search_jobs", limit)?.reason).toBe("rate_limit");
  });

  test("the window slides — budget returns as calls age out", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(() => now);
    for (let i = 0; i < 3; i++) rl.check("t", limit);
    expect(rl.check("t", limit)?.reason).toBe("rate_limit");
    now += 60_001;
    expect(rl.check("t", limit)).toBeNull();
  });

  test("budgets are per tool", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(() => now);
    for (let i = 0; i < 3; i++) rl.check("a", limit);
    expect(rl.check("a", limit)?.reason).toBe("rate_limit");
    expect(rl.check("b", limit)).toBeNull();
  });

  test("a denied call does not consume budget", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(() => now);
    for (let i = 0; i < 3; i++) rl.check("t", limit);
    rl.check("t", limit); // denied
    now += 60_001;
    // If the denial had been recorded, the window would still be occupied here.
    expect(rl.check("t", limit)).toBeNull();
  });

  test("no limit configured means no limiting", () => {
    const rl = new RateLimiter(() => 0);
    for (let i = 0; i < 100; i++) expect(rl.check("t", undefined)).toBeNull();
  });
});
