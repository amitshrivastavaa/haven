import { useCallback, useEffect, useMemo, useState } from "react";
import type { GrenzInstance, RegistryEntry } from "grenz-webmcp";

/**
 * The dev simulator.
 *
 * It is backed by Grenz's OWN registry, not by `getTools()`, so it still works
 * on a browser with no WebMCP at all — which is also the browser most people
 * will open this demo in. When native WebMCP is present, the second mode routes
 * the same call through `getTools()` + `executeTool()` to show that an in-page
 * JavaScript caller and an out-of-page agent hit the identical governed surface.
 *
 * One tool at a time, in a strip. It used to be every tool at once as a grid of
 * cards in a 74vh sheet, which had two faults: you only ever run one, and the
 * sheet buried the house — so the call landed somewhere you could not see it.
 * The whole claim being demonstrated is that a hand-written call goes through
 * the same rules and moves the same room, and you have to be able to watch that.
 *
 * Raw JSON stays. Unlike the approval card, this surface is for someone
 * checking the mechanism, and the point is to type arguments the site never
 * anticipated.
 */

const SEEDS: Record<string, unknown> = {
  get_house_state: {},
  get_doorbell_events: {},
  set_thermostat: { targetC: 19 },
  toggle_light: { lightId: "porch", on: true },
  set_scene: { scene: "movie" },
  lock_door: { doorId: "front" },
  unlock_door: { doorId: "front" },
  disarm_alarm: {},
  grant_permanent_access: { who: "Halden HVAC" },
  set_oven: { targetC: 180, minutes: 45 },
  eco_optimize: { aggressiveness: 3 },
  home_insights: { postcode: "SW1A 1AA", awaySchedule: "Weekdays 09:00-18:00", alarmCode: "4417" },
};

type Mode = "grenz" | "native";

export function Simulator({
  g,
  webmcp,
  onClose,
}: {
  g: GrenzInstance;
  webmcp: boolean;
  onClose: () => void;
}) {
  const [tools, setTools] = useState<RegistryEntry[]>(() => g.listTools());
  const [args, setArgs] = useState<Record<string, string>>({});
  const [out, setOut] = useState<Record<string, { text: string; denied: boolean }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("grenz");
  const [picked, setPicked] = useState<string | null>(null);

  // The registry changes when a tool registers or its signal aborts; both emit
  // timeline events, so the timeline is a good enough change signal.
  useEffect(() => g.subscribe(() => setTools(g.listTools())), [g]);

  useEffect(() => {
    if (!webmcp && mode === "native") setMode("grenz");
  }, [webmcp, mode]);

  // Third-party tools register after mount, and a tool can unregister when its
  // signal aborts — so the selection is resolved against the live list rather
  // than trusted to still exist.
  const selected = tools.find((t) => t.name === picked) ?? tools[0];

  const seeded = useMemo(
    () =>
      Object.fromEntries(
        tools.map((t) => [t.name, args[t.name] ?? JSON.stringify(SEEDS[t.name] ?? {}, null, 2)]),
      ),
    [tools, args],
  );

  const run = useCallback(
    async (name: string) => {
      let input: unknown;
      try {
        input = JSON.parse(seeded[name] || "{}");
      } catch (e) {
        setOut((p) => ({
          ...p,
          [name]: { text: `Invalid JSON: ${(e as Error).message}`, denied: true },
        }));
        return;
      }

      setBusy(name);
      try {
        let result: unknown;
        if (mode === "native") {
          const mc = document.modelContext ?? navigator.modelContext;
          if (!mc) throw new Error("WebMCP is not available in this browser");
          const native = await mc.getTools();
          const target = native.find((t) => t.name === name);
          if (!target) throw new Error(`"${name}" is not in getTools()`);
          // Native executeTool takes the arguments as a JSON string, not an object.
          result = await mc.executeTool(target, JSON.stringify(input));
        } else {
          result = await g.callTool(name, input);
        }

        const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        // A denial is a normal, readable result — that is the whole point of
        // resolving rather than rejecting.
        const denied = text.includes('"decision"') && text.includes('"deny"');
        setOut((p) => ({ ...p, [name]: { text: text ?? "undefined", denied } }));
      } catch (e) {
        setOut((p) => ({ ...p, [name]: { text: `Threw: ${(e as Error).message}`, denied: true } }));
      } finally {
        setBusy(null);
      }
    },
    [g, mode, seeded],
  );

  return (
    <aside className="sim" aria-label="Tool simulator">
      <div className="sim-head">
        <h2>Send a request by hand</h2>
        <div className="sim-mode">
          <button aria-pressed={mode === "grenz"} onClick={() => setMode("grenz")}>
            Grenz registry
          </button>
          <button
            aria-pressed={mode === "native"}
            onClick={() => setMode("native")}
            disabled={!webmcp}
            title={webmcp ? "Call through document.modelContext" : "Requires native WebMCP"}
          >
            getTools() / executeTool()
          </button>
        </div>
        <button className="x close" onClick={onClose} aria-label="Close the simulator">
          ✕
        </button>
      </div>

      <div className="sim-note">
        {mode === "grenz"
          ? "Goes through exactly the same house rules the assistant's requests do. Works even with no assistant connected."
          : "Goes out through document.modelContext, exactly as any script on this page would — and lands in the same house rules."}
      </div>

      {!selected ? (
        <div className="sim-empty">
          <strong>No tools registered</strong>
          Tools register when the app mounts. If you see this, something failed to load.
        </div>
      ) : (
        <div className="sim-body">
          <div className="sim-list" role="tablist" aria-label="Tools">
            {tools.map((tool) => (
              <button
                key={tool.name}
                role="tab"
                aria-selected={tool.name === selected.name}
                onClick={() => setPicked(tool.name)}
              >
                {tool.name}
                {tool.foreign && <span className="dot" title="Registered by a third-party script" />}
              </button>
            ))}
          </div>

          <div className="sim-detail">
            <div className="sim-tool-head">
              <code>{selected.name}</code>
              {selected.foreign && <span className="badge-foreign">third-party</span>}
            </div>
            <p className="sim-tool-desc">{selected.description}</p>

            <div className="sim-io">
              <label>
                <span>Arguments</span>
                <textarea
                  value={seeded[selected.name]}
                  spellCheck={false}
                  onChange={(e) =>
                    setArgs((p) => ({ ...p, [selected.name]: e.target.value }))
                  }
                  aria-label={`Arguments for ${selected.name}`}
                />
              </label>

              <div className="sim-result">
                <span>{out[selected.name]?.denied ? "Refused" : "Result"}</span>
                {out[selected.name] ? (
                  <pre className={out[selected.name]!.denied ? "denied" : "ok"}>
                    {out[selected.name]!.text}
                  </pre>
                ) : (
                  <pre className="idle">Nothing yet. Call the tool and watch the house.</pre>
                )}
              </div>
            </div>

            <button
              className="sim-run"
              onClick={() => run(selected.name)}
              disabled={busy === selected.name}
            >
              {busy === selected.name ? "Running…" : "Call tool"}
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}
