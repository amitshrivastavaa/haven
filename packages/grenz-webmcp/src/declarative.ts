/**
 * The other registration path.
 *
 * WebMCP has two ways to create a tool. `registerTool` is the one everybody
 * writes about, and `takeover.ts` owns it. The other is declarative: annotate a
 * plain `<form>` and the browser derives a tool from it, with no JavaScript
 * involved at all.
 *
 *   <form toolname="book_table" tooldescription="Reserve a table." toolautosubmit>
 *
 * That form never touches `registerTool`, so a policy layer that patches only
 * the imperative surface does not see it. Verified against Chrome: a declarative
 * tool arrives on `getTools()` and on the CDP `WebMCP` domain with an empty
 * `stackTrace`, because no script registered it. It is also reachable by an
 * attacker who can write HTML but not run script — appending a `<form
 * toolname=…>` after load registers a tool immediately — which is a lower bar
 * than the injected-script case this library was built for.
 *
 * So Grenz adopts them. Removing the `toolname` attribute unregisters the
 * browser's tool (Chrome emits `WebMCP.toolsRemoved`), and the same tool is
 * re-registered through the governed surface, where it gets a policy lookup and
 * everything after it. The form keeps working for a human either way: these
 * attributes are agent-facing only, so nothing about the page changes.
 *
 * Adopted tools are deliberately treated as unvouched-for. A form in the site's
 * own HTML and a form injected into it are indistinguishable at this layer, so
 * the safe reading is the deny-by-default one: unless the site's policy names
 * the tool, it does not run. A site that wants its own form tool allowed says
 * so in the policy, the same as for any other tool.
 */

import type { ModelContextLike, ToolDescriptor } from "./types.ts";

/** Marks a form Grenz has already taken over, so it is never adopted twice. */
const CLAIMED = "data-grenz-adopted";

/** The subset of a form element this module needs, so it is testable without a DOM. */
export interface FormLike {
  getAttribute(name: string): string | null;
  removeAttribute(name: string): void;
  setAttribute(name: string, value: string): void;
  readonly elements: ArrayLike<FieldLike>;
  requestSubmit?(): void;
  submit?(): void;
}

export interface FieldLike {
  readonly name?: string;
  readonly type?: string;
  readonly required?: boolean;
  readonly labels?: ArrayLike<{ textContent: string | null }> | null;
  readonly options?: ArrayLike<{ value: string }>;
  getAttribute(name: string): string | null;
  value?: string;
  checked?: boolean;
}

interface Prop {
  type: string;
  description?: string;
  enum?: string[];
}

/**
 * Derive a tool's schema from the form, the way the browser does: field `name`
 * becomes the property, `toolparamdescription` or the field's label becomes its
 * description, `required` becomes the required list.
 */
export function schemaFromForm(form: FormLike): { properties: Record<string, Prop>; required: string[] } {
  const properties: Record<string, Prop> = {};
  const required: string[] = [];

  for (let i = 0; i < form.elements.length; i++) {
    const field = form.elements[i];
    if (!field?.name) continue;
    // A submit button carries a name sometimes; it is not an input to the tool.
    const kind = (field.type ?? "text").toLowerCase();
    if (kind === "submit" || kind === "button" || kind === "reset" || kind === "fieldset") continue;
    if (properties[field.name]) continue;

    const prop: Prop = {
      type: kind === "checkbox" ? "boolean"
        : kind === "number" || kind === "range" ? "number"
        : "string",
    };

    const said = field.getAttribute("toolparamdescription")
      ?? field.labels?.[0]?.textContent?.trim()
      ?? undefined;
    if (said) prop.description = said;

    if (field.options && field.options.length > 0) {
      prop.enum = Array.from({ length: field.options.length }, (_, n) => field.options![n]!.value);
    }

    properties[field.name] = prop;
    if (field.required) required.push(field.name);
  }

  return { properties, required };
}

