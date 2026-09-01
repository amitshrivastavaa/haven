/**
 * The two pieces of UI the library owns: the approval card and the audit
 * timeline. Both render into a shadow root so a host app's CSS can neither
 * restyle nor accidentally hide them.
 *
 * Everything user-visible here is set with `textContent`, never `innerHTML`.
 * Tool names, titles and descriptions can come from a third-party script — a
 * security surface that renders attacker-controlled strings as markup would be
 * worse than no security surface at all.
 */

import type { ApprovalOutcome, ApprovalRequest, GrenzInstance } from "./grenz.ts";
import { provePresence } from "./presence.ts";
import type { ReasonCode, TimelineEvent } from "./types.ts";

const PALETTE = `
  :host {
    --g-bg: #ffffff;
    --g-surface: #f7f7f8;
    --g-text: #18181b;
    --g-dim: #71717a;
    --g-line: #e4e4e7;
    --g-allow: #15803d;
    --g-allow-bg: #dcfce7;
    --g-deny: #b91c1c;
    --g-deny-bg: #fee2e2;
    --g-approve: #b45309;
    --g-approve-bg: #fef3c7;
    --g-open: #2563eb;
    --g-open-bg: #eff4ff;
    --g-font: ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    --g-mono: ui-monospace, SFMono-Regular, "SF Mono", Menlo, monospace;
  }
  @media (prefers-color-scheme: dark) {
    :host {
      --g-bg: #18181b;
      --g-surface: #232327;
      --g-text: #fafafa;
      --g-dim: #a1a1aa;
      --g-line: #34343a;
      --g-allow: #4ade80;
      --g-allow-bg: #14351f;
      --g-deny: #f87171;
      --g-deny-bg: #3d1a1a;
      --g-approve: #fbbf24;
      --g-approve-bg: #3a2c0d;
      --g-open: #7da6ff;
      --g-open-bg: #14203a;
    }
  }
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function shadowHost(zIndex: number): { host: HTMLDivElement; root: ShadowRoot } {
  const host = document.createElement("div");
  host.style.cssText = `position:fixed;inset:0;z-index:${zIndex};pointer-events:none;`;
  const root = host.attachShadow({ mode: "open" });
  return { host, root };
}

function prettyArgs(input: unknown): string {
  if (input === undefined) return "(no arguments)";
  try {
    return JSON.stringify(input, null, 2) ?? String(input);
  } catch {
    return "[unserializable arguments]";
  }
}

/**
 * The arguments, as rows rather than a JSON blob.
 *
 * Showing the literal request is the point of this section: the line above it
 * is what the SITE says the tool does, and this is what the agent actually
 * asked for. A summary here would be the hole the card exists to close, so
 * every key and every value survives verbatim — only the braces and quotes go.
 * The person deciding whether to unlock their own front door is not reading
 * JSON.
 *
 * Values are composed by the agent, so they are inserted as text and never as
 * markup. Nested shapes stay JSON: flattening them would drop structure the
 * reader may need in order to judge the request.
 */
function argsNode(input: unknown): HTMLElement {
  if (input === undefined || input === null) return el("p", "args-none", "No arguments.");

  // Anything that is not a bag of named arguments has no rows to make, so it
  // falls back rather than being guessed at.
  if (typeof input !== "object" || Array.isArray(input))
    return el("pre", "args-raw", prettyArgs(input));

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length === 0) return el("p", "args-none", "No arguments.");

  const list = el("dl", "args");
  for (const [key, value] of entries) {
    list.append(
      el("dt", undefined, key),
      el("dd", undefined, value !== null && typeof value === "object"
        ? prettyArgs(value)
        : String(value)),
    );
  }
  return list;
}

// ---------------------------------------------------------------------------
// Approval card
// ---------------------------------------------------------------------------

const CARD_CSS = `
  ${PALETTE}
  .backdrop {
    position: fixed; inset: 0; pointer-events: auto;
    background: color-mix(in srgb, #09090b 55%, transparent);
    backdrop-filter: blur(3px);
    display: grid; place-items: center; padding: 24px;
    font-family: var(--g-font);
    animation: fade .16s ease-out;
  }
  @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
  @keyframes rise { from { opacity: 0; transform: translateY(8px) scale(.99) } to { opacity: 1; transform: none } }
  .card {
    width: min(560px, 100%);
    background: var(--g-bg); color: var(--g-text);
    border: 1px solid var(--g-line); border-radius: 16px;
    box-shadow: 0 24px 64px -12px rgba(0,0,0,.45);
    overflow: hidden; animation: rise .18s cubic-bezier(.2,.8,.3,1);
  }
  .card:focus { outline: none }
  .head {
    display: flex; align-items: center; gap: 10px;
    padding: 14px 20px; border-bottom: 1px solid var(--g-line);
    background: var(--g-surface);
  }
  .shield { width: 18px; height: 18px; flex: none; color: var(--g-approve) }
  .brand { font-size: 12px; font-weight: 650; letter-spacing: .04em; text-transform: uppercase; color: var(--g-dim) }
  .countdown { margin-left: auto; font-variant-numeric: tabular-nums; font-size: 12px; color: var(--g-dim) }
  .body { padding: 20px }
  .ask { font-size: 13px; color: var(--g-dim); margin: 0 0 6px }
  .tool { font-size: 19px; font-weight: 640; margin: 0 0 14px; letter-spacing: -.01em }
  .tool code { font-family: var(--g-mono); font-size: 15px; color: var(--g-dim); font-weight: 500 }
  .effect {
    display: flex; gap: 10px; padding: 13px 14px; border-radius: 10px;
    background: var(--g-approve-bg); color: var(--g-approve);
    font-size: 14px; line-height: 1.45; font-weight: 550; margin-bottom: 16px;
  }
  .effect svg { flex: none; margin-top: 1px }
  .args-label { font-size: 11px; font-weight: 650; letter-spacing: .05em; text-transform: uppercase; color: var(--g-dim); margin-bottom: 6px }
  dl.args {
    display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 7px 18px;
    margin: 0 0 16px; padding: 12px 14px; border-radius: 10px;
    background: var(--g-surface); border: 1px solid var(--g-line);
    max-height: 190px; overflow: auto;
  }
  dl.args dt { font-size: 12.5px; font-weight: 650; color: var(--g-dim) }
  /* Mono on the value only: it is the agent's own text, shown unaltered. */
  dl.args dd {
    margin: 0; font-family: var(--g-mono); font-size: 12.5px; line-height: 1.45;
    color: var(--g-text); white-space: pre-wrap; word-break: break-word;
  }
  .args-none { margin: 0 0 16px; font-size: 13px; color: var(--g-dim) }
  pre.args-raw {
    margin: 0 0 16px; padding: 12px; border-radius: 10px;
    background: var(--g-surface); border: 1px solid var(--g-line);
    font-family: var(--g-mono); font-size: 12.5px; line-height: 1.5;
    max-height: 190px; overflow: auto; white-space: pre-wrap; word-break: break-word;
  }
  .remember { display: flex; align-items: center; gap: 9px; font-size: 13px; color: var(--g-dim); cursor: pointer; margin-bottom: 18px }
  .remember input { accent-color: var(--g-approve); width: 15px; height: 15px; cursor: pointer }
  .actions { display: flex; gap: 10px }
  button {
    flex: 1; padding: 11px 16px; border-radius: 10px; font-size: 14px; font-weight: 600;
    font-family: inherit; cursor: pointer; border: 1px solid transparent; transition: filter .12s;
  }
  button:hover { filter: brightness(1.06) }
  button:focus-visible { outline: 2px solid var(--g-open); outline-offset: 2px }
  .deny { background: var(--g-bg); color: var(--g-text); border-color: var(--g-line) }
  .approve { background: var(--g-text); color: var(--g-bg) }
  .keys { margin: 12px 0 0; text-align: center; font-size: 11.5px; color: var(--g-dim) }
  kbd {
    font-family: var(--g-mono); font-size: 10.5px; padding: 1px 5px; border-radius: 4px;
    border: 1px solid var(--g-line); background: var(--g-surface);
  }
`;

const SHIELD = `<svg class="shield" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`;
const ALERT = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`;

/** Only one card at a time — two overlapping overlays would look broken. */
let cardQueue: Promise<unknown> = Promise.resolve();

export function mountApprovalCard(request: ApprovalRequest): Promise<ApprovalOutcome> {
  const run = () => showCard(request);
  const next = cardQueue.then(run, run);
  cardQueue = next.catch(() => undefined);
  return next;
}

function showCard(request: ApprovalRequest): Promise<ApprovalOutcome> {
  return new Promise<ApprovalOutcome>((resolve) => {
    const { host, root } = shadowHost(2147483000);
    const style = document.createElement("style");
    style.textContent = CARD_CSS;
    root.append(style);

    const backdrop = el("div", "backdrop");
    const card = el("div", "card");
    card.tabIndex = -1;
    card.setAttribute("role", "alertdialog");
    card.setAttribute("aria-modal", "true");
    card.setAttribute("aria-labelledby", "g-tool");

    const head = el("div", "head");
    head.innerHTML = SHIELD; // static, authored here — never request data
    head.append(el("span", "brand", "Grenz · approval required"));
    const countdown = el("span", "countdown");
    head.append(countdown);

    const body = el("div", "body");
    body.append(el("p", "ask", "Your assistant is asking to do something in your home."));

    // The site's phrasing of this call when there is one, its title for the
    // tool otherwise. The machine name used to sit here in mono; it told the
    // resident nothing they could act on, and the audit trail carries it.
    const tool = el("h2", "tool", request.plain ?? request.title);
    tool.id = "g-tool";
    tool.title = request.tool;
    body.append(tool);

    const effect = el("div", "effect");
    effect.innerHTML = ALERT; // static
    effect.append(el("span", undefined, request.effect));
    body.append(effect);

    // Only when the site did not phrase the call. Showing both would be the
    // same request twice, once in words and once in keys — but dropping this
    // block unconditionally would hide arguments no one had put into words.
    if (request.plain === undefined) {
      body.append(el("div", "args-label", "Exactly what it asked for"));
      body.append(argsNode(request.input));
    }

    const remember = el("label", "remember");
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    remember.append(checkbox, el("span", undefined, "Approve this tool for the rest of the session"));
    body.append(remember);

    const actions = el("div", "actions");
    const denyBtn = el("button", "deny", "Deny");
    // Named before it runs: nobody should meet a fingerprint prompt they did
    // not ask for.
    const approveBtn = el("button", "approve", request.presence ? "Approve with a passkey" : "Approve");
    actions.append(denyBtn, approveBtn);
    body.append(actions);

    const keys = el("p", "keys");
    keys.append(
      el("kbd", undefined, "Enter"),
      document.createTextNode(" approve · "),
      el("kbd", undefined, "Esc"),
      document.createTextNode(" deny"),
    );
    body.append(keys);

    card.append(head, body);
    backdrop.append(card);
    root.append(backdrop);
    document.body.append(host);

    const deadline = Date.now() + request.timeoutMs;
    const tick = () => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      countdown.textContent = `auto-deny in ${left}s`;
    };
    tick();
    const timer = window.setInterval(tick, 250);

    let done = false;
    const settle = (outcome: ApprovalOutcome) => {
      if (done) return;
      done = true;
      window.clearInterval(timer);
      document.removeEventListener("keydown", onKey, true);
      host.remove();
      previouslyFocused?.focus?.();
      resolve(outcome);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        settle({ granted: false });
      } else if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        // Enter is an approval, so it is held to the same standard as a click.
        if (!e.isTrusted) return settle({ granted: false, synthetic: true });
        void approve();
      } else if (e.key === "Tab") {
        // Minimal focus trap: keep Tab inside the card.
        const focusables = [denyBtn, approveBtn, checkbox];
        const idx = focusables.indexOf(root.activeElement as HTMLElement & never);
        const nextIdx = (idx + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length;
        e.preventDefault();
        focusables[nextIdx]?.focus();
      }
    };

    /**
     * Approval requires a real click.
     *
     * `isTrusted` is set by the browser on events it synthesises from actual
     * input, and page script cannot forge it: `element.click()` and
     * `dispatchEvent(new MouseEvent(...))` are both false. That makes the whole
     * in-page class — a partner widget, an injected tool, anything sharing this
     * realm — unable to grant its own permission, which is the class WebMCP
     * creates by moving tool execution into the page.
     *
     * It does NOT distinguish a person from an agent driving the real mouse;
     * that event is genuinely trusted. Telling those two apart is the user
     * agent's job, and the spec leaves the whole of mediation there.
     *
     * The attempt answers no rather than being ignored, because an ignored
     * card stays up to be attacked again.
     */
    const humanOnly = (run: () => void) => (e: Event) => {
      if (e.isTrusted) return run();
      settle({ granted: false, synthetic: true });
    };

    /**
     * The trusted click gets us into the ceremony; the ceremony finishes the
     * job. The platform draws it, so there is nothing here for an agent to
     * click — and the button says what it is asking for before it asks.
     */
    const approve = async () => {
      if (!request.presence) {
        return settle({ granted: true, remember: checkbox.checked });
      }
      approveBtn.disabled = true;
      denyBtn.disabled = true;
      approveBtn.textContent = "Waiting for you…";
      const proof = await provePresence(document.title || location.hostname, request.verifier);
      if (proof.ok) {
        // "proved" only when someone off-page actually checked the signature.
        return settle({
          granted: true,
          remember: checkbox.checked,
          presence: proof.verified ? "proved" : "unverified",
        });
      }
      if (proof.reason === "rejected") {
        return settle({ granted: false, presence: "refused" });
      }
      if (proof.reason === "unavailable" && request.presence === "preferred") {
        // Falling back is a real weakening, so it is granted AND reported —
        // the trail says the proof was not available, never nothing.
        return settle({ granted: true, remember: checkbox.checked, presence: "unavailable" });
      }
      settle({ granted: false, presence: proof.reason === "unavailable" ? "unavailable" : "refused" });
    };

    denyBtn.addEventListener("click", () => settle({ granted: false }));
    approveBtn.addEventListener("click", humanOnly(() => void approve()));
    // Resolved elsewhere: the timeout fired, or the agent hung up.
    request.close.addEventListener("abort", () => settle({ granted: false }), { once: true });

    const previouslyFocused = document.activeElement as HTMLElement | null;
    document.addEventListener("keydown", onKey, true);
    // Focus the dialog itself, not a button: focusing Approve would make a
    // stray Enter an approval, and focusing Deny would fight Enter-to-approve.
    card.focus();
  });
}

