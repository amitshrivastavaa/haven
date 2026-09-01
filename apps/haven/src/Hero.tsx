import { RULE_COPY } from "./policy";
import type { House } from "./types";

/**
 * The one sentence.
 *
 * Everything else on this screen is evidence. If you open Haven at two in the
 * morning because you heard something, there is exactly one thing you need
 * read to you in type you cannot miss — and it is never "dashboard".
 *
 * Precedence is by consequence, not recency: an open door outranks a refusal,
 * a refusal outranks a disarmed alarm, and a quiet house says so plainly.
 */
/** What a refusal means, in the house's words rather than the engine's. */
const WHY: Record<string, string> = {
  explicit_deny: "A house rule says never.",
  no_matching_allow: "No house rule covers it.",
  annotation_mismatch: "It said it only reads. It writes.",
  constraint: "It asked for a value the house does not allow.",
  rate_limit: "It has asked too many times, too fast.",
  approval_expired: "Nobody answered in time, so it was refused.",
  approval_denied: "You said no.",
};

/** "grant_permanent_access" -> "give someone permanent access" */
function saidPlainly(tool: string): string {
  const copy = RULE_COPY.find((r) => r.tool === tool);
  return copy ? copy.what.charAt(0).toLowerCase() + copy.what.slice(1) : `use ${tool}`;
}

export interface Moment {
  /** The sentence, in display type. */
  line: string;
  /** The reason underneath it, in the body face. */
  note: string;
  tone: "calm" | "watch" | "alarm";
}

export interface LastEvent {
  tool: string;
  decision: string;
  message: string;
  reason?: string;
}

export function momentFor(house: House, last: LastEvent | null, protection: boolean): Moment {
  if (!house.doorLocked)
    return {
      line: "The front door is unlocked.",
      note: last?.tool === "unlock_door"
        ? "Your assistant opened it, and you approved."
        : "Anyone outside can walk in.",
      tone: "alarm",
    };

  if (!protection)
    return {
      line: "Nothing is watching.",
      note: "Every tool on this page runs the moment the assistant asks — including the two a partner app added.",
      tone: "alarm",
    };

  if (!house.alarmArmed)
    return {
      line: "The alarm is off.",
      note: "Nobody will be told if the house is entered.",
      tone: "watch",
    };

  if (last?.decision === "deny")
    return {
      line: "Something was just refused.",
      note: `Your assistant tried to ${saidPlainly(last.tool)}. ${
        (last.reason && WHY[last.reason]) ?? "The house rules did not allow it."
      }`,
      tone: "watch",
    };

  const on = house.lights.filter((l) => l.on);
  const lights =
    on.length === 0
      ? "every light off"
      : on.length === house.lights.length
        ? "every light on"
        : `${on.map((l) => l.name.toLowerCase()).join(" and ")} lit`;

  return {
    line: "The house is quiet.",
    note: `Locked and armed, ${lights}, heating at ${house.targetC}°.`,
    tone: "calm",
  };
}

export function Hero({
  moment,
  doorLocked,
  onLock,
  onSeeWhy,
}: {
  moment: Moment;
  doorLocked: boolean;
  onLock: () => void;
  onSeeWhy: () => void;
}) {
  return (
    <section className={`hero ${moment.tone}`}>
      <h1 className="hero-line">{moment.line}</h1>
      <p className="hero-note">{moment.note}</p>
      <div className="hero-acts">
        {!doorLocked && (
          <button className="act act-strong" onClick={onLock}>
            Lock it
          </button>
        )}
        <button className="act" onClick={onSeeWhy}>
          See what happened
        </button>
      </div>
    </section>
  );
}
