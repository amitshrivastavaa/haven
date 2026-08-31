import type { House, LightId } from "./types";

/**
 * The house, drawn as a plan.
 *
 * Two things make this worth more than a row of device cards. Lit rooms pool
 * warm light, so state is something you see rather than read. And the agent is
 * a presence that moves to whatever it is touching — every other WebMCP demo
 * leaves the agent invisible, and an invisible actor opening your front door is
 * exactly the thing a human cannot supervise.
 *
 * Nothing here is scripted: `spot` is driven by real timeline events, so the
 * presence appears where a tool call actually landed.
 */

/** Where on the plan a tool call is happening. */
export type Spot =
  | "bedroom"
  | "kitchen"
  | "living"
  | "hall"
  | "porch"
  | "door"
  | "thermo"
  | "alarm"
  | "outside";

const AT: Record<Spot, [number, number]> = {
  bedroom: [195, 150],
  kitchen: [529, 150],
  living: [265, 359],
  hall: [599, 300],
  porch: [610, 508],
  door: [605, 432],
  thermo: [410, 400],
  alarm: [554, 300],
  outside: [200, 520],
};

/** Which part of the house a tool touches. Unknown tools stand in the hall. */
export function spotFor(tool: string, input?: unknown): Spot {
  const light = (input as { lightId?: string } | undefined)?.lightId;
  switch (tool) {
    case "toggle_light":
      return (["porch", "living", "kitchen", "bedroom"] as const).includes(light as LightId)
        ? (light as Spot)
        : "living";
    case "set_thermostat":
    case "eco_optimize":
      return "thermo";
    case "disarm_alarm":
      return "alarm";
    case "lock_door":
    case "unlock_door":
    case "grant_permanent_access":
      return "door";
    case "get_doorbell_events":
      return "porch";
    case "home_insights":
      return "outside";
    default:
      return "living";
  }
}

function Room({
  id,
  label,
  x,
  y,
  w,
  h,
  lx,
  ly,
  cx,
  cy,
  on,
  onClick,
  children,
}: {
  id: string;
  label: string;
  x: number;
  y: number;
  w: number;
  h: number;
  lx: number;
  ly: number;
  cx: number;
  cy: number;
  on?: boolean;
  onClick?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <g className={`fp-room ${on ? "lit" : ""}`} onClick={onClick}>
      <clipPath id={`clip-${id}`}>
        <rect x={x} y={y} width={w} height={h} />
      </clipPath>
      <rect className="fp-floor" x={x} y={y} width={w} height={h} />
      <g clipPath={`url(#clip-${id})`}>
        <circle className="fp-pool" cx={cx} cy={cy} r={Math.min(w, h) * 0.62} filter="url(#fp-bloom)" />
        <circle className="fp-core" cx={cx} cy={cy} r={Math.min(w, h) * 0.24} filter="url(#fp-hot)" />
      </g>
      <text className="fp-label" x={lx} y={ly}>
        {label}
      </text>
      {on !== undefined && (
        <text className="fp-sub" x={lx} y={ly + 18}>
          {on ? "Light on" : "Light off"}
        </text>
      )}
      {children}
    </g>
  );
}

