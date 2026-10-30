import type {
  FootballLiveAction,
  FootballMatchReplayFormationPlayer,
  FootballMatchReplay,
  FootballMatchReplayEvent,
  FootballMatchReplayShotEvent,
  FootballMatchReplaySection,
} from "@workspace/api-zod";
import {
  closeBrowserSession,
  createBrowserSession,
  getBrowserState,
  navigateBrowserJsonDocument,
  waitForBrowserPage,
} from "./browser-controller";
import { UpstreamRateLimitError } from "./upstream-rate-limit";
import {
  build365ScoresForensicsFallback,
  type FootballMatchForensicsFallback,
} from "./365scores-forensics-fallback";

const DAY_LIST_URL = "https://www.365scores.com/football/yesterdays-matches";
const RESULTS_LIST_URL = "https://www.365scores.com/football/match-results";
const PAGE_LOAD_SETTLE_MS = 3_500;
const REPLAY_CACHE_TTL_MS = 10 * 60 * 1_000;
const LIVE_SHOT_FEED_CACHE_TTL_MS = 55_000;
const REPLAY_SOURCE_TIMEOUT_MS = 45_000;
const MAX_REPLAY_CACHE_ENTRIES = 60;
const MIN_365SCORES_REQUEST_INTERVAL_MS = 1_500;
const BLOCKED_SOURCE_COOLDOWN_MS = 30 * 60 * 1_000;
const SERVER_ERROR_COOLDOWN_MS = 5 * 60 * 1_000;
const MAX_RATE_LIMIT_BACKOFF_MS = 15 * 60 * 1_000;

type BrowserSnapshot = Awaited<ReturnType<typeof getBrowserState>>;
type SectionKey = FootballMatchReplaySection["key"];
type ReplayFixtureContext = {
  match: {
    fixtureId: number;
    date: string | Date;
    competition: string;
    status: string;
    home: {
      id: number;
      name: string;
      score: number | null;
      halfTimeScore: number | null;
    };
    away: {
      id: number;
      name: string;
      score: number | null;
      halfTimeScore: number | null;
    };
  };
};

type LoadedReplay = {
  replay: FootballMatchReplay;
  forensicsFallback: FootballMatchForensicsFallback;
};

type SourcePlayerStat = {
  name?: string;
  shortName?: string;
  value?: string | number;
};

type SourcePlayer = {
  id?: number;
  name?: string;
  shortName?: string;
  jerseyNumber?: number;
  competitorId?: number;
};

type SourceLineupMember = {
  id?: number;
  statusText?: string;
  position?: { name?: string };
  formation?: { name?: string; shortName?: string };
  ranking?: number;
  substitution?: { time?: number };
  stats?: SourcePlayerStat[];
  yardFormation?: { fieldLine?: number; fieldSide?: number };
};

type SourceTeam = {
  id?: number;
  name?: string;
  longName?: string;
  nameForURL?: string;
  score?: number;
  lineups?: {
    status?: string;
    formation?: string;
    members?: SourceLineupMember[];
  };
};

type SourceGameEvent = {
  gameTime?: number;
  gameTimeDisplay?: string;
  order?: number;
  playerId?: number;
  extraPlayers?: number[];
  competitorNum?: number;
  eventType?: { name?: string };
};

type SourceShot = {
  time?: string;
  playerId?: number;
  competitorNum?: number;
  bodyPart?: string;
  xg?: string | number;
  xgot?: string | number;
  line?: number;
  side?: number;
  outcome?: { name?: string };
};

type SourceGame = {
  id?: number;
  competitionId?: number;
  competitionDisplayName?: string;
  statusText?: string;
  shortStatusText?: string;
  gameTime?: number;
  startTime?: string;
  date?: string;
  homeCompetitor?: SourceTeam;
  awayCompetitor?: SourceTeam;
  members?: SourcePlayer[] | Record<string, SourcePlayer>;
  events?: SourceGameEvent[] | Record<string, SourceGameEvent>;
  chartEvents?: { events?: SourceShot[] };
  actualPlayTime?: {
    actualTime?: { name?: string };
    totalTime?: { name?: string };
  };
  playByPlay?: { feedURL?: string };
};

type SourceStatistic = {
  name?: string;
  value?: string | number;
  competitorId?: number;
  order?: number;
};

type SourceTimeStat = {
  name?: string;
  value?: string | number;
  competitorId?: number;
};

type SourceMatchTimeStats = {
  actualPlayTime?: {
    actualTime?: { name?: string };
    totalTime?: { name?: string };
  };
  general?: SourceTimeStat[];
  addedTime?: { title?: string; stats?: SourceTimeStat[] };
  wastedTime?: { title?: string; stats?: SourceTimeStat[] };
};

type SourceStatsResponse = {
  statistics?: SourceStatistic[];
  actualGameStatistics?: SourceMatchTimeStats;
};

type SourceComment = {
  Id?: number;
  Comment?: string;
  Timeline?: string;
  TimeLineSecondaryText?: string;
};

type SourceFeedResponse = {
  Messages?: SourceComment[];
};

const replayCache = new Map<number, { expiresAt: number; loaded: LoadedReplay }>();
const LIVE_ACTION_CACHE_TTL_MS = 20_000;
const liveActionCache = new Map<
  string,
  { expiresAt: number; snapshot: FootballLiveAction }
>();
const liveActionRequests = new Map<string, Promise<FootballLiveAction>>();
const replayRequests = new Map<number, Promise<LoadedReplay>>();

type SourcePause = {
  until: number;
  kind: "rate-limited" | "blocked";
};

let sourcePause: SourcePause | null = null;
let consecutiveRateLimits = 0;
let nextSourceRequestAt = 0;
let sourceRequestTail: Promise<void> = Promise.resolve();

export class LiveActionSourceUrlError extends Error {
  constructor(message = "Provide a valid 365Scores football match link.") {
    super(message);
    this.name = "LiveActionSourceUrlError";
  }
}

function isLiveMatchStatus(status: string): boolean {
  return /\b(live|in play|in progress|first half|second half|1st half|2nd half|1h|2h|half[ -]?time|halftime)\b/i.test(
    status,
  );
}

const teamAliases: string[][] = [
  ["psg", "paris saint germain", "paris saint-germain", "paris sg"],
  ["lyon", "olympique lyonnais", "olympique de lyon"],
  ["marseille", "olympique marseille", "olympique de marseille"],
  ["man utd", "manchester united"],
  ["man city", "manchester city"],
  ["atletico madrid", "atlético madrid", "atletico de madrid"],
  ["inter", "internazionale", "inter milan"],
  ["ac milan", "milan"],
  ["bayern", "bayern munich", "fc bayern münchen"],
  ["barcelona", "fc barcelona", "barça", "barca"],
];

