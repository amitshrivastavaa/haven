import { useEffect } from "react";

/**
 * Below this width the panel would cover the plan, so a scenario closes it
 * on the way out. Above it, the page shifts and both stay visible.
 */
const NARROW = 1180;

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
 *
 * Deliberately NOT modal. The whole point of a scenario is watching the house
 * react to it — the lights pool, the assistant moves, the door bolt slides —
 * so dimming the app behind a veil defeated the feature it exists to show.
 * The page shifts to make room instead, and stays live underneath.
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

  const play = (run: () => void) => () => {
    if (window.innerWidth < NARROW) onClose();
    run();
  };

  return (
    <aside className="demo" role="complementary" aria-label="Demo">
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
              onClick={play(s.run)}
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
  );
}
