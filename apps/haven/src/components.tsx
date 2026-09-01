import type { ReactNode } from "react";
import type { ToolAction } from "grenz-webmcp";
import { SCENES } from "./house";
import { RULE_COPY, rules } from "./policy";
import type { DoorbellEvent, SceneId } from "./types";

export type View = "home" | "access" | "history";

const VIEWS: { id: View; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "access", label: "Access" },
  { id: "history", label: "History" },
];

export function Head({
  webmcp,
  polyfilled,
  protection,
  onProtection,
  summary,
  view,
  onView,
  refused,
  onPitch,
}: {
  webmcp: boolean;
  polyfilled: boolean;
  protection: boolean;
  onProtection: (next: boolean) => void;
  summary: string;
  view: View;
  onView: (v: View) => void;
  refused: number;
  onPitch: () => void;
}) {
  return (
    <div className="head">
      <button className="logo" onClick={onPitch} aria-label="What Grenz is">
        H
      </button>
      <div className="head-id">
        <h1>Haven</h1>
        <p className="sub">
          {summary}
          {" · "}
          <span
            title={
              polyfilled
                ? "A demo polyfill is standing in for the browser's WebMCP"
                : "document.modelContext"
            }
          >
            {!webmcp
              ? "no assistant connected"
              : polyfilled
                ? "assistant connected (demo)"
                : "assistant connected"}
          </span>
        </p>
      </div>

      {/* The views are the app's own navigation. Tools stay registered on the
          document whichever one is showing, so moving between them never
          leaves an agent looking at an empty toolset. */}
      <nav className="nav" aria-label="Views">
        {VIEWS.map((v) => (
          <button
            key={v.id}
            aria-current={v.id === view ? "page" : undefined}
            onClick={() => onView(v.id)}
          >
            {v.label}
            {v.id === "history" && refused > 0 && (
              <span className="n-count" aria-label={`${refused} refused`}>
                {refused}
              </span>
            )}
          </button>
        ))}
      </nav>

      <button
        className={`guard ${protection ? "on" : "off"}`}
        onClick={() => onProtection(!protection)}
        aria-pressed={protection}
      >
        Haven protection <span className="sw" />
      </button>

    </div>
  );
}

/** Scene presets. A home-screen control, so it lives on the home screen. */
export function Scenes({ scene, onScene }: { scene: SceneId; onScene: (s: SceneId) => void }) {
  return (
    <div className="modes" role="group" aria-label="Home mode">
      {Object.values(SCENES).map((s) => (
        <button
          key={s.id}
          className="mode"
          aria-pressed={s.id === scene}
          onClick={() => onScene(s.id as SceneId)}
        >
          {s.name}
        </button>
      ))}
    </div>
  );
}

export function Banner({ kind, children }: { kind: "info" | "danger"; children: ReactNode }) {
  return (
    <div className={`banner ${kind}`} role={kind === "danger" ? "alert" : undefined}>
      <span>{children}</span>
    </div>
  );
}

/**
 * The rules at a glance: one sentence each, and a dot for which of the three
 * kinds it is. The full screen has room to state each one properly, which is
 * all it does — the rules are read-only at runtime, so the control that opens
 * it must not offer to change them.
 */
export function RulesCard({ onOpen }: { onOpen: () => void }) {
  const dot = (a: ToolAction | undefined) =>
    a === "approve" ? "r-ask" : a === "deny" ? "r-never" : "";

  return (
    <div className="card rules">
      <div className="card-top">
        <div>
          <h2>House rules</h2>
          <p className="lead">What your assistant may do.</p>
        </div>
        <button className="edit" onClick={onOpen}>
          See all
        </button>
      </div>

      <ul>
        {RULE_COPY.map((r) => (
          <li key={r.tool} className={dot(rules[r.tool]?.action)}>
            {r.said}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function DoorbellFeed({ events }: { events: DoorbellEvent[] }) {
  return (
    <div className="card">
      <h2>Front door intercom</h2>
      <p className="lead">Today</p>
      <div style={{ marginTop: 12 }}>
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
