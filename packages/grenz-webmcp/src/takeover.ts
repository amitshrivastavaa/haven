/**
 * Registration takeover.
 *
 * A policy layer that only sees its own registrations is not a policy layer.
 * This module owns the page's `registerTool` surface so that EVERY tool —
 * first-party, third-party script tag, anything sharing this document — is
 * wrapped before an agent can reach it.
 *
 * Two rules govern this file:
 *
 *  1. The prototype is derived from the live instance, never from a global
 *     `ModelContext` name. The spec marks the interface `Exposed=Window`, so
 *     the global probably exists, but instance-derivation works either way and
 *     survives the two accessors not sharing a class.
 *
 *  2. The patch is PERMANENT for the page's lifetime. Turning protection off
 *     flips a flag the wrapper reads at call time; it never un-patches. That
 *     is what lets the demo toggle change the outcome of an ALREADY-registered
 *     tool, and it removes any patch/unpatch race.
 */

import { adoptDeclarativeTools } from "./declarative.ts";
import type { ModelContextLike, RegisterOptions, ToolDescriptor } from "./types.ts";

/** A tool as Grenz knows it, whoever registered it. */
export interface RegistryEntry {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema?: object;
  readonly annotations?: ToolDescriptor["annotations"];
  /** True when it did not come through `g.registerTool` — i.e. someone else's. */
  readonly foreign: boolean;
  /** The tool's own implementation, before wrapping. */
  readonly original: ToolDescriptor["execute"];
  /** The wrapped implementation the agent actually reaches. */
  readonly governed: ToolDescriptor["execute"];
  readonly registeredAt: number;
}

type Wrapper = (tool: ToolDescriptor, options: RegisterOptions | undefined, foreign: boolean) => ToolDescriptor;

interface TakeoverState {
  installed: boolean;
  patched: { proto: object; original: ModelContextLike["registerTool"] }[];
  registry: Map<string, RegistryEntry>;
  wrapper: Wrapper | null;
  /** Registrations that arrived before a wrapper was attached. */
  queued: { tool: ToolDescriptor; options: RegisterOptions | undefined }[];
  /**
   * Re-entrancy depth, not a boolean: `g.registerTool` can be called while
   * another registration is in flight (React StrictMode double-invokes
   * effects), and a boolean would be cleared by the inner call while the outer
   * one is still running — mislabelling a first-party tool as someone else's.
   */
  firstPartyDepth: number;
  /** Tears down the declarative-form observer. Test-only; production never stops. */
  stopDeclarative: (() => void) | null;
}

/**
 * The state is keyed off a global Symbol, NOT held in module scope.
 *
 * This is not defensiveness, it is the deployment shape. `grenz-install.js` is
 * a classic-script IIFE bundle and the app imports the library as ESM: two
 * bundles, two copies of this module, and therefore two module scopes. If the
 * state lived in module scope, the IIFE would patch the prototype into one
 * registry while the app attached its policy to a different, empty one — and
 * every registration would be wrapped twice, by two layers that cannot see
 * each other. A page-global symbol is the only thing both copies share.
 */
const STATE_KEY = Symbol.for("dev.grenz.webmcp.takeover");

const state: TakeoverState = ((globalThis as unknown as Record<symbol, TakeoverState>)[
  STATE_KEY
] ??= {
  installed: false,
  patched: [],
  registry: new Map<string, RegistryEntry>(),
  wrapper: null,
  queued: [],
  firstPartyDepth: 0,
  stopDeclarative: null,
});

export function modelContext(): ModelContextLike | undefined {
  if (typeof document === "undefined") return undefined;
  const doc = document as unknown as { modelContext?: ModelContextLike };
  const nav = typeof navigator !== "undefined" ? (navigator as unknown as { modelContext?: ModelContextLike }) : undefined;
  return doc.modelContext ?? nav?.modelContext;
}

/** Every distinct prototype behind the (possibly two) accessors. */
function prototypesToPatch(): object[] {
  const seen = new Set<object>();
  const out: object[] = [];
  if (typeof document === "undefined") return out;

  const candidates = [
    (document as unknown as { modelContext?: object }).modelContext,
    typeof navigator !== "undefined" ? (navigator as unknown as { modelContext?: object }).modelContext : undefined,
  ];

  for (const instance of candidates) {
    if (!instance || typeof instance !== "object") continue;
    const proto = Object.getPrototypeOf(instance) as object | null;
    // Guard against an implementation that hangs registerTool off the instance
    // itself rather than a prototype; patch whichever object actually owns it.
    const owner =
      proto && Object.prototype.hasOwnProperty.call(proto, "registerTool") ? proto : instance;
    if (owner && !seen.has(owner)) {
      seen.add(owner);
      out.push(owner);
    }
  }
  return out;
}

