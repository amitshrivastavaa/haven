import { useEffect, useState } from "react";
import { g } from "./grenz-instance";

/**
 * The pitch.
 *
 * A judge, or anyone else, may land here knowing nothing. This says what the
 * problem is and what was built, and then gets out of the way.
 *
 * It is a view, not a page. The tools are registered on the document, not on
 * whatever is currently rendered, so an agent that connects while this is
 * showing already sees the whole governed surface — which is also the claim
 * being made, so the counter below reads the live registry rather than a
 * number typed into the copy.
 */

const STEPS = [
  ["Policy lookup", "Is this tool in the site's policy at all? Deny by default, so an unlisted tool stops here."],
  ["Annotation check", "Does the registration's readOnlyHint agree with how the site classifies the tool? If they disagree, one of them is lying and the call does not run."],
  ["Constraints", "Are the arguments inside the bounds the site set — 10–30°, at most 45 minutes?"],
  ["Rate limit", "Has it asked too many times, too fast?"],
  ["Approval", "If the rule says ask, the human is asked, with the exact arguments in front of them."],
  ["Execute", "Only now does the tool's own code run."],
];

export function Pitch({ onEnter }: { onEnter: () => void }) {
  const [tools, setTools] = useState(() => g.listTools());
  useEffect(() => g.subscribe(() => setTools(g.listTools())), []);
  const foreign = tools.filter((t) => t.foreign).length;

  return (
    <div className="pitch">
      <section className="pitch-hero">
        <p className="mono">Grenz for WebMCP</p>
        <h1>
          Every tool on this page is governed.
          <br />
          Including the ones we didn’t register.
        </h1>
        <p className="pitch-lead">
          WebMCP moves tool execution <em>into the page</em>, as the signed-in user. There is no
          server left to put a gateway in front of. So the control has to live where the execution
          lives — and the site is the only party that knows what its own tools actually do.
        </p>

        <div className="pitch-cta">
          <button className="enter" onClick={onEnter}>
            Open Haven, a house an agent can run →
          </button>
          <a className="pitch-repo" href="https://github.com/amitshrivastavaa/haven" target="_blank" rel="noreferrer">
            Read the source
          </a>
        </div>

        {/* Live, not typed into the copy: this is the claim, so it reads the
            registry the agent is actually looking at. */}
        <div className="proof">
          <span className="proof-dot" />
          <span>
            <b>{tools.length} tools</b> are registered on this page right now, and every one of them
            goes through the policy below.
            {foreign > 0 && (
              <>
                {" "}
                <b>{foreign}</b> {foreign === 1 ? "was" : "were"} put there by a script this site
                does not control — and {foreign === 1 ? "it is" : "they are"} governed too.
              </>
            )}
          </span>
        </div>
      </section>

      <section className="pitch-block">
        <h2 className="mono">The problem</h2>
        <blockquote>
          “There is no guarantee that a WebMCP tool’s declared intent matches its actual behavior…
          agents… cannot verify the tool’s actual effects before execution.”
          <cite>The WebMCP specification — which then declines to define mitigations</cite>
        </blockquote>
        <p>
          Site authors register tools. Agents invoke them. User agents <em>might</em> mediate.
          Nobody is obliged to authorize anything. In June 2026{" "}
          <span className="lit">arXiv:2606.06387</span> named the resulting attack class —
          Mid-Session Tool Injection, where a third-party script injects tools into a live session.
          It gave four design recommendations and shipped no implementation.
        </p>
        <p>
          This is that implementation, and it takes a position: <b>the site authorizes</b>. The
          agent reads a description, which can lie. The user sees a name. The browser has no
          semantics for <code>unlock_door</code>. The site author wrote the function.
        </p>
      </section>

      <section className="pitch-block">
        <h2 className="mono">One tag, before anything else</h2>
        <pre className="code">
          <span className="c-tag">&lt;script</span> <span className="c-attr">src</span>=
          <span className="c-str">"/grenz-install.js"</span>
          <span className="c-tag">&gt;&lt;/script&gt;</span>
        </pre>
        <p className="pitch-note">
          Zero runtime dependencies. It derives the prototype from the live{" "}
          <code>ModelContext</code> and patches <code>registerTool</code> there, so every tool —
          first-party or not — is wrapped before an agent can reach it. It ships as a classic
          script rather than a module for one reason: module scripts are always deferred, and an
          <code>import</code> would lose the race to any synchronous third-party tag below it.
        </p>
      </section>

      <section className="pitch-block">
        <h2 className="mono">What happens to every call</h2>
        {/* Numbered because it genuinely is a sequence: a denial at step one
            means steps two through six never run. */}
        <ol className="steps">
          {STEPS.map(([name, what], i) => (
            <li key={name}>
              <span className="step-n">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <b>{name}</b>
                <span>{what}</span>
              </div>
            </li>
          ))}
        </ol>
        <p className="pitch-note">
          A denial is not an opaque rejection. It resolves as structured data the agent can read and
          adapt to — a <code>reason</code> code, never a value drawn from the request — and every
          decision, registration included, lands in an audit trail you can open.
        </p>
      </section>

      <section className="pitch-block">
        <h2 className="mono">Why WebMCP makes it possible</h2>
        <ul className="whys">
          <li>
            <code>registerTool</code> lives on a real prototype, so it is interceptable at all.
          </li>
          <li>Return values are serialized, so a denial can be readable data rather than a throw.</li>
          <li>
            <code>options.signal</code> defines a tool’s lifetime, so unregistrations can be
            mirrored instead of leaking.
          </li>
          <li>
            <code>annotations</code> give the site something to check a tool’s self-description
            against — which is how EcoSaver gets caught.
          </li>
        </ul>
      </section>

      <section className="pitch-foot">
        <button className="enter" onClick={onEnter}>
          Open Haven →
        </button>
        <p>
          A smart home with a front door, an oven, an alarm and two third-party scripts that want
          more than they should.
        </p>
      </section>
    </div>
  );
}
