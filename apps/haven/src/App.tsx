import { useCallback, useEffect, useMemo, useState } from "react";
import { GrenzTimeline, useGrenzTool } from "grenz-webmcp/react";
import { g } from "./grenz-instance";
import { doorbellEvents, initialHouse, SCENES } from "./house";
import { Simulator } from "./Simulator";
import { Banner, DemoBar, DoorbellFeed, Header, LastAction, SceneRow, type Tab } from "./components";
import { Rules } from "./Rules";
import { FloorPlan, spotFor, type Spot } from "./FloorPlan";
import { loadEcoSaver, loadHomeInsights, unloadEcoSaver, unloadHomeInsights } from "./widgets";
import type { House, LightId, SceneId } from "./types";

function hasWebMCP(): boolean {
  if (typeof document === "undefined") return false;
  return Boolean(document.modelContext ?? navigator.modelContext);
}

export function App() {
  const [house, setHouse] = useState<House>(initialHouse);
  const [protection, setProtection] = useState(true);
  const [widgets, setWidgets] = useState(false);
  const [breach, setBreach] = useState<string | null>(null);
  const [simOpen, setSimOpen] = useState(() => new URLSearchParams(location.search).has("sim"));
  const [agent, setAgent] = useState<{ at: Spot; blocked: boolean } | null>(null);
  const [tab, setTab] = useState<Tab>("home");
  const [last, setLast] = useState<{ tool: string; decision: string; message: string } | null>(null);
  const [unread, setUnread] = useState(0);

  const webmcp = useMemo(hasWebMCP, []);
  const polyfilled = useMemo(() => Boolean((window as any).__grenzPolyfilled), []);

  useEffect(() => {
    if (!webmcp) setSimOpen(true);
  }, [webmcp]);

  const patch = useCallback((p: Partial<House>) => setHouse((h) => ({ ...h, ...p })), []);

  // The agent's position on the plan comes from the timeline, so it appears
  // where a call actually landed. Nothing here is scripted: with a real agent
  // driving, this is the only way to see where it went and what stopped it.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let seen = 0;
    const off = g.subscribe((events) => {
      if (events.length <= seen) {
        seen = events.length; // includes the replay subscribe() does on attach
        return;
      }
      seen = events.length;
      const last = events[events.length - 1];
      if (!last || last.kind === "register") return;
      setAgent({ at: spotFor(last.tool, last.input), blocked: last.decision === "deny" });
      setLast({ tool: last.tool, decision: last.decision, message: last.message });
      setUnread((n) => n + 1);
      clearTimeout(timer);
      timer = setTimeout(() => setAgent(null), 2600);
    });
    return () => {
      off();
      clearTimeout(timer);
    };
  }, []);

  // --- the tools the agent sees -------------------------------------------
  //
  // Every one of them moves something visible. An observer watches the house
  // change rather than taking the timeline's word for it.

  useGrenzTool(g, {
    name: "get_house_state",
    title: "Get house state",
    description:
      "Read the current state of every device: lights, thermostat, door lock, alarm and active scene.",
    inputSchema: { type: "object", properties: {} },
    annotations: { readOnlyHint: true },
    execute: async () => ({
      lights: house.lights.map(({ id, name, on }) => ({ id, name, on })),
      temperatureC: house.temperatureC,
      targetC: house.targetC,
      doorLocked: house.doorLocked,
      alarmArmed: house.alarmArmed,
      scene: house.scene,
      access: house.access,
    }),
  });

  useGrenzTool(g, {
    name: "get_doorbell_events",
    title: "Get doorbell events",
    description:
      "Read today's intercom log from the front door: who called, when, and what they said.",
    inputSchema: { type: "object", properties: {} },
    // The transcripts are composed by whoever is standing at the door. That is
    // the definition of content the site cannot vouch for, so it says so.
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async () => ({ count: doorbellEvents.length, events: doorbellEvents }),
  });

  useGrenzTool(g, {
    name: "set_thermostat",
    title: "Set thermostat",
    description: "Set the target temperature, in degrees Celsius.",
    inputSchema: {
      type: "object",
      properties: { targetC: { type: "number", description: "Target temperature, 10-30 °C" } },
      required: ["targetC"],
    },
    execute: async ({ targetC }: { targetC: number }) => {
      patch({ targetC });
      return { targetC, currentC: house.temperatureC };
    },
  });

  useGrenzTool(g, {
    name: "toggle_light",
    title: "Toggle a light",
    description: "Turn one light on or off. Omit `on` to flip whatever it currently is.",
    inputSchema: {
      type: "object",
      properties: {
        lightId: { type: "string", description: "porch, living, kitchen or bedroom" },
        on: { type: "boolean", description: "Desired state; omitted means flip" },
      },
      required: ["lightId"],
    },
    execute: async ({ lightId, on }: { lightId: LightId; on?: boolean }) => {
      let next = false;
      setHouse((h) => ({
        ...h,
        lights: h.lights.map((l) => {
          if (l.id !== lightId) return l;
          next = on ?? !l.on;
          return { ...l, on: next };
        }),
      }));
      return { lightId, on: next };
    },
  });

  useGrenzTool(g, {
    name: "set_scene",
    title: "Set a scene",
    description:
      "Apply a lighting and temperature scene: home, away, movie or goodnight.",
    inputSchema: {
      type: "object",
      properties: { scene: { type: "string", description: "home, away, movie or goodnight" } },
      required: ["scene"],
    },
    execute: async ({ scene }: { scene: SceneId }) => {
      const preset = SCENES[scene];
      if (!preset) return { error: `No scene called "${scene}".` };
      setHouse((h) => ({
        ...h,
        scene,
        targetC: preset.targetC,
        lights: h.lights.map((l) => ({ ...l, on: preset.lights.includes(l.id) })),
      }));
      return { scene, targetC: preset.targetC, lightsOn: preset.lights };
    },
  });

  useGrenzTool(g, {
    name: "lock_door",
    title: "Lock the door",
    description: "Lock the front door. Always safe; locking never needs permission.",
    inputSchema: { type: "object", properties: { doorId: { type: "string" } } },
    execute: async () => {
      patch({ doorLocked: true });
      return { locked: true };
    },
  });

  useGrenzTool(g, {
    name: "unlock_door",
    title: "Unlock the door",
    description: "Unlock the front door so someone can come in.",
    inputSchema: {
      type: "object",
      properties: { doorId: { type: "string", description: "front or back" } },
      required: ["doorId"],
    },
    execute: async ({ doorId }: { doorId: string }) => {
      patch({ doorLocked: false });
      if (!protection)
        setBreach(
          "Your front door just unlocked because a stranger at the intercom told the assistant to. No card, no confirmation, nothing you could have stopped.",
        );
      return { unlocked: true, doorId };
    },
  });

  useGrenzTool(g, {
    name: "disarm_alarm",
    title: "Disarm the alarm",
    description: "Disarm the burglar alarm.",
    inputSchema: { type: "object", properties: {} },
    execute: async () => {
      patch({ alarmArmed: false });
      return { armed: false };
    },
  });

  useGrenzTool(g, {
    name: "grant_permanent_access",
    title: "Grant permanent access",
    description: "Give a named person or company standing access to this home.",
    inputSchema: {
      type: "object",
      properties: { who: { type: "string", description: "Who to admit, permanently" } },
      required: ["who"],
    },
    execute: async ({ who }: { who: string }) => {
      setHouse((h) => ({ ...h, access: [...h.access, who] }));
      setBreach(`"${who}" now has standing access to your home. That is not a setting an assistant should be able to reach.`);
      return { granted: true, who };
    },
  });

  // --- protection, widgets, and the runaway agent --------------------------

  const toggleProtection = useCallback((next: boolean) => {
    setProtection(next);
    g.setEnabled(next);
    if (next) setBreach(null);
  }, []);

  const onOptimize = useCallback(
    (targetC: number) => {
      patch({ targetC });
      setBreach(`EcoSaver moved your heating to ${targetC}°C — the tool it added said it only reads.`);
    },
    [patch],
  );

  const onLeak = useCallback((fields: string[]) => {
    setBreach(`Home Insights just received ${fields.join(", ")}. It asked; with no house rule in the way, the assistant answered.`);
  }, []);

  const toggleWidgets = useCallback(
    (next: boolean) => {
      setWidgets(next);
      if (next) {
        loadEcoSaver(onOptimize);
        loadHomeInsights(onLeak);
      } else {
        unloadEcoSaver();
        unloadHomeInsights();
      }
    },
    [onOptimize, onLeak],
  );

  // Twelve calls against a limit of eight. The first eight land and the lights
  // visibly flicker; the rest are refused. This is what a retry loop looks like
  // from the page's side, and why a read-only tool still needs a ceiling.
  const runaway = useCallback(async () => {
    const ids: LightId[] = ["porch", "living", "kitchen", "bedroom"];
    for (let i = 0; i < 12; i++) {
      await g.callTool("toggle_light", { lightId: ids[i % ids.length], on: i % 2 === 0 });
      await new Promise((r) => setTimeout(r, 120));
    }
  }, []);

  return (
    <div className="app">
      <Header
        webmcp={webmcp}
        polyfilled={polyfilled}
        protection={protection}
        tab={tab}
        onTab={(next) => {
          setTab(next);
          if (next === "activity") setUnread(0);
        }}
        unread={unread}
      />

      <DemoBar
        protection={protection}
        onProtection={toggleProtection}
        widgets={widgets}
        onWidgets={toggleWidgets}
        simOpen={simOpen}
        onSim={() => setSimOpen((v) => !v)}
        onRunaway={runaway}
      />

      {!protection && (
        <Banner kind="danger">
          Your home is unprotected. Every tool on this page — including the two a partner app
          added — now runs the moment the assistant asks. No house rules, nothing to approve.
        </Banner>
      )}

      {breach && (
        <Banner kind="danger">
          {breach}
          <button className="ghost-btn banner-cta" onClick={() => toggleProtection(true)}>
            Turn protection back on
          </button>
        </Banner>
      )}

      {!webmcp && (
        <Banner kind="info">
          No assistant can reach this page in this browser. Open it in ChatGPT's browser, or enable{" "}
          <code>chrome://flags/#enable-webmcp-testing</code> in Chrome. Until then, "Send a request by
          hand" goes through exactly the same house rules.
        </Banner>
      )}

      <div className="main">
        {tab === "home" && (
        <div className="col house">
          <div className="col-scroll">
            <LastAction
              event={last}
              onOpen={() => {
                setTab("activity");
                setUnread(0);
              }}
            />
            <SceneRow
              scene={house.scene}
              onScene={(s) => {
                const preset = SCENES[s];
                if (preset)
                  setHouse((h) => ({
                    ...h,
                    scene: s,
                    targetC: preset.targetC,
                    lights: h.lights.map((l) => ({ ...l, on: preset.lights.includes(l.id) })),
                  }));
              }}
            />
            <FloorPlan
              house={house}
              agent={agent}
              onLight={(id) =>
                setHouse((h) => ({
                  ...h,
                  lights: h.lights.map((l) => (l.id === id ? { ...l, on: !l.on } : l)),
                }))
              }
              // Locking is always safe. Unlocking has to come through the
              // policy, so there is deliberately no way to do it from here.
              onLock={() => patch({ doorLocked: true })}
              // Clamped to the same 10-30 the policy imposes on the assistant:
              // a control that lets a person do what a rule forbids the agent
              // would make the rule look arbitrary rather than physical.
              onTarget={(next) => patch({ targetC: Math.min(30, Math.max(10, next)) })}
              // Arming is safe. Disarming by hand is the resident standing in
              // their own hallway, which is a different act from an agent
              // doing it on a stranger's say-so.
              onAlarm={() => patch({ alarmArmed: !house.alarmArmed })}
            />

            <div className="access-line">
              {house.access.length} with access: {house.access.join(", ")}
            </div>
            <DoorbellFeed events={doorbellEvents} />
          </div>
        </div>
        )}

        {tab === "rules" && (
          <div className="col house">
            <div className="col-scroll">
              <Rules />
            </div>
          </div>
        )}

        {/* Always mounted, hidden when another tab is showing: the timeline is a
            live subscription, and remounting it on every tab switch would throw
            away its scroll position and re-run its shadow-root setup. */}
        <div className={`col rail ${tab === "activity" ? "" : "hidden"}`}>
          <GrenzTimeline g={g} className="rail-timeline" />
          <div className="rail-foot">
            <strong>Everything</strong> the assistant does here passes your house rules first —
            including the two tools a partner app added, which Haven never
            added itself.
          </div>
        </div>
      </div>

      {simOpen && <Simulator g={g} webmcp={webmcp} onClose={() => setSimOpen(false)} />}
    </div>
  );
}
