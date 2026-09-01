import { useEffect } from "react";

/**
 * The demo drawer.
 *
 * These controls used to sit in the app's own frame, which made a product look
 * like a test harness — the single thing most likely to cost a reader's trust
 * in the rest of it. They are honest instruments, so they are labelled as
 * instruments and kept behind one click.
 *
 * Nothing in here is scripted playback. Every scenario is a real sequence of
 * real tool calls through the real pipeline, which is why one can be
 * interrupted by an approval card, and why one can fail.
 */

export interface Scenario {
  id: string;
  label: string;
  note: string;
  run: () => void;
  danger?: boolean;
}

export function Demo({
  scenarios,
  busy,
  onReset,
  onSimulator,
  onClose,
}: {
  scenarios: Scenario[];
  busy: boolean;
  onReset: () => void;
  onSimulator: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="demo-veil" onClick={onClose} />
      <aside className="demo" role="dialog" aria-modal="true" aria-label="Demo">
        <div className="demo-head">
          <div className="row">
            <h2>Demo</h2>
            <button className="demo-close" onClick={onClose}>
              Close
            </button>
          </div>
          <p>
            Ways to make the house do something without an assistant attached. Each one is a real
            sequence of real tool calls — the house rules answer them exactly as they would answer
            an agent, which is why one can stop to ask you.
          </p>
        </div>

        <div className="demo-body">
          <h3>Scenarios</h3>
          {scenarios.map((s) => (
            <button
              key={s.id}
              className={`scen ${s.danger ? "danger" : ""}`}
              onClick={s.run}
              disabled={busy}
            >
              <b>{s.label}</b>
              <span>{s.note}</span>
            </button>
          ))}

          <h3>For anyone checking the mechanism</h3>
          <button className="scen" onClick={onSimulator}>
            <b>Open the tool simulator</b>
            <span>
              Call any registered tool by hand, with your own arguments — through Grenz, or through
              the browser's own getTools() and executeTool() where WebMCP is available.
            </span>
          </button>
        </div>

        <div className="demo-foot">
          <button onClick={onReset}>Reset the house</button>
        </div>
      </aside>
    </>
  );
}