// ---------------------------------------------------------------------------
// Audit timeline
// ---------------------------------------------------------------------------

const TIMELINE_CSS = `
  ${PALETTE}
  .wrap {
    pointer-events: auto; height: 100%; display: flex; flex-direction: column;
    font-family: var(--g-font); color: var(--g-text); background: var(--g-bg);
  }
  .top {
    display: flex; align-items: center; gap: 8px; padding: 12px 14px;
    border-bottom: 1px solid var(--g-line); flex: none;
  }
  .title { font-size: 13px; font-weight: 650; letter-spacing: -.01em }
  .count { font-size: 11px; color: var(--g-dim); font-variant-numeric: tabular-nums }
  .clear {
    margin-left: auto; background: none; border: 1px solid var(--g-line); color: var(--g-dim);
    border-radius: 7px; padding: 3px 9px; font-size: 11px; font-family: inherit; cursor: pointer;
  }
  .clear:hover { color: var(--g-text) }
  .list { flex: 1; overflow-y: auto; padding: 8px }
  .empty { padding: 40px 22px; text-align: center; color: var(--g-dim); font-size: 13px; line-height: 1.6 }
  .empty strong { display: block; color: var(--g-text); font-size: 13.5px; margin-bottom: 5px; font-weight: 600 }
  .row {
    border: 1px solid var(--g-line); border-radius: 10px; padding: 9px 11px;
    margin-bottom: 6px; background: var(--g-bg); animation: slide .2s ease-out;
  }
  @keyframes slide { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: none } }
  .row-top { display: flex; align-items: center; gap: 7px; margin-bottom: 3px }
  .tool { font-family: var(--g-mono); font-size: 12px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
  .time { margin-left: auto; font-size: 10.5px; color: var(--g-dim); font-variant-numeric: tabular-nums; flex: none }
  .badge {
    font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase;
    padding: 2px 6px; border-radius: 5px; flex: none;
  }
  .b-allow { background: var(--g-allow-bg); color: var(--g-allow) }
  .b-deny { background: var(--g-deny-bg); color: var(--g-deny) }
  .b-approve { background: var(--g-approve-bg); color: var(--g-approve) }
  .b-open { background: var(--g-open-bg); color: var(--g-open) }
  .msg { font-size: 12px; line-height: 1.45; color: var(--g-dim) }
  .flags { display: flex; gap: 5px; margin-top: 5px; flex-wrap: wrap }
  .flag {
    font-size: 9.5px; padding: 1.5px 5px; border-radius: 4px; border: 1px solid var(--g-line);
    color: var(--g-dim); font-family: var(--g-mono);
  }
  .flag.warn { color: var(--g-deny); border-color: var(--g-deny) }
  details { margin-top: 6px }
  summary { font-size: 10.5px; color: var(--g-dim); cursor: pointer; user-select: none; list-style: none }
  summary::-webkit-details-marker { display: none }
  summary::before { content: "▸ "; }
  details[open] summary::before { content: "▾ "; }
  details pre {
    margin: 5px 0 0; padding: 8px; border-radius: 7px; background: var(--g-surface);
    border: 1px solid var(--g-line); font-family: var(--g-mono); font-size: 11px;
    line-height: 1.45; overflow: auto; max-height: 150px; white-space: pre-wrap; word-break: break-word;
  }
`;

