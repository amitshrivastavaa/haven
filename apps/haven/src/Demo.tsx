import { useEffect, useState } from "react";

/**
 * The demo dock.
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
 * A bar rather than a drawer. The whole point of a scenario is watching the
 * house react to it — the lights pool, the bolt slides, the rail fills — so a
 * 430px panel that took a quarter of the screen was competing with the thing
 * it exists to show. Six buttons need a transport control, not a sidebar: the
 * house keeps its full width, and you can fire one scenario after another
 * without the layout moving underneath you.
 *
 * Its own handle opens it. The trigger used to live in the header, eight
 * hundred pixels from the bar it opened, so the bar read as having arrived
 * from nowhere — the same reason the simulator feels placed, and it is
 * launched from here. Collapsed, this is a pill in the bottom corner;
 * expanded, that pill is the bar's first control. One object, two sizes.
 *
 * The notes each scenario carries are worth reading, so they are not thrown
 * away with the panel — one line above the pills shows whichever scenario the
 * pointer or keyboard is on, and `title` keeps the same text reachable.
 */

const RESTING =
  "Every one is a real sequence of real tool calls. The house rules answer them exactly as they " +
  "would answer an agent, which is why one can stop to ask you.";

const SIM_NOTE =
  "Call any registered tool by hand, with your own arguments — through Grenz, or through the " +
  "browser's own getTools() and executeTool() where WebMCP is available.";

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
  open,
  onOpen,
  onReset,
  onSimulator,
  onClose,
}: {
  scenarios: Scenario[];
  busy: boolean;
  open: boolean;
  onOpen: () => void;
  onReset: () => void;
  onSimulator: () => void;
  onClose: () => void;
}) {
  const [hint, setHint] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /** Hover and focus both drive the hint, so it works without a pointer. */
  const shows = (note: string) => ({
    onMouseEnter: () => setHint(note),
    onMouseLeave: () => setHint(null),
    onFocus: () => setHint(note),
    onBlur: () => setHint(null),
  });

  if (!open) {
    return (
      <div className="dock shut">
        <div className="dock-row">
          <button className="dock-handle" onClick={onOpen} aria-expanded={false}>
            <span className="chev" aria-hidden="true">
              ⌃
            </span>
            Demo
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="dock" role="complementary" aria-label="Demo">
      <p className="dock-hint">{hint ?? RESTING}</p>

      <div className="dock-row">
        {/* The handle stays put and turns into the close control, so the thing
            that opened the bar is the thing that shuts it. */}
        <button className="dock-handle open" onClick={onClose} aria-expanded={true}>
          <span className="chev" aria-hidden="true">
            ⌃
          </span>
          Demo
        </button>

        <div className="dock-scen">
          {scenarios.map((s) => (
            <button
              key={s.id}
              className={`pill ${s.danger ? "danger" : ""}`}
              onClick={s.run}
              disabled={busy}
              title={s.note}
              {...shows(s.note)}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="dock-tools">
          <button onClick={onSimulator} title={SIM_NOTE} {...shows(SIM_NOTE)}>
            Tool simulator
          </button>
          <button onClick={onReset} {...shows("Put the house back the way it started.")}>
            Reset
          </button>
        </div>
      </div>
    </div>
  );
}
