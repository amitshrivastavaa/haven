import { useCallback, useEffect, useMemo, useState } from "react";
import type { Constraint, GrenzInstance, RegistryEntry } from "grenz-webmcp";
import { rules } from "./policy";
import { toLine, type Line } from "./Feed";

/**
 * The tool simulator.
 *
 * It is backed by Grenz's OWN registry, not by `getTools()`, so it still works
 * on a browser with no WebMCP at all — which is also the browser most people
 * will open this demo in. When native WebMCP is present, the second mode routes
 * the same call through `getTools()` + `executeTool()` to show that an in-page
 * JavaScript caller and an out-of-page agent hit the identical governed surface.
 *
 * Controls, not a JSON textarea. This used to be a grid of cards each holding
 * raw arguments to hand-edit, which asked a visitor to compose `{"doorId":
 * "front"}` in order to try a door — a developer console wearing a product's
 * clothes.
 *
 * The fields are built from the tool's own `inputSchema` and from the site's
 * policy for it, which is the part worth watching: the bound beside a field is
 * the same number the pipeline will check the value against, read from the same
 * object. It is shown and NOT enforced, so you can put 45° in a box labelled
 * 10–30 and watch the house rules refuse it. A form that quietly clamped the
 * value would be hiding the only thing this screen is for.
 *
 * Full height, so both readings of a call fit at once: the fields on the left,
 * and beside them the exact JSON an agent would have put on the wire. They are
 * two views of one value — edit either and the other follows — which is the
 * cheapest way to show that the friendly control and the agent's request are
 * the same request. The JSON stays editable for arguments no form could
 * anticipate.
 *
 * The answer is phrased the same way, and by the same function the Activity
 * rail uses — a call made here is a real call, so it lands in the real
 * timeline, and the timeline already knows how to say "Switched the living
 * light" or "It asked for a value your house does not allow". The raw payload
 * sits underneath it, because for the one reader who wants it, it is the
 * point.
 */

/** Seed values, so every tool is one click from doing something. */
const SEEDS: Record<string, Record<string, unknown>> = {
  get_house_state: {},
  get_doorbell_events: {},
  set_thermostat: { targetC: 19 },
  toggle_light: { lightId: "porch", on: true },
  set_scene: { scene: "movie" },
  lock_door: { doorId: "front" },
  unlock_door: { doorId: "front" },
  disarm_alarm: {},
  grant_permanent_access: { who: "Halden HVAC" },
  set_oven: { targetC: 180, minutes: 45 },
  eco_optimize: { aggressiveness: 3 },
  home_insights: { postcode: "SW1A 1AA", awaySchedule: "Weekdays 09:00-18:00", alarmCode: "4417" },
};

/**
 * Argument names as a person would say them. Same principle as a policy's
 * `describe`: the site wrote the tool, so the site is the one that can say
 * `doorId` means "which door". A tool with no entry keeps its own key — better
 * an honest machine name than a guessed-at English one.
 */
const LABELS: Record<string, string> = {
  doorId: "Which door",
  lightId: "Which light",
  on: "Turn it",
  targetC: "Temperature",
  minutes: "For how long",
  scene: "Scene",
  who: "Who",
  aggressiveness: "How hard to push",
  postcode: "Postcode",
  awaySchedule: "When the house is empty",
  alarmCode: "Alarm code",
};

const UNITS: Record<string, string> = { targetC: "°C", minutes: "minutes" };

type Mode = "grenz" | "native";

interface Field {
  key: string;
  type: "string" | "number" | "boolean";
  label: string;
  unit?: string;
  /** From the site's policy, shown beside the field and not enforced. */
  options?: readonly (string | number)[];
  bound?: string;
  required: boolean;
}

interface Schema {
  properties?: Record<string, { type?: string; description?: string }>;
  required?: string[];
}

