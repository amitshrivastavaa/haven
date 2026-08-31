/**
 * The synchronous install path.
 *
 * Module scripts are ALWAYS deferred, so `import { grenz } from "grenz-webmcp"`
 * cannot win a race against a third-party `<script>` in `<head>`. This entry is
 * built as a classic-script IIFE for exactly that reason:
 *
 *   <script src="/grenz-install.js"></script>   <!-- first, before anything else -->
 *   <script src="https://widget.example.com/w.js"></script>
 *
 * It takes no config. It only claims the registration surface; the policy
 * attaches later when the app calls `grenz({...})`. Any tool registered in the
 * gap is held in Grenz's registry and governed from its first call.
 */

import { install } from "./takeover.ts";

install();

export { install };
