# assistant

AI chat for a Max/MSP patch. A `[jweb]` object renders the UI; a
`[node.script]` spawns the `claude` CLI and feeds it patch context via
MCP tools.

## Overview

The user types a question in the `[jweb]` chat. `assistant.ts` (running
in `[node.script]`) asks `[v8 bridge.js]` for the top-level patcher's
file path, reads the `.maxpat` JSON, writes a normalised snapshot to
`patch-context.json`, and spawns `claude --mcp-config .mcp.json`. Three
MCP tools (`get_patch_context`, `get_connections`, `get_object_docs`)
let the agent inspect the live patch and the Max reference pages. The
reply is sent back to `[jweb]` and appended to the chat.

## Features

- **Patch analysis** — full list of objects and connections, plus
  per-object inputs/outputs.
- **Max reference lookup** — MCP tool reads `*.maxref.xml` for any
  `maxclass`.
- **Session continuity** — subsequent prompts resume the same Claude
  session until `new chat`.
- **Typed protocol** — selector constants and JSON text codec in
  `src/types/protocol.ts`, imported by both Max-side and jweb-side.

## Installation

```bash
bun install
```

## Usage

Build both artifacts and open the patch in Max:

```bash
bun run build                 # build:agent + build:ui
open patchers/assistant.maxpat
```

Iterating on the UI without Max:

```bash
bun run dev:ui                # http://localhost:5173 (Bun static server)
```

## Scripts

| Command                 | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `bun run build`         | `build:agent && build:ui`                                   |
| `bun run build:agent`   | `src/assistant.ts` → `code/assistant.js` (node target)      |
| `bun run build:ui`      | `src/ui/app.ts` → `ui/app.js` (browser IIFE)                |
| `bun run dev`           | run `src/assistant.ts` directly (no bundle)                 |
| `bun run dev:ui`        | Bun static server over `ui/`                                |
| `bun run mcp`           | start the MCP server (normally spawned by `claude`)         |
| `bun run audit`         | typecheck + biome check + knip + `bun outdated`             |

## Tech Stack

