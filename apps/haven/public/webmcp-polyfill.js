/**
 * A minimal, clearly-labelled WebMCP stand-in for demoing and recording.
 *
 * INERT unless the page is loaded with ?polyfill=1. It exists so the demo can
 * be exercised — and filmed — in a browser without the WebMCP flag, and so the
 * approval flow can be tested end to end in CI-less headless Chrome.
 *
 * It is not a spec implementation and does not pretend to be one: the header
 * pill says "polyfill" whenever it is active. It implements only the surface
 * this demo uses: registerTool / getTools / executeTool and signal-based
 * removal. For a real polyfill with an agent attached, see @mcp-b/global.
 */
(function () {
  if (!new URLSearchParams(location.search).has("polyfill")) return;
  if (document.modelContext) return;

  class ModelContextPolyfill extends EventTarget {
    constructor() {
      super();
      this.tools = new Map();
    }
    async registerTool(tool, options) {
      if (!tool || typeof tool.name !== "string" || !tool.name)
        throw new TypeError("tool.name is required");
      if (!tool.description) throw new TypeError("tool.description is required");
      if (!/^[A-Za-z0-9_.-]{1,128}$/.test(tool.name))
        throw new TypeError("invalid tool name: " + tool.name);
      if (this.tools.has(tool.name)) throw new Error("duplicate tool: " + tool.name);

      this.tools.set(tool.name, tool);
      this.dispatchEvent(new Event("toolchange"));
      options?.signal?.addEventListener(
        "abort",
        () => {
          this.tools.delete(tool.name);
          this.dispatchEvent(new Event("toolchange"));
        },
        { once: true },
      );
    }
    async getTools() {
      return [...this.tools.values()];
    }
    async executeTool(tool, input) {
      const target = typeof tool === "string" ? this.tools.get(tool) : tool;
      if (!target) throw new Error("no such tool");
      const out = await target.execute(input ?? {}, { signal: new AbortController().signal });
      return JSON.stringify(out);
    }
  }

  document.modelContext = new ModelContextPolyfill();
  window.__grenzPolyfilled = true;
})();