const BADGE: Record<TimelineEvent["decision"], { cls: string; label: string }> = {
  allow: { cls: "b-allow", label: "allowed" },
  deny: { cls: "b-deny", label: "refused" },
  require_approval: { cls: "b-approve", label: "you allowed it" },
  unprotected: { cls: "b-open", label: "unprotected" },
};

/**
 * Reason codes, said out loud.
 *
 * The codes themselves are the vocabulary a developer greps for, so they are
 * not thrown away — they move behind the disclosure triangle. What a household
 * member reads is a sentence about their own house.
 */
const REASON: Record<ReasonCode, string> = {
  policy_loosened: "a house rule was relaxed",
  policy_tightened: "a house rule was tightened",
  approval_synthetic: "something clicked Approve that was not you",
  approval_present: "you proved it was you, and the site's server checked it",
  presence_unverified: "a passkey answered, but nothing off-page checked it",
  presence_refused: "the passkey check was not satisfied",
  presence_unavailable: "this device cannot prove a person is here",
  explicit_allow: "a house rule allows this",
  explicit_deny: "a house rule says never",
  approval_required: "a house rule says ask me first",
  no_matching_allow: "no house rule covers this",
  approval_granted: "you said yes",
  approval_denied: "you said no",
  approval_expired: "nobody answered in time",
  approval_abandoned: "the page closed before you answered",
  approval_remembered_grant: "you allowed this earlier today",
  annotation_mismatch: "it said it only reads — it writes",
  constraint: "that value is out of range",
  rate_limit: "too many times, too fast",
  unprotected: "protection was off",
};