/**
 * Build the governed stand-in for a declarative form.
 *
 * `execute` mirrors what the browser would have done: fill the named fields,
 * and submit only when the form asked for `toolautosubmit`. Without that
 * attribute the declarative contract is that a human submits, so filling the
 * form and stopping is the honest translation, not a shortcut.
 */
export function toolFromForm(form: FormLike): ToolDescriptor | null {
  const name = form.getAttribute("toolname")?.trim();
  if (!name) return null;

  const description = form.getAttribute("tooldescription")?.trim()
    ?? `Submits the "${name}" form on this page.`;
  const autosubmit = form.getAttribute("toolautosubmit") !== null;
  const { properties, required } = schemaFromForm(form);

  return {
    name,
    title: name,
    description,
    inputSchema: required.length
      ? { type: "object", properties, required }
      : { type: "object", properties },
    execute: async (input: unknown) => {
      const values = (input ?? {}) as Record<string, unknown>;
      const filled: string[] = [];
      for (let i = 0; i < form.elements.length; i++) {
        const field = form.elements[i];
        if (!field?.name || !(field.name in values)) continue;
        const value = values[field.name];
        if ((field.type ?? "").toLowerCase() === "checkbox") field.checked = Boolean(value);
        else field.value = value === undefined || value === null ? "" : String(value);
        filled.push(field.name);
      }
      if (autosubmit) {
        // requestSubmit runs validation and fires submit handlers; submit()
        // skips both. Prefer the former, fall back for older shapes.
        if (form.requestSubmit) form.requestSubmit();
        else form.submit?.();
      }
      return { filled, submitted: autosubmit };
    },
  };
}

/**
 * Take over every declarative tool on the page, now and as they appear.
 *
 * Returns a stop function. Safe to call with no DOM and with no WebMCP: it
 * simply does nothing, which is what a server render or an unsupported browser
 * needs.
 */
export function adoptDeclarativeTools(mc: ModelContextLike | undefined): () => void {
  if (!mc || typeof document === "undefined" || typeof MutationObserver === "undefined") {
    return () => {};
  }

  // One controller per adopted form, so a form leaving the DOM takes its tool
  // with it. `options.signal` is WebMCP's own lifetime mechanism, so this is
  // the documented way to unregister rather than a trick.
  const live = new Map<Element, AbortController>();

  const adopt = (element: Element): void => {
    if (element.hasAttribute(CLAIMED)) return;
    const form = element as unknown as FormLike;
    const tool = toolFromForm(form);
    if (!tool) return;

    // Strip first. Until this attribute is gone the browser's own ungoverned
    // tool is live, and registering ours under the same name while it stands
    // would be a name collision rather than a replacement.
    element.setAttribute(CLAIMED, tool.name);
    form.removeAttribute("toolname");

    const controller = new AbortController();
    live.set(element, controller);
    void Promise.resolve(mc.registerTool(tool, { signal: controller.signal })).catch(() => {
      // A refused registration must not take the page down with it; the form
      // still works for a person, which is the state we started from.
      live.delete(element);
    });
  };

  const scan = (root: ParentNode): void => {
    for (const el of Array.from(root.querySelectorAll("[toolname]"))) adopt(el);
  };

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes" && record.target instanceof Element) {
        // A form that gains `toolname` after the fact — or has it restored.
        if (record.target.hasAttribute("toolname")) adopt(record.target);
        continue;
      }
      for (const node of Array.from(record.addedNodes)) {
        if (!(node instanceof Element)) continue;
        if (node.hasAttribute("toolname")) adopt(node);
        scan(node);
      }
      for (const node of Array.from(record.removedNodes)) {
        if (!(node instanceof Element)) continue;
        for (const [element, controller] of live) {
          if (element === node || node.contains(element)) {
            controller.abort();
            live.delete(element);
          }
        }
      }
    }
  });

  // documentElement, not body: `grenz-install.js` runs in <head>, before a body
  // exists, and the forms it has to beat are further down the same document.
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["toolname"],
  });
  scan(document);

  return () => {
    observer.disconnect();
    for (const controller of live.values()) controller.abort();
    live.clear();
  };
}
