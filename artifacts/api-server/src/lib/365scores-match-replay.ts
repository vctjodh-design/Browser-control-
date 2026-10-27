import type {
  FootballMatchDetails,
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
  navigateBrowser,
  navigateBrowserJsonDocument,
  waitForBrowserPage,
} from "./browser-controller";

const DAY_LIST_URL = "https://www.365scores.com/football/yesterdays-matches";
const RESULTS_LIST_URL = "https://www.365scores.com/football/match-results";
const PAGE_LOAD_SETTLE_MS = 3_500;
const REPLAY_CACHE_TTL_MS = 10 * 60 * 1_000;
const REPLAY_SOURCE_TIMEOUT_MS = 45_000;
const MAX_REPLAY_CACHE_ENTRIES = 60;

type BrowserSnapshot = Awaited<ReturnType<typeof getBrowserState>>;
type SectionKey = FootballMatchReplaySection["key"];

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
  startTime?: string;
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

const replayCache = new Map<
  number,
  { expiresAt: number; replay: FootballMatchReplay }
>();

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
  details: FootballMatchDetails,
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

function gameApiUrl(sourceMatchUrl: URL): URL {
  const hashParams = new URLSearchParams(sourceMatchUrl.hash.replace(/^#/, ""));
  const rawGameId =
    hashParams.get("id") ?? sourceMatchUrl.searchParams.get("id");
  const rawMatchupId = sourceMatchUrl.pathname
    .split("/")
    .at(-1)
    ?.match(/(\d+-\d+-\d+)$/)?.[1];
  if (!rawGameId || !/^\d+$/.test(rawGameId) || !rawMatchupId) {
    throw new MatchReplayNotFoundError(
      "The 365Scores results link did not include a verifiable match identifier.",
    );
  }

  const url = new URL("https://webws.365scores.com/web/game/");
  url.searchParams.set("appTypeId", "5");
  url.searchParams.set("langId", "1");
  url.searchParams.set("timezoneName", "UTC");
  url.searchParams.set("userCountryId", "355");
  url.searchParams.set("gameId", rawGameId);
  url.searchParams.set("matchupId", rawMatchupId);
  return url;
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

  const response = await navigateBrowserJsonDocument(sessionId, url.toString());
  try {
    if (new URL(response.currentUrl).hostname !== url.hostname) {
      throw new MatchReplaySourceError(
        "365Scores redirected the replay to an unexpected source.",
      );
    }
  } catch (error) {
    if (error instanceof MatchReplaySourceError) throw error;
    throw new MatchReplaySourceError();
  }
  return response.document;
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
  details: FootballMatchDetails,
  fixtureDate: Date,
): boolean {
  if (!game.startTime || !game.homeCompetitor || !game.awayCompetitor) {
    return false;
  }
  const sourceDate = new Date(game.startTime);
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
  return (
    (details.match.home.score === null ||
      homeScore === details.match.home.score) &&
    (details.match.away.score === null ||
      awayScore === details.match.away.score)
  );
}

export async function get365ScoresMatchReplay(
  details: FootballMatchDetails,
): Promise<FootballMatchReplay> {
  const cached = replayCache.get(details.match.fixtureId);
  if (cached && cached.expiresAt > Date.now()) return cached.replay;

  let sessionId: string | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const sourceTask = (async (): Promise<FootballMatchReplay> => {
  const fixtureDate = new Date(details.match.date);
  if (!Number.isFinite(fixtureDate.getTime())) {
    throw new MatchReplaySourceError("The match date is unavailable.");
  }
  const date = matchDate(fixtureDate);
  const dayListUrl = new URL(DAY_LIST_URL);
  dayListUrl.searchParams.set("date", date);
  const resultsListUrl = new URL(RESULTS_LIST_URL);
  resultsListUrl.searchParams.set("date", date);

  try {
    const listState = await createBrowserSession(dayListUrl.toString());
    sessionId = listState.sessionId;
    await waitForBrowserPage(sessionId, PAGE_LOAD_SETTLE_MS);
    let snapshot = await getBrowserState(sessionId);
    let sourceDateListUrl = dayListUrl.toString();
    let candidates = listCandidates(snapshot, details);

    if (!candidates.length) {
      await navigateBrowser(sessionId, resultsListUrl.toString());
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
    const sourceMatchUrl = new URL(candidate.url);
    if (!isAllowedMatchUrl(sourceMatchUrl.toString())) {
      throw new MatchReplaySourceError();
    }

    await navigateBrowser(sessionId, sourceMatchUrl.toString());
    await waitForBrowserPage(sessionId, PAGE_LOAD_SETTLE_MS);
    const matchSnapshot = await getBrowserState(sessionId);
    const initialMatchArea = extractMatchArea(matchSnapshot.pageContent.text);
    if (!reportDateMatches(fixtureDate, matchSnapshot.title, initialMatchArea)) {
      throw new MatchReplayNotFoundError(
        "365Scores returned a result from a different date. No replay was attached.",
      );
    }

    const gameUrl = gameApiUrl(sourceMatchUrl);
    const gamePayload = sourceObject(
      await readSourceJson(sessionId, gameUrl.toString()),
    );
    const rawGame = gamePayload?.game;
    const game = sourceObject(rawGame) as SourceGame | null;
    if (
      !game ||
      !gameMatchesFixture(game, details, fixtureDate) ||
      typeof game.id !== "number"
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
    const dateListText = snapshot.pageContent.text;
    if (!dateListText) throw new MatchReplaySourceError();

    const replay: FootballMatchReplay = {
      fixtureId: details.match.fixtureId,
      date: fixtureDate,
      competition: details.match.competition,
      homeTeam: details.match.home.name,
      awayTeam: details.match.away.name,
      homeScore: details.match.home.score,
      awayScore: details.match.away.score,
      halfTimeScore: parseHalfTimeScore(initialMatchArea),
      actualPlayTime,
      totalDuration,
      sourceDateListUrl,
      sourceMatchUrl: sourceMatchUrl.toString(),
      events: commentary.events,
      shotEvents,
      formationPlayers,
      sections,
    };

    replayCache.set(details.match.fixtureId, {
      replay,
      expiresAt: Date.now() + REPLAY_CACHE_TTL_MS,
    });
    if (replayCache.size > MAX_REPLAY_CACHE_ENTRIES) {
      const oldestFixtureId = replayCache.keys().next().value;
      if (oldestFixtureId !== undefined) replayCache.delete(oldestFixtureId);
    }
    return replay;
  } catch (error) {
    if (
      error instanceof MatchReplayNotFoundError ||
      error instanceof MatchReplaySourceError
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