export function mountTimelineInto(element: HTMLElement, g: GrenzInstance): () => void {
  const root = element.shadowRoot ?? element.attachShadow({ mode: "open" });
  root.textContent = "";
  const style = document.createElement("style");
  style.textContent = TIMELINE_CSS;

  const wrap = el("div", "wrap");
  const top = el("div", "top");
  const title = el("span", "title", "Assistant activity");
  const count = el("span", "count");
  const clear = el("button", "clear", "Clear");
  clear.addEventListener("click", () => g.clearTimeline());
  top.append(title, count, clear);

  const list = el("div", "list");
  wrap.append(top, list);
  root.append(style, wrap);

  const render = (events: TimelineEvent[]) => {
    count.textContent = events.length === 1 ? "1 event" : `${events.length} events`;
    list.textContent = "";

    if (events.length === 0) {
      const empty = el("div", "empty");
      empty.append(el("strong", undefined, "Your assistant hasn't done anything yet."));
      empty.append(
        document.createTextNode(
          "When it touches something in your home, it shows up here — what it did, whether it was allowed, and why.",
        ),
      );
      list.append(empty);
      return;
    }

    // Newest first: on a live page the interesting row should never be the one
    // that just scrolled out of view.
    //
    // The page's own tools all register at mount, which would otherwise bury
    // every interesting row under a wall of "registered X". They collapse into
    // one line. A *partner* script registering a tool does not collapse — that
    // one is the news.
    const ordered = [...events].reverse();
    for (let i = 0; i < ordered.length; i++) {
      const e = ordered[i]!;
      if (e.kind !== "register" || e.foreign) {
        list.append(renderRow(e));
        continue;
      }
      let j = i;
      while (j + 1 < ordered.length) {
        const next = ordered[j + 1]!;
        if (next.kind !== "register" || next.foreign) break;
        j++;
      }
      list.append(renderOwnTools(ordered.slice(i, j + 1)));
      i = j;
    }
  };

  const unsubscribe = g.subscribe(render);
  return () => {
    unsubscribe();
    root.textContent = "";
  };
}

