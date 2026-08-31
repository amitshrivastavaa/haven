import type { ReactNode } from "react";
import { SCENES } from "./house";
import type { DoorbellEvent, Light, LightId, SceneId } from "./types";

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

const LockIcon = ({ locked }: { locked: boolean }) => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="11" width="16" height="10" rx="2" />
    <path d={locked ? "M8 11V7a4 4 0 0 1 8 0v4" : "M8 11V7a4 4 0 0 1 7.5-2"} />
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

export function LockCard({
  locked,
  armed,
  access,
  onLock,
}: {
  locked: boolean;
  armed: boolean;
  access: string[];
  onLock: () => void;
}) {
  return (
    <div className={`card lock ${locked ? "" : "open"}`}>
      <div className="card-head">
        <h2>Front door</h2>
        <span className={`state ${locked ? "ok" : "bad"}`}>{locked ? "Locked" : "UNLOCKED"}</span>
      </div>
      <div className="lock-body">
        <div className={`lock-icon ${locked ? "" : "open"}`}>
          <LockIcon locked={locked} />
        </div>
        <div className="lock-meta">
          <div className={`alarm ${armed ? "" : "off"}`}>
            Alarm {armed ? "armed" : "disarmed"}
          </div>
          <div className="access">
            {access.length} with access: {access.join(", ")}
          </div>
        </div>
      </div>
      {!locked && (
        <button className="btn btn-primary" onClick={onLock}>
          Lock it
        </button>
      )}
    </div>
  );
}

export function ThermostatCard({
  targetC,
  currentC,
  onTarget,
}: {
  targetC: number;
  currentC: number;
  onTarget: (t: number) => void;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Thermostat</h2>
        <span className="state">{currentC}°C now</span>
      </div>
      <div className="thermo">
        <button className="step" onClick={() => onTarget(Math.max(10, targetC - 1))} aria-label="Cooler">
          −
        </button>
        <div className="temp">
          {targetC}
          <span>°C</span>
        </div>
        <button className="step" onClick={() => onTarget(Math.min(30, targetC + 1))} aria-label="Warmer">
          +
        </button>
      </div>
      <div className="thermo-range">Range 10–30 °C, enforced by policy</div>
    </div>
  );
}

export function LightsCard({
  lights,
  onToggle,
}: {
  lights: Light[];
  onToggle: (id: LightId) => void;
}) {
  return (
    <div className="card">
      <div className="card-head">
        <h2>Lights</h2>
        <span className="state">{lights.filter((l) => l.on).length} of {lights.length} on</span>
      </div>
      <div className="lights">
        {lights.map((l) => (
          <button
            key={l.id}
            className={`light ${l.on ? "on" : ""}`}
            onClick={() => onToggle(l.id)}
            aria-pressed={l.on}
          >
            <span className="bulb" />
            {l.name}
          </button>
        ))}
      </div>
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
