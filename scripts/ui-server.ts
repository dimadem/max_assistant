/**
 * Dev server for the jweb UI.
 *
 * Serves the `ui/` folder over HTTP so Claude Code's preview panel and a
 * regular browser can load the chat while iterating. In production the
 * [jweb] object in the Max patch loads `ui/index.html` directly via
 * `file://`, so this server is a development-only convenience — it is not
 * used by Max at runtime.
 *
 * Start: `bun run dev:ui`    (see package.json)
 * Stop:  Ctrl-C / preview_stop
 */

import { extname, join, normalize, resolve } from "node:path";
import { file } from "bun";

const PORT = Number(process.env.UI_PORT ?? 5173);
const ROOT = resolve(import.meta.dir, "..", "ui");

const MIME: Record<string, string> = {
	".html": "text/html; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".js": "application/javascript; charset=utf-8",
	".json": "application/json; charset=utf-8",
	".svg": "image/svg+xml",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".woff2": "font/woff2",
	".ico": "image/x-icon",
};

const server = Bun.serve({
	port: PORT,
	async fetch(req) {
		const url = new URL(req.url);
		// Normalize & guard against path traversal (`../`).
		const rel = normalize(decodeURIComponent(url.pathname)).replace(/^\/+/, "");
		const requested = rel === "" ? "index.html" : rel;
		const full = join(ROOT, requested);
		if (!full.startsWith(ROOT)) {
			return new Response("Forbidden", { status: 403 });
		}
		const f = file(full);
		if (!(await f.exists())) {
			return new Response("Not Found", { status: 404 });
		}
		const mime =
			MIME[extname(full).toLowerCase()] ?? "application/octet-stream";
		return new Response(f, {
			headers: {
				"Content-Type": mime,
				"Cache-Control": "no-store",
			},
		});
	},
});

console.log(
	`ui dev-server on http://localhost:${server.port}  (root: ${ROOT})`,
);