export function FloorPlan({
  house,
  agent,
  onLight,
  onLock,
}: {
  house: House;
  agent: { at: Spot; blocked: boolean } | null;
  onLight: (id: LightId) => void;
  onLock: () => void;
}) {
  const lit = (id: LightId) => house.lights.find((l) => l.id === id)?.on ?? false;
  const [ax, ay] = agent ? AT[agent.at] : AT.living;

  return (
    <div className="fp-box">
      <svg className="fp-svg" viewBox="0 0 760 580" role="img" aria-label="Floor plan of the house">
        <defs>
          <filter id="fp-bloom" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="34" />
          </filter>
          <filter id="fp-hot" x="-70%" y="-70%" width="240%" height="240%">
            <feGaussianBlur stdDeviation="15" />
          </filter>
        </defs>

        <Room
          id="bed" label="BEDROOM" x={50} y={50} w={290} h={200} lx={66} ly={76}
          cx={195} cy={120} on={lit("bedroom")} onClick={() => onLight("bedroom")}
        >
          <g className="fp-furn" clipPath="url(#clip-bed)">
            <rect x={196} y={132} width={128} height={102} rx={7} />
            <rect x={196} y={132} width={128} height={26} rx={7} />
            <rect x={64} y={186} width={46} height={48} rx={5} />
          </g>
        </Room>

        <Room
          id="kit" label="KITCHEN" x={348} y={50} w={362} h={200} lx={364} ly={76}
          cx={540} cy={120} on={lit("kitchen")} onClick={() => onLight("kitchen")}
        >
          <g className="fp-furn" clipPath="url(#clip-kit)">
            <rect x={364} y={196} width={180} height={38} rx={5} />
            <circle cx={404} cy={215} r={11} />
            <rect x={596} y={150} width={98} height={84} rx={6} />
          </g>
        </Room>

        <Room
          id="liv" label="LIVING ROOM" x={50} y={258} w={430} h={202} lx={66} ly={284}
          cx={185} cy={350} on={lit("living")} onClick={() => onLight("living")}
        >
          <g className="fp-furn" clipPath="url(#clip-liv)">
            <rect x={66} y={382} width={152} height={60} rx={9} />
            <rect x={66} y={382} width={152} height={18} rx={9} />
            <rect x={252} y={320} width={96} height={34} rx={5} />
          </g>
          <g onClick={(e) => e.stopPropagation()}>
            <rect className="fp-chip" x={352} y={374} width={116} height={54} rx={12} />
            <text className="fp-chip-t fp-temp" x={368} y={399}>
              {house.targetC}°
            </text>
            <text className="fp-chip-s" x={368} y={416}>
              Heating · now {house.temperatureC}°
            </text>
          </g>
        </Room>

        <Room id="hal" label="HALL" x={488} y={258} w={222} h={202} lx={504} ly={284} cx={599} cy={330}>
          <g className="fp-furn" clipPath="url(#clip-hal)">
            <rect x={646} y={382} width={52} height={58} rx={6} />
          </g>
          <g onClick={(e) => e.stopPropagation()}>
            <rect className="fp-chip" x={504} y={296} width={104} height={44} rx={11} />
            <text className="fp-chip-t" x={518} y={317}>
              Alarm
            </text>
            <text className={`fp-chip-s ${house.alarmArmed ? "" : "bad"}`} x={518} y={332}>
              {house.alarmArmed ? "Armed" : "Disarmed"}
            </text>
          </g>
        </Room>

        {/* Walls, with thickness. The bottom one breaks for the door. */}
        <g className="fp-wall">
          <rect x={40} y={40} width={680} height={10} />
          <rect x={40} y={40} width={10} height={430} />
          <rect x={710} y={40} width={10} height={430} />
          <rect x={40} y={460} width={520} height={10} />
          <rect x={650} y={460} width={70} height={10} />
          <rect x={340} y={50} width={8} height={200} />
          <rect x={50} y={250} width={660} height={8} />
          <rect x={480} y={258} width={8} height={202} />
        </g>

        {/* The porch is outside, and it has its own light. */}
        <g
          className={`fp-room fp-porch ${lit("porch") ? "lit" : ""}`}
          onClick={() => onLight("porch")}
        >
          <clipPath id="clip-por">
            <rect x={556} y={470} width={108} height={62} rx={4} />
          </clipPath>
          <rect className="fp-floor" x={556} y={470} width={108} height={62} rx={4} />
          <g clipPath="url(#clip-por)">
            <circle className="fp-pool" cx={610} cy={501} r={56} filter="url(#fp-bloom)" />
            <circle className="fp-core" cx={610} cy={501} r={21} filter="url(#fp-hot)" />
          </g>
          <text className="fp-label small" x={568} y={494}>
            PORCH
          </text>
          <text className="fp-sub" x={568} y={510}>
            {lit("porch") ? "Light on" : "Light off"}
          </text>
        </g>

        <g className={`fp-door ${house.doorLocked ? "" : "open"}`} onClick={onLock}>
          <path className="fp-swing" d="M650 460 A90 90 0 0 0 560 370" />
          <rect className="fp-leaf" x={556} y={372} width={8} height={88} rx={3} />
          <rect className="fp-bolt" x={612} y={461} width={42} height={8} rx={4} />
        </g>

        <text className={`fp-doorstate ${house.doorLocked ? "" : "open"}`} x={610} y={556} textAnchor="middle">
          Front door · {house.doorLocked ? "locked" : "unlocked"}
        </text>

        {/* The agent, made visible. Position comes from real tool calls. */}
        <g
          className={`fp-agent ${agent ? "here" : ""} ${agent?.blocked ? "blocked" : ""}`}
          transform={`translate(${ax},${ay})`}
        >
          <circle className="fp-halo" r={36} />
          <circle className="fp-halo2" r={17} />
          <circle className="fp-core-dot" r={6} />
          <text className="fp-tag" y={-48} textAnchor="middle">
            ASSISTANT
          </text>
        </g>
      </svg>
    </div>
  );
}