/**
 * Patch the registration surface. Idempotent, and safe to call when WebMCP is
 * absent (it simply reports false — Grenz still governs its own registry, which
 * is what the simulator reads).
 *
 * @returns whether a native registration surface was found and patched.
 */
export function install(): boolean {
  // Short-circuit only once something was ACTUALLY patched. A first call made
  // before any ModelContext exists (no WebMCP, or a polyfill that loads as a
  // deferred module) must not permanently disarm the takeover — otherwise the
  // polyfill arrives, registrations flow, and nothing governs them.
  if (state.patched.length > 0) return true;
  state.installed = true;

  for (const owner of prototypesToPatch()) {
    const original = (owner as unknown as ModelContextLike).registerTool;
    if (typeof original !== "function") continue;

    // Sealed, and that is the point. Left configurable/writable, the exact
    // attacker this exists to stop removes the whole policy layer in one line:
    // `delete document.modelContext.registerTool` restores the prototype's
    // original, and a plain assignment replaces the wrapper. Neither works now
    // — the property cannot be redefined, reassigned or deleted for the life
    // of the page. It does not save a page whose attacker wins the load race
    // and patches first; it removes the much cheaper move of undoing a
    // takeover that already happened.
    // Recorded only once the property is actually ours. Pushing first would
    // report a takeover that a throw below never completed.
    try {
      Object.defineProperty(owner, "registerTool", {
      configurable: false,
      writable: false,
      value: function patchedRegisterTool(
        this: ModelContextLike,
        tool: ToolDescriptor,
        options?: RegisterOptions,
      ): Promise<void> {
        // `first` marks registrations that did NOT come through g.registerTool.
        // g.registerTool sets the flag before delegating here, so a first-party
        // call is not mislabelled as someone else's.
        const foreign = !state.firstPartyDepth;
        const wrapped = applyWrapper(tool, options, foreign);
        return original.call(this, wrapped, options);
      },
      });
      state.patched.push({ proto: owner, original });
    } catch {
      // Someone sealed this surface first — another policy layer, a hardened
      // browser, or an attacker who won the load race. It is not ours, so it is
      // not recorded as ours, and `isInstalled()` stays false. The instance
      // still governs its own registrations; see `registerTool` in grenz.ts.
    }
  }

  // The imperative surface is only half of WebMCP. Declarative `<form
  // toolname=…>` tools never pass through `registerTool`, so patching alone
  // leaves them ungoverned — see declarative.ts.
  if (state.patched.length > 0 && !state.stopDeclarative) {
    state.stopDeclarative = adoptDeclarativeTools(modelContext());
  }

  return state.patched.length > 0;
}

export async function registerAsFirstParty(register: () => Promise<void>): Promise<void> {
  state.firstPartyDepth++;
  try {
    await register();
  } finally {
    state.firstPartyDepth--;
  }
}

function applyWrapper(
  tool: ToolDescriptor,
  options: RegisterOptions | undefined,
  foreign: boolean,
): ToolDescriptor {
  if (!state.wrapper) {
    // Installed, but no policy attached yet. Queue it so the instance can
    // adopt it on attach, and hand back a tool whose execute resolves through
    // the (eventual) wrapper — the closure reads `state` at call time.
    state.queued.push({ tool, options });
    return {
      ...tool,
      execute: (input, ctx) => {
        const entry = state.registry.get(tool.name);
        return entry ? entry.governed(input, ctx) : tool.execute(input, ctx);
      },
    };
  }
  return state.wrapper(tool, options, foreign);
}

/** Attach the policy pipeline. Drains anything registered before this point. */
export function attachWrapper(wrapper: Wrapper): void {
  state.wrapper = wrapper;
  const queued = state.queued.splice(0);
  for (const q of queued) wrapper(q.tool, q.options, true);
}

export function registry(): Map<string, RegistryEntry> {
  return state.registry;
}

export function isInstalled(): boolean {
  return state.patched.length > 0;
}

/**
 * Test-only. Restores the original methods and clears state. Production code
 * must never un-patch — see the header.
 */
export function __resetForTests(): void {
  // The patch is sealed, so it cannot be lifted — which is also true in
  // production, where it is never lifted either. Clearing the mutable state is
  // enough for isolation: the wrapper reads `state` at call time, so a cleared
  // registry and a null wrapper give the next test a page where Grenz is
  // installed but no policy has attached yet. `patched` is kept deliberately,
  // so `install()` short-circuits and a shared test prototype is never
  // wrapped twice.
  state.stopDeclarative?.();
  state.stopDeclarative = null;
  state.installed = state.patched.length > 0;
  state.registry.clear();
  state.wrapper = null;
  state.queued = [];
  state.firstPartyDepth = 0;
}
