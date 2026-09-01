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
 * What this is NOT: client-side verification of the assertion. The signature is
 * checked by a server in any real deployment, and a verifier living in the same
 * realm as the attacker proves nothing. The gate here is the ceremony — page
 * script cannot make `navigator.credentials.get()` resolve — not the maths
 * afterwards. Saying otherwise would be the kind of claim this library exists
 * to argue against.
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

export type PresenceResult =
  /** A platform authenticator answered. */
  | { readonly ok: true; readonly credentialId: string }
  /** The device has no authenticator to ask. */
  | { readonly ok: false; readonly reason: "unavailable" }
  /** There was one, and the person did not satisfy it. */
  | { readonly ok: false; readonly reason: "refused"; readonly message: string };

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
  if (!nativeGet || !nativeCreate) return false;
  try {
    const check = (
      globalThis.PublicKeyCredential as unknown as {
        isUserVerifyingPlatformAuthenticatorAvailable?: () => Promise<boolean>;
      }
    )?.isUserVerifyingPlatformAuthenticatorAvailable;
    return check ? await check.call(globalThis.PublicKeyCredential) : false;
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
export async function provePresence(userLabel: string): Promise<PresenceResult> {
  if (!nativeGet || !nativeCreate) return { ok: false, reason: "unavailable" };
  if (!(await presenceAvailable())) return { ok: false, reason: "unavailable" };
  return Promise.race([ceremony(userLabel), deadline()]);
}

/** A prompt nobody can answer is, from where the user stands, no prompt. */
function deadline(): Promise<PresenceResult> {
  return new Promise((resolve) =>
    setTimeout(() => resolve({ ok: false, reason: "unavailable" }), CEREMONY_MS),
  );
}

async function ceremony(userLabel: string): Promise<PresenceResult> {
  const existing = remembered();
  try {
    if (!existing) {
      const created = (await nativeCreate({
        publicKey: {
          challenge: randomChallenge(),
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
      remember(id);
      return { ok: true, credentialId: id };
    }

    const assertion = (await nativeGet({
      publicKey: {
        challenge: randomChallenge(),
        allowCredentials: [{ type: "public-key", id: fromBase64Url(existing) }],
        // The whole point: a gesture is not enough, the person must verify.
        userVerification: "required",
        timeout: CEREMONY_MS,
      },
    })) as PublicKeyCredential | null;
    if (!assertion) return { ok: false, reason: "refused", message: "No assertion was returned." };
    return { ok: true, credentialId: toBase64Url(assertion.rawId) };
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
