import type {
  FootballOddsMarketCategory,
  FootballLastFiveEvent,
  FootballLastFiveLineup,
  FootballLastFiveLineupPlayer,
  FootballLastFiveMarketBookmaker,
  FootballLastFiveOddsMarket,
  FootballLastFivePlayer,
  FootballLastFivePlayerGroup,
  FootballLastFiveStat,
  FootballLastFiveTeam,
  FootballLastFiveTeamStatistics,
  FootballMatchLastFive,
  FootballRecentMatch,
} from "@workspace/api-zod";
import {
  fetchKickoffScoreJson,
  getKickoffScoreMatchDetails,
  oddsCategory,
  KickoffScoreMatchNotFoundError,
} from "./kickoffscore-match-details";
import { UpstreamRateLimitError } from "./upstream-rate-limit";

const KICKOFFSCORE_SITE_ORIGIN = "https://kickoffscore.com";
const LAST_FIVE_CACHE_TTL_MS = 5 * 60_000;
const MAX_LAST_FIVE_CACHE_ENTRIES = 24;
const MAX_PREMATCH_STATS = 500;

type JsonObject = Record<string, unknown>;
type CacheEntry = { expiresAt: number; data: FootballMatchLastFive };
type HistoricalFixture = {
  fixtureId: number;
  date: Date;
  homeTeamId: number;
  homeTeamName: string;
  awayTeamId: number;
  awayTeamName: string;
  homeScore: number;
  awayScore: number;
};
type TeamHistoryCacheEntry = {
  expiresAt: number;
  matches: HistoricalFixture[];
};

const resultCache = new Map<number, CacheEntry>();
const inFlightResults = new Map<number, Promise<FootballMatchLastFive>>();
const teamHistoryCache = new Map<number, TeamHistoryCacheEntry>();
const inFlightTeamHistory = new Map<number, Promise<HistoricalFixture[]>>();

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function responseRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const object = asObject(value);
  return asArray(object?.response ?? object?.data);
}

function collection(value: unknown, key: string): unknown[] {
  return asArray(asObject(value)?.[key]);
}

function fixtureRows(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const object = asObject(value);
  const wrapped = object?.response ?? object?.data;
  return Array.isArray(wrapped) ? wrapped : object ? [object] : [];
}

function fixtureObject(value: unknown): JsonObject | null {
  return fixtureRows(value).map(asObject).find((row) => row !== null) ?? null;
}

function asString(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function asInteger(value: unknown): number | null {
  const parsed = asNumber(value);
  return parsed !== null && Number.isInteger(parsed) ? parsed : null;
}

function safeImageUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value) return null;
  try {
    const url = new URL(value, KICKOFFSCORE_SITE_ORIGIN);
    if (
      url.protocol !== "https:" ||
      ![
        "kickoffscore.com",
        "api.kickoffscore.com",
        "media.api-sports.io",
      ].includes(url.hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function sourceMatchUrl(match: FootballRecentMatch): string {
  const slugify = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  return `${KICKOFFSCORE_SITE_ORIGIN}/match/${slugify(match.homeTeam.name)}-vs-${slugify(match.awayTeam.name)}/${match.fixtureId}`;
}

function statValue(value: unknown): string | number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return null;
}

function flattenValues(
  value: unknown,
  prefix: string,
  target: FootballLastFiveStat[],
): void {
  if (target.length >= MAX_PREMATCH_STATS || value === null) return;

  if (typeof value === "string" || typeof value === "number") {
    target.push({ label: prefix || "Value", value });
    return;
  }
  if (typeof value === "boolean") {
    target.push({ label: prefix || "Value", value: value ? "Yes" : "No" });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      if (target.length < MAX_PREMATCH_STATS) {
        flattenValues(item, `${prefix}[${index + 1}]`, target);
      }
    });
    return;
  }
  const object = asObject(value);
  if (!object) return;
  for (const [key, child] of Object.entries(object)) {
    if (target.length >= MAX_PREMATCH_STATS) break;
    flattenValues(child, prefix ? `${prefix} · ${key}` : key, target);
  }
}

