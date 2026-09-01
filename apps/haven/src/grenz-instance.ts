import { grenz, type Verifier } from "grenz-webmcp";
import { policy } from "./policy";
import { verifier, verifierAvailable } from "./verifier";

/**
 * Module scope, not a hook: there is exactly one policy per page, and it must
 * exist before any component renders. `grenz()` attaches the pipeline to the
 * registration surface that `/grenz-install.js` already claimed in <head>.
 */
export const g = grenz(policy);

/**
 * Attach the server-side verifier only if this deployment has one.
 *
 * Asked once, at startup, rather than at the moment someone is holding a
 * fingerprint prompt. Running locally with `bun dev` has no functions, and a
 * verifier that is not there must mean "we could not check this" in the audit
 * trail — never a denial of the resident's own front door, and never a silent
 * pretence that the check happened. `config.presence` is read live on every
 * approval, so attaching it after construction takes effect immediately.
 */
void verifierAvailable().then((present) => {
  if (present) (policy as { presence?: Verifier }).presence = verifier;
});
