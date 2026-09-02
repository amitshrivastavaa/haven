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
  /**
   * Why the takeover did not claim the surface, in the browser's own words.
   *
   * A page that says "could not take over" and nothing else is untestable from
   * the outside: every hardened WebMCP implementation looks identical from
   * here. These strings are rendered next to that warning so the reason is
   * visible in the one place the failure actually happens — someone else's
   * browser, which is never the one holding a debugger.
   */
  blocked: string[];
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
  blocked: [],
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

/** At most a handful, deduped: this is read by a person, not a log pipeline. */
function note(line: string): void {
  if (state.blocked.length < 6 && !state.blocked.includes(line)) state.blocked.push(line);
}

function describe(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.slice(0, 120);
}

/**
 * The property as the browser holds it. Which of the two flags is false says
 * what would have to change for a takeover to be possible at all, and whether
 * it is an own property or an inherited one says where to look.
 */
function descriptorOf(target: object, key: string): string {
  let owner: object | null = target;
  while (owner && !Object.prototype.hasOwnProperty.call(owner, key)) {
    owner = Object.getPrototypeOf(owner) as object | null;
  }
  if (!owner) return `${key}: no own descriptor on the chain`;
  const d = Object.getOwnPropertyDescriptor(owner, key)!;
  const where = owner === target ? "own" : "inherited";
  const kind = d.get || d.set ? "accessor" : "data";
  return `${where} ${kind}, configurable=${d.configurable}, writable=${d.writable ?? "n/a"}, frozen=${Object.isFrozen(owner)}`;
}

/**
 * Second-choice takeover: claim the accessor instead of the method.
 *
 * Measured in ChatGPT's in-app browser, which does not implement WebMCP the way
 * Chrome does — it injects a polyfill object and hardens it, so
 * `defineProperty` on its `registerTool` throws and the takeover above claims
 * nothing. The page then governs its own tools (see `registerTool` in
 * grenz.ts) and nothing else, which is the one guarantee this library exists to
 * make.
 *
 * A frozen object still has to be *reached*, and it is reached through
 * `document.modelContext`. So this replaces that property with a facade that
 * forwards everything except `registerTool`. Any script asking the document for
 * the model context — which is the only way a third party finds it — gets the
 * governed surface.
 *
 * It is strictly weaker than owning the method, and the difference is worth
 * being exact about: whoever already holds a direct reference to the real
 * object still bypasses this, including the browser's own bridge. That is fine
 * for the bridge and it is the limit for an attacker who captured the object
 * before Grenz loaded. Every method other than `registerTool` is bound to the
 * real object, so a native implementation does not throw on an illegal
 * invocation through the facade.
 *
 * The facade proxies an EMPTY object and forwards by hand, which looks like the
 * long way round. It is the only way round. A proxy whose target is the real
 * object may not return a different value for a non-configurable, non-writable
 * property — and `Object.freeze` makes every property exactly that, including
 * the `registerTool` this needs to replace. Proxying the real object throws a
 * TypeError on the first read of it. An empty target owns nothing, so there is
 * no invariant left to violate.
 */
export function claimAccessor(): boolean {
  const hosts: object[] = [];
  if (typeof document !== "undefined") hosts.push(document);
  if (typeof navigator !== "undefined") hosts.push(navigator);

  for (const host of hosts) {
    const name = host === (globalThis as { document?: object }).document ? "document" : "navigator";
    const real = (host as { modelContext?: object }).modelContext;
    if (!real || typeof real !== "object") {
      note(`${name}.modelContext: ${real === undefined ? "absent" : typeof real}`);
      continue;
    }
    const original = (real as ModelContextLike).registerTool;
    if (typeof original !== "function") {
      note(`${name}.modelContext.registerTool: ${typeof original}, not a function`);
      continue;
    }

    const patchedRegisterTool = (tool: ToolDescriptor, options?: RegisterOptions): Promise<void> =>
      original.call(real as ModelContextLike, applyWrapper(tool, options, !state.firstPartyDepth), options);

    const facade = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === "registerTool") return patchedRegisterTool;
          const value = (real as Record<string | symbol, unknown>)[prop];
          return typeof value === "function" ? value.bind(real) : value;
        },
        has: (_target, prop) => prop in real,
      },
    );

    try {
      // Same sealing rationale as the method patch: left configurable, one
      // `delete document.modelContext` restores the ungoverned object.
      Object.defineProperty(host, "modelContext", { configurable: false, get: () => facade });
      state.patched.push({ proto: real, original });
    } catch (err) {
      // The accessor is sealed too. There is no third place to stand, and the
      // page says so rather than implying a takeover it did not get.
      note(`accessor: ${describe(err)} · ${descriptorOf(host, "modelContext")}`);
    }
  }
  return state.patched.length > 0;
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
    } catch (err) {
      // Someone sealed this surface first — another policy layer, a hardened
      // browser, or an attacker who won the load race. It is not ours, so it is
      // not recorded as ours, and `isInstalled()` stays false. The instance
      // still governs its own registrations; see `registerTool` in grenz.ts.
      note(`method: ${describe(err)} · ${descriptorOf(owner, "registerTool")}`);
    }
  }

  // Owning the method is the strong form and it failed — the surface is
  // frozen. Fall back to owning the way it is reached, which is weaker but is
  // the difference between governing third-party registrations and not.
  if (state.patched.length === 0) claimAccessor();

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

/** Why the takeover failed. Empty when it succeeded, or was never attempted. */
export function takeoverDiagnosis(): string[] {
  return state.patched.length > 0 ? [] : [...state.blocked];
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
  state.blocked = [];
}