/** One line standing in for every tool this page registered itself. */
function renderOwnTools(events: TimelineEvent[]): HTMLElement {
  const row = el("div", "row");
  const head = el("div", "row-top");
  head.append(
    el("span", "badge b-open", "ready"),
    el("span", "tool", `${events.length} tool${events.length === 1 ? "" : "s"} this home offers`),
    el("span", "time", new Date(events[events.length - 1]!.at).toLocaleTimeString()),
  );
  row.append(head);

  const details = document.createElement("details");
  details.append(el("summary", undefined, "which ones"));
  const pre = el("pre");
  // Newest-first above, but a plain list of capabilities reads better in the
  // order the page offered them.
  pre.textContent = [...events].reverse().map((e) => `${e.tool} — ${REASON[e.reason!] ?? e.reason}`).join("\n");
  details.append(pre);
  row.append(details);
  return row;
}

function renderRow(e: TimelineEvent): HTMLElement {
  const row = el("div", "row");
  const head = el("div", "row-top");

  const badge = BADGE[e.decision];
  const label = e.kind === "register" ? "registered" : e.kind === "grant" ? "policy" : badge.label;
  const cls = e.kind === "call" ? badge.cls : "b-open";
  const badgeEl = el("span", `badge ${cls}`, label);

  head.append(badgeEl, el("span", "tool", e.tool));
  head.append(el("span", "time", new Date(e.at).toLocaleTimeString()));
  row.append(head, el("div", "msg", e.message));

  const flags: HTMLElement[] = [];
  if (e.foreign) flags.push(el("span", "flag", "partner app"));
  if (e.claimedReadOnly) {
    // A read-only claim is only suspicious when something else about the tool
    // is. Flagging an honest annotation in red teaches the reader to ignore
    // the colour, which costs us the one moment it needs to be believed.
    const doubted = e.decision === "deny" || e.foreign === true;
    flags.push(
      el("span", doubted ? "flag warn" : "flag", doubted ? "claims it only reads" : "only reads"),
    );
  }
  // Unlike a readOnly claim, this one is a disclosure of risk rather than of
  // safety, so it is worth a colour whether or not the tool is otherwise
  // doubted — the content is untrusted either way.
  if (e.untrustedContent) flags.push(el("span", "flag warn", "written by a stranger"));
  if (e.requestedFields?.length)
    flags.push(
      el(
        "span",
        "flag warn",
        `wants ${e.requestedFields.length} thing${e.requestedFields.length === 1 ? "" : "s"} about you`,
      ),
    );
  if (e.reason) {
    const flag = el("span", "flag", REASON[e.reason] ?? e.reason);
    flag.title = e.reason; // the code a developer greps for, one hover away
    flags.push(flag);
  }
  if (flags.length) {
    const bar = el("div", "flags");
    bar.append(...flags);
    row.append(bar);
  }

  if (e.description) {
    const details = document.createElement("details");
    details.append(el("summary", undefined, "what the assistant was told"));
    const quote = el("pre");
    quote.textContent = e.description;
    details.append(quote);
    row.append(details);
  }

  if (e.requestedFields?.length) {
    const details = document.createElement("details");
    details.append(el("summary", undefined, "what it wanted from you"));
    const quote = el("pre");
    quote.textContent = e.requestedFields.join("\n");
    details.append(quote);
    row.append(details);
  }

  if (e.input !== undefined || e.result !== undefined) {
    const details = document.createElement("details");
    details.append(el("summary", undefined, "what it sent, and what it got back"));
    const pre = el("pre");
    const parts: string[] = [];
    if (e.input !== undefined) parts.push(`input:\n${prettyArgs(e.input)}`);
    if (e.result !== undefined) parts.push(`result:\n${e.result}`);
    pre.textContent = parts.join("\n\n");
    details.append(pre);
    row.append(details);
  }

  return row;
}
