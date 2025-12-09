/**
 * Backward-compatibility shim.
 *
 * Older scripts and tooling referenced the project root `index.ts`. The
 * canonical entry point now lives under `src/index.ts`, so we simply import it
 * here to keep those legacy references working.
 */

import "./src/index.js";
