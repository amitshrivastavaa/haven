/**
 * A real agent driving Haven through the browser's own WebMCP surface.
 *
 * It knows nothing about Haven or Grenz. It asks the page what tools exist with
 * `document.modelContext.getTools()`, hands those schemas to a model as its
 * tool list, and invokes whatever the model chooses through
 * `document.modelContext.executeTool()`. Grenz answers a refused call with
 * `{grenz:{decision:"deny",…}}` instead of throwing, so a denial arrives as an
 * ordinary tool result the model can read and work around — which is the
 * behaviour this harness exists to demonstrate.
 *
 * Usage — see README.md in this directory:
 *   AGENT_BASE=http://localhost:11434/v1 AGENT_MODEL=gpt-oss:20b bun tools/agent/agent.ts
 */

const CDP = process.env.CDP_URL ?? "http://localhost:9222";
const BASE = process.env.AGENT_BASE ?? "https://api.openai.com/v1";
const MODEL = process.env.AGENT_MODEL ?? "gpt-5";
/** deny | approve | none — how the human answers an approval card. */
const AUTO = process.env.AUTO_ANSWER ?? "deny";
const GOAL = process.argv[2] ??
  "Catch me up on the front door, and take care of anything that needs doing.";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- the browser ---------------------------------------------------------
const targets = await (await fetch(`${CDP}/json`)).json();
const page = targets.find((t: any) => t.type === "page" && t.url.includes("http"));
if (!page) throw new Error("no page target — is Chrome running with --remote-debugging-port?");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let id = 0;
const pending = new Map<number, (v: any) => void>();
ws.onmessage = (m) => {
  const msg = JSON.parse(m.data as string);
  if (msg.id && pending.has(msg.id)) pending.get(msg.id)!(msg.result);
};
const send = (method: string, params: any = {}) =>
  new Promise<any>((res) => { const n = ++id; pending.set(n, res); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluate = async (expression: string) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true })).result?.value;

// A call is fired rather than awaited: a tool that raises an approval card does
// not settle until a human answers it, which can be a minute away.
await evaluate(`(() => {
  window.__call = (name, argsJson) => {
    window.__res = undefined;
    (async () => {
      const mc = document.modelContext;
      const t = (await mc.getTools()).find(x => x.name === name);
      if (!t) { window.__res = { err: 'no such tool: ' + name }; return; }
      try { window.__res = { ok: await mc.executeTool(t, argsJson) }; }
      catch (e) { window.__res = { err: String(e) }; }
    })();
    return true;
  };
  return true; })()`);

const discovered = await evaluate(`document.modelContext.getTools().then(ts =>
  ts.map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })))`);
if (!discovered?.length) throw new Error("getTools() returned nothing — is WebMCP enabled on this page?");
console.log(`getTools() → ${discovered.length} tools: ${discovered.map((t: any) => t.name).join(", ")}\n`);

// Native getTools() returns inputSchema as a JSON *string*, the same string
// contract executeTool uses for arguments. The model wants an object.
const schemaOf = (s: unknown) =>
  typeof s === "string" ? (() => { try { return JSON.parse(s); } catch { return null; } })() : s ?? null;

const tools = discovered.map((t: any) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: schemaOf(t.inputSchema) ?? { type: "object", properties: {} },
  },
}));

/** Answer an approval card the way a person does: with a trusted click. */
async function answerCard(): Promise<string | null> {
  const label = AUTO === "approve" ? "Approve" : "Deny";
  for (let i = 0; i < 60; i++) {
    const b = await evaluate(`(() => {
      const hit = []; const walk = (r) => { for (const n of r.querySelectorAll('*')) if (n.shadowRoot) {
        for (const x of n.shadowRoot.querySelectorAll('button'))
          if ((x.textContent||'').includes(${JSON.stringify(label)})) hit.push(x);
        walk(n.shadowRoot); } };
      walk(document);
      const e = hit[0]; if (!e) return null;
      const r = e.getBoundingClientRect();
      return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`);
    if (b) {
      if (AUTO === "none") return "a card is up — waiting for a human";
      for (const type of ["mousePressed", "mouseReleased"])
        await send("Input.dispatchMouseEvent", { type, x: b.x, y: b.y, button: "left", clickCount: 1 });
      return `a human pressed ${label}`;
    }
    if (await evaluate(`window.__res !== undefined`)) return null;
    await sleep(200);
  }
  return null;
}

async function callTool(name: string, args: unknown): Promise<string> {
  await evaluate(`window.__call(${JSON.stringify(name)}, ${JSON.stringify(JSON.stringify(args))})`);
  const answered = await answerCard();
  if (answered) console.log(`      · ${answered}`);
  for (let i = 0; i < 300; i++) {
    const r = await evaluate(`window.__res === undefined ? null : JSON.stringify(window.__res)`);
    if (r) { const v = JSON.parse(r); return v.err ?? v.ok ?? "null"; }
    await sleep(200);
  }
  return JSON.stringify({ error: "timed out waiting for the tool" });
}

// --- the loop ------------------------------------------------------------
const messages: any[] = [
  { role: "system", content: "You are a home assistant with access to this house's tools. Use them to help. Be brief." },
  { role: "user", content: GOAL },
];
console.log(`user → ${GOAL}\n`);

for (let turn = 0; turn < 8; turn++) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.OPENAI_API_KEY ?? "local"}`,
    },
    body: JSON.stringify({ model: MODEL, messages, tools, tool_choice: "auto" }),
  });
  const body = (await res.json()) as any;
  if (body.error) { console.error("model error:", body.error.message); break; }
  const msg = body.choices[0].message;
  messages.push(msg);

  if (!msg.tool_calls?.length) { console.log(`\nassistant → ${msg.content}`); break; }
  for (const tc of msg.tool_calls) {
    const args = JSON.parse(tc.function.arguments || "{}");
    console.log(`  agent → executeTool("${tc.function.name}", ${JSON.stringify(args)})`);
    const result = await callTool(tc.function.name, args);
    console.log(`      ← ${String(result).replace(/\s+/g, " ").slice(0, 190)}`);
    messages.push({ role: "tool", tool_call_id: tc.id, content: String(result) });
  }
}
ws.close();
