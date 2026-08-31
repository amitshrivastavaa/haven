import { grenz } from "grenz-webmcp";
import { policy } from "./policy";

/**
 * Module scope, not a hook: there is exactly one policy per page, and it must
 * exist before any component renders. `grenz()` attaches the pipeline to the
 * registration surface that `/grenz-install.js` already claimed in <head>.
 */
export const g = grenz(policy);