function parseStatistics(payload: unknown): FootballLastFiveTeamStatistics[] {
  const periods = [
    { key: "statistics", label: "Full match" },
    { key: "statistics_1h", label: "1st half" },
    { key: "statistics_2h", label: "2nd half" },
  ];
  const teams = new Map<
    string,
    FootballLastFiveTeamStatistics
  >();

  for (const entry of collection(payload, "statistics")) {
    const teamStats = asObject(entry);
    const team = asObject(teamStats?.team);
    const teamId = asInteger(team?.id);
    const teamName = asString(team?.name);
    if (!teamName) continue;
    const teamKey = teamId === null ? teamName : String(teamId);
    const parsed = teams.get(teamKey) ?? {
      teamId,
      teamName,
      statistics: [],
    };

    for (const period of periods) {
      for (const statValue of asArray(teamStats?.[period.key])) {
        const stat = asObject(statValue);
        const label = asString(stat?.type);
        if (!label) continue;
        parsed.statistics.push({
          label: `${period.label} · ${label}`,
          value: statValueValue(stat?.value),
        });
      }
    }
    teams.set(teamKey, parsed);
  }

  return [...teams.values()].filter((team) => team.statistics.length > 0);
}

function statValueValue(value: unknown): string | number | null {
  return statValue(value);
}

function parseEntityName(value: unknown): string | null {
  const object = asObject(value);
  return asString(object?.name);
}

function parseEvents(payload: unknown): FootballLastFiveEvent[] {
  return collection(payload, "events")
    .flatMap((value) => {
      const row = asObject(value);
      const time = asObject(row?.time);
      const team = asObject(row?.team);
      const player = asObject(row?.player);
      const assist = asObject(row?.assist);
      const type = asString(row?.type);
      if (!type) return [];
      return [
        {
          minute: asInteger(time?.elapsed),
          extraMinute: asInteger(time?.extra),
          teamId: asInteger(team?.id),
          teamName: asString(team?.name),
          player: parseEntityName(player),
          assist: parseEntityName(assist),
          type,
          detail: asString(row?.detail),
          comments: asString(row?.comments),
        },
      ];
    })
    .sort((left, right) => {
      const leftMinute = left.minute ?? Number.MAX_SAFE_INTEGER;
      const rightMinute = right.minute ?? Number.MAX_SAFE_INTEGER;
      return leftMinute - rightMinute || (left.extraMinute ?? 0) - (right.extraMinute ?? 0);
    });
}

function parseLineupPlayers(value: unknown): FootballLastFiveLineupPlayer[] {
  return asArray(value).flatMap((entry) => {
    const object = asObject(entry);
    const player = asObject(object?.player) ?? object;
    const name = asString(player?.name);
    if (!name) return [];
    return [
      {
        id: asInteger(player?.id),
        name,
        number: asInteger(player?.number),
        position: asString(player?.pos) ?? asString(player?.position),
        grid: asString(player?.grid),
      },
    ];
  });
}

function parseLineups(payload: unknown): FootballLastFiveLineup[] {
  return collection(payload, "lineups").flatMap((value) => {
    const row = asObject(value);
    const team = asObject(row?.team);
    const teamId = asInteger(team?.id);
    const teamName = asString(team?.name);
    if (!teamName) return [];
    const coach = asObject(row?.coach);
    return [
      {
        teamId,
        teamName,
        formation: asString(row?.formation),
        coach: asString(coach?.name),
        starters: parseLineupPlayers(row?.startXI),
        substitutes: parseLineupPlayers(row?.substitutes),
      },
    ];
  });
}

function flattenPlayerStatistics(value: unknown): FootballLastFiveStat[] {
  const stats: FootballLastFiveStat[] = [];
  flattenValues(value, "Player", stats);
  return stats;
}

