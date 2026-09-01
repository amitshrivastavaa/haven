# Related work

Split out of the [README](README.md) so that document stays about what the
project is and how to run it.

The survey covers the WebMCP ecosystem as of August 2026 — npm (every package
matching `webmcp`), the top 100 GitHub repositories, and three independently
curated `awesome-webmcp` lists — followed by the open spec questions this
project takes a position on. The threat is documented in four places; runtime
enforcement of it is largely absent.

**[@absolutejs/webmcp](https://www.npmjs.com/package/@absolutejs/webmcp)** is the
closest existing work and deserves credit: default-deny authorization, TypeBox
input validation, metadata-poisoning checks, bounded payloads, and audit
receipts. It is a different architecture, not a competing implementation of the
same one:

| | @absolutejs/webmcp | Grenz for WebMCP |
| --- | --- | --- |
| Third-party registrations | Not seen — it is an opt-in wrapper you call *instead of* `registerTool`; the source contains no interception | Governed — the prototype takeover means a script that never heard of Grenz is still wrapped |
| The human | No UI in the package; `authorize` is a programmatic callback, and `"approval-required"` is an outcome the app must render itself | A shadow-DOM card showing the site's consequence, the agent's actual arguments, and a countdown that denies by default |
| Audit | `onAudit` callback carrying an `inputHash` | An on-page timeline the user can read, with real arguments and results |
| Authorization boundary | *"The HTTP server remains the authorization and audit boundary"* | The page, because on WebMCP the call never reaches a server |
| Metadata poisoning | `metadataPolicy`, `maxDescriptionLength` — **ahead of Grenz here** | Only `readOnlyHint` contradiction; description scanning is future work |

**Everything else in the ecosystem is advice or observation, not enforcement:**

- [MCP-B's security best practices](https://docs.mcp-b.ai/security) — by a WebMCP
  co-author — states the requirement precisely and leaves it open: browser
  mediation *"do[es] not authorize a call or guarantee confirmation"*, so
  *"the application validates input, authorizes the current user, and requires
  human review when the consequence warrants it."* It recommends
  consequence-based confirmation tiers and provides no mechanism. It does not
  address third-party scripts registering tools on the same page.
- [`@mcp-b/global`](https://www.npmjs.com/package/@mcp-b/global) v5.1.0, the
  runtime most sites build on — polyfill, transports, testing. No policy surface.
- Tool inspectors ([model-context-tool-inspector](https://github.com/beaufortfrancois/model-context-tool-inspector),
  WebMCP DevTools) — developer-side observation, extension-hosted, no enforcement.
- Server-side MCP gateways (FastMCP approval, TrueFoundry, Invariant Labs) — a
  mature space that cannot apply here: a gateway needs a network path between
  agent and server, and WebMCP has none.

**Open questions in the spec this project takes a position on:**

- [Issue #53 — semantic hints for side-effects](https://github.com/webmachinelearning/webmcp/issues/53)
  (open): annotations are self-declared and unverified. Grenz checks them against
  the site's own classification and denies contradictions.
- [Issue #45 — prompt injection](https://github.com/webmachinelearning/webmcp/issues/45)
  and the [official threat model](https://github.com/webmachinelearning/webmcp/blob/main/docs/security-privacy.md),
  which names *"Misrepresentation — tools whose behavior doesn't match their
  description."*
- [Issue #21 — elicitation](https://github.com/webmachinelearning/webmcp/issues/21)
  (closed): a way for the **agent** to request user input *"if the agent
  determines that their input is needed."* Agent-initiated and discretionary — a
  tool that wants to avoid the human simply never elicits. Grenz's card is
  site-initiated and not the tool's decision to make.
