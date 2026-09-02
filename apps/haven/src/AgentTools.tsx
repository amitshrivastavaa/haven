import { useEffect, useState } from "react";
import { presenceAvailable } from "grenz-webmcp";
import type { GrenzInstance, ToolAction } from "grenz-webmcp";
import { rules } from "./policy";

/**
 * What an agent can see, and what the house will let it do about it.
 *
 * A reference, not a console — the Simulator is the console and sits one
 * button away. The reason both exist is that they answer different questions:
 * the Simulator answers "what happens if I call this", and there was nothing
 * on the site answering "what is here, and what may it do", which is the
 * question someone asks before they have decided to try anything.
 *
 * Every row is read from two live sources and composes nothing of its own. The
 * name, description and annotations come from Grenz's registry — so a tool a
 * third-party script registered a moment ago appears here, described in its own
 * words, with no code change. The verdict comes from `rules`, the same object
 * the pipeline reads on every call. Neither can drift from what actually
 * happens, because there is no third copy to keep in sync.
 *
 * The vocabulary is deliberately the House rules screen's vocabulary — "Runs
 * freely / Asks me first / Never" — and not a second one that means the same
 * thing. Two words for one state is how a page starts lying slowly.
 */
const STATE: Record<ToolAction, { label: string; cls: string }> = {
  allow: { label: "Runs freely", cls: "c-allow" },
  approve: { label: "Asks me first", cls: "c-ask" },
  deny: { label: "Never", cls: "c-never" },
};

/**
 * What to say to an assistant that is actually attached.
 *
 * The third one is the point of the list. An agent asking for 45° is refused by
 * the site's own bounds and told why, in a sentence it can read — so watching a
 * model take the refusal and explain the limit back to you is the whole
 * argument, performed by something nobody here scripted.
 */
const PROMPTS: { say: string; then: string }[] = [
  { say: "What's the state of my house?", then: "A read. Runs immediately, nothing to approve." },
  { say: "Turn on the kitchen light.", then: "A write the rules allow — and capped at 8 calls a minute." },
  { say: "Set the thermostat to 45.", then: "Refused: the house allows 10–30°. Watch it read the refusal rather than error." },
  { say: "Unlock the front door.", then: "Stops here and asks you, on this page, with a passkey." },
];