function parsePlayers(payload: unknown): FootballLastFivePlayerGroup[] {
  return collection(payload, "players").flatMap((value) => {
    const row = asObject(value);
    const team = asObject(row?.team);
    const teamName = asString(team?.name);
    if (!teamName) return [];
    const players = asArray(row?.players).flatMap((entry) => {
      const playerRow = asObject(entry);
      const player = asObject(playerRow?.player);
      const name = asString(player?.name);
      if (!name) return [];
      const statistics = asArray(playerRow?.statistics)
        .map(asObject)
        .filter((item): item is JsonObject => item !== null);
      const games = asObject(statistics[0]?.games);
      const rating = asString(games?.rating);
      return [
        {
          id: asInteger(player?.id),
          name,
          photo: safeImageUrl(player?.photo),
          number: asInteger(games?.number),
          position: asString(games?.position),
          rating,
          statistics: flattenPlayerStatistics(statistics[0] ?? {}),
        } satisfies FootballLastFivePlayer,
      ];
    });
    return players.length
      ? [
          {
            teamId: asInteger(team?.id),
            teamName,
            players,
          },
        ]
      : [];
  });
}

function parseHistoricalFixture(value: unknown): HistoricalFixture | null {
  const object = asObject(value);
  const fixture = asObject(object?.fixture);
  const teams = asObject(object?.teams);
  const home = asObject(teams?.home);
  const away = asObject(teams?.away);
  const goals = asObject(object?.goals);
  const score = asObject(object?.score);
  const fullTime = asObject(score?.fulltime);
  const fixtureId = asInteger(fixture?.id) ?? asInteger(object?._id);
  const dateValue = asString(fixture?.date);
  const homeTeamId = asInteger(home?.id);
  const awayTeamId = asInteger(away?.id);
  const homeTeamName = asString(home?.name);
  const awayTeamName = asString(away?.name);
  const homeScore =
    asInteger(goals?.home) ?? asInteger(fullTime?.home);
  const awayScore =
    asInteger(goals?.away) ?? asInteger(fullTime?.away);

  if (
    fixtureId === null ||
    !dateValue ||
    !Number.isFinite(Date.parse(dateValue)) ||
    homeTeamId === null ||
    awayTeamId === null ||
    !homeTeamName ||
    !awayTeamName ||
    homeScore === null ||
    awayScore === null
  ) {
    return null;
  }

  return {
    fixtureId,
    date: new Date(dateValue),
    homeTeamId,
    homeTeamName,
    awayTeamId,
    awayTeamName,
    homeScore,
    awayScore,
  };
}

async function getTeamHistory(teamId: number): Promise<HistoricalFixture[]> {
  const cached = teamHistoryCache.get(teamId);
  if (cached && cached.expiresAt > Date.now()) return cached.matches;

  const active = inFlightTeamHistory.get(teamId);
  if (active) return active;

  const request = fetchKickoffScoreJson("/api/fixtures", {
    team: String(teamId),
    last: "100",
    summary: "true",
  })
    .then((payload) =>
      fixtureRows(payload)
        .flatMap((value) => {
          const match = parseHistoricalFixture(value);
          return match ? [match] : [];
        })
        .sort((left, right) => right.date.getTime() - left.date.getTime()),
    )
    .then((matches) => {
      teamHistoryCache.set(teamId, {
        matches,
        expiresAt: Date.now() + LAST_FIVE_CACHE_TTL_MS,
      });
      return matches;
    })
    .finally(() => inFlightTeamHistory.delete(teamId));

  inFlightTeamHistory.set(teamId, request);
  return request;
}

function teamResult(
  match: HistoricalFixture,
  teamId: number,
): { outcome: "W" | "D" | "L"; scored: number; conceded: number } {
  const home = match.homeTeamId === teamId;
  const scored = home ? match.homeScore : match.awayScore;
  const conceded = home ? match.awayScore : match.homeScore;
  return {
    outcome: scored > conceded ? "W" : scored < conceded ? "L" : "D",
    scored,
    conceded,
  };
}

function historyBefore(
  matches: HistoricalFixture[],
  fixtureId: number,
  kickoff: Date,
): HistoricalFixture[] {
  const kickoffTime = kickoff.getTime();
  return matches
    .filter(
      (match) =>
        match.fixtureId !== fixtureId && match.date.getTime() < kickoffTime,
    )
    .sort((left, right) => right.date.getTime() - left.date.getTime());
}