const sourceCompetitionIds: Array<{ id: number; names: string[] }> = [
  { id: 7, names: ["premier league"] },
  { id: 8, names: ["fa cup"] },
  { id: 9, names: ["efl cup", "carabao cup"] },
  { id: 11, names: ["laliga", "la liga"] },
  { id: 13, names: ["copa del rey"] },
  { id: 17, names: ["serie a"] },
  { id: 18, names: ["serie b"] },
  { id: 25, names: ["bundesliga"] },
  { id: 28, names: ["liga portugal", "primeira liga"] },
  { id: 35, names: ["ligue 1"] },
  { id: 37, names: ["eredivisie"] },
  { id: 104, names: ["mls", "major league soccer"] },
];

export class MatchReplayNotFoundError extends Error {
  constructor(message = "No matching 365Scores report was found for this match date.") {
    super(message);
    this.name = "MatchReplayNotFoundError";
  }
}

export class MatchReplaySourceError extends Error {
  constructor(message = "365Scores could not be read right now. Please try again.") {
    super(message);
    this.name = "MatchReplaySourceError";
  }
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1_000;
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - Date.now()) : null;
}

function activeSourcePauseError(): Error | null {
  if (!sourcePause || sourcePause.until <= Date.now()) {
    sourcePause = null;
    return null;
  }
  const seconds = Math.max(
    1,
    Math.ceil((sourcePause.until - Date.now()) / 1_000),
  );
  return sourcePause.kind === "rate-limited"
    ? new UpstreamRateLimitError(seconds)
    : new MatchReplaySourceError(
        `365Scores is temporarily declining requests. Please wait at least ${seconds} seconds before trying again.`,
      );
}

async function with365ScoresRequest<T>(request: () => Promise<T>): Promise<T> {
  const previous = sourceRequestTail;
  let release = () => {};
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => turn);
  sourceRequestTail = tail;
  await previous;

  try {
    const paused = activeSourcePauseError();
    if (paused) throw paused;

    const wait = nextSourceRequestAt - Date.now();
    if (wait > 0) await sleep(wait);

    const pauseAfterWait = activeSourcePauseError();
    if (pauseAfterWait) throw pauseAfterWait;

    nextSourceRequestAt =
      Date.now() + MIN_365SCORES_REQUEST_INTERVAL_MS;
    return await request();
  } finally {
    release();
    if (sourceRequestTail === tail) sourceRequestTail = Promise.resolve();
  }
}

function pauseAfterRateLimit(retryAfter: string | null): number {
  consecutiveRateLimits += 1;
  const fallbackDelay = Math.min(
    60_000 * 2 ** Math.min(consecutiveRateLimits - 1, 4),
    MAX_RATE_LIMIT_BACKOFF_MS,
  );
  const delay = Math.max(
    1_000,
    retryAfterMilliseconds(retryAfter) ?? fallbackDelay,
  );
  sourcePause = { until: Date.now() + delay, kind: "rate-limited" };
  return delay;
}

function pauseAfterSourceBlock(
  retryAfter: string | null,
  fallbackDelay = BLOCKED_SOURCE_COOLDOWN_MS,
): void {
  sourcePause = {
    until:
      Date.now() +
      Math.max(1_000, retryAfterMilliseconds(retryAfter) ?? fallbackDelay),
    kind: "blocked",
  };
}

async function request365ScoresDocument(
  sessionId: string,
  value: string,
  expectedContent: "json" | "html",
): Promise<Awaited<ReturnType<typeof navigateBrowserJsonDocument>>> {
  return with365ScoresRequest(async () => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      throw new MatchReplaySourceError();
    }

    let response: Awaited<ReturnType<typeof navigateBrowserJsonDocument>>;
    try {
      response = await navigateBrowserJsonDocument(sessionId, url.toString());
    } catch {
      pauseAfterSourceBlock(null, SERVER_ERROR_COOLDOWN_MS);
      throw new MatchReplaySourceError(
        "365Scores could not be reached. Further requests are paused before retrying.",
      );
    }
    let currentUrl: URL;
    try {
      currentUrl = new URL(response.currentUrl);
    } catch {
      throw new MatchReplaySourceError();
    }
    if (currentUrl.hostname !== url.hostname) {
      pauseAfterSourceBlock(response.retryAfter);
      throw new MatchReplaySourceError(
        "365Scores redirected the request to an unexpected source.",
      );
    }

    if (response.statusCode === 429) {
      const delay = pauseAfterRateLimit(response.retryAfter);
      throw new UpstreamRateLimitError(Math.max(1, Math.ceil(delay / 1_000)));
    }
    if (response.statusCode === 401 || response.statusCode === 403) {
      pauseAfterSourceBlock(response.retryAfter);
      throw new MatchReplaySourceError(
        "365Scores declined the request. No further requests will be made for a while.",
      );
    }
    if (response.statusCode === 503) {
      pauseAfterSourceBlock(response.retryAfter, SERVER_ERROR_COOLDOWN_MS);
      throw new MatchReplaySourceError(
        "365Scores is temporarily unavailable. Requests are paused before retrying.",
      );
    }
    if (response.statusCode >= 500) {
      pauseAfterSourceBlock(response.retryAfter, SERVER_ERROR_COOLDOWN_MS);
      throw new MatchReplaySourceError(
        "365Scores returned a temporary server error. Requests are paused before retrying.",
      );
    }
    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new MatchReplaySourceError(
        `365Scores returned HTTP ${response.statusCode}.`,
      );
    }

    const contentType = response.contentType.toLowerCase();
    const hasExpectedType =
      expectedContent === "json"
        ? contentType.includes("json") && response.document !== null
        : contentType.includes("text/html") ||
          contentType.includes("application/xhtml");
    if (!hasExpectedType) {
      pauseAfterSourceBlock(response.retryAfter);
      throw new MatchReplaySourceError(
        "365Scores returned an unexpected page instead of the requested data. Further requests are paused.",
      );
    }
    consecutiveRateLimits = 0;
    return response;
  });
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function sourceCompetitionId(value: string): number | null {
  const normalized = normalizeText(value);
  const competition = sourceCompetitionIds.find(({ names }) =>
    names.some((name) => {
      const normalizedName = normalizeText(name);
      return (
        normalized === normalizedName ||
        normalized.endsWith(` ${normalizedName}`)
      );
    }),
  );
  return competition?.id ?? null;
}

function variantsForTeam(name: string): string[] {
  const normalized = normalizeText(name);
  const aliases = teamAliases.find((group) =>
    group.some((alias) => normalizeText(alias) === normalized),
  );
  return [...new Set((aliases ?? [name]).map(normalizeText).filter(Boolean))];
}

function containsTeam(source: string, name: string): boolean {
  const normalizedSource = normalizeText(source);
  return variantsForTeam(name).some((variant) =>
    normalizedSource.includes(variant),
  );
}

function matchDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isAllowedMatchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "www.365scores.com" ||
        url.hostname === "365scores.com") &&
      url.pathname.startsWith("/football/match/") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function listCandidates(
  snapshot: BrowserSnapshot,
  details: ReplayFixtureContext,
): Array<{ url: string; text: string }> {
  const match = details.match;
  const potential = snapshot.pageContent.links.flatMap((link) => {
    if (!isAllowedMatchUrl(link.href)) return [];
    const searchable = `${link.text} ${link.href}`;
    if (
      !containsTeam(searchable, match.home.name) ||
      !containsTeam(searchable, match.away.name)
    ) {
      return [];
    }
    return [{ url: link.href, text: searchable }];
  });

  const expectedScore =
    match.home.score !== null && match.away.score !== null
      ? new RegExp(
          `\\b${match.home.score}\\s*[-–:]\\s*${match.away.score}\\b`,
        )
      : null;
  const scoreMatches = expectedScore
    ? potential.filter((candidate) => expectedScore.test(candidate.text))
    : [];
  return scoreMatches.length ? scoreMatches : potential;
}

function extractMatchArea(text: string): string {
  const footerIndex = text.indexOf("365Scores is the fastest");
  const bounded = footerIndex >= 0 ? text.slice(0, footerIndex) : text;
  const headerPattern =
    /(?:^|\n)[^\n]{2,100}\s+Vs\s+[^\n]{2,100}\n[^\n]{2,160}\bRound\s+\d+/g;
  const headers = [...bounded.matchAll(headerPattern)];
  const header = headers.at(-1);
  if (!header || header.index === undefined) return bounded.slice(-18_000);
  return bounded.slice(header.index + (header[0].startsWith("\n") ? 1 : 0));
}

function sectionText(
  key: SectionKey,
  title: string,
  text: string,
): FootballMatchReplaySection {
  const normalized = text.trim();
  return {
    key,
    title,
    text: normalized || null,
    available: Boolean(normalized),
  };
}

function parseHalfTimeScore(content: string): string | null {
  const match = content.match(/Halftime\s+(\d+)\s*[-–:]\s*(\d+)/i);
  return match ? `${match[1]}–${match[2]}` : null;
}

function parseDuration(content: string, label: "Actual" | "Total"): string | null {
  const match = content.match(
    new RegExp(`\\b${label}\\s+(\\d{1,3}:\\d{2})`, "i"),
  );
  return match?.[1] ?? null;
}

function reportDateMatches(
  date: Date,
  title: string,
  matchArea: string,
): boolean {
  const source = `${title}\n${matchArea}`;
  const displayed = source.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (!displayed) return false;
  const month = Number(displayed[1]);
  const day = Number(displayed[2]);
  const yearText = displayed[3];
  if (month !== date.getUTCMonth() + 1 || day !== date.getUTCDate()) return false;
  if (!yearText) return true;
  const year = Number(yearText.length === 2 ? `20${yearText}` : yearText);
  return year === date.getUTCFullYear();
}

function replayErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "365Scores could not be read right now. Please try again.";
}

function sourceEntries<T>(
  value: T[] | Record<string, T> | undefined,
): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : Object.values(value);
}

function sourceObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sourcePlayerMap(game: SourceGame): Map<number, SourcePlayer> {
  const players = new Map<number, SourcePlayer>();
  for (const player of sourceEntries(game.members)) {
    if (typeof player.id === "number") players.set(player.id, player);
  }
  return players;
}

function sourcePercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
    return null;
  }
  return Math.round(value * 10) / 10;
}

function sourceMetricText(value: string | number | undefined): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function replayTeamSide(
  game: SourceGame,
  player: SourcePlayer | undefined,
  competitorNum: number | undefined,
): "home" | "away" | null {
  if (
    typeof player?.competitorId === "number" &&
    player.competitorId === game.homeCompetitor?.id
  ) {
    return "home";
  }
  if (
    typeof player?.competitorId === "number" &&
    player.competitorId === game.awayCompetitor?.id
  ) {
    return "away";
  }
  if (competitorNum === 1) return "home";
  if (competitorNum === 2) return "away";
  return null;
}

function replayShotEvents(game: SourceGame): FootballMatchReplayShotEvent[] {
  const playersById = sourcePlayerMap(game);
  return (game.chartEvents?.events ?? []).flatMap((shot, sourceOrder) => {
    const player =
      typeof shot.playerId === "number"
        ? playersById.get(shot.playerId)
        : undefined;
    const teamSide = replayTeamSide(game, player, shot.competitorNum);
    if (!teamSide) return [];

    const sourceSide = sourcePercent(shot.side);
    const y = sourcePercent(shot.line);
    return [
      {
        minute: shot.time?.trim() || "—",
        teamSide,
        playerName: player?.name?.trim() || null,
        outcome: shot.outcome?.name?.trim() || null,
        bodyPart: shot.bodyPart?.trim() || null,
        xg: sourceMetricText(shot.xg),
        xgot: sourceMetricText(shot.xgot),
        x: sourceSide === null
          ? null
          : teamSide === "home"
            ? Math.round((100 - sourceSide) * 10) / 10
            : sourceSide,
        y,
        sourceOrder,
      },
    ];
  });
}

function replayFormationPlayers(
  game: SourceGame,
): FootballMatchReplayFormationPlayer[] {
  const playersById = sourcePlayerMap(game);
  return ([game.homeCompetitor, game.awayCompetitor] as const).flatMap(
    (team, teamIndex) => {
      if (!team) return [];
      const teamSide = teamIndex === 0 ? "home" : "away";
      return (team.lineups?.members ?? []).flatMap((member) => {
        if (member.statusText !== "Starting" || typeof member.id !== "number") {
          return [];
        }
        const player = playersById.get(member.id);
        const fieldLine = sourcePercent(member.yardFormation?.fieldLine);
        const y = sourcePercent(member.yardFormation?.fieldSide);
        if (!player?.name?.trim() || fieldLine === null || y === null) {
          return [];
        }

        return [
          {
            teamSide,
            playerName: player.name.trim(),
            shirtNumber:
              typeof player.jerseyNumber === "number" &&
              Number.isInteger(player.jerseyNumber)
                ? player.jerseyNumber
                : null,
            position:
              member.formation?.shortName?.trim() ||
              member.formation?.name?.trim() ||
              member.position?.name?.trim() ||
              null,
            x:
              teamSide === "home"
                ? Math.round((100 - fieldLine) * 10) / 10
                : fieldLine,
            y,
          },
        ];
      });
    },
  );
}

