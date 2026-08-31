/**
 * Day-one spike, as its own bundle.
 *
 * The question this answers is mechanical and cannot be answered by a unit
 * test: in a REAL browser, with the install shipped as a separate classic
 * script, does patching a prototype derived from the live ModelContext
 * instance actually intercept a later direct `registerTool` call — and does it
 * do so exactly once?
 *
 * The page loads three separate scripts in the deployment order a real site
 * would use, so the cross-bundle shared-state path is exercised for real.
 */

import { grenz } from "../src/index.ts";

declare global {
  interface Window {
    __spike: (name: string, pass: boolean, detail?: string) => void;
    __spikeDone: () => void;
  }
}

const g = grenz({
  defaultAction: "deny",
  tools: { get_house_state: { action: "allow" } },
});

const mc = (document as any).modelContext;
let thirdPartyRan: string[] = [];

async function main() {
  const t = window.__spike;

  t("install patched a native registration surface", g.isTakeoverInstalled());

  await g.registerTool({
    name: "get_house_state",
    description: "search",
    annotations: { readOnlyHint: true },
    execute: async () => ({ lights: ["porch", "kitchen"] }),
  });

  // --- a third-party script, registering directly, knowing nothing of Grenz ---
  const original = async ({ doorId }: { doorId: string }) => {
    thirdPartyRan.push(doorId);
    return { finalized: true };
  };
  await mc.registerTool({
    name: "finalize_access",
    title: "Finalize access",
    description: "Finalize visitor access for review",
    annotations: { readOnlyHint: true },
    execute: original,
  });

  const stored = mc.tools.get("finalize_access");
  t("the platform holds a WRAPPED tool, not the third party's own", stored.execute !== original);

  // The agent calls it through the platform, the way an agent actually would.
  const denied = await mc.executeTool(stored, { doorId: "door-1" });
  const parsed = JSON.parse(denied);
  t("the call is denied", parsed?.grenz?.decision === "deny", denied);
  t("with reason no_matching_allow", parsed?.grenz?.reason === "no_matching_allow", denied);
  t("the third party's implementation never ran", thirdPartyRan.length === 0);

  t(
    "wrapped exactly once (no double layer across the two bundles)",
    g.getTimeline().filter((e) => e.kind === "register" && e.tool === "finalize_access")
      .length === 1,
  );

  // --- the protection toggle, on the ALREADY-registered tool ---
  g.setEnabled(false);
  const ran = JSON.parse(await mc.executeTool(stored, { doorId: "door-2" }));
  t("protection OFF: the same registered tool now runs", ran?.finalized === true);
  t("and it really submitted", thirdPartyRan.join() === "door-2");

  g.setEnabled(true);
  const denied2 = JSON.parse(await mc.executeTool(stored, { doorId: "door-3" }));
  t("protection ON again: denied again, no re-registration", denied2?.grenz?.decision === "deny");
  t("nothing more submitted", thirdPartyRan.join() === "door-2");

  const allowed = JSON.parse(await mc.executeTool(mc.tools.get("get_house_state"), {}));
  t("a policied tool still works normally", Array.isArray(allowed?.lights));

  window.__spikeDone();
}

void main().catch((e) => {
  window.__spike("spike ran without throwing", false, `${e && (e as Error).stack ? (e as Error).stack : String(e)}`);
  window.__spikeDone();
});
