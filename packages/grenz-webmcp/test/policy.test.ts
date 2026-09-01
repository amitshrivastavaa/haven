import { describe, expect, test } from "bun:test";
import { RateLimiter, checkConstraints, evaluate, isWriteClassified } from "../src/policy.ts";
import type { GrenzConfig } from "../src/types.ts";

const config: GrenzConfig = {
  defaultAction: "deny",
  tools: {
    get_house_state: { action: "allow", rateLimit: { calls: 3, per: "minute" } },
    toggle_light: { action: "allow" },
    export_history: { action: "allow", effect: "Downloads every camera clip and door event." },
    unlock_door: {
      action: "approve",
      effect: "Unlocks your front door. Anyone outside can walk in.",
      constraints: { note: { maxLength: 20 }, doorId: { required: true, pattern: "door-\\d+" } },
    },
    never: { action: "deny" },
  },
};

describe("step 1 — policy lookup", () => {
  test("denies an unpolicied tool by default", () => {
    const r = evaluate(config, "finalize_access");
    expect(r.decision).toBe("deny");
    expect(r.reason).toBe("no_matching_allow");
  });

  test("allows an unpolicied tool when defaultAction is allow", () => {
    const r = evaluate({ ...config, defaultAction: "allow" }, "finalize_access");
    expect(r.decision).toBe("allow");
  });

  test("deny beats everything else in the entry", () => {
    expect(evaluate(config, "never").reason).toBe("explicit_deny");
  });

  test("allow and approve resolve as written", () => {
    expect(evaluate(config, "get_house_state").decision).toBe("allow");
    expect(evaluate(config, "unlock_door").decision).toBe("require_approval");
  });
});

describe("step 2 — annotation mismatch", () => {
  test("catches a write-classified tool claiming readOnlyHint", () => {
    const r = evaluate(config, "unlock_door", { readOnlyHint: true });
    expect(r.decision).toBe("deny");
    expect(r.reason).toBe("annotation_mismatch");
  });

  test("an effect string alone is enough to classify a tool as a write", () => {
    expect(isWriteClassified({ action: "allow", effect: "x" })).toBe(true);
    const r = evaluate(config, "export_history", { readOnlyHint: true });
    expect(r.reason).toBe("annotation_mismatch");
  });

  // The message is what an agent reads back, and what the tool simulator
  // shows. It is also the one place `effect` is quoted outside the approval
  // card, so it has to read whether the site wrote a consequence
  // ("anyone outside can walk in") or an action ("changes the setpoint").
  test("the denial explains itself without mangling the site's sentence", () => {
    const site = { action: "approve", effect: "Anyone outside can walk in." } as const;
    const r = evaluate({ tools: { d: site } }, "d", { readOnlyHint: true });
    expect(r.message).toBe(
      `"d" registered with readOnlyHint: true, but the site's policy classifies it as a write. ` +
        `The site says: Anyone outside can walk in. ` +
        `A tool's description must match what it does.`,
    );
    // No doubled full stop where the site's sentence ends.
    expect(r.message).not.toMatch(/\.\s*\./);
  });

  test("a genuine read-only tool is untouched", () => {
    expect(evaluate(config, "get_house_state", { readOnlyHint: true }).decision).toBe("allow");
  });

  test("an unpolicied tool can never mismatch — it has no policy to contradict", () => {
    // This is the demo's attack scene. The claim is false, but the reason is
    // still `no_matching_allow`; overclaiming here would be a lie on camera.
    const r = evaluate(config, "finalize_access", { readOnlyHint: true });
    expect(r.reason).toBe("no_matching_allow");
  });
});

describe("step 3 — argument constraints", () => {
  const c = config.tools!.unlock_door!.constraints;

  test("passes clean input", () => {
    expect(checkConstraints(c, { doorId: "door-42", note: "short" })).toBeNull();
  });

  test("catches maxLength with the specific numbers", () => {
    const r = checkConstraints(c, { doorId: "door-42", note: "x".repeat(21) });
    expect(r?.reason).toBe("constraint");
    expect(r?.message).toContain("21");
    expect(r?.message).toContain("20");
  });

  test("catches a missing required argument", () => {
    expect(checkConstraints(c, { note: "ok" })?.message).toContain("required");
  });

  test("patterns are anchored, so a substring match is still a violation", () => {
    expect(checkConstraints(c, { doorId: "not-a-door-42-really" })?.reason).toBe("constraint");
    expect(checkConstraints(c, { doorId: "door-42" })).toBeNull();
  });

  test("enum and numeric range", () => {
    const rules = { sort: { enum: ["asc", "desc"] }, limit: { min: 1, max: 50 } };
    expect(checkConstraints(rules, { sort: "sideways" })?.reason).toBe("constraint");
    expect(checkConstraints(rules, { limit: 99 })?.reason).toBe("constraint");
    expect(checkConstraints(rules, { sort: "asc", limit: 10 })).toBeNull();
  });

  test("non-object input does not throw", () => {
    expect(checkConstraints(c, undefined)?.reason).toBe("constraint"); // doorId required
    expect(checkConstraints(undefined, { anything: true })).toBeNull();
  });
});

describe("step 4 — sliding-window rate limit", () => {
  const limit = { calls: 3, per: "minute" } as const;

  test("allows up to the budget, then denies", () => {
    let now = 1_000_000;
    const rl = new RateLimiter(() => now);
    expect(rl.check("get_house_state", limit)).toBeNull();
    expect(rl.check("get_house_state", limit)).toBeNull();
    expect(rl.check("get_house_state", limit)).toBeNull();
    expect(rl.check("get_house_state", limit)?.reason).toBe("rate_limit");
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