function formatLineups(game: SourceGame): string | null {
  const playersById = sourcePlayerMap(game);
  const teams = [game.homeCompetitor, game.awayCompetitor];
  const lines: string[] = [];

  for (const [teamIndex, team] of teams.entries()) {
    if (!team) continue;
    const teamName =
      team.longName?.trim() || team.name?.trim() || `Team ${teamIndex + 1}`;
    const lineup = team.lineups;
    const members = lineup?.members ?? [];
    const listedMembers = members.filter(
      (member) =>
        member.statusText === "Starting" ||
        member.statusText === "Substitute",
    );
    if (!lineup || !listedMembers.length) {
      lines.push(`${teamName} — lineup unavailable in the 365Scores data.`);
      continue;
    }

    const details = [lineup.formation, lineup.status]
      .filter((value): value is string => Boolean(value?.trim()))
      .join(" · ");
    lines.push(`${teamName}${details ? ` — ${details}` : ""}`);

    for (const [status, heading] of [
      ["Starting", "Starting XI"],
      ["Substitute", "Substitutes"],
    ] as const) {
      const group = listedMembers.filter(
        (member) => member.statusText === status,
      );
      if (!group.length) continue;
      lines.push(heading);
      for (const member of group) {
        const player =
          typeof member.id === "number"
            ? playersById.get(member.id)
            : undefined;
        if (!player?.name) continue;
        const position =
          member.formation?.shortName ??
          member.formation?.name ??
          member.position?.name;
        const minutes = member.stats?.find(
          (stat) =>
            stat.name?.toLowerCase() === "minutes" ||
            stat.shortName?.toLowerCase() === "min",
        )?.value;
        const labels = [
          typeof player.jerseyNumber === "number"
            ? `#${player.jerseyNumber}`
            : null,
          player.name,
          position,
          typeof member.ranking === "number" &&
          Number.isFinite(member.ranking) &&
          member.ranking > 0
            ? `Rating ${member.ranking.toFixed(1)}`
            : null,
          minutes !== undefined ? `${minutes} played` : null,
        ].filter((value): value is string => Boolean(value));
        lines.push(labels.join(" · "));
      }
    }
  }

  const substitutions = sourceEntries(game.events)
    .filter(
      (event) =>
        event.eventType?.name?.toLowerCase() === "substitution",
    )
    .sort(
      (left, right) =>
        (left.gameTime ?? Number.MAX_SAFE_INTEGER) -
          (right.gameTime ?? Number.MAX_SAFE_INTEGER) ||
        (left.order ?? 0) - (right.order ?? 0),
    );
  if (substitutions.length) {
    lines.push("Substitutions");
    for (const event of substitutions) {
      const incoming =
        typeof event.playerId === "number"
          ? playersById.get(event.playerId)?.name
          : undefined;
      const outgoing = (event.extraPlayers ?? [])
        .map((playerId) => playersById.get(playerId)?.name)
        .filter((name): name is string => Boolean(name));
      const time =
        event.gameTimeDisplay?.trim() ||
        (typeof event.gameTime === "number" ? `${event.gameTime}'` : null);
      const change = [
        incoming ? `${incoming} on` : null,
        outgoing.length ? `${outgoing.join(", ")} off` : null,
      ]
        .filter((value): value is string => Boolean(value))
        .join("; ");
      if (change) lines.push(`${time ? `${time} — ` : ""}${change}`);
    }
  }

  return lines.length ? lines.join("\n") : null;
}

function formatStatistics(
  response: SourceStatsResponse,
  game: SourceGame,
): string | null {
  const home = game.homeCompetitor;
  const away = game.awayCompetitor;
  const homeId = home?.id;
  const awayId = away?.id;
  if (typeof homeId !== "number" || typeof awayId !== "number") {
    return null;
  }

  const rows = new Map<
    string,
    { order: number; values: Map<number, string> }
  >();
  for (const [index, statistic] of (response.statistics ?? []).entries()) {
    const name = statistic.name?.trim();
    if (!name || typeof statistic.competitorId !== "number") continue;
    const row = rows.get(name) ?? {
      order:
        typeof statistic.order === "number" ? statistic.order : index,
      values: new Map<number, string>(),
    };
    row.values.set(
      statistic.competitorId,
      statistic.value === undefined ? "Unavailable" : String(statistic.value),
    );
    rows.set(name, row);
  }

  const orderedRows = [...rows.entries()].sort(
    (left, right) => left[1].order - right[1].order,
  );
  if (!orderedRows.length) return null;

  const homeName = home?.longName || home?.name || "Home";
  const awayName = away?.longName || away?.name || "Away";
  return orderedRows
    .map(
      ([name, row]) =>
        `${name}: ${homeName} ${row.values.get(homeId) ?? "Unavailable"} · ${awayName} ${row.values.get(awayId) ?? "Unavailable"}`,
    )
    .join("\n");
}

function formatShotMap(game: SourceGame): string | null {
  const shots = game.chartEvents?.events ?? [];
  if (!shots.length) return null;
  const playersById = sourcePlayerMap(game);
  const lines = [`${shots.length} shots recorded by 365Scores`];

  for (const shot of shots) {
    const player =
      typeof shot.playerId === "number"
        ? playersById.get(shot.playerId)?.name
        : undefined;
    const coordinates =
      typeof shot.line === "number" && typeof shot.side === "number"
        ? `source coordinates ${shot.line}, ${shot.side}`
        : "coordinates unavailable";
    const labels = [
      shot.time?.trim() || "Time unavailable",
      player || "Player unavailable",
      shot.outcome?.name || "Outcome unavailable",
      shot.bodyPart || "Shot type unavailable",
      `xG ${shot.xg === undefined ? "unavailable" : shot.xg}`,
      `xGOT ${shot.xgot === undefined ? "unavailable" : shot.xgot}`,
      coordinates,
    ];
    lines.push(labels.join(" · "));
  }
  return lines.join("\n");
}

function commentaryMinute(comment: SourceComment): string | null {
  const base = comment.Timeline?.trim();
  if (!base || !/^\d{1,3}$/.test(base)) return null;
  const added = comment.TimeLineSecondaryText?.match(/\+(\d{1,2})/);
  return added ? `${base}+${added[1]}` : base;
}

function formatCommentary(
  feed: SourceFeedResponse,
): { text: string | null; events: FootballMatchReplayEvent[] } {
  const messages = [...(feed.Messages ?? [])].sort(
    (left, right) => (left.Id ?? 0) - (right.Id ?? 0),
  );
  const commentary = messages
    .map((message) => {
      const text = message.Comment?.trim();
      if (!text) return null;
      const minute = commentaryMinute(message);
      return [minute ? `${minute}'` : null, text]
        .filter((value): value is string => Boolean(value))
        .join(" ");
    })
    .filter((value): value is string => Boolean(value))
    .join("\n\n");
  const events = messages.flatMap((message, sourceOrder) => {
    const lines = (message.Comment ?? "")
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (!lines.length) return [];
    const title = lines[0] ?? "Match event";
    const kind =
      title.match(
        /\b(goal|assist|substitution|yellow card|red card|penalty|missed penalty|own goal|half-time|full-time|var|injury)\b/i,
      )?.[1]?.toLowerCase() ?? "commentary";
    return [
      {
        minute: commentaryMinute(message) ?? "—",
        kind,
        title,
        detail: lines.slice(1).join(" "),
        sourceOrder,
      },
    ];
  });
  return { text: commentary || null, events };
}

