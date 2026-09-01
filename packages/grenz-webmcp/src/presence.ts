/**
 * Proof that a person is present.
 *
 * `isTrusted` gets us most of the way: nothing running in the page can forge an
 * event the browser stamped as real input, so a partner widget or an injected
 * tool cannot click Approve. What it cannot do is tell a person from an agent
 * driving the actual mouse — that event is genuinely trusted.
 *
 * So for the calls where that distinction matters, the site can ask for
 * something the page does not draw. A WebAuthn ceremony is rendered by the
 * platform, not the DOM: there is no element to click and no coordinate to hit,
 * and satisfying it takes a fingerprint, a face or a security key. An agent
 * with the mouse has none of those.
 *
 * The assertion itself is not checked here, and could not usefully be: a
 * verifier living in the same realm as the attacker decides whatever the
 * attacker wants it to decide, and a challenge the page chose for itself is no
 * challenge at all. So the site supplies a `Verifier` — a challenge it fetched
 * from its own server, and a check it performs there — and an assertion nobody
 * verified is reported as exactly that rather than counted as proof.
 *
 * Without a verifier the ceremony is still worth running: page script cannot
 * make `navigator.credentials.get()` resolve, so it still stops everything
 * sharing this realm. It just cannot stop a replay, and the trail says so.
 */

/**
 * Captured at load, before any third-party script on the page has run.
 *
 * The same reasoning as the registerTool takeover: an attacker that can replace
 * `navigator.credentials.get` with a function that resolves can satisfy the
 * ceremony without a human. Taking the reference early means a later
 * replacement is not the one we call.
 */
const nativeGet = globalThis.navigator?.credentials?.get?.bind(navigator.credentials);
const nativeCreate = globalThis.navigator?.credentials?.create?.bind(navigator.credentials);
/**
 * Captured for the same reason, and easy to miss: this one is not how the
 * ceremony is satisfied, it is how the ceremony is *skipped*. A `preferred`
 * policy falls back to a plain click when no authenticator is available, so a
 * script that can make this answer `false` has switched the passkey off — and
 * the fallback then reports "unavailable", which reads like a tired laptop
 * rather than an attack. Reading it live let page script disarm the strongest
 * check on the site without ever touching the check itself.
 */
const nativeAvailable = (
  globalThis.PublicKeyCredential as unknown as {
    isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
  }
)?.isUserVerifyingPlatformAuthenticatorAvailable?.bind(globalThis.PublicKeyCredential);

const STORE = "grenz.presence.credential";
const RP_NAME = "Grenz";

/**
 * Deliberately shorter than any sane approval timeout.
 *
 * A stored credential whose authenticator has gone — a cleared profile, a
 * revoked passkey, a different machine — makes the platform sit on the prompt
 * until it gives up. If that matches the approval window, the ceremony eats
 * the whole thing and the call dies of "you did not respond" when the truth is
 * that it never had anything to respond to. Failing early leaves the card time
 * to say what happened and, on a "preferred" policy, to fall back.
 *
 * Enforced here rather than by the `timeout` option, because that option is
 * advisory and measurably ignored: on a browser with no authenticator,
 * `isUserVerifyingPlatformAuthenticatorAvailable()` answers TRUE and then
 * `create()` never settles at all. A capability probe that lies is exactly the
 * situation to hold a deadline of our own for.
 */
const CEREMONY_MS = 20_000;

export type PresenceMode = "required" | "preferred";

/**
 * The site's server, as far as this file is concerned.
 *
 * `challenge` must come from somewhere the page does not control, or the whole
 * ceremony reduces to a signature over a number the attacker picked.
 */
export interface Verifier {
  /** A server-issued challenge, plus whatever the server needs to recognise it. */
  challenge(): Promise<{
    challenge: string;
    token: string;
    enrolled?: boolean;
    /** What this browser enrolled, if anything. Not a secret. */
    credentialId?: string;
  }>;
  /** Hand a new credential to the server. */
  enrol(proof: { token: string; credentialId: string; publicKey: string }): Promise<boolean>;
  /** True only when the server verified the signature against a known key. */
  verify(proof: {
    token: string;
    credentialId: string;
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
  }): Promise<boolean>;
}

export type PresenceResult =
  /** A platform authenticator answered. `verified` says whether anyone checked. */
  | { readonly ok: true; readonly credentialId: string; readonly verified: boolean }
  /** The device has no authenticator to ask. */
  | { readonly ok: false; readonly reason: "unavailable" }
  /** There was one, and the person did not satisfy it. */
  | { readonly ok: false; readonly reason: "refused"; readonly message: string }
  /** The server looked at the assertion and said no. */
  | { readonly ok: false; readonly reason: "rejected"; readonly message: string };

/** ArrayBuffer, not Uint8Array: BufferSource will not take a possibly-shared one. */
function randomChallenge(): ArrayBuffer {
  const bytes = new Uint8Array(new ArrayBuffer(32));
  crypto.getRandomValues(bytes);
  return bytes.buffer;
}

