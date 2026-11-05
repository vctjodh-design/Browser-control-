// Plays one fixture's match with the Open Football engine
// (https://github.com/ZOXEXIVO/open-football) and hands back the recording.
//
// The app's own 3D simulation invents its movement from the squads' numbers.
// This is the other way round: a real football match engine — the one behind
// open-football.org, written in Rust — plays the eleven that the predicted team
// sheets name, and its recording is what the pitch replays.
//
// The bridge is a small Rust binary (engine/of-replay) built from the pinned
// upstream tag. It reads a JSON fixture on stdin and writes the recording on
// stdout, so the only contract between the two languages is that document.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import type { SimFormProfile, SimLineupPlayer, SimTeamProfile } from "./sim-form-profile";

/** The engine's own role names, one per slot the profile invents. */
const ENGINE_ROLE: Record<string, string> = {
  GK: "Goalkeeper",
  LB: "DefenderLeft",
  CB: "DefenderCenterLeft",
  RB: "DefenderRight",
  DM: "DefensiveMidfielder",
  CM: "MidfielderCenter",
  LM: "MidfielderLeft",
  RM: "MidfielderRight",
  LW: "AttackingMidfielderLeft",
  RW: "AttackingMidfielderRight",
  ST: "Striker",
};

/** Two centre-halves must not share a role, or one plays out of position. */
function engineRole(role: string, taken: Set<string>): string {
  let name = ENGINE_ROLE[role] ?? "MidfielderCenter";
  if (role === "CB" && taken.has("DefenderCenterLeft")) name = "DefenderCenterRight";
  if (role === "CM" && taken.has("MidfielderCenter")) name = "MidfielderCenterRight";
  if (role === "ST" && taken.has("Striker")) name = "ForwardCenter";
  taken.add(name);
  return name;
}

function tacticFor(formation: string): string {
  const digits = formation.replace(/[^\d]/g, "");
  if (digits.startsWith("433")) return "T433";
  if (digits.startsWith("4231")) return "T4231";
  if (digits.startsWith("352")) return "T352";
  if (digits.startsWith("451")) return "T451";
  return "T442";
}

const clamp = (value: number, low: number, high: number): number => Math.min(high, Math.max(low, value));

/** What an ordinary player of this level looks like, in the feed's own ratings. */
const ORDINARY_RATING = 6.9;
/** The engine's middle: level 12 is a competent professional, not a star. */
const MIDDLE_LEVEL = 12;

/**
 * How good the engine should make one player.
 *
 * Nothing here decides who wins. The level is built from what has been
 * *measured* about the man — the ratings he has actually been given in the
 * matches we have read, his standing inside his own squad, and whether his
 * recent run is better or worse than usual — and the result of the match is
 * whatever those players then do on the pitch. No price, no expected
 * scoreline and no league position goes in: a favourite emerges because its
 * players are better at football, or it does not emerge at all.
 *
 * The engine's scale is steep (two levels between two elevens already turns a
 * match into a rout), so each term is compressed and capped: even the widest
 * gap the data can describe is worth about three levels between the elevens,
 * which is a heavy win rather than a cricket score.
 */
function levelFor(player: SimLineupPlayer): number {
  const rating = player.form?.rating ?? player.formRating ?? null;
  const quality = rating === null ? 0 : clamp((rating - ORDINARY_RATING) * 1.6, -1.1, 1.1);
  // player-form.ts caps the run-of-form level at ±1.6.
  const form = (player.form?.level ?? 0) * 0.2;
  const standing = (player.impact - 0.5) * 0.7;
  return clamp(Math.round(MIDDLE_LEVEL + quality + form + standing), 5, 19);
}

type EnginePlayer = {
  name: string;
  position: string;
  level: number;
  shirt: number;
  /** Additive points per skill, from the player's own match history. */
  weights?: Record<string, number>;
};

