import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Load .env file manually since Max doesn't do it automatically
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = join(__dirname, ".env");

try {
	const envContent = readFileSync(envPath, "utf-8");
	for (const line of envContent.split("\n")) {
		const [key, ...valueParts] = line.split("=");
		if (key && valueParts.length > 0) {
			process.env[key.trim()] = valueParts.join("=").trim();
		}
	}
} catch {
	console.warn("Warning: .env file not found");
}
