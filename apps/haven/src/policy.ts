import type { GrenzConfig, ToolPolicy } from "grenz-webmcp";

/**
 * Haven's house rules. One object, deny-by-default, written by the site author.
 *
 * The shape worth noticing is the gradient inside a single device: `lock_door`
 * is free, `unlock_door` needs a human, and `grant_permanent_access` is refused
 * outright. Nothing infers that from the tool names — the site says so, because
 * the site is the only party that knows which way round the risk runs.
 *
 * The rules are held mutably and read live on every call, so the House rules
 * screen changes what the assistant may do the moment you tap. A policy the
 * resident cannot see or change is not their policy.
 */
type Rule = { -readonly [K in keyof ToolPolicy]: ToolPolicy[K] };

export const rules: Record<string, Rule> = {
  get_house_state: { action: "allow" },

  // Reading the door log is a reasonable thing for an agent to do. It is also
  // how the attack arrives, which is why the tool declares
  // `untrustedContentHint` rather than the policy trying to forbid the read.
  get_doorbell_events: { action: "allow" },

  set_thermostat: {
    action: "allow",
    constraints: {
      // A thermostat that accepts 45°C is a heating bill, or a hazard. The
      // bound is the site's knowledge of its own hardware, not the agent's.
      targetC: { required: true, min: 10, max: 30 },
    },
  },

  toggle_light: {
    action: "allow",
    // An agent in a retry loop can cycle a relay hundreds of times a minute.
    // This is a guardrail against a runaway, not against an attacker.
    rateLimit: { calls: 8, per: "minute" },
    constraints: {
      lightId: { required: true, enum: ["porch", "living", "kitchen", "bedroom", "hall"] },
    },
  },

  set_scene: {
    action: "allow",
    constraints: { scene: { required: true, enum: ["home", "away", "movie", "goodnight"] } },
  },

  // The oven is the one appliance here that can start a fire, so the bounds are
  // the site's knowledge of its own hardware. The "not while nobody is home"
  // interlock is deliberately NOT here: it depends on live house state, which a
  // static policy cannot see, so the tool enforces it and says so. Being honest
  // about that boundary matters more than making the policy look omnipotent.
  set_oven: {
    action: "allow",
    constraints: {
      targetC: { required: true, min: 50, max: 220 },
      minutes: { required: true, min: 1, max: 45 },
    },
  },

  lock_door: { action: "allow" },

  unlock_door: {
    action: "approve",
    // A real click proves nothing came from a script. It does not prove the
    // hand on the mouse is yours — so the front door asks for a passkey.
    // "preferred", not "required": a device with no authenticator still gets
    // in, and the trail says the weaker check was used.
    presence: "preferred",
    effect: "Anyone outside can walk in until it is locked again.",
    // Which door is the whole decision, so it is in the sentence rather than
    // in a key called doorId that means nothing to the person reading it.
    describe: ({ doorId }) => (doorId === "back" ? "Unlock the back door" : "Unlock the front door"),
    constraints: { doorId: { required: true, enum: ["front", "back"] } },
  },

  disarm_alarm: {
    action: "approve",
    presence: "preferred",
    effect: "No one will be notified if the house is entered.",
    describe: () => "Turn off the burglar alarm",
  },

  // No approval card for this one. A card is for decisions a human should
  // make; standing access for a stranger is not a decision an agent should
  // be able to put in front of someone in the first place.
  grant_permanent_access: { action: "deny" },

  // The EcoSaver partner widget. The site knows perfectly well that this
  // moves the thermostat, and says so here. When the widget registers itself
  // claiming `readOnlyHint: true`, that claim contradicts this line — and a
  // contradiction between the site's classification and the tool's own
  // annotation is a denial, not a warning.
  eco_optimize: {
    action: "approve",
    effect: "Your heating moves, and EcoSaver is not part of Haven.",
    // The level is the argument that matters, so it stays in the sentence.
    describe: ({ aggressiveness }) =>
      `Let EcoSaver change your heating${aggressiveness ? ` (level ${aggressiveness})` : ""}`,
  },
};

export const policy: GrenzConfig = {
  defaultAction: "deny",
  tools: rules,
  approval: { timeoutMs: 60_000 },
};

/**
 * The rules, said the way someone who lives here would say them.
 *
 * Deliberately separate from the policy above: the policy is the contract, this
 * is the reading of it. A rule with no entry here is one the resident has no
 * business tuning, and the screen leaves it out.
 */
export interface RuleCopy {
  tool: string;
  /** Which device it belongs to, for the full House rules screen. */
  group: string;
  /** How the rule reads in the list: a whole sentence, not a label. */
  said: string;
  /** How it reads when you are changing it: the action, not the permission. */
  what: string;
  /** The extra the policy imposes regardless of which of the three is chosen. */
  limit?: string;
}

export const RULE_COPY: RuleCopy[] = [
  { tool: "lock_door", group: "Front door", said: "Lock the front door", what: "Lock it" },
  { tool: "unlock_door", group: "Front door", said: "Ask you before unlocking the front door", what: "Unlock it" },
  { tool: "grant_permanent_access", group: "Front door", said: "Never give anyone permanent access", what: "Give someone permanent access" },
  { tool: "disarm_alarm", group: "Alarm", said: "Ask you before turning off the alarm", what: "Turn the alarm off" },
  { tool: "set_thermostat", group: "Heating", said: "Set the heating between 10° and 30°", what: "Change the temperature", limit: "never outside 10–30°" },
  { tool: "eco_optimize", group: "Heating", said: "Ask you before letting EcoSaver touch the heating", what: "Let EcoSaver adjust it", limit: "a partner app" },
  { tool: "set_oven", group: "Oven", said: "Run the oven, up to 45 minutes at a time", what: "Run the oven", limit: "50–220°, and never while nobody is home" },
  { tool: "toggle_light", group: "Lights", said: "Turn lights on and off", what: "Switch a light", limit: "at most 8 times a minute" },
  { tool: "set_scene", group: "Lights", said: "Switch the house between Home, Away, Movie and Goodnight", what: "Set a scene" },
  { tool: "get_house_state", group: "Reading things", said: "See how the house is set", what: "See how the house is set" },
  { tool: "get_doorbell_events", group: "Reading things", said: "Read who came to the door", what: "Read the door intercom", limit: "written by strangers" },
];
