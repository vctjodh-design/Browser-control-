// The engine's own broadcast viewer, fed with our fixture.
//
// Upstream ships a Bevy renderer (src/match) — the turf, the stands, the kits,
// the scoreboard — compiled to WebAssembly. It plays back a recording as a
// list of five-minute position chunks plus a document naming the teams and the
// men in them. So this module does two things: runs the bridge in its
// `--viewer` mode to write exactly those files for one fixture, and hands the
// page the viewer's own assets. What the browser draws is their engine end to
// end — not a re-drawing of its movement.
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  OpenFootballUnavailableError,
  buildOpenFootballSpec,
  openFootballBinaryPath,
  profileSignature,
} from "./open-football-replay";
import type { SimFormProfile } from "./sim-form-profile";

/** Where the viewer's two WebAssembly files live. */
function assetsDir(): string {
  const configured = process.env.OF_VIEWER_ASSETS;
  if (configured) return configured;

  const candidates = [
    path.resolve(process.cwd(), "assets/viewer"),
    path.resolve(process.cwd(), "artifacts/api-server/assets/viewer"),
    "/app/assets/viewer",
    path.resolve(process.cwd(), "../../assets/viewer"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export function viewerScriptPath(): string {
  return path.join(assetsDir(), "match_viewer.js.gz");
}

export function viewerWasmPath(): string {
  return path.join(assetsDir(), "match_viewer_bg.wasm.gz");
}

export function openFootballViewerReady(): boolean {
  return existsSync(viewerScriptPath()) && existsSync(viewerWasmPath());
}

type ViewerRecording = {
  dir: string;
  config: Record<string, unknown>;
};

const cache = new Map<string, Promise<ViewerRecording>>();
const MAX_CACHED = 3;

/**
 * Plays one fixture and writes it in the viewer's format, once per
 * fixture-and-seed. A played match never changes, so the directory is kept
 * and served from disk for the rest of the process's life.
 */
export async function openFootballViewerRecording(
  profile: SimFormProfile,
  seed: number,
): Promise<ViewerRecording> {
  // Keyed on the elevens as well as the seed: a ruled-out player changes the
  // match, so the recording made before him cannot stand in for this one.
  const key = `${profile.fixtureId}:${seed}:${profileSignature(profile)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const pending = writeRecording(profile, seed);
  cache.set(key, pending);

  pending.catch(() => cache.delete(key));

  if (cache.size > MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined && oldest !== key) {
      const evicted = cache.get(oldest);
      cache.delete(oldest);
      evicted
        ?.then((recording) => rmSync(recording.dir, { recursive: true, force: true }))
        .catch(() => undefined);
    }
  }

  return pending;
}

async function writeRecording(
  profile: SimFormProfile,
  seed: number,
): Promise<ViewerRecording> {
  const binary = openFootballBinaryPath();
  if (!existsSync(binary)) {
    throw new OpenFootballUnavailableError(
      `The Open Football engine is not built (looked for ${binary}). Run \`cargo build --release\` in engine/of-replay.`,
    );
  }

  const dir = mkdtempSync(path.join(tmpdir(), "of-viewer-"));
  const spec = buildOpenFootballSpec(profile, seed);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(binary, ["--viewer", dir], { stdio: ["pipe", "pipe", "pipe"] });
    const stderr: Buffer[] = [];
    let settled = false;

    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdout.resume();
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        const text = Buffer.concat(stderr).toString("utf8").slice(-400);
        reject(new OpenFootballUnavailableError(`The engine exited with ${code}. ${text}`));
        return;
      }
      resolve();
    });

    child.stdin.end(JSON.stringify(spec));
  });

  const configPath = path.join(dir, "config.json");
  if (!existsSync(configPath)) {
    rmSync(dir, { recursive: true, force: true });
    throw new OpenFootballUnavailableError("The engine wrote no viewer document.");
  }

  return { dir, config: JSON.parse(readFileSync(configPath, "utf8")) as Record<string, unknown> };
}

type ConfigShape = {
  home_name?: string;
  away_name?: string;
  home_goals?: number;
  away_goals?: number;
  match_time_ms?: number;
  [key: string]: unknown;
};