function summarizeTeamBeforeKickoff(
  teamId: number,
  teamName: string,
  matches: HistoricalFixture[],
  fixtureId: number,
  kickoff: Date,
): FootballLastFiveStat[] {
  const recent = historyBefore(matches, fixtureId, kickoff).slice(0, 6);
  const results = recent.map((match) => teamResult(match, teamId));
  const wins = results.filter((result) => result.outcome === "W").length;
  const draws = results.filter((result) => result.outcome === "D").length;
  const losses = results.filter((result) => result.outcome === "L").length;
  const goalsFor = results.reduce((sum, result) => sum + result.scored, 0);
  const goalsAgainst = results.reduce((sum, result) => sum + result.conceded, 0);
  const average = (total: number) =>
    recent.length ? Number((total / recent.length).toFixed(2)) : null;
  const scoredBoth = recent.filter(
    (match) => match.homeScore > 0 && match.awayScore > 0,
  ).length;
  const overTwoAndHalf = recent.filter(
    (match) => match.homeScore + match.awayScore > 2,
  ).length;
  const cleanSheets = results.filter((result) => result.conceded === 0).length;
  const form = results
    .slice(0, 5)
    .reverse()
    .map((result) => result.outcome)
    .join(" ");

  return [
    { label: `${teamName} · Matches before kickoff`, value: recent.length },
    { label: `${teamName} · Form (W-D-L)`, value: `${wins}-${draws}-${losses}` },
    {
      label: `${teamName} · Recent form, oldest to newest`,
      value: form || "Not available",
    },
    {
      label: `${teamName} · Goals scored per match`,
      value: average(goalsFor),
    },
    {
      label: `${teamName} · Goals conceded per match`,
      value: average(goalsAgainst),
    },
    {
      label: `${teamName} · Both teams scored`,
      value: `${scoredBoth}/${recent.length}`,
    },
    {
      label: `${teamName} · Over 2.5 goals`,
      value: `${overTwoAndHalf}/${recent.length}`,
    },
    {
      label: `${teamName} · Clean sheets`,
      value: `${cleanSheets}/${recent.length}`,
    },
  ];
}

function summarizeHeadToHead(
  homeTeamId: number,
  homeTeamName: string,
  awayTeamName: string,
  matches: HistoricalFixture[],
  fixtureId: number,
  kickoff: Date,
): FootballLastFiveStat[] {
  const meetings = historyBefore(matches, fixtureId, kickoff);
  let homeWins = 0;
  let draws = 0;
  let awayWins = 0;
  for (const match of meetings) {
    if (match.homeScore === match.awayScore) {
      draws += 1;
      continue;
    }
    const winnerId =
      match.homeScore > match.awayScore
        ? match.homeTeamId
        : match.awayTeamId;
    if (winnerId === homeTeamId) homeWins += 1;
    else awayWins += 1;
  }
  return [
    { label: "Head-to-head meetings before kickoff", value: meetings.length },
    { label: `${homeTeamName} head-to-head wins`, value: homeWins },
    { label: "Head-to-head draws", value: draws },
    { label: `${awayTeamName} head-to-head wins`, value: awayWins },
  ];
}

