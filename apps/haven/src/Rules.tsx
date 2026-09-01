import { useState } from "react";
import type { ToolAction } from "grenz-webmcp";
import { RULE_COPY, rules, setRuleAction } from "./policy";

/**
 * The house rules, as a screen a resident owns.
 *
 * Three choices, never more. "Runs freely / Asks me first / Never" is the whole
 * vocabulary — everything the policy engine can express that does not fit those
 * three words is shown as a fixed limit, not offered as a knob. A rule you can
 * misconfigure into danger is worse than a rule you cannot see.
 */
const CHOICES: { action: ToolAction; label: string; cls: string }[] = [
  { action: "allow", label: "Runs freely", cls: "c-allow" },
  { action: "approve", label: "Asks me first", cls: "c-ask" },
  { action: "deny", label: "Never", cls: "c-never" },
];

export function Rules() {
  // The policy object is the source of truth and is read live by the pipeline;
  // this only forces a repaint after a tap.
  const [, bump] = useState(0);

  const groups = RULE_COPY.reduce<Record<string, typeof RULE_COPY>>((acc, r) => {
    (acc[r.group] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div className="rules">
      <div className="rules-intro">
        <h1>House rules</h1>
        <p>
          What your assistant may do on its own, what it has to ask you about, and what it can
          never do — whoever is asking. Changes apply to its very next request.
        </p>
      </div>

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
                      className={`choice ${c.cls} ${current === c.action ? "on" : ""}`}
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
        These are the site's rules, not the assistant's. It cannot read them, argue with them, or
        change them — it only ever learns it was refused, and why.
      </p>
    </div>
  );
}
