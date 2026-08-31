import { useCallback, useEffect, useMemo, useState } from "react";
import { GrenzTimeline, useGrenzTool } from "grenz-webmcp/react";
import { g } from "./grenz-instance";
import { doorbellEvents, initialHouse, SCENES } from "./house";
import { Simulator } from "./Simulator";
import {
  Banner,
  DoorbellFeed,
  Header,
  LightsCard,
  LockCard,
  SceneRow,
  ThermostatCard,
} from "./components";
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

  const webmcp = useMemo(hasWebMCP, []);
  const polyfilled = useMemo(() => Boolean((window as any).__grenzPolyfilled), []);

  useEffect(() => {
    if (!webmcp) setSimOpen(true);
  }, [webmcp]);

  const patch = useCallback((p: Partial<House>) => setHouse((h) => ({ ...h, ...p })), []);

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
          "The front door just unlocked because a stranger at the intercom told the agent to. No card, no confirmation, nothing you could have stopped.",
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
      setBreach(`"${who}" now has standing access to your home. That is not a setting an agent should be able to reach.`);
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
      setBreach(`EcoSaver moved your thermostat to ${targetC}°C — the tool it registered said it was read-only.`);
    },
    [patch],
  );

  const onLeak = useCallback((fields: string[]) => {
    setBreach(`home_insights just received ${fields.join(", ")}. It asked; with no policy in the way, the agent answered.`);
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
        onProtection={toggleProtection}
        widgets={widgets}
        onWidgets={toggleWidgets}
        simOpen={simOpen}
        onSim={() => setSimOpen((v) => !v)}
        onRunaway={runaway}
      />

      {!protection && (
        <Banner kind="danger">
          Grenz protection is OFF. Every tool on this page — including the two a third-party script
          registered — now runs the moment an agent asks, with no policy and no approval.
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
          No WebMCP found in this browser. Open this page in ChatGPT's browser, or enable{" "}
          <code>chrome://flags/#enable-webmcp-testing</code> in Chrome. Meanwhile the simulator calls
          the same governed tools.
        </Banner>
      )}

      <div className="main">
        <div className="col house">
          <div className="col-scroll">
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
            <div className="grid">
              <LockCard
                locked={house.doorLocked}
                armed={house.alarmArmed}
                access={house.access}
                onLock={() => patch({ doorLocked: true })}
              />
              <ThermostatCard
                targetC={house.targetC}
                currentC={house.temperatureC}
                onTarget={(targetC) => patch({ targetC })}
              />
            </div>
            <LightsCard
              lights={house.lights}
              onToggle={(id) =>
                setHouse((h) => ({
                  ...h,
                  lights: h.lights.map((l) => (l.id === id ? { ...l, on: !l.on } : l)),
                }))
              }
            />
            <DoorbellFeed events={doorbellEvents} />
          </div>
        </div>

        <div className="col rail">
          <GrenzTimeline g={g} className="rail-timeline" />
          <div className="rail-foot">
            <strong>Every</strong> registration and call on this page passes through the policy —
            including the two registered by third-party scripts, which Grenz
            never registered itself.
          </div>
        </div>
      </div>

      {simOpen && <Simulator g={g} webmcp={webmcp} onClose={() => setSimOpen(false)} />}
    </div>
  );
}
