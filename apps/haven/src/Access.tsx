import { useEffect, useState } from "react";
import type { TimelineEvent } from "grenz-webmcp";
import { g } from "./grenz-instance";
import { RULE_COPY, rules } from "./policy";

/**
 * Access — who and what can get into this house.
 *
 * This is a product screen, not an instrument. Every phone ships one: iOS has
 * App Privacy Report, Android has Permission Manager. A house an agent can
 * operate needs the same thing, and nobody has built it, which is why it is
 * worth having rather than another row of device cards.
 *
 * Nothing here is written down in advance. The third-party rows are built from
 * real `register` events on the timeline — the fields a script asked for are
 * the fields it actually declared in its input schema, and the verdict is the
 * decision the pipeline actually reached. If a script were added tomorrow it
 * would appear here without this file changing.
 */

/** Fields no "energy score" has any business asking a house for. */
const SENSITIVE = new Set(["alarmCode", "doorCodes", "awaySchedule"]);

/** What we can say about a third-party script, from its registration alone. */
interface Foreign {
  tool: string;
  denied: boolean;
  fields: readonly string[];
  claimedReadOnly: boolean;
}

function useForeign(): Foreign[] {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  useEffect(() => g.subscribe(setEvents), []);

  const seen = new Map<string, Foreign>();
  for (const e of events) {
    if (e.kind !== "register" || !e.foreign) continue;
    seen.set(e.tool, {
      tool: e.tool,
      denied: e.decision === "deny",
      fields: e.requestedFields ?? [],
      claimedReadOnly: Boolean(e.claimedReadOnly),
    });
  }
  return [...seen.values()];
}

/** The human-readable identity behind a tool name. */
const WHO: Record<string, { name: string; kind: string; mark: string; note: string }> = {
  eco_optimize: {
    name: "EcoSaver",
    kind: "Energy partner",
    mark: "ES",
    note: "You signed up for this one, and your house rules say it may adjust the heating if it asks you first. It never gets that far.",
  },
  home_insights: {
    name: "Home insights",
    kind: "Analytics tag",
    mark: "HI",
    note: "Nobody vouched for this one. It is not in your house rules, and the default is to refuse, so it was stopped before it ever ran.",
  },
  home_survey: {
    name: "Halden HVAC survey",
    kind: "Injected tag",
    mark: "HH",
    note: "This one never called registerTool at all — it wrote a form into the page and let the browser register it. Same default, same refusal.",
  },
  unlock_door: {
    name: "Halden HVAC",
    kind: "Injected tag",
    mark: "HH",
    note: "The same tag claimed the name of a door you already have. Names are first-come, so your tool kept it and this one is inert.",
  },
};

export function Access({
  people,
  widgets,
  onWidgets,
}: {
  people: string[];
  widgets: boolean;
  onWidgets: (next: boolean) => void;
}) {
  const foreign = useForeign();

  // What the assistant may do without asking, straight from the live policy.
  const asks = RULE_COPY.filter((r) => rules[r.tool]?.action === "approve").length;
  const never = RULE_COPY.filter((r) => rules[r.tool]?.action === "deny").length;

  return (
    <div>
      <div className="view-head">
        <h1>Access</h1>
        <p>
          Everyone and everything that can reach this house — including the scripts on this page
          you never agreed to. What they asked for is recorded whether or not they got it.
        </p>
      </div>

      <div className="acc-group">
        <h2>People with a key</h2>
        {people.map((who) => (
          <div className="who" key={who}>
            <div className="who-face">{who.slice(0, 1)}</div>
            <div className="who-what">
              <b>{who}</b>
              <span>Full access, always. Can come and go without the house asking anyone.</span>
            </div>
            <div className="verdict in">Can get in</div>
          </div>
        ))}
      </div>

      <div className="acc-group">
        <h2>Your assistant</h2>
        <div className="who">
          <div className="who-face">AI</div>
          <div className="who-what">
            <b>Whatever agent is connected</b>
            <span>
              Bound by your house rules: {asks} {asks === 1 ? "action needs" : "actions need"} your
              say-so first, {never} {never === 1 ? "is" : "are"} refused outright however it asks.
              It never gets a standing key.
            </span>
          </div>
          <div className="verdict ask">Asks first</div>
        </div>
      </div>

      <div className="acc-group">
        <h2>Other apps on this page</h2>

        {foreign.length === 0 && (
          <div className="who">
            <div className="who-face script">—</div>
            <div className="who-what">
              <b>No partner apps are connected</b>
              <span>
                Turn them on to see what a script you didn't write asks your house for, and what
                happens to it.
              </span>
            </div>
            <button className="verdict ask" onClick={() => onWidgets(true)}>
              Connect
            </button>
          </div>
        )}

        {foreign.map((f) => {
          const who = WHO[f.tool];
          return (
            <div className={`who script ${f.denied ? "refused" : ""}`} key={f.tool}>
              <div className="who-face">{who?.mark ?? "??"}</div>
              <div className="who-what">
                <b>
                  {who?.name ?? f.tool} <code>{f.tool}</code>
                </b>
                <span>{who?.note ?? "A script on this page registered a tool."}</span>
                {f.claimedReadOnly && (
                  <span>
                    It registered claiming <code>readOnlyHint: true</code> — that it only reads and
                    changes nothing. The house classifies this tool as a write, because it moves
                    your thermostat. One of the two is lying, and the house will not guess which,
                    so the tool is refused before anyone is asked to approve anything.
                  </span>
                )}
              </div>
              <div className={`verdict ${f.denied ? "out" : "ask"}`}>
                {f.denied ? "Refused" : "Asks first"}
              </div>

              {f.fields.length > 0 && (
                <div className="wanted">
                  <span className="mono">What it asked your house for</span>
                  <div className="fields">
                    {f.fields.map((field) => (
                      <span key={field} className={`field ${SENSITIVE.has(field) ? "hot" : ""}`}>
                        {field}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}

        {foreign.length > 0 && (
          <div className="rules-foot">
            These are real registrations through <code>document.modelContext.registerTool</code>.
            Neither script knows Grenz exists.{" "}
            <button className="edit" onClick={() => onWidgets(!widgets)}>
              {widgets ? "Disconnect partner apps" : "Connect partner apps"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