/** The controls for one tool, from its schema and the site's rules for it. */
function fieldsFor(entry: RegistryEntry): Field[] {
  const schema = (entry.inputSchema ?? {}) as Schema;
  const constraints = (rules[entry.name]?.constraints ?? {}) as Record<string, Constraint>;
  const keys = new Set([...Object.keys(schema.properties ?? {}), ...Object.keys(constraints)]);

  return [...keys].map((key) => {
    const c = constraints[key];
    const declared = schema.properties?.[key]?.type;
    const type: Field["type"] =
      declared === "number" || declared === "integer"
        ? "number"
        : declared === "boolean"
          ? "boolean"
          : typeof c?.min === "number" || typeof c?.max === "number"
            ? "number"
            : "string";

    const bounds: string[] = [];
    if (typeof c?.min === "number" || typeof c?.max === "number")
      bounds.push(`${c?.min ?? "…"}–${c?.max ?? "…"}`);
    if (typeof c?.maxLength === "number") bounds.push(`up to ${c.maxLength} characters`);

    return {
      key,
      type,
      label: LABELS[key] ?? key,
      unit: UNITS[key],
      options: c?.enum,
      bound: bounds.join(" · ") || undefined,
      required: Boolean(c?.required) || Boolean(schema.required?.includes(key)),
    };
  });
}

/** Field strings back into the JSON an agent would have sent. */
function toInput(fields: Field[], values: Record<string, string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const raw = values[f.key];
    // A blank field is an omitted argument, not an empty one — which is how you
    // watch a `required` constraint do its job.
    if (raw === undefined || raw === "") continue;
    if (f.type === "number") {
      const n = Number(raw);
      out[f.key] = Number.isNaN(n) ? raw : n;
    } else if (f.type === "boolean") {
      out[f.key] = raw === "true";
    } else {
      out[f.key] = raw;
    }
  }
  return out;
}

function seedValues(entry: RegistryEntry, fields: Field[]): Record<string, string> {
  const seed = SEEDS[entry.name] ?? {};
  return Object.fromEntries(
    fields.map((f) => [f.key, seed[f.key] === undefined ? "" : String(seed[f.key])]),
  );
}

