# assistant

AI chat for a Max/MSP patch. A `[jweb]` object renders the UI; a
`[node.script]` spawns the `claude` CLI and feeds it patch context via
MCP tools.

## Overview

The project has two halves:

- **Max side** — `patchers/assistant.maxpat` (open via `max_assistant.maxproj`).
  `[node.script assistant.js]` runs a local HTTP bridge and the chat;
  `[v8 bridge.js]` executes patch commands against the live patcher.
- **MCP server** — `code/mcp-server.js` exposes the patch-building tools.
  Any MCP client can use it: the chat inside Max (spawns the `claude` CLI),
  Claude Desktop, Claude Code, etc. The rules for using the tools are sent
  as MCP server `instructions`, so every client gets them.

```
 Claude (Max chat / Desktop / Code)
        │ stdio (MCP)
        ▼
 code/mcp-server.js ──HTTP 127.0.0.1 (.bridge.json: port+token)──►
        [node.script assistant.js] ──`command <json>`──► [v8 bridge.js] ──► live patcher
                                   ◄─`bridgeResult <json>`──
```

Nothing is saved to disk and nothing polls: commands are request/response
messages, and the patch is read live (`Patcher.apply` + `Maxobj.patchcords`).

### Which patch gets edited

- Assistant opened on its own (`assistant.maxpat` window): the most recently
  focused **other** patcher window. Click your patch, then the chat. With no
  other window open, the first mutation opens a new "assistant work" patcher.
- Assistant embedded in your patch (as a `bpatcher`/abstraction): that patch.
  The box hosting the assistant is hidden from the agent and can't be
  deleted or connected by it.

## Features

- **Live patch context** — objects, stable ids (`varname` or `obj-<n>`),
  connections; no auto-save.
- **Object search** — `search_objects` finds objects by what they do
  (index over all `*.maxref.xml`).
- **Reference + help lookup** — `get_object_docs`, `get_object_help`.
- **Patch editing** — `create_object`, `create_patch_fragment` (many objects
  + cords in one call, auto-layout), `connect_objects`, `delete_object`.
- **Self-checks** — every result carries `warnings`: signal feedback loops
  without a delay ("infinite recursion") and invalid (`jbogus`) objects.
- **Session continuity** in the Max chat until `new chat`.

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

### Use from Claude Desktop / Claude Code

Max must be running with `max_assistant.maxproj` open (that starts the bridge).

