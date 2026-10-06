import { existsSync } from "node:fs";

/**
 * Max reports paths as "<Volume>:/rest". On the boot volume
 * ("Macintosh HD:/Users/...") that maps to "/rest"; on any other volume
 * ("localhost:/max/...") it lives under "/Volumes/<Volume>/rest".
 * Already-POSIX paths pass through unchanged.
 */
export function hfsToPosix(
	path: string,
	exists: (p: string) => boolean = existsSync,
): string {
	const m = path.match(/^([^/:]+):(\/.*)$/);
	if (!m) return path;
	const [, volume, rest] = m as unknown as [string, string, string];
	if (exists(rest)) return rest;
	const onVolume = `/Volumes/${volume}${rest}`;
	return exists(onVolume) ? onVolume : rest;
}