export function Simulator({
  g,
  webmcp,
  onClose,
}: {
  g: GrenzInstance;
  webmcp: boolean;
  onClose: () => void;
}) {
  const [tools, setTools] = useState<RegistryEntry[]>(() => g.listTools());
  const [values, setValues] = useState<Record<string, Record<string, string>>>({});
  /** Hand-typed JSON, kept verbatim while editing so the caret does not jump. */
  const [draft, setDraft] = useState<Record<string, string>>({});
  /** Keys the form has no field for. Hand-written arguments survive here. */
  const [extras, setExtras] = useState<Record<string, Record<string, unknown>>>({});
  const [badJson, setBadJson] = useState<Record<string, string>>({});
  const [out, setOut] = useState<Record<string, { text: string; denied: boolean; line: Line | null }>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode>("grenz");
  const [picked, setPicked] = useState<string | null>(null);

  // The registry changes when a tool registers or its signal aborts; both emit
  // timeline events, so the timeline is a good enough change signal.
  useEffect(() => g.subscribe(() => setTools(g.listTools())), [g]);

  useEffect(() => {
    if (!webmcp && mode === "native") setMode("grenz");
  }, [webmcp, mode]);

  // Third-party tools register after mount, and a tool can unregister when its
  // signal aborts — so the selection is resolved against the live list rather
  // than trusted to still exist.
  const selected = tools.find((t) => t.name === picked) ?? tools[0];
  const fields = useMemo(() => (selected ? fieldsFor(selected) : []), [selected]);
  const current = selected
    ? (values[selected.name] ?? seedValues(selected, fields))
    : {};

  const input = useMemo(
    () => ({ ...toInput(fields, current), ...(selected ? (extras[selected.name] ?? {}) : {}) }),
    [fields, current, extras, selected],
  );
  const shownJson = selected
    ? (draft[selected.name] ?? JSON.stringify(input, null, 2))
    : "{}";
  const jsonError = selected ? badJson[selected.name] : undefined;

  const forget = (map: Record<string, unknown>, name: string) => {
    const { [name]: _drop, ...rest } = map;
    return rest as Record<string, string>;
  };

  const set = (key: string, value: string) => {
    if (!selected) return;
    setValues((p) => ({ ...p, [selected.name]: { ...current, [key]: value } }));
    // The JSON is a view of the values, so a field edit drops the hand-typed
    // text and lets it re-render from the truth.
    setDraft((p) => forget(p, selected.name));
    setBadJson((p) => forget(p, selected.name));
  };

  /** Hand-edited JSON flows back into the fields, so there is one truth. */
  const setJson = (text: string) => {
    if (!selected) return;
    const name = selected.name;
    setDraft((p) => ({ ...p, [name]: text }));
    let parsed: unknown;
    try {
      parsed = JSON.parse(text || "{}");
    } catch (e) {
      setBadJson((p) => ({ ...p, [name]: (e as Error).message }));
      return;
    }
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      setBadJson((p) => ({ ...p, [name]: "Arguments have to be an object." }));
      return;
    }
    setBadJson((p) => forget(p, name));
    const bag = parsed as Record<string, unknown>;
    const known = new Set(fields.map((f) => f.key));
    setValues((p) => ({
      ...p,
      [name]: Object.fromEntries(
        fields.map((f) => [f.key, bag[f.key] === undefined ? "" : String(bag[f.key])]),
      ),
    }));
    setExtras((p) => ({
      ...p,
      [name]: Object.fromEntries(Object.entries(bag).filter(([k]) => !known.has(k))),
    }));
  };

  const run = useCallback(async () => {
    if (!selected) return;
    const name = selected.name;
    if (badJson[name]) return; // the JSON pane already says what is wrong
    const payload: unknown = input;

    setBusy(name);
    try {
      let result: unknown;
      if (mode === "native") {
        const mc = document.modelContext ?? navigator.modelContext;
        if (!mc) throw new Error("WebMCP is not available in this browser");
        const native = await mc.getTools();
        const target = native.find((t) => t.name === name);
        if (!target) throw new Error(`"${name}" is not in getTools()`);
        // Native executeTool takes the arguments as a JSON string, not an object.
        result = await mc.executeTool(target, JSON.stringify(payload));
      } else {
        result = await g.callTool(name, payload);
      }

      const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
      // A denial is a normal, readable result — that is the whole point of
      // resolving rather than rejecting.
      const denied = text.includes('"decision"') && text.includes('"deny"');
      // The call really happened, so it is really in the timeline — and the
      // timeline is where the human phrasing already lives.
      const event = [...g.getTimeline()].reverse().find((e) => e.kind === "call" && e.tool === name);
      setOut((p) => ({
        ...p,
        [name]: { text: text ?? "undefined", denied, line: event ? toLine(event) : null },
      }));
    } catch (e) {
      setOut((p) => ({
        ...p,
        [name]: { text: `It threw: ${(e as Error).message}`, denied: true, line: null },
      }));
    } finally {
      setBusy(null);
    }
  }, [g, mode, selected, input, badJson]);

  return (
    <aside className="sim" aria-label="Tool simulator">
      <div className="sim-head">
        <h2>Try a tool by hand</h2>
        <div className="sim-mode">
          <button aria-pressed={mode === "grenz"} onClick={() => setMode("grenz")}>
            Through Haven
          </button>
          <button
            aria-pressed={mode === "native"}
            onClick={() => setMode("native")}
            disabled={!webmcp}
            title={webmcp ? "Call through document.modelContext" : "Requires native WebMCP"}
          >
            Through the browser
          </button>
        </div>
        <button className="x close" onClick={onClose} aria-label="Close the simulator">
          ✕
        </button>
      </div>

      <div className="sim-note">
        {mode === "grenz"
          ? "Goes through exactly the same house rules the assistant's requests do. Works even with no assistant connected."
          : "Goes out through the browser's own getTools() and executeTool(), exactly as any script on this page would — and lands in the same house rules."}
      </div>

      {!selected ? (
        <div className="sim-empty">
          <strong>No tools registered</strong>
          Tools register when the app mounts. If you see this, something failed to load.
        </div>
      ) : (
        <div className="sim-body">
          <div className="sim-list" role="tablist" aria-label="Tools">
            {tools.map((tool) => (
              <button
                key={tool.name}
                role="tab"
                aria-selected={tool.name === selected.name}
                onClick={() => setPicked(tool.name)}
              >
                <b>{tool.title}</b>
                {tool.foreign && <span className="dot" title="Added by a third-party script" />}
              </button>
            ))}
          </div>

          <div className="sim-detail">
            <div className="sim-tool-head">
              <h3>{selected.title}</h3>
              <code>{selected.name}</code>
              {selected.foreign && <span className="badge-foreign">third-party</span>}
            </div>
            <p className="sim-tool-desc">{selected.description}</p>

            <div className="sim-io">
              <div className="sim-args">
                <span>What to ask for</span>
                {fields.length === 0 ? (
                  <p className="sim-noargs">This one takes no arguments. Just call it.</p>
                ) : (
                  <div className="sim-fields">
                    {fields.map((f) => (
                      <label key={f.key}>
                        <span className="f-name">
                          {f.label}
                          {f.unit && <em>{f.unit}</em>}
                          {/* The site's own bound, shown but never enforced —
                              putting 45 in a 10–30 box is the demo. */}
                          {f.bound && <i>{f.bound}</i>}
                        </span>

                        {f.options ? (
                          <select value={current[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}>
                            {!f.required && <option value="">— leave out —</option>}
                            {f.options.map((o) => (
                              <option key={String(o)} value={String(o)}>
                                {String(o)}
                              </option>
                            ))}
                          </select>
                        ) : f.type === "boolean" ? (
                          <select value={current[f.key] ?? ""} onChange={(e) => set(f.key, e.target.value)}>
                            <option value="">— leave out —</option>
                            <option value="true">on</option>
                            <option value="false">off</option>
                          </select>
                        ) : (
                          <input
                            type={f.type === "number" ? "number" : "text"}
                            value={current[f.key] ?? ""}
                            onChange={(e) => set(f.key, e.target.value)}
                            placeholder={f.required ? "required" : "optional"}
                          />
                        )}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* The same value, on the wire. Editable, and it flows back into
                  the fields — a control and a request are not two things. */}
              <div className="sim-wire">
                <span>What gets sent</span>
                <textarea
                  className={`sim-json ${jsonError ? "bad" : ""}`}
                  value={shownJson}
                  spellCheck={false}
                  onChange={(e) => setJson(e.target.value)}
                  aria-label={`Arguments for ${selected.name} as JSON`}
                  aria-invalid={Boolean(jsonError)}
                />
                {jsonError && <p className="sim-badjson">Not valid JSON — {jsonError}</p>}
              </div>
            </div>

            <button
              className="sim-run"
              onClick={run}
              disabled={busy === selected.name || Boolean(jsonError)}
            >
              {busy === selected.name ? "Asking…" : `Ask Haven to ${selected.title.toLowerCase()}`}
            </button>

            <div className="sim-result">
              <span>What came back</span>
              {!out[selected.name] ? (
                <pre className="idle">Nothing yet. Call it and watch the house.</pre>
              ) : (
                <div className={`sim-said ${out[selected.name]!.denied ? "denied" : "ok"}`}>
                  {out[selected.name]!.line && (
                    <p>
                      <b>{out[selected.name]!.line!.title}</b>
                      {out[selected.name]!.line!.detail}
                    </p>
                  )}
                  <pre>{out[selected.name]!.text}</pre>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </aside>
  );
}
