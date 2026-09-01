import type { ReactNode } from "react";
import { useState } from "react";
import type { ToolAction } from "grenz-webmcp";
import { SCENES } from "./house";
import { RULE_COPY, rules, setRuleAction } from "./policy";
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

const CHOICES: { action: ToolAction; label: string; cls: string }[] = [
  { action: "allow", label: "Freely", cls: "p-allow" },
  { action: "approve", label: "Ask me", cls: "p-ask" },
  { action: "deny", label: "Never", cls: "p-never" },
];

/**
 * The rules as a list you read, and — one tap away — a list you change.
 *
 * Two states of one card rather than two screens: the sentence is the same
 * either way, and a rule you can see but not change is not really yours.
 */
export function RulesCard() {
  const [editing, setEditing] = useState(false);
  const [, bump] = useState(0);

  const dot = (a: ToolAction | undefined) => (a === "approve" ? "r-ask" : a === "deny" ? "r-never" : "");

  return (
    <div className="card rules">
      <div className="card-top">
        <div>
          <h2>House rules</h2>
          <p className="lead">What your assistant may do.</p>
        </div>
        <button className="edit" onClick={() => setEditing((v) => !v)}>
          {editing ? "Done" : "Change these"}
        </button>
      </div>

      {!editing ? (
        <ul>
          {RULE_COPY.map((r) => (
            <li key={r.tool} className={dot(rules[r.tool]?.action)}>
              {r.said}
            </li>
          ))}
        </ul>
      ) : (
        <div className="redit">
          {RULE_COPY.map((r) => {
            const current = rules[r.tool]?.action;
            return (
              <div key={r.tool} className="redit-row">
                <div className="redit-what">{r.what}</div>
                <div className="redit-sub">
                  {r.tool}
                  {r.limit ? ` · ${r.limit}` : ""}
                </div>
                <div className="redit-pick" role="group" aria-label={r.what}>
                  {CHOICES.map((c) => (
                    <button
                      key={c.action}
                      className={c.cls}
                      aria-pressed={current === c.action}
                      onClick={() => {
                        setRuleAction(r.tool, c.action);
                        bump((n) => n + 1);
                      }}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
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
