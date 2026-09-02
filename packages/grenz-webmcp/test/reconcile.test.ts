import { describe, expect, test } from "bun:test";
import { findOutOfReach } from "../src/reconcile.ts";
import type { ModelContextLike } from "../src/types.ts";

/**
 * A stand-in for the browser's `getTools()`, shaped like the real one: Chrome
 * returns objects carrying `name, description, origin, window`, and `window` is
 * the registering window rather than the reading one. That last detail is the
 * whole point of the module, so the fake has to keep it.
 */
function context(tools: unknown[]): ModelContextLike {
  return {
    registerTool: async () => {},
    getTools: async () => tools,
  };
}

const here = globalThis.window;
const elsewhere = { name: "a child frame" } as unknown as Window;

describe("findOutOfReach", () => {
  test("says nothing about tools the registry already governs", async () => {
    const mc = context([
      { name: "unlock_door", description: "Unlock it", origin: "https://haven.test", window: here },
      { name: "lock_door", description: "Lock it", origin: "https://haven.test", window: here },
    ]);
    expect(await findOutOfReach(mc, () => true)).toEqual([]);
  });

  test("reports a tool the registry has never seen", async () => {
    const mc = context([
      { name: "unlock_door", description: "Unlock it", window: here },
      { name: "ghost", description: "Nobody's tool", origin: "https://haven.test", window: elsewhere },
    ]);
    const found = await findOutOfReach(mc, (name) => name === "unlock_door");
    expect(found).toHaveLength(1);
    expect(found[0]!.name).toBe("ghost");
    expect(found[0]!.origin).toBe("https://haven.test");
  });

  /**
   * The finding this module exists for. A same-origin child reports the SAME
   * origin as the parent, so origin cannot separate them and `window` must.
   */
  test("a same-origin frame is caught by window, which origin could not do", async () => {
    const mc = context([
      { name: "mine", description: "", origin: "https://haven.test", window: here },
      { name: "theirs", description: "", origin: "https://haven.test", window: elsewhere },
    ]);
    const found = await findOutOfReach(mc, (name) => name === "mine");
    expect(found.map((f) => [f.name, f.origin, f.fromFrame])).toEqual([
      ["theirs", "https://haven.test", true],
    ]);
  });

  test("an ungoverned tool in THIS window is reported, but not as a frame", async () => {
    const mc = context([{ name: "leaked", description: "", window: here }]);
    const found = await findOutOfReach(mc, () => false);
    expect(found[0]!.fromFrame).toBe(false);
  });

  test("a tool with no window at all is not guessed at", async () => {
    const mc = context([{ name: "polyfilled", description: "" }]);
    const found = await findOutOfReach(mc, () => false);
    expect(found[0]!.fromFrame).toBe(false);
  });

  test("no WebMCP means nothing to reconcile, not a crash", async () => {
    expect(await findOutOfReach(undefined, () => false)).toEqual([]);
    expect(await findOutOfReach({ registerTool: async () => {} }, () => false)).toEqual([]);
  });

  /**
   * An audit that throws takes down whatever asked for it. Since this runs off
   * a frame's load event, that would trade a reporting gap for a real one.
   */
  test("a getTools that rejects is survived, not propagated", async () => {
    const mc: ModelContextLike = {
      registerTool: async () => {},
      getTools: async () => {
        throw new Error("detached frame");
      },
    };
    expect(await findOutOfReach(mc, () => false)).toEqual([]);
  });

  test("junk entries are skipped rather than reported as nameless tools", async () => {
    const mc = context([null, 42, { description: "no name" }, { name: "real", description: "" }]);
    const found = await findOutOfReach(mc, () => false);
    expect(found.map((f) => f.name)).toEqual(["real"]);
  });
});