Claude Desktop — `~/Library/Application Support/Claude/claude_desktop_config.json`
(use the absolute path to `bun`, Desktop doesn't inherit your shell PATH):

```json
{
  "mcpServers": {
    "max-msp": {
      "command": "/Users/<you>/.bun/bin/bun",
      "args": ["/path/to/max_assistant/code/mcp-server.js"]
    }
  }
}
```

Claude Code:

```bash
claude mcp add max-msp -- bun /path/to/max_assistant/code/mcp-server.js
```

## Scripts

| Command                 | Purpose                                                     |
| ----------------------- | ----------------------------------------------------------- |
| `bun run build`         | `build:agent && build:mcp && build:ui`                      |
| `bun run build:agent`   | `src/assistant.ts` → `code/assistant.js` (node target)      |
| `bun run build:mcp`     | `src/mcp-server.ts` → `code/mcp-server.js` (bun target)     |
| `bun run build:ui`      | `src/ui/app.ts` → `ui/app.js` (browser IIFE)                |
| `bun run dev`           | run `src/assistant.ts` directly (no bundle)                 |
| `bun run dev:ui`        | Bun static server over `ui/`                                |
| `bun run mcp`           | start the MCP server (normally spawned by `claude`)         |
| `bun run audit`         | typecheck + biome check + knip + `bun outdated`             |

## Tech Stack

- **Runtime**: Bun
- **Agent**: [Claude Code](https://claude.com/claude-code) CLI spawned as a subprocess
- **MCP tools**: `@modelcontextprotocol/sdk` + `zod`
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
                                   │                     isn't "bridge"
                                   └──► bridgeResult ──► [node.script]
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

## Project layout

```
src/
  assistant.ts          [node.script] entry: chat, spawns claude, runs the bridge
  bridge-server.ts      local HTTP endpoint → `command` to [v8], awaits `bridgeResult`
  bridge-client.ts      used by the MCP server to call the bridge (.bridge.json)
  mcp-server.ts         MCP tools + instructions (stdio)
  object-index.ts       search index over *.maxref.xml
  layout.ts             auto-layout for create_patch_fragment
  patch-checks.ts       warnings: signal feedback loops, jbogus objects
  parse-object-text.ts  "cycle~ 440" → { classname, args }
  types/
    max.ts              PatchContext, RawMaxpat + convertMaxpat (help patches)
    protocol.ts         Max ↔ jweb selectors and JSON text codec
  ui/app.ts             jweb entry
scripts/ui-server.ts    Bun static server for UI (port 5173)
code/
  assistant.js          build artifact — loaded by [node.script]
  mcp-server.js         build artifact — MCP server for any client
javascript/bridge.js    [v8]: target-patcher choice, live snapshot, commands
ui/                     index.html, style.css, app.js (build artifact)
patchers/assistant.maxpat
max_assistant.maxproj   open this in Max
docs/                   Max 9 PDF reference
.mcp.json               MCP config for the claude CLI spawned by the chat
.bridge.json            runtime: bridge port + token (gitignored)
```

`code/*.js` and `ui/app.js` are build artifacts tracked in git so Max loads
them without a build step. Edit `src/` and run `bun run build`.

## Request flow (chat inside Max)

1. `[jweb]` → `prompt <text>` → `assistant.ts` spawns
   `claude --print --mcp-config .mcp.json --strict-mcp-config --session-id|--resume`.
2. Claude calls MCP tools; each tool POSTs to the bridge
   (`127.0.0.1:<port>/command`, header `x-bridge-token`).
3. `assistant.ts` forwards `command <json>` to `[v8]`; `bridge.js` picks the
   target patcher, runs the command, replies `bridgeResult <json>` (mutations
   include a fresh snapshot, which the MCP server turns into `warnings`).
4. The final answer goes to `[jweb]` as `appendAssistant`.

`new chat` resets the Claude session and the bridge's target/id registry.

## MCP tools

| Tool | Purpose |
| ---- | ------- |
| `get_patch_context` | live patch: `patch` title, boxes, lines, warnings |
| `get_object_connections(id)` | inputs/outputs of one object |
| `search_objects(query)` | find objects by functionality |
| `get_object_docs(maxclass)` | reference page (`*.maxref.xml`) |
| `get_object_help(maxclass)` | help patch as boxes/lines |
| `create_object(text,x,y)` | one object |
| `create_patch_fragment(objects, connections)` | many objects + cords, auto-layout |
| `connect_objects` / `delete_object` | patchcords / removal |

## Documentation (`docs/`)

| File | Contents | When to use |
| ---- | -------- | ----------- |
| `Max9-UserGuide-en.pdf` | Full Max 9 guide | UI, patching, objects, **jweb API**, Presentation Mode |
| `Max9-JS-API-en.pdf` | JS API for `[js]` / `[jsui]` / `[v8]` | Code inside Max `js`, `jsui`, `v8`, `v8.codebox` objects |
| `Max9-NodeForMax-API-en.pdf` | Node for Max (`max-api`) | Node.js ↔ Max communication (`Max.outlet`, handlers) |
| `Max9-LOM-en.pdf` | Live Object Model | Working with Ableton Live via Max for Live |

Read PDFs with the `Read` tool and `pages: "1-20"` (20-page maximum per call).

## Bun runtime

Use Bun commands instead of Node equivalents:

- `bun <file>` instead of `node` / `ts-node`
- `bun install` / `bun run <script>` / `bunx <pkg>`
- `bun test` instead of jest / vitest
- `.env` is loaded automatically — no dotenv needed

Preferred Bun APIs:

- `Bun.serve()` instead of express
- `bun:sqlite` instead of better-sqlite3
- `Bun.file` instead of `node:fs` readFile / writeFile
- `WebSocket` built-in — no `ws` package needed
- `` Bun.$`cmd` `` instead of execa