function toBase64Url(buffer: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): ArrayBuffer {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

function remembered(): string | null {
  try {
    return localStorage.getItem(STORE);
  } catch {
    // Private mode, or storage denied. Enrolment simply happens again.
    return null;
  }
}

function remember(id: string): void {
  try {
    localStorage.setItem(STORE, id);
  } catch {
    /* not being able to remember is not a reason to fail the ceremony */
  }
}

/** Whether asking is even possible here, so a card can say so before it asks. */
export async function presenceAvailable(): Promise<boolean> {
  if (!nativeGet || !nativeCreate || !nativeAvailable) return false;
  try {
    return await nativeAvailable();
  } catch {
    return false;
  }
}

/**
 * Enrol once, then assert on every later call.
 *
 * Enrolment is itself a user-verifying ceremony, so the first approval is as
 * well proven as the ones after it — there is no weaker first step to aim at.
 */
export async function provePresence(
  userLabel: string,
  verifier?: Verifier,
): Promise<PresenceResult> {
  if (!nativeGet || !nativeCreate) return { ok: false, reason: "unavailable" };
  if (!(await presenceAvailable())) return { ok: false, reason: "unavailable" };
  return Promise.race([ceremony(userLabel, verifier), deadline()]);
}

/** A prompt nobody can answer is, from where the user stands, no prompt. */
function deadline(): Promise<PresenceResult> {
  return new Promise((resolve) =>
    setTimeout(() => resolve({ ok: false, reason: "unavailable" }), CEREMONY_MS),
  );
}

async function ceremony(userLabel: string, verifier?: Verifier): Promise<PresenceResult> {
  let existing = remembered();

  // The challenge has to come from somewhere the page does not control. With
  // no verifier there is nowhere, so a local random one is used and the result
  // is reported as unverified rather than dressed up as proof.
  let issued: Awaited<ReturnType<Verifier["challenge"]>> | null = null;
  if (verifier) {
    try {
      issued = await verifier.challenge();
    } catch {
      // The site said it had a server and the server is not there. That is a
      // weaker check than promised, so it is never quietly treated as one.
      return { ok: false, reason: "rejected", message: "The site could not reach its own server." };
    }
    // The server is the source of truth for what is enrolled here; local
    // storage is only a cache of it. A credential the server has never seen
    // cannot be asserted against anything, and an enrolment the browser has
    // forgotten can still be asserted with — without this, clearing site data
    // would put someone at a front door that refuses them, because a second
    // key is refused rather than allowed to replace the first.
    if (issued.enrolled === false) existing = null;
    else existing ??= issued.credentialId ?? null;
  }
  const challengeBytes = issued ? fromBase64Url(issued.challenge) : randomChallenge();

  try {
    if (!existing) {
      const created = (await nativeCreate({
        publicKey: {
          challenge: challengeBytes,
          rp: { name: RP_NAME },
          user: { id: randomChallenge(), name: userLabel, displayName: userLabel },
          // ES256 then RS256: the two every platform authenticator supports.
          pubKeyCredParams: [
            { type: "public-key", alg: -7 },
            { type: "public-key", alg: -257 },
          ],
          authenticatorSelection: {
            authenticatorAttachment: "platform",
            userVerification: "required",
            residentKey: "preferred",
          },
          timeout: CEREMONY_MS,
        },
      })) as PublicKeyCredential | null;
      if (!created) return { ok: false, reason: "refused", message: "No credential was created." };
      const id = toBase64Url(created.rawId);
      const response = created.response as AuthenticatorAttestationResponse;
      if (verifier && issued) {
        // SPKI rather than the attestation object's COSE key: Web Crypto
        // imports SPKI directly, so the server needs no CBOR parser to read it.
        const spki = (
          response as unknown as { getPublicKey?: () => ArrayBuffer | null }
        ).getPublicKey?.();
        if (!spki)
          return { ok: false, reason: "refused", message: "This browser did not expose the key." };
        const accepted = await verifier.enrol({
          token: issued.token,
          credentialId: id,
          publicKey: toBase64Url(spki),
        });
        if (!accepted)
          return { ok: false, reason: "rejected", message: "The server would not enrol this key." };
      }
      remember(id);
      return { ok: true, credentialId: id, verified: Boolean(verifier) };
    }

    const assertion = (await nativeGet({
      publicKey: {
        challenge: challengeBytes,
        allowCredentials: [{ type: "public-key", id: fromBase64Url(existing) }],
        // The whole point: a gesture is not enough, the person must verify.
        userVerification: "required",
        timeout: CEREMONY_MS,
      },
    })) as PublicKeyCredential | null;
    if (!assertion) return { ok: false, reason: "refused", message: "No assertion was returned." };
    const id = toBase64Url(assertion.rawId);
    if (!verifier || !issued) return { ok: true, credentialId: id, verified: false };

    const response = assertion.response as AuthenticatorAssertionResponse;
    const accepted = await verifier.verify({
      token: issued.token,
      credentialId: id,
      clientDataJSON: toBase64Url(response.clientDataJSON),
      authenticatorData: toBase64Url(response.authenticatorData),
      signature: toBase64Url(response.signature),
    });
    // The server is the authority. A signature it would not accept is not a
    // weaker approval, it is no approval.
    if (!accepted)
      return { ok: false, reason: "rejected", message: "The server did not accept the signature." };
    return { ok: true, credentialId: id, verified: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // A credential the platform has forgotten (cleared storage, new profile)
    // should re-enrol rather than lock the user out of their own house.
    if (existing && /not allowed|NotAllowedError|InvalidState/i.test(message)) {
      try {
        localStorage.removeItem(STORE);
      } catch {
        /* nothing to do */
      }
    }
    return { ok: false, reason: "refused", message };
  }
}
