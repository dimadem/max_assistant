/**
 * jweb UI — entry point.
 * Bundled by `bun build` to `ui/app.js` (IIFE, browser target) and loaded
 * by `ui/index.html` inside the Max [jweb] object.
 */

import {
	decodeText,
	UI_IN,
	UI_OUT,
	type UIOutSelector,
} from "../types/protocol.ts";

/**
 * `window.max` is injected by Max into every jweb page. Typed loosely here
 * — args on both sides are variadic atoms.
 */
interface MaxBridge {
	bindInlet(selector: string, cb: (...args: unknown[]) => void): void;
	outlet(selector: string, ...args: unknown[]): void;
	getDict(name: string, cb: (dict: Record<string, unknown>) => void): void;
	setDict(name: string, dict: Record<string, unknown>): void;
}
declare global {
	interface Window {
		max?: MaxBridge;
	}
}

type MessageKind = "user" | "ast" | "sys" | "err";

const ROLES: Record<MessageKind, string> = {
	user: "user>",
	ast: "ast>",
	sys: "sys>",
	err: "err>",
};

const log = document.getElementById("log") as HTMLElement;
const inp = document.getElementById("inp") as HTMLInputElement;
const form = document.getElementById("form") as HTMLFormElement;
const newBtn = document.getElementById("new-chat") as HTMLButtonElement;
const statusEl = document.getElementById("status") as HTMLElement;

function scrollToBottom(): void {
	log.scrollTop = log.scrollHeight;
}

function appendMessage(kind: MessageKind, text: string): void {
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

function setStatus(text: string): void {
	statusEl.textContent = text || "ready";
}

function setBusy(on: boolean): void {
	document.body.classList.toggle("busy", on);
	inp.disabled = on;
	if (!on) inp.focus();
}

function clearChat(): void {
	log.innerHTML = "";
}

function sendToMax(selector: UIOutSelector, ...args: unknown[]): void {
	if (window.max?.outlet) {
		window.max.outlet(selector, ...args);
		return;
	}
	// Dev mode: running in a normal browser without a Max host.
	console.log("[outlet]", selector, args);
	if (selector === UI_OUT.prompt) {
		setTimeout(
			() => appendMessage("ast", `echo: ${String(args[0] ?? "")}`),
			250,
		);
	}
	if (selector === UI_OUT.clear) clearChat();
}

/* ---------------- UI events ---------------- */

form.addEventListener("submit", (e: Event) => {
	e.preventDefault();
	const text = inp.value.trim();
	if (!text) return;
	appendMessage("user", text);
	sendToMax(UI_OUT.prompt, text);
	inp.value = "";
});

newBtn.addEventListener("click", () => {
	sendToMax(UI_OUT.clear);
	clearChat();
	setStatus("ready");
});

/* ---------------- inlet bindings ---------------- */

const max = window.max;
if (max?.bindInlet) {
	max.bindInlet(UI_IN.appendUser, (...a) =>
		appendMessage("user", decodeText(a)),
	);
	max.bindInlet(UI_IN.appendAssistant, (...a) =>
		appendMessage("ast", decodeText(a)),
	);
	max.bindInlet(UI_IN.appendSystem, (...a) =>
		appendMessage("sys", decodeText(a)),
	);
	max.bindInlet(UI_IN.appendError, (...a) =>
		appendMessage("err", decodeText(a)),
	);
	max.bindInlet(UI_IN.status, (...a) => setStatus(decodeText(a)));
	max.bindInlet(UI_IN.busy, (v) => setBusy(Number(v) === 1));
	max.bindInlet(UI_IN.clearChat, () => clearChat());
	setStatus("connected");
} else {
	setStatus("dev mode (no Max host)");
	appendMessage("sys", "running outside Max — echo mode enabled");
}

inp.focus();