function formatTimeDetails(
  timeStats: SourceMatchTimeStats | undefined,
  game: SourceGame,
  messages: SourceComment[],
): string | null {
  const lines = [
    timeStats?.actualPlayTime?.actualTime?.name ??
      game.actualPlayTime?.actualTime?.name,
    timeStats?.actualPlayTime?.totalTime?.name ??
      game.actualPlayTime?.totalTime?.name,
  ].filter((value): value is string => Boolean(value?.trim()));

  for (const statistic of timeStats?.general ?? []) {
    if (statistic.name && statistic.value !== undefined) {
      lines.push(`${statistic.name}: ${statistic.value}`);
    }
  }

  if (timeStats?.addedTime?.stats?.length) {
    lines.push(timeStats.addedTime.title || "Added Time");
    for (const statistic of timeStats.addedTime.stats) {
      if (statistic.name && statistic.value !== undefined) {
        lines.push(`${statistic.name}: ${statistic.value}`);
      }
    }
  }

  const home = game.homeCompetitor;
  const away = game.awayCompetitor;
  const homeId = home?.id;
  const awayId = away?.id;
  const homeName = home?.longName || home?.name || "Home";
  const awayName = away?.longName || away?.name || "Away";
  if (timeStats?.wastedTime?.stats?.length) {
    lines.push(timeStats.wastedTime.title || "Time Wasted On");
    const rows = new Map<
      string,
      { home?: string; away?: string; other?: string }
    >();
    for (const statistic of timeStats.wastedTime.stats) {
      if (!statistic.name || statistic.value === undefined) continue;
      const row = rows.get(statistic.name) ?? {};
      if (statistic.competitorId === homeId) {
        row.home = String(statistic.value);
      } else if (statistic.competitorId === awayId) {
        row.away = String(statistic.value);
      } else {
        row.other = String(statistic.value);
      }
      rows.set(statistic.name, row);
    }
    for (const [name, row] of rows) {
      if (row.other !== undefined) {
        lines.push(`${name}: ${row.other}`);
      } else {
        lines.push(
          `${name}: ${homeName} ${row.home ?? "Unavailable"} · ${awayName} ${row.away ?? "Unavailable"}`,
        );
      }
    }
  }

  const markers = new Set<string>();
  for (const message of messages) {
    const minute = commentaryMinute(message);
    if (minute?.includes("+")) markers.add(`${minute}'`);
  }
  if (markers.size) {
    lines.push(
      `Commentary stoppage-time markers: ${[...markers].join(", ")}`,
    );
  }
  return lines.length ? lines.join("\n") : null;
}

function gamesListApiUrl(date: string, competitionId: number): URL {
  const url = new URL("https://webws.365scores.com/web/games/results/");
  url.searchParams.set("appTypeId", "5");
  url.searchParams.set("langId", "1");
  url.searchParams.set("timezoneName", "UTC");
  url.searchParams.set("userCountryId", "355");
  url.searchParams.set("date", date);
  url.searchParams.set("competitions", String(competitionId));
  return url;
}

function liveGamesListApiUrl(date: string): URL {
  const url = new URL("https://webws.365scores.com/web/games/");
  url.searchParams.set("appTypeId", "5");
  url.searchParams.set("langId", "1");
  url.searchParams.set("timezoneName", "UTC");
  url.searchParams.set("userCountryId", "355");
  url.searchParams.set("date", date);
  return url;
}

function gameApiUrl(game: SourceGame): URL {
  const homeId = game.homeCompetitor?.id;
  const awayId = game.awayCompetitor?.id;
  if (
    typeof game.id !== "number" ||
    !Number.isInteger(game.id) ||
    typeof game.competitionId !== "number" ||
    !Number.isInteger(game.competitionId) ||
    typeof homeId !== "number" ||
    !Number.isInteger(homeId) ||
    typeof awayId !== "number" ||
    !Number.isInteger(awayId)
  ) {
    throw new MatchReplayNotFoundError(
      "The 365Scores match list did not include a verifiable match identifier.",
    );
  }

  const url = new URL("https://webws.365scores.com/web/game/");
  url.searchParams.set("appTypeId", "5");
  url.searchParams.set("langId", "1");
  url.searchParams.set("timezoneName", "UTC");
  url.searchParams.set("userCountryId", "355");
  url.searchParams.set("gameId", String(game.id));
  url.searchParams.set(
    "matchupId",
    `${awayId}-${homeId}-${game.competitionId}`,
  );
  return url;
}

function sourceMatchPageUrl(
  game: SourceGame,
  details: ReplayFixtureContext,
): string {
  const home = game.homeCompetitor;
  const away = game.awayCompetitor;
  if (
    typeof game.id !== "number" ||
    typeof game.competitionId !== "number" ||
    typeof home?.id !== "number" ||
    typeof away?.id !== "number"
  ) {
    throw new MatchReplayNotFoundError(
      "The 365Scores match list did not include a verifiable match identifier.",
    );
  }

  const competitionName =
    game.competitionDisplayName ??
    details.match.competition.split(":").at(-1)?.trim() ??
    "football";
  const competitionSlug = normalizeText(competitionName).replace(/\s+/g, "-");
  const awaySlug =
    away.nameForURL ?? normalizeText(away.name ?? "").replace(/\s+/g, "-");
  const homeSlug =
    home.nameForURL ?? normalizeText(home.name ?? "").replace(/\s+/g, "-");
  const path = `/football/match/${competitionSlug}-${game.competitionId}/${awaySlug}-${homeSlug}-${away.id}-${home.id}-${game.competitionId}`;
  const url = new URL(path, "https://www.365scores.com");
  url.hash = `id=${game.id}`;
  return url.toString();
}

async function readSourceJson(
  sessionId: string,
  value: string,
): Promise<unknown> {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new MatchReplaySourceError();
  }
  if (
    url.protocol !== "https:" ||
    !["webws.365scores.com", "pbpgenerator.365scores.com"].includes(
      url.hostname,
    ) ||
    url.username ||
    url.password
  ) {
    throw new MatchReplaySourceError(
      "365Scores returned an unexpected data source. The replay was stopped.",
    );
  }

  const response = await request365ScoresDocument(
    sessionId,
    url.toString(),
    "json",
  );
  return response.document;
}

async function navigate365ScoresPage(
  sessionId: string,
  url: string,
): Promise<void> {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !["www.365scores.com", "365scores.com"].includes(parsed.hostname)
  ) {
    throw new MatchReplaySourceError(
      "365Scores returned an unexpected page address. The replay was stopped.",
    );
  }
  await request365ScoresDocument(sessionId, url, "html");
}