/** The page that hosts the canvas, with this fixture's document baked in. */
export function renderViewerPage(recording: ViewerRecording, apiBase: string): string {
  const config = recording.config as ConfigShape;
  const document = { canvas: "#match-canvas", api_base: apiBase, ...config };
  // `</` is escaped so a player's name can never close the script element.
  const json = JSON.stringify(document).replaceAll("</", "<\\/");

  const clockFrom = (config.match_time_ms ?? 0) / 1000;
  const minutes = Math.floor(clockFrom / 60);
  const subtitle =
    minutes > 0
      ? `Open Football engine · ${minutes}' played`
      : "Open Football engine";

  return PAGE.replace("__CONFIG__", json)
    .replaceAll("__HOME_NAME__", escapeHtml(String(config.home_name ?? "Home")))
    .replaceAll("__AWAY_NAME__", escapeHtml(String(config.away_name ?? "Away")))
    .replaceAll("__HOME_GOALS__", String(config.home_goals ?? 0))
    .replaceAll("__AWAY_GOALS__", String(config.away_goals ?? 0))
    .replaceAll("__SUBTITLE__", escapeHtml(subtitle));
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

// The viewer's own page: a score header, the canvas, and the hint line. The
// markup and the script are upstream's (`src/match/src/viewer.html`), pointed
// at our asset routes and handed this fixture's document.
const PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>__HOME_NAME__ v __AWAY_NAME__ · Open Football</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: #0e1419; color: #c8d6e0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
.header { text-align: center; padding: 12px 0 10px; }
.score { font-size: 22px; font-weight: 700; letter-spacing: 2px; }
.score .sep { color: #3a4f5c; margin: 0 10px; }
.team-home { color: #6ba3d6; }
.team-away { color: #d6836b; }
.levels { font-size: 11px; color: #5d7180; margin-top: 4px; letter-spacing: 1px; }
.stage-wrap { padding: 0 12px 10px; max-width: 1500px; margin: 0 auto; }
.stage { position: relative; width: 100%; aspect-ratio: 16 / 9; overflow: hidden; border-radius: 6px; background: #080c12; }
.stage-placeholder { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 13px; color: #7a8c98; text-align: center; padding: 0 24px; }
#match-canvas { position: relative; display: block; width: 100%; height: 100%; outline: none; touch-action: none; }
.hint { text-align: center; font-size: 10px; color: #4a5a66; padding-bottom: 10px; letter-spacing: 0.4px; }
</style>
</head>
<body>
<div class="header">
    <div class="score">
        <span class="team-home">__HOME_NAME__</span>
        <span>__HOME_GOALS__</span>
        <span class="sep">-</span>
        <span>__AWAY_GOALS__</span>
        <span class="team-away">__AWAY_NAME__</span>
    </div>
    <div class="levels">__SUBTITLE__</div>
</div>
<div class="stage-wrap">
    <div class="stage">
        <div class="stage-placeholder" id="placeholder">Loading match data…</div>
        <canvas id="match-canvas"></canvas>
    </div>
</div>
<div class="hint">space toggles playback &middot; drag the bar to scrub &middot; WASD / arrows fly the camera, Q and E drop and lift it, shift for speed &middot; right-drag aims &middot; wheel zooms</div>

<script type="module">
    const config = __CONFIG__;

    // The engine's own quality switches, passed straight through: a machine
    // without a real GPU (or one with little memory) can thin the crowd or the
    // squad out rather than lose the WebGL context mid-match.
    const asked = new URLSearchParams(location.search);
    for (const key of ["grain", "device", "crowd"]) {
        if (asked.has(key)) config[key] = asked.get(key);
    }
    if (asked.get("squad") === "off") config.squad = "off";

    // The viewer's files sit under the same base it asks for its chunks at, so
    // the page works the same whether it is reached directly or in a frame.
    try {
        const viewer = await import(config.api_base + "/static/match_viewer.js");
        await viewer.default({ module_or_path: config.api_base + "/static/match_viewer_bg.wasm" });
        await viewer.MatchViewer.start(JSON.stringify(config));
    } catch (error) {
        console.error("match viewer failed to start", error);
        document.getElementById("placeholder").textContent = "viewer failed to start: " + error;
    }
</script>
</body>
</html>
`;
