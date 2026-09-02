/**
 * What the agent can see that Grenz cannot govern.
 *
 * The takeover owns `registerTool` and the adopter owns `<form toolname>`, and
 * between them they cover every registration made in *this* document. They do
 * not cover another document. Each realm gets its own `ModelContext` on its own
 * prototype, so a same-origin `<iframe>` registers into its own copy — and
 * Chrome then lists that tool in the *parent's* `getTools()`. Verified against
 * Chrome 152: a `srcdoc` child with no Grenz on it put both an imperative and a
 * declarative tool into the top frame's list, and calling one from the top ran
 * the child's code ungoverned.
 *
 * Two things are worth being precise about, because they bound how much this
 * matters and what could ever be done about it.
 *
 * Cross-origin frames are not part of this. The same probe with the child on a
 * second port contributed nothing to the parent's `getTools()` — the browser
 * already scopes tool visibility to same-origin, and a cross-origin child is
 * unreachable from here anyway (`SecurityError`). So the exposure is exactly:
 * frames on your own origin.
 *
 * Which is also why an origin allow-list would be no use. Every tool from
 * `getTools()` carries an `origin`, and a same-origin child's is byte-identical
 * to the parent's — the field cannot separate your page from a frame inside it.
 * The field that can is `window`: it is the registering window, so `t.window
 * !== window` is true for exactly the tools that came from somewhere this
 * library never ran.
 *
 * This module does not claim to stop them. It cannot: Grenz is not in the call
 * path, so there is no decision to make. What it does is refuse to let the gap
 * be silent — a tool the agent can call and the rules never saw is reported as
 * exactly that, with `decision: "unprotected"`, the same word used when someone
 * switches protection off. Naming an unguarded door is worth more than
 * pretending it is shut.
 */

import type { ModelContextLike } from "./types.ts";

/** A tool on `getTools()` that never passed through this document's Grenz. */
export interface OutOfReach {
  readonly name: string;
  readonly description: string;
  /** The registering document's origin, as the browser reports it. */
  readonly origin?: string;
  /**
   * Registered in a different window — a frame on this page. False means the
   * tool is in this window and Grenz still missed it, which would be a bug in
   * the takeover rather than a boundary, and is worth telling apart.
   */
  readonly fromFrame: boolean;
}

interface NativeTool {
  name?: unknown;
  description?: unknown;
  origin?: unknown;
  window?: unknown;
}

/**
 * Everything the browser will hand an agent that this document's registry does
 * not know about.
 *
 * `governs` is asked rather than passed a set, so the caller can answer from
 * whatever it considers authoritative without this module reaching into it.
 * Resolves empty on any failure: an audit that throws would take down the
 * registration path it is auditing, which trades a reporting gap for a real one.
 */
export async function findOutOfReach(
  mc: ModelContextLike | undefined,
  governs: (name: string) => boolean,
): Promise<OutOfReach[]> {
  if (typeof mc?.getTools !== "function") return [];

  let tools: unknown[];
  try {
    tools = await mc.getTools();
  } catch {
    return [];
  }
  if (!Array.isArray(tools)) return [];

  // Undefined off a browser, which is fine and is why the comparison is against
  // it rather than guarded by it: a tool carrying no `window` is never called a
  // frame, and a tool carrying one that is not ours always is.
  const here = (globalThis as { window?: unknown }).window;
  const out: OutOfReach[] = [];

  for (const raw of tools) {
    const tool = raw as NativeTool | null;
    const name = typeof tool?.name === "string" ? tool.name : null;
    if (!name || governs(name)) continue;
    out.push({
      name,
      description: typeof tool?.description === "string" ? tool.description : "",
      ...(typeof tool?.origin === "string" ? { origin: tool.origin } : {}),
      // No `window` at all (a polyfill, an older build) reads as "not from a
      // frame": claiming a frame we cannot see would be a guess in the UI.
      fromFrame: tool !== null && "window" in tool && tool.window !== here,
    });
  }
  return out;
}

export interface WatchOptions {
  /** Defaults to `setTimeout`. Injected so tests need no real clock. */
  readonly scheduler?: (fn: () => void, ms: number) => unknown;
}

/**
 * Re-audit when a frame appears and again when it finishes loading.
 *
 * The obvious implementation — one capturing `load` listener on `window` —
 * does not work, and it is worth writing down because it looks like it should.
 * `load` at an `<iframe>` is dispatched to the element and, measured in Chrome
 * 152, never reaches a capture-phase listener on `window`: an array filled by
 * such a listener came back empty for a `srcdoc` frame whose own `onload` had
 * already fired. So each frame is hooked directly, and a MutationObserver
 * supplies the ones added later.
 *
 * A child that registers *after* its own load event — on a timer, or from a
 * fetch — is missed by the load pass and caught only by the follow-up, which is
 * why the audit is also a method the app can call. This samples a surface no
 * event covers; it does not subscribe to one.
 */
export function watchFrames(audit: () => void, options: WatchOptions = {}): () => void {
  if (typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => {};
  }
  const later = options.scheduler ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const hooked = new WeakSet<Element>();

  const hook = (frame: Element): void => {
    if (hooked.has(frame)) return;
    hooked.add(frame);
    // A frame already loaded by the time we find it will not fire `load`
    // again, so the arrival itself is a reason to look.
    audit();
    frame.addEventListener("load", () => {
      audit();
      later(audit, 1_500);
    });
  };

  const scan = (root: ParentNode): void => {
    for (const frame of Array.from(root.querySelectorAll("iframe, frame"))) hook(frame);
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.matches("iframe, frame")) hook(node);
        scan(node);
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan(document);
  audit();

  return () => observer.disconnect();
}