export function AgentTools({
  g,
  webmcp,
  onAsk,
  onSimulator,
  onClose,
}: {
  g: GrenzInstance;
  webmcp: boolean;
  /** Puts a prompt in the page's own assistant box, for visitors with no agent. */
  onAsk: (text: string) => void;
  onSimulator: () => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Live, not a snapshot. A script can register while this is open — that is
  // the case the panel exists to make visible, and a list that froze on mount
  // would be showing the state of the page before the interesting thing
  // happened.
  const [tools, setTools] = useState(() => g.listTools());
  useEffect(() => g.subscribe(() => setTools(g.listTools())), [g]);
  const governed = g.isTakeoverInstalled();

  // Asked, not assumed. Two of these tools ask for a passkey, and whether this
  // browser can supply one is a property of the browser — in an embedded
  // webview it often cannot. Reporting it here means nobody has to unlock a
  // door to find out, and the answer is the browser's, through the same call
  // the approval card makes.
  const [passkey, setPasskey] = useState<boolean | null>(null);
  useEffect(() => {
    let live = true;
    void presenceAvailable().then((ok) => live && setPasskey(ok));
    return () => {
      live = false;
    };
  }, []);

  return (
    <div className="sheet-veil" onClick={onClose}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label="Agent tools"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sheet-head">
          <div>
            <h1>Agent tools</h1>
            <p>
              The {tools.length} functions this page hands an assistant, and what Haven's rules say
              about each. Registered with WebMCP: they exist in your browser, in your session, and
              nowhere else.
            </p>
          </div>
          <button className="sheet-close" onClick={onClose}>
            Done
          </button>
        </div>

        <div className="sheet-body">
          {/* Three states, and the third is the awkward one. A page that only
              says "connected" when the interception is missing is the failure
              this panel would be most likely to hide.

              This used to be a red banner across the front page. It was the
              right fact in the wrong place: a full-width danger stripe on
              first load reads as "this site is broken" to someone who has not
              read a word yet, and it said the same thing twice once this panel
              existed. It is not softened here — the sentence is unchanged and
              the descriptors are one toggle away — it is filed under the
              heading it belongs to. The header still carries "registerTool
              sealed" on every screen, so nothing about it is discoverable only
              by opening this. */}
          <div className={`at-status ${webmcp ? (governed ? "ok" : "part") : "off"}`}>
            <b>
              {!webmcp
                ? "No assistant is connected to this page"
                : governed
                  ? "An assistant is connected, and every registration is governed"
                  : "An assistant is connected; this browser sealed registerTool"}
            </b>
            <span>
              {!webmcp
                ? "Everything below is registered and governed anyway — the box on the home screen goes through the identical pipeline, so you can try any of it without one."
                : governed
                  ? "Grenz owns the registration surface, so a tool added by any script on this page arrives here too, and under the same rules."
                  : "This browser makes document.modelContext and the object it holds unwritable, so no script on the page can claim registerTool — Grenz included. Haven's own tools and any injected form are still governed. What is lost is intercepting a third-party script's own registerTool call."}
            </span>
            {/* The exception and the property descriptor that caused it, for
                the one reader who wants to check the claim rather than take
                it. Behind the same technical-detail switch as everything else
                of its kind, because it is the browser's words, not ours. */}
            {webmcp && !governed && (
              <ul className="why-blocked">
                {g.takeoverDiagnosis().map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            )}
            {passkey !== null && (
              <span className="at-passkey">
                {passkey
                  ? "This browser can prove a person is present with a passkey, so the two approvals that ask for one get the strong check."
                  : "No passkey authenticator in this browser. The two approvals that ask for one still stop and ask you — a real click carries them on its own, and the timeline records that the weaker check was used."}
              </span>
            )}
          </div>

          <section className="at-grid">
            {tools.map((t) => {
              const rule = rules[t.name];
              const state = STATE[rule?.action ?? "deny"];
              const readOnly = t.annotations?.readOnlyHint === true;
              return (
                <div key={t.name} className="at-tool">
                  <div className="at-tool-top">
                    <code>{t.name}</code>
                    <span className={`at-verdict ${state.cls}`}>{state.label}</span>
                  </div>
                  <b>{t.title || t.name}</b>
                  <p>{t.description}</p>
                  <div className="at-tags">
                    <span>{readOnly ? "read" : "write"}</span>
                    {rule?.presence && <span>needs a passkey</span>}
                    {rule?.rateLimit && (
                      <span>
                        {rule.rateLimit.calls} per {rule.rateLimit.per}
                      </span>
                    )}
                    {t.annotations?.untrustedContentHint && <span>returns others' words</span>}
                    {/* Not decoration. A tool nobody at Haven wrote is the case
                        the whole library is for, so it is named on the row
                        rather than looking like part of the house. */}
                    {t.foreign && <span className="at-foreign">added by a script on this page</span>}
                  </div>
                </div>
              );
            })}
          </section>

          <section className="at-ask">
            <h2>Try asking</h2>
            {PROMPTS.map((p) => (
              <button key={p.say} className="at-prompt" onClick={() => onAsk(p.say)}>
                <b>“{p.say}”</b>
                <span>{p.then}</span>
              </button>
            ))}
            <p className="at-note">
              {webmcp
                ? "Say these to your assistant. Clicking one asks the page's own stand-in instead, through the same rules."
                : "Clicking one asks the page's own stand-in, which goes through the same rules a real assistant would meet."}
            </p>
          </section>

          <div className="at-foot">
            <div>
              <b>Want to call one directly?</b>
              <span>
                The simulator builds each tool's arguments from its schema and shows the exact JSON
                an agent would send — including values the rules will refuse.
              </span>
            </div>
            <button className="at-sim" onClick={onSimulator}>
              Open the simulator
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
