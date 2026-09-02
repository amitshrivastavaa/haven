import type { ReactNode } from "react";
import type { ToolAction } from "grenz-webmcp";
import { SCENES } from "./house";
import { RULE_COPY, rules } from "./policy";
import type { DoorbellEvent, SceneId } from "./types";

export type View = "home" | "access" | "history" | "why";

/**
 * The house's own three views, and then the one that is not about the house.
 *
 * "Why Grenz" used to BE the landing page, which put a pitch in front of anyone
 * following a demo link — including a judge with three minutes and a hundred
 * entries. The app opens first now, and the argument lives one click away where
 * someone who wants it can find it.
 */
const VIEWS: { id: View; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "access", label: "Access" },
  { id: "history", label: "History" },
  { id: "why", label: "Why Grenz" },
];

export function Head({
  webmcp,
  polyfilled,
  governed,
  protection,
  onProtection,
  summary,
  view,
  onView,
  refused,
  toolCount,
  onTools,
  onPitch,
}: {
  webmcp: boolean;
  polyfilled: boolean;
  /** Whether the takeover actually claimed this browser's registration surface. */
  governed: boolean;
  protection: boolean;
  onProtection: (next: boolean) => void;
  summary: string;
  view: View;
  onView: (v: View) => void;
  refused: number;
  toolCount: number;
  onTools: () => void;
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
            {/* "connected" and "governed" are two different claims and used to
                be one word. A browser can expose WebMCP on a surface this
                build could not take over — then an agent sees the tools and
                the rules do not, which is the one state the header must not
                describe as normal.
                It is not "NOT governed", either: Haven's own tools and any
                injected form are still governed on a sealed surface. What is
                lost is one specific interception, and the banner names it. */}
            {!webmcp
              ? "no assistant connected"
              : !governed
                ? "assistant connected · registerTool sealed"
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

      {/* What an agent can actually see, on every view, one click from trying
          it. The tools were only ever countable on the pitch and callable from
          a drawer behind a demo dock — which hid the single thing this project
          is about. */}
      <button className="toolchip" onClick={onTools} title="Open the tool simulator">
        <span className="toolchip-n">{toolCount}</span>
        {toolCount === 1 ? "tool an agent can use" : "tools an agent can use"}
      </button>

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

/**
 * The intercom, and the demo's only actual attacker.
 *
 * The last entry carries a prompt injection, and the presentation has one job:
 * make a reader see it for what it is without pretending Haven detected it.
 * So nothing marks that entry specifically — the site cannot tell a service
 * call from an instruction aimed at an assistant, and a badge saying it can
 * would be claiming a defence this project explicitly does not have. What is
 * marked is the whole log: every word of it is a stranger's, and the tool that
 * reads it says so with `untrustedContentHint`. Framed that way, the payload
 * gives itself away — it is the one that addresses the assistant.
 *
 * The frame goes above the messages, not below. A note underneath is a note
 * you reach having already read them as though they were Haven's own words.
 */
export function DoorbellFeed({ events }: { events: DoorbellEvent[] }) {
  return (
    <div className="card">
      <div className="card-top">
        <div>
          <h2>Front door intercom</h2>
          <p className="lead">Today</p>
        </div>
        <span className="badge-foreign">Not vouched for</span>
      </div>

      <p className="intercom-note">
        Whoever is at the door writes this, and your assistant reads it word for word. Haven
        vouches for none of it — which is why <code>get_doorbell_events</code> declares{" "}
        <code>untrustedContentHint</code>.
      </p>

      {events.map((e) => (
        <div key={e.id} className="feed-row">
          <div className="feed-meta">
            <strong>{e.from}</strong>
            <span>{e.at}</span>
          </div>
          <blockquote>{e.transcript}</blockquote>
        </div>
      ))}
    </div>
  );
}
