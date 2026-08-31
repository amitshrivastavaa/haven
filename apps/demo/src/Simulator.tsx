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
 */

const SEEDS: Record<string, unknown> = {
  search_jobs: { query: "", tags: ["typescript"], remote: true, minSalary: 90000, limit: 5 },
  get_job: { jobId: "job-1041" },
  list_applications: {},
  save_draft: {
    jobId: "job-1041",
    coverLetter:
      "I have spent four years maintaining a component library that three teams depended on, and I have the scar tissue to prove it.",
  },
  submit_application: { jobId: "job-1041" },
  withdraw_application: { jobId: "job-1041", reason: "Took another offer." },
  finalize_application: { jobId: "job-1041" },
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

  // The registry changes when a tool registers or its signal aborts; both emit
  // timeline events, so the timeline is a good enough change signal.
  useEffect(() => g.subscribe(() => setTools(g.listTools())), [g]);

  useEffect(() => {
    if (!webmcp && mode === "native") setMode("grenz");
  }, [webmcp, mode]);

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
          const mc = (document as any).modelContext ?? (navigator as any).modelContext;
          const native = (await mc.getTools()) as { name: string }[];
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
        <h2>Tool simulator</h2>
        <button className="close" onClick={onClose} aria-label="Close simulator">
          ×
        </button>
      </div>

      <div className="sim-mode">
        <button className={mode === "grenz" ? "on" : ""} onClick={() => setMode("grenz")}>
          Grenz registry
        </button>
        <button
          className={mode === "native" ? "on" : ""}
          onClick={() => setMode("native")}
          disabled={!webmcp}
          title={webmcp ? "Call through document.modelContext" : "Requires native WebMCP"}
        >
          getTools() / executeTool()
        </button>
      </div>

      <div className="sim-note">
        {mode === "grenz"
          ? "Calls go through the same policy pipeline an agent's calls do. This mode works even with no WebMCP in the browser."
          : "Calls go out through document.modelContext, exactly as an in-page JavaScript caller would — and land in the same policy."}
      </div>

      <div className="sim-body">
        {tools.length === 0 ? (
          <div className="empty-detail" style={{ height: "auto", padding: "40px 10px" }}>
            <div className="inner">
              <h2>No tools registered</h2>
              <p>Tools register when the app mounts. If you see this, something failed to load.</p>
            </div>
          </div>
        ) : (
          tools.map((tool) => (
            <div className="sim-tool" key={tool.name}>
              <div className="sim-tool-head">
                <code>{tool.name}</code>
                {tool.foreign && <span className="badge-foreign">third-party</span>}
              </div>
              <div className="sim-tool-desc">{tool.description}</div>
              <div className="sim-tool-body">
                <textarea
                  value={seeded[tool.name]}
                  spellCheck={false}
                  onChange={(e) => setArgs((p) => ({ ...p, [tool.name]: e.target.value }))}
                  aria-label={`Arguments for ${tool.name}`}
                />
                <div className="sim-run">
                  <button
                    className="btn btn-primary"
                    style={{ padding: "6px 13px", fontSize: 12 }}
                    onClick={() => run(tool.name)}
                    disabled={busy === tool.name}
                  >
                    {busy === tool.name ? "Running…" : "Call tool"}
                  </button>
                </div>
                {out[tool.name] && (
                  <pre className={`sim-out ${out[tool.name]!.denied ? "denied" : "ok"}`}>
                    {out[tool.name]!.text}
                  </pre>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