async function loadPrematchStats(
  match: FootballRecentMatch,
  issues: string[],
): Promise<FootballLastFiveStat[]> {
  const safeHistory = async (teamId: number, name: string) => {
    try {
      return await getTeamHistory(teamId);
    } catch (error) {
      if (error instanceof UpstreamRateLimitError) throw error;
      issues.push(`${name} prematch form was not supplied.`);
      return [];
    }
  };
  const safeHeadToHead = async () => {
    try {
      const payload = await fetchKickoffScoreJson("/api/fixtures/h2h", {
        h2h: `${match.homeTeam.id}-${match.awayTeam.id}`,
      });
      return fixtureRows(payload)
        .flatMap((value) => {
          const meeting = parseHistoricalFixture(value);
          return meeting ? [meeting] : [];
        })
        .sort((left, right) => right.date.getTime() - left.date.getTime());
    } catch (error) {
      if (error instanceof UpstreamRateLimitError) throw error;
      issues.push("Head-to-head prematch context was not supplied.");
      return [];
    }
  };

  const [homeHistory, awayHistory, h2hHistory] = await Promise.all([
    safeHistory(match.homeTeam.id, match.homeTeam.name),
    safeHistory(match.awayTeam.id, match.awayTeam.name),
    safeHeadToHead(),
  ]);

  return [
    ...summarizeTeamBeforeKickoff(
      match.homeTeam.id,
      match.homeTeam.name,
      homeHistory,
      match.fixtureId,
      match.date,
    ),
    ...summarizeTeamBeforeKickoff(
      match.awayTeam.id,
      match.awayTeam.name,
      awayHistory,
      match.fixtureId,
      match.date,
    ),
    ...summarizeHeadToHead(
      match.homeTeam.id,
      match.homeTeam.name,
      match.awayTeam.name,
      h2hHistory,
      match.fixtureId,
      match.date,
    ),
  ];
}

function parseOdds(payload: unknown): FootballLastFiveOddsMarket[] {
  const markets = new Map<
    string,
    {
      marketId: string;
      name: string;
      category: FootballOddsMarketCategory;
      bookmakers: Map<string, FootballLastFiveMarketBookmaker>;
    }
  >();

  for (const rowValue of responseRows(payload)) {
    const row = asObject(rowValue);
    for (const bookmakerValue of asArray(row?.bookmakers)) {
      const bookmaker = asObject(bookmakerValue);
      const bookmakerName = asString(bookmaker?.name);
      if (!bookmakerName) continue;
      for (const betValue of asArray(bookmaker?.bets)) {
        const bet = asObject(betValue);
        const marketName = asString(bet?.name);
        if (!marketName) continue;
        const rawMarketId = bet?.id;
        const marketId =
          asString(rawMarketId) ?? String(asInteger(rawMarketId) ?? marketName);
        const key = `${marketId}:${marketName}`;
        const market = markets.get(key) ?? {
          marketId,
          name: marketName,
          category: oddsCategory(marketName),
          bookmakers: new Map<string, FootballLastFiveMarketBookmaker>(),
        };
        markets.set(key, market);

        const currentBookmaker = market.bookmakers.get(bookmakerName) ?? {
          name: bookmakerName,
          selections: [],
        };
        for (const selectionValue of asArray(bet?.values)) {
          const selection = asObject(selectionValue);
          const name = asString(selection?.value);
          const odd = asNumber(selection?.odd);
          if (name && odd !== null && odd > 0) {
            currentBookmaker.selections.push({ selection: name, odd });
          }
        }
        market.bookmakers.set(bookmakerName, currentBookmaker);
      }
    }
  }

  return [...markets.values()].map((market) => ({
    marketId: market.marketId,
    name: market.name,
    category: market.category,
    bookmakers: [...market.bookmakers.values()].map((bookmaker) => ({
      ...bookmaker,
      selections: bookmaker.selections.filter(
        (selection, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.selection === selection.selection &&
              candidate.odd === selection.odd,
          ) === index,
      ),
    })),
  }));
}

async function loadSection<T>(
  fixtureId: number,
  label: string,
  endpoint: string,
  parser: (payload: unknown) => T,
  emptyValue: T,
  issues: string[],
): Promise<T> {
  try {
    const payload = await fetchKickoffScoreJson(endpoint, {
      fixture: String(fixtureId),
    });
    return parser(payload);
  } catch (error) {
    if (error instanceof UpstreamRateLimitError) throw error;
    issues.push(`${label} were not supplied for this match.`);
    return emptyValue;
  }
}