function liveActionSourceIdentifiers(value: string): {
  sourceMatchUrl: string;
  gameId: number;
  teamIds: [number, number];
  competitionId: number;
  matchupId: string;
} {
  let sourceUrl: URL;
  try {
    sourceUrl = new URL(value);
  } catch {
    throw new LiveActionSourceUrlError();
  }
  if (
    sourceUrl.protocol !== "https:" ||
    !["www.365scores.com", "365scores.com"].includes(sourceUrl.hostname) ||
    sourceUrl.port ||
    sourceUrl.username ||
    sourceUrl.password ||
    !sourceUrl.pathname.startsWith("/football/match/")
  ) {
    throw new LiveActionSourceUrlError(
      "Use a 365Scores football match link from the official site.",
    );
  }

  const gameIdValue =
    new URLSearchParams(sourceUrl.hash.replace(/^#/, "")).get("id") ??
    sourceUrl.searchParams.get("id");
  const matchup = sourceUrl.pathname
    .split("/")
    .at(-1)
    ?.match(/-(\d+)-(\d+)-(\d+)$/);
  const gameId = Number(gameIdValue);
  const teamIdOne = Number(matchup?.[1]);
  const teamIdTwo = Number(matchup?.[2]);
  const competitionId = Number(matchup?.[3]);
  if (
    !gameIdValue ||
    !/^\d+$/.test(gameIdValue) ||
    !Number.isSafeInteger(gameId) ||
    gameId < 1 ||
    !Number.isSafeInteger(teamIdOne) ||
    !Number.isSafeInteger(teamIdTwo) ||
    teamIdOne < 1 ||
    teamIdTwo < 1 ||
    teamIdOne === teamIdTwo ||
    !Number.isSafeInteger(competitionId) ||
    competitionId < 1
  ) {
    throw new LiveActionSourceUrlError(
      "The 365Scores match link is missing a valid game or matchup ID.",
    );
  }

  return {
    sourceMatchUrl: sourceUrl.toString(),
    gameId,
    teamIds: [teamIdOne, teamIdTwo],
    competitionId,
    matchupId: `${teamIdOne}-${teamIdTwo}-${competitionId}`,
  };
}

function liveActionGameApiUrl(gameId: number, matchupId: string): string {
  const url = new URL("https://webws.365scores.com/web/game/");
  url.searchParams.set("appTypeId", "5");
  url.searchParams.set("langId", "1");
  url.searchParams.set("timezoneName", "UTC");
  url.searchParams.set("userCountryId", "355");
  url.searchParams.set("gameId", String(gameId));
  url.searchParams.set("matchupId", matchupId);
  return url.toString();
}

function sourceNonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
    ? value
    : null;
}

export async function get365ScoresLiveAction(
  sourceUrl: string,
): Promise<FootballLiveAction> {
  const identifiers = liveActionSourceIdentifiers(sourceUrl);
  const cacheKey = `${identifiers.gameId}:${identifiers.matchupId}`;
  const cached = liveActionCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.snapshot;
  const inFlight = liveActionRequests.get(cacheKey);
  if (inFlight) return inFlight;

  const request = (async (): Promise<FootballLiveAction> => {
    let sessionId: string | null = null;
    try {
      const session = await createBrowserSession();
      sessionId = session.sessionId;
      const gamePayload = sourceObject(
        await readSourceJson(
          sessionId,
          liveActionGameApiUrl(identifiers.gameId, identifiers.matchupId),
        ),
      );
      const game = sourceObject(gamePayload?.game) as SourceGame | null;
      const homeId = game?.homeCompetitor?.id;
      const awayId = game?.awayCompetitor?.id;
      const sourceTeamsMatch =
        typeof homeId === "number" &&
        typeof awayId === "number" &&
        homeId !== awayId &&
        identifiers.teamIds.includes(homeId) &&
        identifiers.teamIds.includes(awayId);
      if (
        !game ||
        game.id !== identifiers.gameId ||
        game.competitionId !== identifiers.competitionId ||
        !sourceTeamsMatch
      ) {
        throw new LiveActionSourceUrlError(
          "The match IDs in this link do not match the data returned by 365Scores.",
        );
      }

      const homeTeam = game.homeCompetitor?.longName?.trim() ||
        game.homeCompetitor?.name?.trim();
      const awayTeam = game.awayCompetitor?.longName?.trim() ||
        game.awayCompetitor?.name?.trim();
      if (!homeTeam || !awayTeam) {
        throw new MatchReplaySourceError(
          "365Scores did not return both team names for this match.",
        );
      }

      let feed: SourceFeedResponse = {};
      if (game.playByPlay?.feedURL) {
        feed =
          (sourceObject(
            await readSourceJson(sessionId, game.playByPlay.feedURL),
          ) as SourceFeedResponse | null) ?? {};
      }
      const comments = formatCommentary(feed);
      const snapshot: FootballLiveAction = {
        sourceMatchUrl: identifiers.sourceMatchUrl,
        gameId: identifiers.gameId,
        competition:
          game.competitionDisplayName?.trim() || "Competition unavailable",
        status:
          game.statusText?.trim() ||
          game.shortStatusText?.trim() ||
          "Status unavailable",
        elapsedMinute:
          typeof game.gameTime === "number" &&
          Number.isFinite(game.gameTime) &&
          game.gameTime >= 0
            ? Math.floor(game.gameTime)
            : null,
        homeTeam,
        awayTeam,
        homeScore: sourceNonNegativeInteger(game.homeCompetitor?.score),
        awayScore: sourceNonNegativeInteger(game.awayCompetitor?.score),
        observedAt: new Date(),
        events: comments.events,
        shotEvents: replayShotEvents(game),
        formationPlayers: replayFormationPlayers(game),
      };
      liveActionCache.set(cacheKey, {
        snapshot,
        expiresAt: Date.now() + LIVE_ACTION_CACHE_TTL_MS,
      });
      if (liveActionCache.size > MAX_REPLAY_CACHE_ENTRIES) {
        const oldestKey = liveActionCache.keys().next().value;
        if (oldestKey !== undefined) liveActionCache.delete(oldestKey);
      }
      return snapshot;
    } catch (error) {
      if (
        error instanceof LiveActionSourceUrlError ||
        error instanceof MatchReplaySourceError ||
        error instanceof UpstreamRateLimitError
      ) {
        throw error;
      }
      throw new MatchReplaySourceError(
        "365Scores live action data could not be read. Please try again shortly.",
      );
    } finally {
      if (sessionId) await closeBrowserSession(sessionId).catch(() => undefined);
    }
  })();

  liveActionRequests.set(cacheKey, request);
  try {
    return await request;
  } finally {
    liveActionRequests.delete(cacheKey);
  }
}

function statsApiUrl(gameId: number, filterId?: number): URL {
  const url = new URL("https://webws.365scores.com/web/game/stats/");
  url.searchParams.set("appTypeId", "5");
  url.searchParams.set("langId", "1");
  url.searchParams.set("timezoneName", "UTC");
  url.searchParams.set("userCountryId", "355");
  url.searchParams.set("games", String(gameId));
  if (filterId !== undefined) url.searchParams.set("filterId", String(filterId));
  return url;
}

function gameMatchesFixture(
  game: SourceGame,
  details: ReplayFixtureContext,
  fixtureDate: Date,
  requireCurrentScore = true,
): boolean {
  const gameDate = game.startTime ?? game.date;
  if (!gameDate || !game.homeCompetitor || !game.awayCompetitor) {
    return false;
  }
  const sourceDate = new Date(gameDate);
  if (
    !Number.isFinite(sourceDate.getTime()) ||
    matchDate(sourceDate) !== matchDate(fixtureDate)
  ) {
    return false;
  }
  const homeName =
    game.homeCompetitor.longName ?? game.homeCompetitor.name ?? "";
  const awayName =
    game.awayCompetitor.longName ?? game.awayCompetitor.name ?? "";
  if (
    !containsTeam(homeName, details.match.home.name) ||
    !containsTeam(awayName, details.match.away.name)
  ) {
    return false;
  }
  const homeScore = game.homeCompetitor.score;
  const awayScore = game.awayCompetitor.score;
  return !requireCurrentScore || (
    (details.match.home.score === null ||
      homeScore === details.match.home.score) &&
    (details.match.away.score === null ||
      awayScore === details.match.away.score)
  );
}

async function load365ScoresMatchReplay(
  details: ReplayFixtureContext,
): Promise<LoadedReplay> {
  const cached = replayCache.get(details.match.fixtureId);
  if (cached && cached.expiresAt > Date.now()) return cached.loaded;

  let sessionId: string | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const sourceTask = (async (): Promise<LoadedReplay> => {
  const fixtureDate = new Date(details.match.date);
  if (!Number.isFinite(fixtureDate.getTime())) {
    throw new MatchReplaySourceError("The match date is unavailable.");
  }
  const date = matchDate(fixtureDate);
  const dayListUrl = new URL(DAY_LIST_URL);
  dayListUrl.searchParams.set("date", date);
  const resultsListUrl = new URL(RESULTS_LIST_URL);
  resultsListUrl.searchParams.set("date", date);
  const competitionId = sourceCompetitionId(details.match.competition);

  try {
    // Start with a blank page: createBrowserSession(initialUrl) would request
    // the same list a second time when readSourceJson runs below.
    const listState = await createBrowserSession();
    sessionId = listState.sessionId;
    let sourceDateListUrl = dayListUrl.toString();
    let matchedGame: SourceGame | null = null;
    let initialMatchArea = "";
    const isLiveFixture = isLiveMatchStatus(details.match.status);

    if (isLiveFixture) {
      const liveListUrl = liveGamesListApiUrl(date);
      const liveListPayload = sourceObject(
        await readSourceJson(sessionId, liveListUrl.toString()),
      );
      const liveGames = sourceEntries(
        liveListPayload?.games as
          | SourceGame[]
          | Record<string, SourceGame>
          | undefined,
      );
      const liveMatches = liveGames.filter((candidate) =>
        gameMatchesFixture(candidate, details, fixtureDate, false),
      );
      if (liveMatches.length > 1) {
        throw new MatchReplayNotFoundError(
          "More than one live 365Scores match matched these fixture teams and date. The replay was stopped to avoid attaching the wrong match.",
        );
      }
      matchedGame = liveMatches[0] ?? null;
      if (matchedGame) sourceDateListUrl = liveListUrl.toString();
    }

    if (!matchedGame && competitionId !== null) {
      const listPayload = sourceObject(
        await readSourceJson(
          sessionId,
          gamesListApiUrl(date, competitionId).toString(),
        ),
      );
      const games = sourceEntries(
        listPayload?.games as
          | SourceGame[]
          | Record<string, SourceGame>
          | undefined,
      );
      const matches = games.filter((candidate) =>
        gameMatchesFixture(
          candidate,
          details,
          fixtureDate,
          !isLiveFixture,
        ),
      );
      if (matches.length > 1) {
        throw new MatchReplayNotFoundError(
          "More than one 365Scores result matched this date, teams, and score. The replay was stopped to avoid attaching the wrong match.",
        );
      }
      matchedGame = matches[0] ?? null;
    }

    if (!matchedGame) {
      await navigate365ScoresPage(sessionId, dayListUrl.toString());
      await waitForBrowserPage(sessionId, PAGE_LOAD_SETTLE_MS);
      let snapshot = await getBrowserState(sessionId);
      let candidates = listCandidates(snapshot, details);

      if (!candidates.length) {
        await navigate365ScoresPage(sessionId, resultsListUrl.toString());
        await waitForBrowserPage(sessionId, PAGE_LOAD_SETTLE_MS);
        snapshot = await getBrowserState(sessionId);
        sourceDateListUrl = resultsListUrl.toString();
        candidates = listCandidates(snapshot, details);
      }

      if (!candidates.length) throw new MatchReplayNotFoundError();
      if (candidates.length > 1) {
        throw new MatchReplayNotFoundError(
          "More than one 365Scores result matched these teams. The replay was stopped to avoid attaching the wrong match.",
        );
      }

      const candidate = candidates[0];
      if (!candidate) throw new MatchReplayNotFoundError();
      const sourceUrl = new URL(candidate.url);
      if (!isAllowedMatchUrl(sourceUrl.toString())) {
        throw new MatchReplaySourceError();
      }

      await navigate365ScoresPage(sessionId, sourceUrl.toString());
      await waitForBrowserPage(sessionId, PAGE_LOAD_SETTLE_MS);
      const matchSnapshot = await getBrowserState(sessionId);
      initialMatchArea = extractMatchArea(matchSnapshot.pageContent.text);
      if (!reportDateMatches(fixtureDate, matchSnapshot.title, initialMatchArea)) {
        throw new MatchReplayNotFoundError(
          "365Scores returned a result from a different date. No replay was attached.",
        );
      }

      const candidateId = new URLSearchParams(
        sourceUrl.hash.replace(/^#/, ""),
      ).get("id");
      const matchupId = sourceUrl.pathname
        .split("/")
        .at(-1)
        ?.match(/(\d+-\d+-\d+)$/)?.[1];
      if (!candidateId || !matchupId) {
        throw new MatchReplayNotFoundError(
          "The 365Scores results link did not include a verifiable match identifier.",
        );
      }
      const fallbackGameUrl = new URL("https://webws.365scores.com/web/game/");
      fallbackGameUrl.searchParams.set("appTypeId", "5");
      fallbackGameUrl.searchParams.set("langId", "1");
      fallbackGameUrl.searchParams.set("timezoneName", "UTC");
      fallbackGameUrl.searchParams.set("userCountryId", "355");
      fallbackGameUrl.searchParams.set("gameId", candidateId);
      fallbackGameUrl.searchParams.set("matchupId", matchupId);
      const gamePayload = sourceObject(
        await readSourceJson(sessionId, fallbackGameUrl.toString()),
      );
      matchedGame = sourceObject(gamePayload?.game) as SourceGame | null;
    }

    if (
      !matchedGame ||
      !gameMatchesFixture(
        matchedGame,
        details,
        fixtureDate,
        !isLiveFixture,
      ) ||
      typeof matchedGame.id !== "number" ||
      !Number.isInteger(matchedGame.id)
    ) {
      throw new MatchReplayNotFoundError(
        "365Scores match data did not confirm the same date, teams, and score. No replay was attached.",
      );
    }

    const sourceMatchUrl = sourceMatchPageUrl(matchedGame, details);
    const gameUrl = gameApiUrl(matchedGame);
    const gamePayload = sourceObject(
      await readSourceJson(sessionId, gameUrl.toString()),
    );
    const game = sourceObject(gamePayload?.game) as SourceGame | null;
    if (
      !game ||
      !gameMatchesFixture(game, details, fixtureDate, !isLiveFixture) ||
      typeof game.id !== "number" ||
      !Number.isInteger(game.id)
    ) {
      throw new MatchReplayNotFoundError(
        "365Scores match data did not confirm the same date, teams, and score. No replay was attached.",
      );
    }

    const gameId = game.id;
    const fullStatsResponse = sourceObject(
      await readSourceJson(sessionId, statsApiUrl(gameId).toString()),
    ) as SourceStatsResponse | null;
    const firstHalfStatsResponse = sourceObject(
      await readSourceJson(sessionId, statsApiUrl(gameId, 6).toString()),
    ) as SourceStatsResponse | null;
    const secondHalfStatsResponse = sourceObject(
      await readSourceJson(sessionId, statsApiUrl(gameId, 8).toString()),
    ) as SourceStatsResponse | null;

    let feed: SourceFeedResponse = {};
    if (game.playByPlay?.feedURL) {
      feed =
        (sourceObject(
          await readSourceJson(sessionId, game.playByPlay.feedURL),
        ) as SourceFeedResponse | null) ?? {};
    }
    const commentary = formatCommentary(feed);
    const lineupText = formatLineups(game);
    const shotEvents = replayShotEvents(game);
    const formationPlayers = replayFormationPlayers(game);
    const fullTimeStats = fullStatsResponse
      ? formatStatistics(fullStatsResponse, game)
      : null;
    const firstHalfStats = firstHalfStatsResponse
      ? formatStatistics(firstHalfStatsResponse, game)
      : null;
    const secondHalfStats = secondHalfStatsResponse
      ? formatStatistics(secondHalfStatsResponse, game)
      : null;
    const shotMapText = formatShotMap(game);
    const timeStats = fullStatsResponse?.actualGameStatistics;
    const timeDetailsText = formatTimeDetails(
      timeStats,
      game,
      feed.Messages ?? [],
    );
    const actualPlayTime =
      parseDuration(timeStats?.actualPlayTime?.actualTime?.name ?? "", "Actual") ??
      parseDuration(game.actualPlayTime?.actualTime?.name ?? "", "Actual") ??
      parseDuration(initialMatchArea, "Actual");
    const totalDuration =
      parseDuration(timeStats?.actualPlayTime?.totalTime?.name ?? "", "Total") ??
      parseDuration(game.actualPlayTime?.totalTime?.name ?? "", "Total") ??
      parseDuration(initialMatchArea, "Total");

    const sections: FootballMatchReplaySection[] = [
      sectionText("lineups", "Lineups, ratings, and substitutions", lineupText ?? ""),
      sectionText("commentary", "Commentary", commentary.text ?? ""),
      sectionText("full-time-stats", "Full-time statistics", fullTimeStats ?? ""),
      sectionText("first-half-stats", "First-half statistics", firstHalfStats ?? ""),
      sectionText("second-half-stats", "Second-half statistics", secondHalfStats ?? ""),
      sectionText("shot-map", "Shot map details", shotMapText ?? ""),
      sectionText("time-details", "Playing time and stoppages", timeDetailsText ?? ""),
    ];
    const halfTimeScore =
      details.match.home.halfTimeScore !== null &&
      details.match.away.halfTimeScore !== null
        ? `${details.match.home.halfTimeScore}–${details.match.away.halfTimeScore}`
        : null;

    const replay: FootballMatchReplay = {
      fixtureId: details.match.fixtureId,
      date: fixtureDate,
      competition: details.match.competition,
      homeTeam: details.match.home.name,
      awayTeam: details.match.away.name,
      homeScore: details.match.home.score,
      awayScore: details.match.away.score,
      halfTimeScore: parseHalfTimeScore(initialMatchArea) ?? halfTimeScore,
      actualPlayTime,
      totalDuration,
      sourceDateListUrl,
      sourceMatchUrl: sourceMatchUrl.toString(),
      events: commentary.events,
      shotEvents,
      formationPlayers,
      sections,
    };

    const loaded: LoadedReplay = {
      replay,
      forensicsFallback: {
        ...build365ScoresForensicsFallback(
          game,
          details,
          fullStatsResponse,
          firstHalfStatsResponse,
          secondHalfStatsResponse,
          commentary.events,
        ),
        halfTimeScore: replay.halfTimeScore,
      },
    };
    replayCache.set(details.match.fixtureId, {
      loaded,
      expiresAt:
        Date.now() +
        (isLiveMatchStatus(details.match.status)
          ? LIVE_SHOT_FEED_CACHE_TTL_MS
          : REPLAY_CACHE_TTL_MS),
    });
    if (replayCache.size > MAX_REPLAY_CACHE_ENTRIES) {
      const oldestFixtureId = replayCache.keys().next().value;
      if (oldestFixtureId !== undefined) replayCache.delete(oldestFixtureId);
    }
    return loaded;
  } catch (error) {
    if (
      error instanceof MatchReplayNotFoundError ||
      error instanceof MatchReplaySourceError ||
      error instanceof UpstreamRateLimitError
    ) {
      throw error;
    }
    throw new MatchReplaySourceError(replayErrorMessage(error));
  } finally {
    if (sessionId) await closeBrowserSession(sessionId).catch(() => undefined);
  }
  })();

  const timeoutTask = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      if (sessionId) void closeBrowserSession(sessionId);
      reject(
        new MatchReplaySourceError(
          "365Scores took too long to load this replay. Please try again shortly.",
        ),
      );
    }, REPLAY_SOURCE_TIMEOUT_MS);
  });

  try {
    return await Promise.race([sourceTask, timeoutTask]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export async function get365ScoresMatchReplay(
  details: ReplayFixtureContext,
): Promise<FootballMatchReplay> {
  return (await get365ScoresLoadedMatch(details)).replay;
}

export async function get365ScoresMatchForensicsFallback(
  details: ReplayFixtureContext,
): Promise<FootballMatchForensicsFallback> {
  return (await get365ScoresLoadedMatch(details)).forensicsFallback;
}

async function get365ScoresLoadedMatch(
  details: ReplayFixtureContext,
): Promise<LoadedReplay> {
  const cached = replayCache.get(details.match.fixtureId);
  if (cached && cached.expiresAt > Date.now()) return cached.loaded;

  const inFlight = replayRequests.get(details.match.fixtureId);
  if (inFlight) return inFlight;

  const request = load365ScoresMatchReplay(details);
  replayRequests.set(details.match.fixtureId, request);
  try {
    return await request;
  } finally {
    if (replayRequests.get(details.match.fixtureId) === request) {
      replayRequests.delete(details.match.fixtureId);
    }
  }
}
