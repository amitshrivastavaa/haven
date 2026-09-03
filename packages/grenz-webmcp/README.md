# grenz-webmcp

A deny-by-default policy layer for [WebMCP](https://webmachinelearning.github.io/webmcp/).
Every tool an agent can reach on your page goes through it first: tools you
register, and tools any other script on the page registers straight at the
platform API.

- **Deny by default.** A tool the policy does not name cannot run.
- **Human approval.** `action: "approve"` puts an in-page card in front of a
  person, with the effect spelled out in plain words. The click that approves
  must be a real one, and a policy can require a passkey on top of it.
- **Constraints and rate limits.** Enum, range and required-argument checks,
  and per-tool call limits, evaluated before the tool runs.
- **Audit timeline.** Every decision is recorded with a reason code, and the
  timeline can be mounted on the page.
- **Zero runtime dependencies.**

Live demo, in ChatGPT's browser or Chrome with WebMCP enabled:
[grenz-webmcp.netlify.app](https://grenz-webmcp.netlify.app). The full design
notes are in the [repository README](https://github.com/amitshrivastavaa/haven#readme).

## Install

```bash
npm i grenz-webmcp
```

Load the takeover **first**, before any third-party script, as a classic
script. It owns `registerTool` at the prototype from that point on:

```html
<script src="/node_modules/grenz-webmcp/dist/grenz-install.js"></script>
```

## Use

```ts
import { grenz } from "grenz-webmcp";

const g = grenz({
  defaultAction: "deny", // anything not named here cannot run
  tools: {
    get_house_state: { action: "allow" },
    toggle_light: { action: "allow", rateLimit: { calls: 8, per: "minute" } },
    lock_door: { action: "allow" },
    unlock_door: {
      action: "approve", // ask a human, every time
      effect: "Unlocks your front door. Anyone outside can walk in.",
      constraints: { doorId: { required: true, enum: ["front", "back"] } },
    },
    grant_permanent_access: { action: "deny" }, // not a decision an agent gets to raise
  },
});

await g.registerTool({ name, description, inputSchema, execute, annotations });
g.mountTimeline(document.querySelector("#audit"));
```

A tool registered by anyone else on the page lands in the same policy:

```ts
document.modelContext.registerTool({ name: "get_house_state", description: "…", inputSchema, execute });
```

React:

```tsx
import { GrenzTimeline, useGrenzTool } from "grenz-webmcp/react";

useGrenzTool(g, { name: "get_house_state", description: "…", execute });
<GrenzTimeline g={g} />;
```

## License

MIT
