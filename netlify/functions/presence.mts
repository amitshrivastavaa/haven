/**
 * Server-side verification of an approval.
 *
 * The in-page checks stop everything that lives in the page: `isTrusted` means
 * no script can forge the click, and the WebAuthn ceremony means no script can
 * satisfy the prompt. But a page cannot verify its own proof — a verifier
 * living in the same realm as the attacker decides whatever the attacker wants
 * it to decide. So the assertion is checked here, where the page cannot reach.
 *
 * What this endpoint actually establishes:
 *
 *   · the challenge was issued by this server, has not expired, and was not
 *     chosen by whoever is presenting it (replay and pre-computation are out)
 *   · the signature verifies against the public key registered for that
 *     credential (only the authenticator holding the private key could produce
 *     it, and that key never leaves the secure element)
 *   · the authenticator set both the user-present and user-verified flags (a
 *     human touched it and the platform checked who they were)
 *   · the origin and RP id in the signed client data are this site (an
 *     assertion harvested by another origin does not transfer)
 *
 * What it does NOT establish, said plainly because the gap matters: which
 * human. A real deployment anchors enrolment to a logged-in account. A demo
 * has no accounts, so it anchors to the next best thing it can actually
 * verify: a first-party id in an HttpOnly cookie, one enrolment per browser,
 * trust-on-first-use within it. That is a stand-in for an account, not an
 * account — it says "the same browser that enrolled is asking", never "this
 * is Amit". Everything above it is real.
 *
 * It has to be per browser rather than per site, and not only for honesty: a
 * single shared credential means the first visitor to enrol is the only one
 * who can ever approve, and every visitor after them is refused at their own
 * front door.
 *
 * Web Crypto does ES256 and HMAC. The only hand-parsing left is the DER
 * signature, because WebAuthn signs DER and Web Crypto verifies raw r‖s.
 */

import { getStore } from "@netlify/blobs";

const CHALLENGE_TTL_MS = 120_000;
/** Netlify sets this per site; the fallback only ever runs on a local build. */
const SECRET = process.env.PRESENCE_SECRET ?? "grenz-demo-secret-not-for-production";

// --------------------------------------------------------------------- utils

const enc = new TextEncoder();

function b64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = "";
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unb64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

async function hmacKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", enc.encode(SECRET), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
    "verify",
  ]);
}

/**
 * A challenge that carries its own expiry and signature.
 *
 * Stateless on purpose: a challenge store would be one more thing to be
 * unavailable at the moment someone is standing at their own front door.
 */
async function mintChallenge(): Promise<{ challenge: string; token: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(32));
  const challenge = b64url(nonce);
  const expires = Date.now() + CHALLENGE_TTL_MS;
  const body = `${challenge}.${expires}`;
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(), enc.encode(body));
  return { challenge, token: `${body}.${b64url(sig)}` };
}

async function openChallenge(token: string): Promise<string | null> {
  // Every failure here is the same answer — no. Anything malformed enough to
  // throw is refused like anything else: an unhandled parse on the path to a
  // verification decision is the last place to let a surprise through, and a
  // 500 tells an attacker more than a 400 does.
  try {
    const [challenge, expires, sig] = token.split(".");
    if (!challenge || !expires || !sig) return null;
    if (!Number.isFinite(Number(expires))) return null;
    const ok = await crypto.subtle.verify(
      "HMAC",
      await hmacKey(),
      unb64url(sig),
      enc.encode(`${challenge}.${expires}`),
    );
    if (!ok) return null;
    if (Number(expires) < Date.now()) return null;
    return challenge;
  } catch {
    return null;
  }
}

/** WebAuthn signs DER; Web Crypto verifies raw r‖s. */
function derToRaw(der: Uint8Array): Uint8Array {
  let i = 2;
  if (der[1]! & 0x80) i += der[1]! & 0x7f;
  const readInt = (): Uint8Array => {
    i++; // 0x02
    const len = der[i++]!;
    let value = der.slice(i, i + len);
    i += len;
    while (value.length > 32 && value[0] === 0) value = value.slice(1);
    const padded = new Uint8Array(32);
    padded.set(value, 32 - value.length);
    return padded;
  };
  const r = readInt();
  const s = readInt();
  const out = new Uint8Array(64);
  out.set(r, 0);
  out.set(s, 32);
  return out;
}

// ------------------------------------------------------------------ handler

/** Same-origin fetch sends cookies by default, so nothing on the page has to. */
function readCookie(request: Request, name: string): string | null {
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return null;
}

interface Registration {
  credentialId: string;
  /** SPKI public key from getPublicKey(), base64url. */
  publicKey: string;
  at: number;
}

const COOKIE = "grenz_hid";
/** Whatever the cookie holds is a store key, so it is validated as one. */
const HID = /^[A-Za-z0-9_-]{16,64}$/;

