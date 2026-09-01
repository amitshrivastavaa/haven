import type { ReactNode } from "react";
import type { ToolAction } from "grenz-webmcp";
import { SCENES } from "./house";
import { RULE_COPY, rules } from "./policy";
import type { DoorbellEvent, SceneId } from "./types";

export function Head({
  webmcp,
  polyfilled,
  protection,
  onProtection,
  summary,
  scene,
  onScene,
}: {
  webmcp: boolean;
  polyfilled: boolean;
  protection: boolean;
  onProtection: (next: boolean) => void;
  summary: string;
  scene: SceneId;
  onScene: (s: SceneId) => void;
}) {
  return (
    <div className="head">
      <div className="logo">H</div>
      <div>
        <h1>Haven</h1>
        <p className="sub">
          {summary}
          {" · "}
          <span title={polyfilled ? "A demo polyfill is standing in for the browser's WebMCP" : "document.modelContext"}>
            {!webmcp ? "no assistant connected" : polyfilled ? "assistant connected (demo)" : "assistant connected"}
          </span>
        </p>
      </div>

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

export function Banner({ kind, children }: { kind: "info" | "danger"; children: ReactNode }) {
  return (
    <div className={`banner ${kind}`} role={kind === "danger" ? "alert" : undefined}>
      <span>{children}</span>
    </div>
  );
}

/**
 * The rules at a glance: one sentence each, and a dot for which of the three
 * kinds it is. Changing one opens the full screen, where the choice has room
 * to be read rather than guessed from a three-across segmented control.
 */
export function RulesCard({ onEdit }: { onEdit: () => void }) {
  const dot = (a: ToolAction | undefined) => (a === "approve" ? "r-ask" : a === "deny" ? "r-never" : "");

  return (
    <div className="card rules">
      <div className="card-top">
        <div>
          <h2>House rules</h2>
          <p className="lead">What your assistant may do.</p>
        </div>
        <button className="edit" onClick={onEdit}>
          Change these
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
