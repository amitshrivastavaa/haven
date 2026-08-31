import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// Deliberately not wrapped in <StrictMode>: its double-invoked effects would
// register every tool twice, and the audit timeline — the thing this demo is
// about — would open with six duplicate rows. The tools themselves are
// StrictMode-safe (useGrenzTool unregisters via AbortController); this is a
// presentation choice, not a correctness workaround.
createRoot(document.getElementById("root")!).render(<App />);
