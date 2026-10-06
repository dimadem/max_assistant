// src/assistant.ts
import { spawn } from "node:child_process";
import { randomUUID as randomUUID2 } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Max from "max-api";

// src/bridge-server.ts
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
function createBridgeServer(sendToMax, timeoutMs = 1e4) {
  const token = randomUUID();
  const pending = new Map;
  function handleResult(json) {
    let r;
    try {
      r = JSON.parse(json);
    } catch {
      return;
    }
    if (!r.requestId)
      return;
    const done = pending.get(r.requestId);
    if (!done)
      return;
    pending.delete(r.requestId);
    const { requestId: _id, ...rest } = r;
    done(rest);
  }
  function dispatch(cmd) {
    const requestId = randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve({
          ok: false,
          error: `Max did not answer "${cmd.type}" within ${timeoutMs} ms (is [v8 bridge.js] loaded?)`
        });
      }, timeoutMs);
      pending.set(requestId, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      sendToMax(JSON.stringify({ ...cmd, requestId }));
    });
  }
  const server = createServer((req, res) => {
    const send = (status, body2) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(body2));
    };
    if (req.method !== "POST" || req.url !== "/command")
      return send(404, { ok: false, error: "not found" });
    if (req.headers["x-bridge-token"] !== token)
      return send(403, { ok: false, error: "bad token" });
    let body = "";
    req.on("data", (c) => {
      body += c;
    });
    req.on("end", async () => {
      let cmd;
      try {
        cmd = JSON.parse(body);
      } catch {
        return send(400, { ok: false, error: "invalid JSON" });
      }
      if (typeof cmd.type !== "string")
        return send(400, { ok: false, error: "missing type" });
      send(200, await dispatch(cmd));
    });
  });
  function listen(firstPort = 7474, attempts = 20) {
    return new Promise((resolve, reject) => {
      let port = firstPort;
      const tryNext = () => {
        server.once("error", (e) => {
          if (e.code === "EADDRINUSE" && port < firstPort + attempts - 1) {
            port++;
            tryNext();
          } else
            reject(e);
        });
        server.listen(port, "127.0.0.1", () => resolve({ port, token }));
      };
      tryNext();
    });
  }
  return { handleResult, dispatch, listen, close: () => server.close() };
}

// src/types/protocol.ts
var UI_IN = {
  appendUser: "appendUser",
  appendAssistant: "appendAssistant",
  appendSystem: "appendSystem",
  appendError: "appendError",
  status: "status",
  busy: "busy",
  clearChat: "clearChat",
  target: "target"
};
var encodeText = (text) => JSON.stringify({ text });

// src/assistant.ts
var scriptDir = dirname(fileURLToPath(import.meta.url));
var PROJECT_ROOT = join(scriptDir, "..");
var BRIDGE_INFO = join(PROJECT_ROOT, ".bridge.json");
var MCP_CONFIG = join(PROJECT_ROOT, ".mcp.json");
var UI_URL = `file://${join(PROJECT_ROOT, "ui", "index.html")}`;
var running = false;
var currentSessionId = null;
var SYSTEM_PROMPT = [
  "You are a Max/MSP assistant embedded in a chat panel inside Max.",
  "The user is looking at their patch; build and edit it with the max-msp MCP tools.",
  "Answer in the user's language. Be concise."
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
    currentSessionId = randomUUID2();
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
    running = false;
    if (code !== 0) {
      const msg = `Claude exited with code ${code}`;
      Max.post(msg);
      sendText(UI_IN.appendError, msg);
      setStatus("ready");
    }
  });
  child.on("error", (err) => {
    setBusy(false);
    running = false;
    const msg = `Failed to start claude: ${err.message}`;
    Max.post(msg);
    sendText(UI_IN.appendError, msg);
    setStatus("ready");
  });
}
function joinArgs(args) {
  return args.map(String).join(" ");
}
var bridge = createBridgeServer((json) => Max.outlet("bridge", "command", json));
Max.addHandlers({
  prompt: (...args) => {
    const text = joinArgs(args).trim();
    if (!text)
      return;
    if (text === "/pin" || text === "/unpin") {
      Max.outlet("bridge", text.slice(1));
      return;
    }
    if (running) {
      setStatus("busy — wait for the current answer");
      return;
    }
    running = true;
    setBusy(true);
    setStatus("running claude…");
    spawnClaude(text);
  },
  clear: () => {
    currentSessionId = null;
    Max.outlet("bridge", "reset");
    Max.outlet(UI_IN.clearChat);
    setStatus("ready");
    Max.post("Session cleared");
  },
  bridgeResult: (...args) => bridge.handleResult(joinArgs(args)),
  target: (...args) => sendText(UI_IN.target, joinArgs(args))
});
try {
  const info = await bridge.listen();
  writeFileSync(BRIDGE_INFO, JSON.stringify(info));
  Max.post(`Bridge listening on 127.0.0.1:${info.port}`);
} catch (e) {
  Max.post(`Bridge failed to start: ${e}`);
}
process.on("exit", () => {
  try {
    unlinkSync(BRIDGE_INFO);
  } catch {}
});
Max.outlet("url", UI_URL);
setStatus("ready");
Max.outlet("bridge", "report");
Max.post(`Assistant ready. UI: ${UI_URL}`);
