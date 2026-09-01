import type { Verifier } from "grenz-webmcp";

/**
 * Haven's server, for the one job a page cannot do for itself.
 *
 * The in-page checks are real but they all run in the attacker's reach: a
 * challenge the page picked is a number the attacker picked, and a signature
 * the page verifies is a verdict the attacker can rewrite. So the challenge
 * comes from `/api/presence` and the assertion goes back to it, and the tool
 * runs only if that endpoint says the signature checks out.
 *
 * Deliberately absent when the endpoint is not there. Running the demo locally
 * with `bun dev` has no functions, and a smart home that refuses to open its
 * own front door because a deploy is missing is worse than one that is honest
 * about which check it managed to make. So a missing endpoint means no
 * verifier at all, the ceremony still runs, and the audit trail says the
 * signature went unchecked — never nothing.
 */

const ENDPOINT = "/api/presence";

async function ask(init?: RequestInit): Promise<Response> {
  const response = await fetch(ENDPOINT, init);
  // A static host answers 404 with an HTML page, which JSON.parse would then
  // fail on somewhere less obvious than here.
  if (!response.ok && response.status === 404) throw new Error("no verifier deployed");
  return response;
}

export const verifier: Verifier = {
  async challenge() {
    const response = await ask();
    if (!response.ok) throw new Error(`challenge failed: ${response.status}`);
    return (await response.json()) as { challenge: string; token: string; enrolled?: boolean };
  },

  async enrol(proof) {
    const response = await ask({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "enrol", ...proof }),
    });
    return response.ok && ((await response.json()) as { verified?: boolean }).verified === true;
  },

  async verify(proof) {
    const response = await ask({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ op: "verify", ...proof }),
    });
    // Anything other than an explicit yes is a no. A verifier that fails open
    // is not a verifier.
    if (!response.ok) return false;
    return ((await response.json()) as { verified?: boolean }).verified === true;
  },
};

/**
 * Whether this deployment has a server to check proofs with.
 *
 * Asked once at startup rather than at the moment of an approval: finding out
 * mid-ceremony would mean a fingerprint prompt that turns out to have been
 * pointless, and the person deserves to know which check they are making
 * before they make it.
 */
export async function verifierAvailable(): Promise<boolean> {
  try {
    const response = await fetch(ENDPOINT, { method: "GET" });
    if (!response.ok) return false;
    const body = (await response.json()) as { token?: string };
    return typeof body.token === "string";
  } catch {
    return false;
  }
}
