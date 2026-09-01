import { useEffect, useState } from "react";
import type { ToolAction } from "grenz-webmcp";
import { RULE_COPY, rules, setRuleAction } from "./policy";

/**
 * The house rules, as a screen a resident owns.
 *
 * Three choices, never more. "Runs freely / Asks me first / Never" is the whole
 * vocabulary — everything the policy engine can express that does not fit those
 * three words is shown as a fixed limit, not offered as a knob. A rule you can
 * misconfigure into danger is worse than a rule you cannot see.
 *
 * The rules object is read live on every call, so a tap here changes what the
 * assistant may do on its very next request. Nothing is staged or saved.
 */
const CHOICES: { action: ToolAction; label: string; cls: string }[] = [
  { action: "allow", label: "Runs freely", cls: "c-allow" },
  { action: "approve", label: "Asks me first", cls: "c-ask" },
  { action: "deny", label: "Never", cls: "c-never" },
];

export function Rules({ onClose }: { onClose: () => void }) {
  // The policy object is the source of truth; this only forces a repaint.
  const [, bump] = useState(0);

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
              never do — whoever is asking. Changes apply to its very next request.
            </p>
          </div>
          <button className="sheet-close" onClick={onClose} aria-label="Close">
            Done
          </button>
        </div>

        <div className="sheet-body">
          {Object.entries(groups).map(([group, items]) => (
            <section key={group} className="rules-group">
              <h2>{group}</h2>
              {items.map((r) => {
                const current = rules[r.tool]?.action;
                return (
                  <div key={r.tool} className="rule">
                    <div className="rule-what">
                      <span className="rule-title">{r.what}</span>
                      <span className="rule-sub">
                        <code>{r.tool}</code>
                        {r.limit ? ` · ${r.limit}` : ""}
                      </span>
                    </div>
                    <div className="rule-choice" role="group" aria-label={r.what}>
                      {CHOICES.map((c) => (
                        <button
                          key={c.action}
                          className={`choice ${c.cls}`}
                          aria-pressed={current === c.action}
                          onClick={() => {
                            setRuleAction(r.tool, c.action);
                            bump((n) => n + 1);
                          }}
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          ))}

          <p className="rules-foot">
            These are the site's rules, not the assistant's. It cannot read them, argue with them,
            or change them — it only ever learns it was refused, and why.
          </p>
        </div>
      </div>
    </div>
  );
}
