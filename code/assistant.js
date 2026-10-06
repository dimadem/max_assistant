// src/assistant.ts
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, writeFileSync as writeFileSync2 } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Max from "max-api";

// src/patch-context.ts
import { writeFileSync } from "node:fs";
function parseContext(json) {
  const ctx = JSON.parse(json);
  if (!Array.isArray(ctx.boxes) || !Array.isArray(ctx.lines)) {
    throw new Error("bridge sent malformed context (missing boxes/lines)");
  }
  return { patch: ctx.patch, boxes: ctx.boxes, lines: ctx.lines };
}
function writeContext(json, contextPath) {
  const ctx = parseContext(json);
  writeFileSync(contextPath, JSON.stringify(ctx, null, 2));
  return ctx;
}

// src/types/protocol.ts
var UI_IN = {
  appendUser: "appendUser",
  appendAssistant: "appendAssistant",
  appendSystem: "appendSystem",
  appendError: "appendError",
  status: "status",
  busy: "busy",
  clearChat: "clearChat"
};
var encodeText = (text) => JSON.stringify({ text });

// src/assistant.ts
var scriptDir = dirname(fileURLToPath(import.meta.url));
var PROJECT_ROOT = join(scriptDir, "..");
var contextFile = join(PROJECT_ROOT, "patch-context.json");
var COMMANDS_FILE = join(PROJECT_ROOT, "commands.ndjson");
var RESULTS_FILE = join(PROJECT_ROOT, "command-results.ndjson");
var MCP_CONFIG = join(PROJECT_ROOT, ".mcp.json");
var UI_URL = `file://${join(PROJECT_ROOT, "ui", "index.html")}`;
var pendingPrompts = [];
var currentSessionId = null;
var SYSTEM_PROMPT = [
  "You are an expert Max/MSP assistant embedded inside a live Max patch.",
  "Use the provided MCP tools to inspect and modify the current patch:",
  "  • get_patch_context       — full list of objects and connections",
  "  • get_object_connections  — inputs/outputs for a specific object by id",
  "  • search_objects          — find objects by what they do when you don't know the name (search first, then read docs)",
  "  • get_object_docs         — Max reference docs (inlets, outlets, messages, attributes) for any object type",
  "  • get_object_help         — working example patch (.maxhelp) for an object type",
  "  • create_object           — create a new Max object at (x,y) with full Box.text",
  "  • connect_objects         — connect srcId.outlet → dstId.inlet (ids from get_patch_context)",
  "  • delete_object           — delete an existing object by id (also removes its patchcords)",
  "You edit the user's WORK patch (its window title is in get_patch_context → patch), never the assistant's own patch.",
  "Never guess object modes, attribute names or argument meanings — confirm them with get_object_docs before using them.",
  "Max/MSP conventions to keep in mind:",
  "  • Signal objects end with ~ (cycle~, dac~, selector~, etc.)",
  "  • Data flows left-to-right through inlets/outlets",
  "  • 'maxclass' is the object type; 'text' is the full typed argument string",
  "  • Connections are indexed: outlet 0 is leftmost, inlet 0 is leftmost",
  "After any mutation tool, the patch-context is refreshed automatically; call get_patch_context again only if you need updated ids.",
  "Be concise. When referencing objects use their text or id."
].join(" ");
var extraPaths = [
  `${process.env.HOME}/.local/bin`,
  `${process.env.HOME}/.bun/bin`,
  "/opt/homebrew/bin",
  "/usr/local/bin",
  "/usr/bin",
  "/bin"
];
var ENRICHED_PATH = [...extraPaths, process.env.PATH ?? ""].join(":");
function shortToolName(name) {
  const parts = name.split("__");
  return parts[parts.length - 1] ?? name;
}
function sendText(selector, text) {
  Max.outlet(selector, encodeText(text));
}
function setBusy(on) {
  Max.outlet(UI_IN.busy, on ? 1 : 0);
}
function setStatus(text) {
  sendText(UI_IN.status, text);
}
function spawnClaude(prompt) {
  const args = [
    "--print",
    prompt,
    "--permission-mode",
    "bypassPermissions",
    "--mcp-config",
    MCP_CONFIG,
    "--strict-mcp-config",
    "--output-format",
    "stream-json",
    "--verbose",
    "--append-system-prompt",
    SYSTEM_PROMPT
  ];
  if (currentSessionId) {
    args.push("--resume", currentSessionId);
    Max.post(`Running claude (resume ${currentSessionId.slice(0, 8)}…)`);
  } else {
    currentSessionId = randomUUID();
    args.push("--session-id", currentSessionId);
    Max.post(`Running claude (new session ${currentSessionId.slice(0, 8)}…)`);
  }
  const child = spawn("claude", args, {
    cwd: PROJECT_ROOT,
    env: { ...process.env, PATH: ENRICHED_PATH }
  });
  child.stdin.end();
  let stdoutBuffer = "";
  const handleEvent = (ev) => {
    switch (ev.type) {
      case "assistant": {
        const toolUse = ev.message.content.find((c) => c.type === "tool_use");
        if (toolUse) {
          setStatus(`claude · ${shortToolName(toolUse.name)}`);
          return;
        }
        if (ev.message.content.some((c) => c.type === "text")) {
          setStatus("claude · writing…");
        }
        return;
      }
      case "result": {
        if (ev.is_error) {
          const msg = `Claude error: ${ev.result ?? "(no message)"}`;
          Max.post(msg);
          sendText(UI_IN.appendError, msg);
          setStatus("ready");
          return;
        }
        currentSessionId = ev.session_id;
        const text = ev.result?.trim() ?? "";
        if (text)
          sendText(UI_IN.appendAssistant, text);
        setStatus("ready");
        return;
      }
    }
  };
  child.stdout.on("data", (chunk) => {
    stdoutBuffer += chunk.toString();
    const lines = stdoutBuffer.split(`
`);
    stdoutBuffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed)
        continue;
      try {
        handleEvent(JSON.parse(trimmed));
      } catch (e) {
        Max.post(`stream parse error: ${e}; line=${trimmed.slice(0, 200)}`);
      }
    }
  });
  child.stderr.on("data", (chunk) => {
    const line = chunk.toString().trim();
    if (line)
      Max.post(`[claude] ${line}`);
  });
  const timeout = setTimeout(() => {
    child.kill("SIGTERM");
    Max.post("Claude timeout (120s)");
  }, 120000);
  child.on("close", (code) => {
    clearTimeout(timeout);
    setBusy(false);
    if (code !== 0) {
      const msg = `Claude exited with code ${code}`;
      Max.post(msg);
      sendText(UI_IN.appendError, msg);
      setStatus("ready");
    }
  });
  child.on("error", (err) => {
    setBusy(false);
    const msg = `Failed to start claude: ${err.message}`;
    Max.post(msg);
    sendText(UI_IN.appendError, msg);
    setStatus("ready");
  });
}
function joinArgs(args) {
  return args.map(String).join(" ");
}
Max.addHandlers({
  prompt: (...args) => {
    const text = joinArgs(args).trim();
    if (!text)
      return;
    pendingPrompts.push(text);
    setBusy(true);
    setStatus("getting patch context…");
    Max.outlet("bridge", "getcontext");
  },
  clear: () => {
    currentSessionId = null;
    pendingPrompts.length = 0;
    Max.outlet("bridge", "reset");
    Max.outlet(UI_IN.clearChat);
    setStatus("ready");
    setBusy(false);
    Max.post("Session cleared");
  },
  bridgeResponse: (type, ...data) => {
    if (type !== "context")
      return;
    const prompt = pendingPrompts.shift();
    if (!prompt)
      return;
    try {
      const ctx = writeContext(joinArgs(data), contextFile);
      setStatus(`running claude · ${ctx.patch ?? "patch"} · ${ctx.boxes.length} obj · ${ctx.lines.length} conn`);
      spawnClaude(prompt);
    } catch (e) {
      const msg = `Error: ${e}`;
      Max.post(msg);
      sendText(UI_IN.appendError, msg);
      setBusy(false);
      setStatus("ready");
    }
  },
  commandSynced: (...args) => {
    const json = joinArgs(args);
    let payload;
    try {
      payload = JSON.parse(json);
    } catch (e) {
      Max.post(`commandSynced parse error: ${e}; raw=${json}`);
      return;
    }
    const { requestId, context, result } = payload;
    if (context) {
      try {
        writeContext(JSON.stringify(context), contextFile);
      } catch (e) {
        Max.post(`context write failed after command ${requestId}: ${e}`);
      }
    }
    try {
      appendFileSync(RESULTS_FILE, `${JSON.stringify({ requestId, ...result })}
`);
    } catch (e) {
      Max.post(`failed to append command-results.ndjson: ${e}`);
    }
  }
});
try {
  writeFileSync2(COMMANDS_FILE, "");
  writeFileSync2(RESULTS_FILE, "");
} catch (e) {
  Max.post(`could not init command channel files: ${e}`);
}
Max.outlet("bridge", "config", PROJECT_ROOT);
Max.outlet("url", UI_URL);
setStatus("ready");
Max.post(`Assistant ready. UI: ${UI_URL}`);
