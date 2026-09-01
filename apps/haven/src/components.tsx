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

/**
 * The product header. Everything here is something a person who lives in this
 * house would recognise: is the assistant connected, and is the house
 * protected. The instruments that exist to break the demo live in DemoBar,
 * below, deliberately separated — a resident has no reason to sabotage their
 * own home, and mixing the two made it impossible to tell which was which.
 */
export type Tab = "home" | "rules" | "activity";

export function Header({
  webmcp,
  polyfilled,
  protection,
  tab,
  onTab,
  unread,
}: {
  webmcp: boolean;
  polyfilled: boolean;
  protection: boolean;
  tab: Tab;
  onTab: (t: Tab) => void;
  unread: number;
}) {
  return (
    <header className="header">
      <div className="brand">
        <div className="brand-mark">H</div>
        <div>
          <div className="brand-name">Haven</div>
          <div className="brand-sub">your home, with an assistant</div>
        </div>
      </div>

      <nav className="tabs" aria-label="Sections">
        {(
          [
            ["home", "Home"],
            ["rules", "House rules"],
            ["activity", "Activity"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            className={`tab ${tab === id ? "on" : ""}`}
            aria-current={tab === id ? "page" : undefined}
            onClick={() => onTab(id)}
          >
            {label}
            {id === "activity" && unread > 0 && <span className="tab-count">{unread}</span>}
          </button>
        ))}
      </nav>

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
          {!webmcp
            ? "No assistant connected"
            : polyfilled
              ? "Assistant connected (demo)"
              : "Assistant connected"}
        </span>

        <span className={`pill state-shield ${protection ? "safe" : "unsafe"}`}>
          {protection ? <Shield size={13} /> : <ShieldOff size={13} />}
          {protection ? "Protected" : "Not protected"}
        </span>
      </div>
    </header>
  );
}

/**
 * The exhibit, labelled as one. A judge needs the levers to be obvious; a
 * resident needs to know these are not their house's controls.
 */
export function DemoBar({
  protection,
  onProtection,
  widgets,
  onWidgets,
  simOpen,
  onSim,
  onRunaway,
}: {
  protection: boolean;
  onProtection: (next: boolean) => void;
  widgets: boolean;
  onWidgets: (next: boolean) => void;
  simOpen: boolean;
  onSim: () => void;
  onRunaway: () => void;
}) {
  return (
    <div className="demobar">
      <span className="demobar-tag">Try to break it</span>

      <button
        className={`demo-btn ${protection ? "" : "armed"}`}
        onClick={() => onProtection(!protection)}
        aria-pressed={!protection}
        title="Removes the policy layer entirely, so every tool runs the moment it is asked"
      >
        {protection ? <ShieldOff size={13} /> : <Shield size={13} />}
        {protection ? "Turn protection off" : "Turn protection back on"}
      </button>

      <button
        className={`demo-btn ${widgets ? "on" : ""}`}
        onClick={() => onWidgets(!widgets)}
        title="Loads two partner scripts that register their own tools straight at document.modelContext"
      >
        {widgets ? "✓ Partner apps connected" : "Connect partner apps"}
      </button>

      <button
        className="demo-btn"
        onClick={onRunaway}
        title="Fires the same tool twelve times against a house rule that allows eight a minute"
      >
        Assistant stuck in a loop
      </button>

      <button className={`demo-btn ${simOpen ? "on" : ""}`} onClick={onSim}>
        Send a request by hand
      </button>
    </div>
  );
}

export function LastAction({
  event,
  onOpen,
}: {
  event: { tool: string; decision: string; message: string } | null;
  onOpen: () => void;
}) {
  if (!event) return null;
  const word =
    event.decision === "deny"
      ? "Refused"
      : event.decision === "require_approval"
        ? "You allowed"
        : event.decision === "unprotected"
          ? "Ran unprotected"
          : "Allowed";
  return (
    <button className={`lastact ${event.decision}`} onClick={onOpen}>
      <span className="lastact-word">{word}</span>
      <code>{event.tool}</code>
      <span className="lastact-msg">{event.message}</span>
      <span className="lastact-more">See all →</span>
    </button>
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