- **Runtime**: Bun
- **Agent**: [Claude Code](https://claude.com/claude-code) CLI spawned as a subprocess
- **MCP tools**: `@modelcontextprotocol/sdk` + `zod` (patch introspection)
- **Max integration**: `max-api` (Node-for-Max), `[v8]`, `[jweb]`
- **UI**: vanilla TypeScript → browser IIFE, no framework

## Max ↔ jweb bridge

The chat UI is a static HTML page (`ui/index.html` + `ui/style.css` +
`ui/app.js`) loaded into a Max `[jweb]` object. `jweb` embeds Chromium
(CEF) — the page runs in a separate process with a modern V8 runtime,
full CSS, SVG, web fonts, and Chrome DevTools. The only channel between
the page and the Max patcher is the `window.max` object that Max injects
into the page.

`ui/app.js` is a **build artifact** — source is `src/ui/app.ts`, bundled
to an IIFE by `bun run build:ui`. Both sides import selector constants
and text codec from `src/types/protocol.ts`, so the protocol is a single
source of truth shared between Max (Node-for-Max) and the browser page.

### The `[jweb]` object

Declared in the `.maxpat` with `rendermode` only:

```
[jweb @rendermode 1]
```

- `@rendermode` — `0` offscreen (other Max objects can layer on top),
  `1` onscreen (page always on top, slightly faster).

Everything else is delivered as a message into the inlet:

- `url <address>` — load a page (`file://`, `http://127.0.0.1:…`, or
  remote).
- `back`, `reload` — navigation.

The URL is computed from `PROJECT_ROOT` in `src/assistant.ts` and sent
on startup, so the path is not hardcoded anywhere:

```ts
const UI_URL = `file://${join(PROJECT_ROOT, "ui", "index.html")}`;
Max.outlet("url", UI_URL);       // → [route bridge] right outlet → [jweb]
```

`[jweb]` is included in Presentation with its own `presentation_rect`,
and the patcher has `@openinpresentation 1` so opening the patch drops
straight into the chat.

### Max → jweb (receive in the page)

Register callbacks on load:

```js
window.max.bindInlet("status", (text) => { /* one atom */ });
window.max.bindInlet("addNumbers", (a, b) => { /* named args */ });
window.max.bindInlet("printLength", (...values) => { /* variadic */ });
```

On the Max side you send a regular message into the `jweb` inlet with the
selector as the first atom — e.g. `addNumbers 3 4`. Dispatch is async.

**Atom boundary caveat.** Max passes data as atoms. Long strings with
spaces may arrive as multiple arguments (`"hello world"` → `["hello", "world"]`).
For text payloads this project wraps the body in JSON on the Max side and
reassembles on the jweb side:

```ts
// src/assistant.ts
Max.outlet("appendAssistant", JSON.stringify({ text: "line one\nline two" }));
```

```js
// ui/app.js
function unwrapText(args) {
  const joined = args.map(String).join(" ");
  try { return JSON.parse(joined).text; } catch { return joined; }
}
```

### jweb → Max (send from the page)

```js
window.max.outlet("prompt", "how does cycle~ work?");
window.max.outlet("clear");
window.max.outlet.apply(window.max, ["list"].concat([1, 2, 3]));
```

Anchor-tag shortcut (no JS required):

```html
<a href="maxmessage:name/arg1/arg2">send</a>
<!-- outputs: maxmessage name arg1 arg2 -->
```

**All `outlet` calls land on the Max low-priority queue.** Fine for UI
events; do not rely on `jweb` for sample-accurate or scheduler-thread
timing. Keep audio/timing logic in the patcher.

### Shared state via `Dict`

For structured payloads larger than what message atoms conveniently carry:

```js
window.max.getDict("name", (dict) => { /* plain JS object */ });
window.max.setDict("name", { a: 1, b: 2 });
```

### Protocol used in this project

| Direction   | Selector          | Payload                                  |
| ----------- | ----------------- | ---------------------------------------- |
| jweb → Max  | `prompt <text>`   | user pressed Enter                       |
| jweb → Max  | `clear`           | user clicked "new chat"                  |
| Max → jweb  | `appendAssistant` | `{"text":"…"}` — assistant reply         |
| Max → jweb  | `appendError`     | `{"text":"…"}` — error line              |
| Max → jweb  | `status`          | `{"text":"…"}` — status-bar content      |
| Max → jweb  | `busy <0\|1>`     | lock/unlock input + show progress        |
| Max → jweb  | `clearChat`       | wipe the log                             |

In the patch the routing is:

```
[jweb] ──► [route prompt clear] ──► [prepend prompt] / [message clear]
                                            │
                                            ▼
                             [node.script assistant.js]
                                            │
                                            ▼
                                   [route bridge]
                                     │          │
                                     ▼          ▼
                             [v8 bridge.js]   [jweb]    ← everything that
                                                         isn't "bridge"
```

### DevTools

Max **Preferences → Jweb → Remote Debugging Port = 9229**, restart Max,
then open `chrome://inspect/#devices` in Chrome and click **inspect** on
the listed page. Full DevTools — Console, breakpoints, Network,
Elements — are available against the live `jweb` page.

### Hot-reload

- `code/assistant.js` — reloaded by `[node.script @watch 1]` on change.
- `javascript/bridge.js` — reloaded by `[v8]` (`autowatch: 1`).
- `ui/app.js` and `ui/index.html` — reloaded by sending `[reload]` into
  the `[jweb]` inlet, or by pressing Cmd-R in DevTools attached via
  port 9229.

### Docs pointer

`window.max` is documented in `docs/Max9-UserGuide-en.pdf` pp. 602-609
(Patching / Web Browser and jweb). The separate `Max9-JS-API-en.pdf`
covers `[js]` / `[v8]` / `[jsui]` — a different runtime; its `Max`
classes are not available inside `jweb`.

