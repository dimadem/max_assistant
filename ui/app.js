(() => {
  // src/types/protocol.ts
  var UI_OUT = {
    prompt: "prompt",
    clear: "clear"
  };
  var UI_IN = {
    appendUser: "appendUser",
    appendAssistant: "appendAssistant",
    appendSystem: "appendSystem",
    appendError: "appendError",
    status: "status",
    busy: "busy",
    clearChat: "clearChat"
  };
  function decodeText(args) {
    const joined = args.map(String).join(" ");
    try {
      const parsed = JSON.parse(joined);
      if (typeof parsed?.text === "string")
        return parsed.text;
    } catch {}
    return joined;
  }

  // src/ui/app.ts
  var ROLES = {
    user: "user>",
    ast: "ast>",
    sys: "sys>",
    err: "err>"
  };
  var log = document.getElementById("log");
  var inp = document.getElementById("inp");
  var form = document.getElementById("form");
  var newBtn = document.getElementById("new-chat");
  var statusEl = document.getElementById("status");
  function scrollToBottom() {
    log.scrollTop = log.scrollHeight;
  }
  function appendMessage(kind, text) {
    const row = document.createElement("div");
    row.className = `msg ${kind}`;
    const role = document.createElement("span");
    role.className = "role";
    role.textContent = ROLES[kind];
    const body = document.createElement("span");
    body.className = "body";
    body.textContent = text;
    row.append(role, body);
    log.append(row);
    scrollToBottom();
  }
  function setStatus(text) {
    statusEl.textContent = text || "ready";
  }
  function setBusy(on) {
    document.body.classList.toggle("busy", on);
    inp.disabled = on;
    if (!on)
      inp.focus();
  }
  function clearChat() {
    log.innerHTML = "";
  }
  function sendToMax(selector, ...args) {
    if (window.max?.outlet) {
      window.max.outlet(selector, ...args);
      return;
    }
    console.log("[outlet]", selector, args);
    if (selector === UI_OUT.prompt) {
      setTimeout(() => appendMessage("ast", `echo: ${String(args[0] ?? "")}`), 250);
    }
    if (selector === UI_OUT.clear)
      clearChat();
  }
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const text = inp.value.trim();
    if (!text)
      return;
    appendMessage("user", text);
    sendToMax(UI_OUT.prompt, text);
    inp.value = "";
  });
  newBtn.addEventListener("click", () => {
    sendToMax(UI_OUT.clear);
    clearChat();
    setStatus("ready");
  });
  var max = window.max;
  if (max?.bindInlet) {
    max.bindInlet(UI_IN.appendUser, (...a) => appendMessage("user", decodeText(a)));
    max.bindInlet(UI_IN.appendAssistant, (...a) => appendMessage("ast", decodeText(a)));
    max.bindInlet(UI_IN.appendSystem, (...a) => appendMessage("sys", decodeText(a)));
    max.bindInlet(UI_IN.appendError, (...a) => appendMessage("err", decodeText(a)));
    max.bindInlet(UI_IN.status, (...a) => setStatus(decodeText(a)));
    max.bindInlet(UI_IN.busy, (v) => setBusy(Number(v) === 1));
    max.bindInlet(UI_IN.clearChat, () => clearChat());
    setStatus("connected");
  } else {
    setStatus("dev mode (no Max host)");
    appendMessage("sys", "running outside Max — echo mode enabled");
  }
  inp.focus();
})();