export default async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const origin = request.headers.get("origin") ?? url.origin;
  const cors = {
    "access-control-allow-origin": origin,
    "access-control-allow-headers": "content-type",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "cache-control": "no-store",
    "content-type": "application/json",
  };
  if (request.method === "OPTIONS") return new Response(null, { headers: cors });

  // One enrolment per browser. HttpOnly so page script cannot read or forge the
  // id — the same reasoning as capturing the WebAuthn calls before third-party
  // script runs. A browser that refuses the cookie simply enrols each time,
  // which is a real ceremony every time rather than a lockout.
  let hid = readCookie(request, COOKIE);
  const issuing = !hid || !HID.test(hid);
  if (issuing) hid = b64url(crypto.getRandomValues(new Uint8Array(16)));
  const headers: Record<string, string> = issuing
    ? {
        ...cors,
        "set-cookie": `${COOKIE}=${hid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${
          url.protocol === "https:" ? "; Secure" : ""
        }`,
      }
    : cors;

  const store = getStore("grenz-presence");
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers });

  try {
    if (request.method === "GET") {
      const enrolled = (await store.get(hid!, { type: "json" })) as Registration | null;
      // The credential id goes back with it: it is not a secret (every
      // assertion request carries it), and returning it makes the server the
      // source of truth. A browser that lost its localStorage can still
      // assert instead of trying to enrol a second key and being refused.
      return json({
        ...(await mintChallenge()),
        enrolled: Boolean(enrolled),
        credentialId: enrolled?.credentialId,
      });
    }

    const body = (await request.json()) as Record<string, string>;
    const challenge = await openChallenge(body.token ?? "");
    if (!challenge) return json({ verified: false, why: "challenge_invalid" }, 400);

    // --- enrolment ---------------------------------------------------------
    // First credential wins, within this browser. A second one is refused
    // rather than silently replacing the first, which is what would let an
    // attacker swap in a key it holds. In production this is an account check,
    // not a first-come rule.
    if (body.op === "enrol") {
      const existing = (await store.get(hid!, { type: "json" })) as Registration | null;
      if (existing && existing.credentialId !== body.credentialId)
        return json({ verified: false, why: "already_enrolled" }, 409);
      const record: Registration = {
        credentialId: body.credentialId!,
        publicKey: body.publicKey!,
        at: Date.now(),
      };
      await store.setJSON(hid!, record);
      return json({ verified: true, enrolled: true });
    }

    // --- assertion ---------------------------------------------------------
    const record = (await store.get(hid!, { type: "json" })) as Registration | null;
    if (!record) return json({ verified: false, why: "not_enrolled" }, 400);
    if (record.credentialId !== body.credentialId)
      return json({ verified: false, why: "unknown_credential" }, 403);

    const clientDataBytes = unb64url(body.clientDataJSON!);
    const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes)) as {
      type: string;
      challenge: string;
      origin: string;
    };
    if (clientData.type !== "webauthn.get")
      return json({ verified: false, why: "wrong_ceremony" }, 400);
    // The challenge the authenticator signed must be the one we issued.
    if (clientData.challenge !== challenge)
      return json({ verified: false, why: "challenge_mismatch" }, 400);
    // An assertion collected by another site does not transfer to this one.
    if (new URL(clientData.origin).host !== new URL(origin).host)
      return json({ verified: false, why: "origin_mismatch" }, 403);

    const authData = unb64url(body.authenticatorData!);
    const rpIdHash = authData.slice(0, 32);
    const expectedRpId = new Uint8Array(
      await crypto.subtle.digest("SHA-256", enc.encode(new URL(origin).hostname)),
    );
    if (b64url(rpIdHash) !== b64url(expectedRpId))
      return json({ verified: false, why: "rp_mismatch" }, 403);

    const flags = authData[32]!;
    if (!(flags & 0x01)) return json({ verified: false, why: "no_user_present" }, 403);
    // The whole reason this endpoint exists: a person was checked, not just
    // present. Without UV, a passkey is a possession factor and nothing more.
    if (!(flags & 0x04)) return json({ verified: false, why: "no_user_verified" }, 403);

    const key = await crypto.subtle.importKey(
      // The client sends SPKI from getPublicKey(), which imports as-is. Reading
      // the attestation object's COSE key instead would mean a CBOR parser here
      // for no gain.
      "spki",
      unb64url(record.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", clientDataBytes));
    const signed = new Uint8Array(authData.length + clientHash.length);
    signed.set(authData, 0);
    signed.set(clientHash, authData.length);

    const verified = await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      key,
      derToRaw(unb64url(body.signature!)),
      signed,
    );
    if (!verified) return json({ verified: false, why: "bad_signature" }, 403);

    return json({ verified: true, at: Date.now(), credentialId: record.credentialId });
  } catch (error) {
    return json({ verified: false, why: (error as Error).message }, 500);
  }
}

export const config = { path: "/api/presence" };