function sideSpec(team: SimTeamProfile) {
  const taken = new Set<string>();
  const players: EnginePlayer[] = team.lineup.map((player, index) => ({
    name: player.name,
    position: engineRole(team.slots[index]?.role ?? player.role, taken),
    level: levelFor(player),
    shirt: player.number ?? index + 1,
    weights: player.form?.skills,
  }));

  // Three changes named, which is what a real bench brings on: a keeper and
  // two outfield players. The engine decides whether it uses them.
  const bench: EnginePlayer[] = team.bench.slice(0, 3).map((player, index) => ({
    name: player.name,
    position: engineRole(player.role, taken),
    level: levelFor(player),
    shirt: player.number ?? 12 + index,
    weights: player.form?.skills,
  }));

  return {
    name: team.name,
    tactic: tacticFor(team.formation),
    players,
    bench,
  };
}

export function buildOpenFootballSpec(profile: SimFormProfile, seed: number) {
  return {
    seed,
    home: sideSpec(profile.teams[0]),
    away: sideSpec(profile.teams[1]),
  };
}

/** Where the built harness lives, relative to the repo, in dev and in Docker. */
export function openFootballBinaryPath(): string {
  const configured = process.env.OF_REPLAY_BIN;
  if (configured) return configured;

  const here = path.dirname(new URL(import.meta.url).pathname);
  const candidates = [
    path.resolve(here, "../../../../engine/of-replay/target/release/of_replay"),
    path.resolve(process.cwd(), "engine/of-replay/target/release/of_replay"),
    path.resolve(process.cwd(), "../../engine/of-replay/target/release/of_replay"),
    "/app/engine/of-replay/target/release/of_replay",
    "engine/of-replay/target/release/of_replay",
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0];
}

export class OpenFootballUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenFootballUnavailableError";
  }
}

/** One played match, as the harness wrote it. */
export type OpenFootballReplay = {
  engine: string;
  seed: number;
  pitch: { lengthM: number; widthM: number };
  score: { home: number; away: number };
  teams: { home: string; away: string };
  durationMs: number;
  players: Record<string, { id: number; name: string; role: string; shirt: number; sub: boolean }>;
  substitutions: { t: number; team: number; out: number; in: number }[];
  goals: { player_id: number; time: number; stat_type?: string; is_auto_goal?: boolean }[];
  ball: number[][];
  tracks: Record<string, number[][]>;
  sampleEveryMs: number;
  engineMs: number;
};

/**
 * A fingerprint of who is playing and what their own matches added to them.
 *
 * The recording cache is keyed by it as well as by seed: when a player is
 * ruled out and his replacement comes in, or a new match of his changes his
 * weights, the old recording is no longer the same fixture and must be
 * played again rather than served from the cache.
 */
export function profileSignature(profile: SimFormProfile): string {
  const text = profile.teams
    .map((team) =>
      team.lineup
        .map(
          (player) =>
            `${player.name}|${levelFor(player)}|${player.form?.level ?? 0}|${JSON.stringify(player.form?.skills ?? {})}`,
        )
        .join(","),
    )
    .join("|");
  return createHash("sha1").update(text).digest("hex").slice(0, 12);
}

const cache = new Map<string, OpenFootballReplay>();
const MAX_CACHED = 8;

export async function playOpenFootballMatch(
  profile: SimFormProfile,
  seed: number,
): Promise<OpenFootballReplay> {
  const key = `${profile.fixtureId}:${seed}:${profileSignature(profile)}`;
  const cached = cache.get(key);
  if (cached) return cached;

  const binary = openFootballBinaryPath();
  if (!existsSync(binary)) {
    throw new OpenFootballUnavailableError(
      `The Open Football engine is not built (looked for ${binary}). Run \`cargo build --release\` in engine/of-replay.`,
    );
  }

  const spec = buildOpenFootballSpec(profile, seed);
  const replay = await new Promise<OpenFootballReplay>((resolve, reject) => {
    const child = spawn(binary, [], { stdio: ["pipe", "pipe", "pipe"] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;

    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      if (error) {
        reject(error);
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(stdout).toString("utf8")) as OpenFootballReplay);
      } catch {
        reject(new OpenFootballUnavailableError("The engine's recording was not readable."));
      }
    };

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => finish(error));
    child.on("close", (code) => {
      if (code !== 0) {
        const text = Buffer.concat(stderr).toString("utf8").slice(-400);
        finish(new OpenFootballUnavailableError(`The engine exited with ${code}. ${text}`));
        return;
      }
      finish(null);
    });

    child.stdin.end(JSON.stringify(spec));
  });

  if (cache.size >= MAX_CACHED) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, replay);
  return replay;
}
