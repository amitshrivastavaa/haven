import type { ReactNode } from "react";
import { SCENES } from "./house";
import type { DoorbellEvent, SceneId } from "./types";

const Shield = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
  </svg>
);

const ShieldOff = ({ size = 15 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    <path d="M3 3l18 18" />
  </svg>
);

export function Header({
  webmcp,
  polyfilled,
  protection,
  onProtection,
  widgets,
  onWidgets,
  simOpen,
  onSim,
  onRunaway,
}: {
  webmcp: boolean;
  polyfilled: boolean;
  protection: boolean;
  onProtection: (next: boolean) => void;
  widgets: boolean;
  onWidgets: (next: boolean) => void;
  simOpen: boolean;
  onSim: () => void;
  onRunaway: () => void;
}) {
  return (
    <header className="header">
      <div className="brand">
        <div className="brand-mark">H</div>
        <div>
          <div className="brand-name">Haven</div>
          <div className="brand-sub">agent-ready home control</div>
        </div>
      </div>

      <div className="header-tools">
        <span
          className={`pill ${webmcp ? "live" : "absent"}`}
          title={
            polyfilled
              ? "A demo polyfill is standing in for the browser's WebMCP — not the real API"
              : "document.modelContext"
          }
        >
          <span className="dot" />
          {!webmcp ? "WebMCP unavailable" : polyfilled ? "WebMCP (polyfill)" : "WebMCP live"}
        </span>

        <button className="ghost-btn" onClick={onRunaway} title="Fires toggle_light twelve times against a limit of eight">
          Runaway agent
        </button>

        <button
          className={`ghost-btn ${widgets ? "active" : ""}`}
          onClick={() => onWidgets(!widgets)}
          title="Loads EcoSaver and Home Insights, which register straight at document.modelContext"
        >
          {widgets ? "✓ Third-party scripts" : "Load third-party scripts"}
        </button>

        <button className={`ghost-btn ${simOpen ? "active" : ""}`} onClick={onSim}>
          Simulator
        </button>

        <button
          className={`shield-toggle ${protection ? "" : "off"}`}
          onClick={() => onProtection(!protection)}
          aria-pressed={protection}
        >
          {protection ? <Shield /> : <ShieldOff />}
          Grenz {protection ? "ON" : "OFF"}
          <span className="switch" />
        </button>
      </div>
    </header>
  );
}

export function Banner({ kind, children }: { kind: "info" | "danger"; children: ReactNode }) {
  return (
    <div className={`banner ${kind}`} role={kind === "danger" ? "alert" : undefined}>
      {kind === "danger" ? <ShieldOff size={14} /> : null}
      <span>{children}</span>
    </div>
  );
}

export function SceneRow({ scene, onScene }: { scene: SceneId; onScene: (s: SceneId) => void }) {
  return (
    <div className="scene-row">
      {Object.values(SCENES).map((s) => (
        <button
          key={s.id}
          className={`scene ${s.id === scene ? "on" : ""}`}
          onClick={() => onScene(s.id as SceneId)}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}

export function DoorbellFeed({ events }: { events: DoorbellEvent[] }) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Front door intercom</h2>
        <span className="state">today</span>
      </div>
      <div className="feed">
        {events.map((e) => (
          <div key={e.id} className="feed-row">
            <div className="feed-meta">
              <strong>{e.from}</strong>
              <span>{e.at}</span>
            </div>
            <p>{e.transcript}</p>
          </div>
        ))}
      </div>
      <div className="feed-foot">
        Whoever is at the door writes this text. <code>get_doorbell_events</code> declares{" "}
        <code>untrustedContentHint</code> for exactly that reason.
      </div>
    </div>
  );
}
