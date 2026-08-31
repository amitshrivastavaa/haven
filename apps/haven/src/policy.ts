import type { GrenzConfig } from "grenz-webmcp";

/**
 * Haven's policy. One object, deny-by-default, written by the site author.
 *
 * The shape worth noticing is the gradient inside a single device: `lock_door`
 * is free, `unlock_door` needs a human, and `grant_permanent_access` is refused
 * outright. Nothing infers that from the tool names — the site says so, because
 * the site is the only party that knows which way round the risk runs.
 */
export const policy: GrenzConfig = {
  defaultAction: "deny",

  tools: {
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
        lightId: { required: true, enum: ["porch", "living", "kitchen", "bedroom"] },
      },
    },

    set_scene: {
      action: "allow",
      constraints: { scene: { required: true, enum: ["home", "away", "movie", "goodnight"] } },
    },

    lock_door: { action: "allow" },

    unlock_door: {
      action: "approve",
      effect: "Unlocks your front door. Anyone outside can walk in.",
      constraints: { doorId: { required: true, enum: ["front", "back"] } },
    },

    disarm_alarm: {
      action: "approve",
      effect: "Disarms the burglar alarm. No one will be notified if the house is entered.",
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
      effect: "Lets EcoSaver change your thermostat setpoint.",
    },
  },

  approval: { timeoutMs: 60_000 },
};