async function loadMatch(match: FootballRecentMatch) {
  const issues: string[] = [];
  const fixtureId = match.fixtureId;
  let fixturePayload: unknown = null;
  try {
    fixturePayload = await fetchKickoffScoreJson("/api/fixtures", {
      id: String(fixtureId),
    });
  } catch (error) {
    if (error instanceof UpstreamRateLimitError) throw error;
    issues.push("Detailed match records were not supplied by the source.");
  }
  const fixture = fixtureObject(fixturePayload);
  const statistics = parseStatistics(fixture);
  const events = parseEvents(fixture);
  const lineups = parseLineups(fixture);
  const players = parsePlayers(fixture);
  if (!statistics.length) issues.push("Match statistics were not supplied for this match.");
  if (!events.length) issues.push("Commentary and events were not supplied for this match.");
  if (!lineups.length) issues.push("Lineups were not supplied for this match.");
  if (!players.length) issues.push("Player statistics were not supplied for this match.");

  const [oddsMarkets, prematchStats] = await Promise.all([
    loadSection(fixtureId, "Odds markets", "/api/odds", parseOdds, [], issues),
    loadPrematchStats(match, issues),
  ]);
  if (!oddsMarkets.length) {
    issues.push("Historical odds markets were not returned for this match.");
  }
  if (
    fixture &&
    !("shotMap" in fixture) &&
    !("shotmap" in fixture) &&
    !("shots" in fixture) &&
    !("xgTimeline" in fixture) &&
    !("xgProgression" in fixture)
  ) {
    issues.push("Shot locations and xG progression were not included in the source data.");
  }

  return {
    match,
    sourceUrl: sourceMatchUrl(match),
    statistics,
    events,
    lineups,
    players,
    oddsMarkets,
    prematchStats,
    issues,
  };
}

async function loadLastFive(fixtureId: number): Promise<FootballMatchLastFive> {
  const details = await getKickoffScoreMatchDetails(fixtureId);
  const homeRecent = details.homeRecent.slice(0, 5);
  const awayRecent = details.awayRecent.slice(0, 5);
  const recentByFixture = new Map<number, FootballRecentMatch>();
  for (const recent of [...homeRecent, ...awayRecent]) {
    if (!recentByFixture.has(recent.fixtureId)) {
      recentByFixture.set(recent.fixtureId, recent);
    }
  }

  const richMatchByFixture = new Map<number, Awaited<ReturnType<typeof loadMatch>>>();
  const uniqueRecent = [...recentByFixture.values()];
  for (let offset = 0; offset < uniqueRecent.length; offset += 2) {
    const batch = uniqueRecent.slice(offset, offset + 2);
    const loaded = await Promise.all(batch.map((match) => loadMatch(match)));
    loaded.forEach((match) => richMatchByFixture.set(match.match.fixtureId, match));
  }

  const convertTeam = (
    id: number,
    name: string,
    logo: string | null,
    matches: FootballRecentMatch[],
  ): FootballLastFiveTeam => ({
    team: { id, name, logo },
    matches: matches.flatMap((match) => {
      const richMatch = richMatchByFixture.get(match.fixtureId);
      return richMatch ? [richMatch] : [];
    }),
  });

  return {
    fixtureId,
    home: convertTeam(
      details.match.home.id,
      details.match.home.name,
      details.match.home.logo,
      homeRecent,
    ),
    away: convertTeam(
      details.match.away.id,
      details.match.away.name,
      details.match.away.logo,
      awayRecent,
    ),
    issues: details.issues
      .filter((issue) => issue.section === "homeRecent" || issue.section === "awayRecent")
      .map((issue) => issue.message),
  };
}

export function getKickoffScoreMatchLastFive(
  fixtureId: number,
): Promise<FootballMatchLastFive> {
  const cached = resultCache.get(fixtureId);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data);

  const existing = inFlightResults.get(fixtureId);
  if (existing) return existing;

  const request = loadLastFive(fixtureId)
    .then((data) => {
      resultCache.set(fixtureId, {
        data,
        expiresAt: Date.now() + LAST_FIVE_CACHE_TTL_MS,
      });
      if (resultCache.size > MAX_LAST_FIVE_CACHE_ENTRIES) {
        const oldestFixtureId = resultCache.keys().next().value;
        if (oldestFixtureId !== undefined) resultCache.delete(oldestFixtureId);
      }
      return data;
    })
    .finally(() => {
      inFlightResults.delete(fixtureId);
    });

  inFlightResults.set(fixtureId, request);
  return request;
}

export { KickoffScoreMatchNotFoundError };
