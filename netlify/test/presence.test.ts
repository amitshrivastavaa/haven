// The bug this covers only ever appeared on a deployed site: with one shared
// store key, the first visitor to enrol was the only one who could ever
// approve, and everyone after them was refused at the front door. Local dev
// has no functions, so nothing here was exercised until it was live.
import { expect, mock, test } from "bun:test";

const blobs = new Map<string, string>();
mock.module("@netlify/blobs", () => ({
  getStore: () => ({
    get: async (k: string) => (blobs.has(k) ? JSON.parse(blobs.get(k)!) : null),
    setJSON: async (k: string, v: unknown) => void blobs.set(k, JSON.stringify(v)),
  }),
}));

// One directory up on purpose: Netlify treats every top-level file in the
// functions directory as a function to bundle and deploy, so a test living
// beside the handler ships as an endpoint of its own.
const { default: handler } = await import(
  "../functions/presence.mts"
);

const URL_ = "https://haven.example/api/presence";
const get = (cookie?: string) =>
  handler(new Request(URL_, { headers: cookie ? { cookie } : {} }));
const post = (cookie: string, body: unknown) =>
  handler(new Request(URL_, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify(body),
  }));

const cookieOf = (r: Response) => r.headers.get("set-cookie")!.split(";")[0]!;

test("each browser gets its own enrolment, so a second visitor is not locked out", async () => {
  // --- visitor A, first ever ---
  const a1 = await get();
  const aCookie = cookieOf(a1);
  const aBody = await a1.json();
  expect(aBody.enrolled).toBe(false);
  expect(a1.headers.get("set-cookie")).toContain("HttpOnly");
  expect(a1.headers.get("set-cookie")).toContain("Secure");

  const aEnrol = await post(aCookie, {
    op: "enrol", token: aBody.token, credentialId: "cred-A", publicKey: "spki-A",
  });
  expect(aEnrol.status).toBe(200);
  expect((await aEnrol.json()).verified).toBe(true);

  // --- visitor B, arriving after A has enrolled. The old code refused here. ---
  const b1 = await get();
  const bCookie = cookieOf(b1);
  const bBody = await b1.json();
  expect(bCookie).not.toBe(aCookie);
  expect(bBody.enrolled).toBe(false);

  const bEnrol = await post(bCookie, {
    op: "enrol", token: bBody.token, credentialId: "cred-B", publicKey: "spki-B",
  });
  expect(bEnrol.status).toBe(200);
  expect((await bEnrol.json()).verified).toBe(true);
});

test("a returning browser is told what it enrolled, so a cleared cache is not a lockout", async () => {
  const first = await get();
  const cookie = cookieOf(first);
  const body = await first.json();
  await post(cookie, { op: "enrol", token: body.token, credentialId: "cred-C", publicKey: "spki-C" });

  const again = await get(cookie);
  const back = await again.json();
  expect(back.enrolled).toBe(true);
  expect(back.credentialId).toBe("cred-C");
  // Same browser, so no new id is minted.
  expect(again.headers.get("set-cookie")).toBeNull();
});

test("within one browser the first credential still wins", async () => {
  const first = await get();
  const cookie = cookieOf(first);
  const body = await first.json();
  await post(cookie, { op: "enrol", token: body.token, credentialId: "cred-D", publicKey: "spki-D" });

  const fresh = await (await get(cookie)).json();
  const swap = await post(cookie, {
    op: "enrol", token: fresh.token, credentialId: "attacker-key", publicKey: "spki-X",
  });
  expect(swap.status).toBe(409);
  expect((await swap.json()).why).toBe("already_enrolled");
});

test("a forged cookie is just a different browser, never a way into someone else's record", async () => {
  const first = await get();
  const cookie = cookieOf(first);
  const body = await first.json();
  await post(cookie, { op: "enrol", token: body.token, credentialId: "cred-E", publicKey: "spki-E" });

  // Junk that fails the store-key shape: a new id is issued rather than used.
  const junk = await get("grenz_hid=../../haven");
  expect(junk.headers.get("set-cookie")).not.toBeNull();
  expect((await junk.json()).enrolled).toBe(false);
});
