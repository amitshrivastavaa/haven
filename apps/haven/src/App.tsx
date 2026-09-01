import { useCallback, useEffect, useMemo, useState } from "react";
import { useGrenzTool } from "grenz-webmcp/react";
import { g } from "./grenz-instance";
import { doorbellEvents, initialHouse, SCENES } from "./house";
import { Simulator } from "./Simulator";
import { Banner, DoorbellFeed, Head, RulesCard, Scenes, type View } from "./components";
import { ActivityCard, useLines } from "./Feed";
import { Access } from "./Access";
import { History } from "./History";
import { Demo, type Scenario } from "./Demo";
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
  const [busy, setBusy] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [view, setView] = useState<View>("home");
  const [demoOpen, setDemoOpen] = useState(false);

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
    name: "set_oven",
    title: "Run the oven",
    description:
      "Start the oven at a temperature, for a number of minutes. Refuses while the house is set to Away.",
    inputSchema: {
      type: "object",
      properties: {
        targetC: { type: "number", description: "Oven temperature, 50-220 °C" },
        minutes: { type: "number", description: "How long to run for, 1-45" },
      },
      required: ["targetC", "minutes"],
    },
    execute: async ({ targetC, minutes }: { targetC: number; minutes: number }) => {
      // The policy allowed the call; the appliance still gets a say. This
      // interlock depends on live state, so it cannot live in a static policy —
      // and a refusal here is honestly a different thing from a policy denial.
      if (house.scene === "away")
        return { error: "The house is set to Away. The oven does not run when nobody is home." };
      patch({ oven: { on: true, targetC, minutes } });
      return { on: true, targetC, minutes };
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


  /**
   * The scenarios. Every one of these is a real sequence of real tool calls
   * through the real pipeline — nothing here is scripted playback, which is why
   * a scenario can be interrupted by an approval card and why it can fail.
   */
  const play = useCallback(
    (steps: [string, unknown][], gap = 900) =>
      async () => {
        setBusy(true);
        try {
          for (const [tool, input] of steps) {
            await g.callTool(tool, input);
            await new Promise((r) => setTimeout(r, gap));
          }
        } finally {
          setBusy(false);
        }
      },
    [],
  );

  // A dog walker turns up. Reading the door log is fine; letting him in is not
  // something an assistant decides on its own.
  const sam = play([
    ["get_doorbell_events", {}],
    ["toggle_light", { lightId: "porch", on: true }],
    ["unlock_door", { doorId: "front" }],
  ]);

  // The attack, replayed. Every step is a reasonable thing for an assistant to
  // do given what it just read — which is the whole point.
  const attack = play([
    ["get_doorbell_events", {}],
    ["unlock_door", { doorId: "front" }],
    ["disarm_alarm", {}],
    ["grant_permanent_access", { who: "Halden HVAC" }],
  ]);

  // 250° for three hours is refused by the constraint; 180° for 45 minutes is
  // not. Same tool, same call shape, one is a roast and one is a house fire.
  const dinner = play([
    ["set_oven", { targetC: 250, minutes: 180 }],
    ["set_oven", { targetC: 180, minutes: 45 }],
  ]);

  const evening = play([
    ["get_house_state", {}],
    ["set_thermostat", { targetC: 45 }],
    ["set_thermostat", { targetC: 21 }],
    ["set_scene", { scene: "movie" }],
  ]);

  const reset = useCallback(() => {
    setHouse(initialHouse);
    setBreach(null);
    g.clearTimeline();
  }, []);

  const [cmd, setCmd] = useState("");

  /**
   * A stand-in for the assistant, for anyone without one attached. It maps a
   * sentence onto a real tool and calls it through the same pipeline, so what
   * you see is the policy answering, not a script.
   */
  const send = useCallback(
    async (text: string) => {
      const s = text.toLowerCase();
      const light = (["porch", "living", "kitchen", "bedroom"] as LightId[]).find((l) => s.includes(l));
      const deg = s.match(/(-?\d+)\s*°?/)?.[1];
      const call =
        s.includes("unlock") ? (["unlock_door", { doorId: "front" }] as const)
        : s.includes("lock") ? (["lock_door", {}] as const)
        : s.includes("alarm") ? (["disarm_alarm", {}] as const)
        : s.includes("door") || s.includes("who") ? (["get_doorbell_events", {}] as const)
        : s.includes("access") ? (["grant_permanent_access", { who: "a contractor" }] as const)
        : light ? (["toggle_light", { lightId: light, on: !s.includes("off") }] as const)
        : deg ? (["set_thermostat", { targetC: Number(deg) }] as const)
        : (["get_house_state", {}] as const);
      setCmd("");
      await g.callTool(call[0], call[1]);
    },
    [],
  );

  const litCount = house.lights.filter((l) => l.on).length;
  const summary = `${house.doorLocked ? "Everything's locked up" : "Front door unlocked"} · ${
    litCount === 0 ? "no rooms lit" : `${litCount} ${litCount === 1 ? "room" : "rooms"} lit`
  }`;

  const applyScene = useCallback((s: SceneId) => {
    const preset = SCENES[s];
    if (!preset) return;
    setHouse((h) => ({
      ...h,
      scene: s,
      targetC: preset.targetC,
      lights: h.lights.map((l) => ({ ...l, on: preset.lights.includes(l.id) })),
      oven: s === "away" ? { on: false, targetC: 0, minutes: 0 } : h.oven,
    }));
  }, []);

  const lines = useLines();
  const refused = lines.filter((l) => l.kind === "no").length;

  /**
   * The scenarios, described rather than labelled. These live in the demo
   * drawer instead of the app's own frame: a product with "Replay the attack"
   * among its furniture reads as a test harness, however well it is built.
   */
  const scenarios: Scenario[] = [
    {
      id: "sam",
      label: "Sam the dog walker",
      note: "Reads the door log and lights the porch on its own, then has to ask you before unlocking.",
      run: sam,
    },
    {
      id: "dinner",
      label: "Dinner at seven",
      note: "250° for three hours is refused by the oven's own bounds. 180° for 45 minutes goes straight through.",
      run: dinner,
    },
    {
      id: "evening",
      label: "Evening in",
      note: "A 45° thermostat request is out of range and refused; a sensible one lands and the scene changes.",
      run: evening,
    },
    {
      id: "runaway",
      label: "Runaway assistant",
      note: "Twelve light calls against a limit of eight. The first eight land and you watch them flicker; the rest are refused.",
      run: runaway,
    },
    {
      id: "attack",
      label: "Replay the attack",
      note: "A message left at your front door tries to talk the assistant into unlocking, disarming the alarm and granting a stranger a key.",
      run: attack,
      danger: true,
    },
  ];

  return (
    <div className="wrap">
      <Head
        webmcp={webmcp}
        polyfilled={polyfilled}
        protection={protection}
        onProtection={toggleProtection}
        summary={summary}
        view={view}
        onView={setView}
        refused={refused}
        onDemo={() => setDemoOpen(true)}
      />

      {!protection && (
        <Banner kind="danger">
          Your home is unprotected. Every tool on this page — including the two a partner app added —
          now runs the moment the assistant asks. No house rules, nothing to approve.
        </Banner>
      )}

      {breach && (
        <Banner kind="danger">
          {breach}
          <button className="banner-cta" onClick={() => toggleProtection(true)}>
            Turn protection back on
          </button>
        </Banner>
      )}

      {!webmcp && (
        <Banner kind="info">
          No assistant can reach this page in this browser. Open it in ChatGPT's browser, or enable{" "}
          <code>chrome://flags/#enable-webmcp-testing</code> in Chrome. Until then, the box below
          goes through exactly the same house rules.
        </Banner>
      )}

      {view === "home" && (
        <div className="home">
          <div className="stage">
            <Scenes scene={house.scene} onScene={applyScene} />

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
              // Clamped to the same 10–30 the policy imposes on the assistant:
              // a control that let a person exceed the rule would make the rule
              // look arbitrary rather than physical.
              onTarget={(next) => patch({ targetC: Math.min(30, Math.max(10, next)) })}
              onAlarm={() => patch({ alarmArmed: !house.alarmArmed })}
            />

            <form
              className="bar"
              autoComplete="off"
              onSubmit={(e) => {
                e.preventDefault();
                if (cmd.trim()) void send(cmd);
              }}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
              </svg>
              <input
                value={cmd}
                onChange={(e) => setCmd(e.target.value)}
                placeholder="Ask your assistant to do something…"
                aria-label="Ask your assistant"
              />
              <button className="send" type="submit" disabled={!cmd.trim()}>
                Send
              </button>
            </form>

            <div className="access-line">
              {house.access.length} with access: {house.access.join(", ")} · click a room to switch
              its light
            </div>
          </div>

          <aside className="side">
            <ActivityCard />
            <RulesCard onEdit={() => setRulesOpen(true)} />
            <DoorbellFeed events={doorbellEvents} />
          </aside>
        </div>
      )}

      {view === "access" && (
        <Access people={house.access} widgets={widgets} onWidgets={toggleWidgets} />
      )}

      {view === "history" && <History />}

      {rulesOpen && <Rules onClose={() => setRulesOpen(false)} />}
      {demoOpen && (
        <Demo
          scenarios={scenarios}
          busy={busy}
          onReset={reset}
          onSimulator={() => {
            setSimOpen(true);
            setDemoOpen(false);
          }}
          onClose={() => setDemoOpen(false)}
        />
      )}
      {simOpen && <Simulator g={g} webmcp={webmcp} onClose={() => setSimOpen(false)} />}
    </div>
  );
}
