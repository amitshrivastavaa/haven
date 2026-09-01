import { useEffect, useState } from "react";
import type { TimelineEvent } from "grenz-webmcp";
import { g } from "./grenz-instance";

/**
 * Activity, said the way the house would say it.
 *
 * The library ships its own timeline and it is the right thing for a developer:
 * tool names, reason codes, arguments. Nobody living here reads that. So this
 * renders the same event stream as sentences, and puts the developer's version
 * back one toggle away — which means the demo never has to choose between being
 * legible to a person and being verifiable by someone checking the mechanism.
 */

const Tick = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
);
const Nope = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" />
  </svg>
);
const Eye = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

const WHY: Record<string, string> = {
  explicit_deny: "A house rule says never.",
  no_matching_allow: "No house rule covers it.",
  annotation_mismatch: "It said it only reads. It writes.",
  name_collision: "It tried to take the name of a tool you already have.",
  approval_synthetic: "Something clicked Approve that was not you.",
  approval_present: "You proved it was you, and Haven's server checked the signature.",
  presence_unverified: "A passkey answered, but nothing off this page checked it.",
  presence_refused: "The passkey check was not satisfied.",
  presence_unavailable: "This device cannot prove a person is here.",
  constraint: "It asked for a value your house does not allow.",
  rate_limit: "It has asked too many times, too fast.",
  approval_expired: "Nobody answered, so it was refused.",
  approval_denied: "You said no.",
  approval_granted: "You approved this.",
  approval_remembered_grant: "You allowed this earlier.",
  unprotected: "Protection was off, so nothing stopped it.",
};

/** What the assistant was trying to do, in a sentence. */
function attempt(e: TimelineEvent): string {
  const a = (e.input ?? {}) as Record<string, unknown>;
  switch (e.tool) {
    case "toggle_light":
      return `${a.on === false ? "Turn off" : "Switch"} the ${a.lightId ?? ""} light`.replace("  ", " ");
    case "set_thermostat":
      return `Set the heating to ${a.targetC}°`;
    case "set_oven":
      return `Run the oven at ${a.targetC}° for ${a.minutes} minutes`;
    case "set_scene":
      return `Set the house to ${a.scene}`;
    case "lock_door":
      return "Lock the front door";
    case "unlock_door":
      return "Unlock the front door";
    case "disarm_alarm":
      return "Turn the alarm off";
    case "grant_permanent_access":
      return `Give ${a.who ?? "someone"} permanent access`;
    case "get_house_state":
      return "Check how the house is set";
    case "get_doorbell_events":
      return "Read who came to the door";
    case "eco_optimize":
      return "Let EcoSaver change your heating";
    case "home_insights":
      return "Send your details to Home Insights";
    default:
      return e.tool;
  }
}

/** Only the first letter — the rest may be somebody's name. */
function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/** Past tense, for the things that actually happened. */
function did(e: TimelineEvent): string {
  return attempt(e)
    .replace(/^Switch /, "Switched ")
    .replace(/^Turn off /, "Turned off ")
    .replace(/^Set /, "Set ")
    .replace(/^Lock /, "Locked ")
    .replace(/^Unlock /, "Unlocked ")
    .replace(/^Turn /, "Turned ")
    .replace(/^Give /, "Gave ")
    .replace(/^Check /, "Checked ")
    .replace(/^Read /, "Read ")
    .replace(/^Run /, "Started ");
}

export interface Line {
  id: string;
  kind: "ok" | "no" | "eye";
  title: string;
  detail: string;
  technical: string;
}

export function toLine(e: TimelineEvent): Line | null {
  const technical = [
    e.tool,
    e.reason,
    e.input !== undefined ? JSON.stringify(e.input) : "",
    e.requestedFields?.length ? `asks for: ${e.requestedFields.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");

  // The page's own tools appearing is not news. A partner app's tool is.
  if (e.kind === "register") {
    if (!e.foreign) return null;
    return {
      id: e.id,
      kind: "eye",
      title: `A partner app added "${e.tool}"`,
      detail: [
        e.decision === "deny"
          ? "You can see it, but nothing here lets it run."
          : "It runs under your house rules.",
        e.requestedFields?.length ? `It wants ${e.requestedFields.join(", ")}.` : "",
      ]
        .filter(Boolean)
        .join(" "),
      technical,
    };
  }

  if (e.kind === "grant")
    return { id: e.id, kind: e.decision === "unprotected" ? "no" : "ok", title: e.message, detail: "", technical };

  if (e.decision === "deny")
    return {
      id: e.id,
      kind: "no",
      title: `Refused: ${lowerFirst(attempt(e))}`,
      detail: (e.reason && WHY[e.reason]) ?? "Your house rules did not allow it.",
      technical,
    };

  // How it was approved is the interesting part, not that it was. A passkey
  // says a person was here; a fallback says the device could not prove that,
  // and the difference must never be invisible.
  if (e.decision === "require_approval")
    return {
      id: e.id,
      kind: "eye",
      title: did(e),
      detail: (e.reason && WHY[e.reason]) ?? "You approved this.",
      technical,
    };

  if (e.decision === "unprotected")
    return { id: e.id, kind: "no", title: did(e), detail: WHY.unprotected!, technical };

  return {
    id: e.id,
    kind: "ok",
    title: did(e),
    detail: e.untrustedContent ? "Whatever was said at the door is a stranger's words." : "",
    technical,
  };
}

/** The timeline, newest first, already turned into sentences. */
export function useLines(): Line[] {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  useEffect(() => g.subscribe(setEvents), []);
  return [...events].reverse().map(toLine).filter((l): l is Line => l !== null);
}

/** One event. Shared so Activity and History can never drift apart. */
export function EventRow({ line }: { line: Line }) {
  return (
    <div className={`ev ${line.kind}`}>
      <div className="d">{line.kind === "no" ? <Nope /> : line.kind === "eye" ? <Eye /> : <Tick />}</div>
      <div>
        <b>{line.title}</b>
        {line.detail && <span>{line.detail}</span>}
        <div className="tk">{line.technical}</div>
      </div>
    </div>
  );
}

/** Puts the developer's version one toggle away, wherever events are shown. */
export function TechToggle() {
  const [tech, setTech] = useState(() => document.body.classList.contains("tech"));
  useEffect(() => {
    document.body.classList.toggle("tech", tech);
  }, [tech]);
  return (
    <label className="toggle">
      <input type="checkbox" checked={tech} onChange={(e) => setTech(e.target.checked)} />
      <span className="tr" /> Show technical detail
    </label>
  );
}

export function ActivityCard() {
  const lines = useLines();
  const refused = lines.filter((l) => l.kind === "no").length;

  return (
    <div className="card">
      <h2>Activity</h2>
      <p className="lead">
        {refused > 0
          ? `${refused} ${refused === 1 ? "request" : "requests"} stopped.`
          : "Nothing needs you."}
      </p>

      <div className="feed">
        {lines.length === 0 ? (
          <div className="quiet">Your assistant hasn't done anything yet.</div>
        ) : (
          lines.slice(0, 12).map((l) => <EventRow key={l.id} line={l} />)
        )}
      </div>

      <TechToggle />
    </div>
  );
}
