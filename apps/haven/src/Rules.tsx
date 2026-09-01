import { useEffect } from "react";
import type { ToolAction } from "grenz-webmcp";
import { RULE_COPY, rules } from "./policy";

/**
 * The house rules, as a screen a resident reads.
 *
 * Read-only, deliberately. These rules ARE the authorization boundary, so a
 * control that edits them is a second way to authorize — a weaker one, needing
 * only a click. Everything that can reach the mouse can reach that click:
 * exactly the party the strong path exists to stop. An agent that cannot unlock
 * the door must not be able to delete the rule that stops it, so relaxing a
 * rule is not something this page can do at any price.
 *
 * The rules come from the site's source, where they are reviewed and deployed,
 * which is the only place a claim about what a tool does can honestly be made.
 * A settings screen that could overrule that would make the claim worth nothing.
 *
 * Three states, never more. "Runs freely / Asks me first / Never" is the whole
 * vocabulary — everything else the policy engine expresses is shown as a fixed
 * limit beside the rule.
 */
const STATE: Record<ToolAction, { label: string; cls: string }> = {
  allow: { label: "Runs freely", cls: "c-allow" },
  approve: { label: "Asks me first", cls: "c-ask" },
  deny: { label: "Never", cls: "c-never" },
};

export function Rules({ onClose }: { onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups = RULE_COPY.reduce<Record<string, typeof RULE_COPY>>((acc, r) => {
    (acc[r.group] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="sheet-veil" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="House rules"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <h1>House rules</h1>
            <p>
              What your assistant may do on its own, what it has to ask you about, and what it can
              never do — whoever is asking.
            </p>
          </div>
          {/* "Done" rather than an ✕: this is a thing you finish reading, not a
              dialog you dismiss. The accessible name is the visible text. */}
          <button className="sheet-close" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="sheet-body">
          {Object.entries(groups).map(([group, items]) => (
            <section key={group} className="rules-group">
              <h2>{group}</h2>
              {items.map((r) => {
                const state = STATE[rules[r.tool]?.action ?? "deny"];
                return (
                  <div key={r.tool} className="rule">
                    <div className="rule-what">
                      <span className="rule-title">{r.what}</span>
                      <span className="rule-sub">
                        <code>{r.tool}</code>
                        {r.limit ? ` · ${r.limit}` : ""}
                      </span>
                    </div>
                    <span className={`rule-state ${state.cls}`}>{state.label}</span>
                  </div>
                );
              })}
            </section>
          ))}

          <p className="rules-foot">
            These are the site's rules, and nothing on this page can change them — not you, not
            your assistant, not a script sharing the page. They ship with Haven and are read fresh
            on every call. Your assistant never sees them: it only ever learns it was refused,
            and why.
          </p>
        </div>
      </div>
    </div>
  );
}
