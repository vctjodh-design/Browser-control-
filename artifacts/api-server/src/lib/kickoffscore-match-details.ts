import type {
  FootballMatchDetails,
  FootballMatchDetailsIssue,
  FootballMatchDetailsIssueSection,
  FootballMatchSummary,
  FootballOddsMarket,
  FootballOddsMarketCategory,
  FootballOddsSelection,
  FootballRecentMatch,
  FootballStandingsRow,
} from "@workspace/api-zod";
import {
  fetchRespectingRateLimits,
  UpstreamRateLimitError,
} from "./upstream-rate-limit";

const KICKOFFSCORE_API_ORIGIN = "https://api.kickoffscore.com";
const KICKOFFSCORE_SITE_ORIGIN = "https://kickoffscore.com";
const REQUEST_TIMEOUT_MS = 15_000;
const DETAILS_CACHE_TTL_MS = 60_000;
const MAX_DETAILS_CACHE_ENTRIES = 80;
const MAX_RESPONSE_BYTES = 6_000_000;

type JsonObject = Record<string, unknown>;

class KickoffScoreApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KickoffScoreApiError";
  }
}

export class KickoffScoreMatchNotFoundError extends Error {
  constructor() {
    super("That match could not be found on KickoffScore.");
    this.name = "KickoffScoreMatchNotFoundError";
  }
}

const detailsCache = new Map<
  number,
  { expiresAt: number; details: FootballMatchDetails }
>();
const inFlightDetails = new Map<number, Promise<FootballMatchDetails>>();

function asObject(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
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

export async function fetchKickoffScoreJson(
  path: string,
  query: Record<string, string>,
): Promise<unknown> {
  const url = new URL(path, KICKOFFSCORE_API_ORIGIN);
  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }

  let response: Response;
  try {
    response = await fetchRespectingRateLimits(url, {
      headers: {
        accept: "application/json",
        "user-agent": "BrowserControl/1.0",
      },
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof UpstreamRateLimitError) throw error;
    throw new KickoffScoreApiError("KickoffScore could not be reached.");
  }

  if (!response.ok) {
    throw new KickoffScoreApiError(
      `KickoffScore returned HTTP ${response.status}.`,
    );
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    throw new KickoffScoreApiError(
      "KickoffScore returned an unexpected data format.",
    );
  }

  const body = await response.text();
  if (body.length > MAX_RESPONSE_BYTES) {
    throw new KickoffScoreApiError(
      "KickoffScore returned more data than expected.",
    );
  }

  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new KickoffScoreApiError(
      "KickoffScore returned invalid JSON data.",
    );
  }
}

function sourceMatchUrl(
  fixtureId: number,
  homeTeam: string,
  awayTeam: string,
): string {
  const slugify = (value: string) =>
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/&/g, " and ")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  const slug = `${slugify(homeTeam)}-vs-${slugify(awayTeam)}`;
  return `${KICKOFFSCORE_SITE_ORIGIN}/match/${slug}/${fixtureId}`;
}

function parseMatchSummary(
  payload: unknown,
  requestedFixtureId: number,
): FootballMatchSummary | null {
  const object = asObject(payload);
  const fixture = asObject(object?.fixture);
  const league = asObject(object?.league);
  const teams = asObject(object?.teams);
  const home = asObject(teams?.home);
  const away = asObject(teams?.away);
  const goals = asObject(object?.goals);
  const score = asObject(object?.score);
  const halfTime = asObject(score?.halftime);
  const venue = asObject(fixture?.venue);
  const fixtureId = asInteger(fixture?.id) ?? asInteger(object?._id);
  const date = asString(fixture?.date);
  const homeId = asInteger(home?.id);
  const awayId = asInteger(away?.id);
  const homeName = asString(home?.name);
  const awayName = asString(away?.name);

  if (
    fixtureId !== requestedFixtureId ||
    !date ||
    !Number.isFinite(Date.parse(date)) ||
    homeId === null ||
    awayId === null ||
    !homeName ||
    !awayName
  ) {
    return null;
  }

  const leagueName = asString(league?.name);
  const country = asString(league?.country);
  const competition =
    leagueName && country
      ? `${country}: ${leagueName}`
      : (leagueName ?? "Football");
  const status = asObject(fixture?.status);

  return {
    fixtureId,
    date: new Date(date),
    competition,
    status: asString(status?.long) ?? asString(status?.short) ?? "Unknown",
    venue: asString(venue?.name),
    leagueId: asInteger(league?.id),
    season: asInteger(league?.season),
    home: {
      id: homeId,
      name: homeName,
      logo: safeImageUrl(home?.logo),
      score: asInteger(goals?.home) ?? asInteger(asObject(score?.fulltime)?.home),
      halfTimeScore: asInteger(halfTime?.home),
    },
    away: {
      id: awayId,
      name: awayName,
      logo: safeImageUrl(away?.logo),
      score: asInteger(goals?.away) ?? asInteger(asObject(score?.fulltime)?.away),
      halfTimeScore: asInteger(halfTime?.away),
    },
  };
}

function parseRecentMatch(value: unknown): FootballRecentMatch | null {
  const object = asObject(value);
  const fixture = asObject(object?.fixture);
  const league = asObject(object?.league);
  const teams = asObject(object?.teams);
  const home = asObject(teams?.home);
  const away = asObject(teams?.away);
  const goals = asObject(object?.goals);
  const fixtureId = asInteger(fixture?.id) ?? asInteger(object?._id);
  const date = asString(fixture?.date);
  const homeId = asInteger(home?.id);
  const awayId = asInteger(away?.id);
  const homeName = asString(home?.name);
  const awayName = asString(away?.name);

  if (
    fixtureId === null ||
    !date ||
    !Number.isFinite(Date.parse(date)) ||
    homeId === null ||
    awayId === null ||
    !homeName ||
    !awayName
  ) {
    return null;
  }

  const status = asObject(fixture?.status);
  return {
    fixtureId,
    date: new Date(date),
    competition:
      asString(league?.name) ??
      asString(league?.country) ??
      "Football",
    status: asString(status?.long) ?? asString(status?.short) ?? "Unknown",
    leagueId: asInteger(league?.id),
    season: asInteger(league?.season),
    homeTeam: {
      id: homeId,
      name: homeName,
      logo: safeImageUrl(home?.logo),
    },
    awayTeam: {
      id: awayId,
      name: awayName,
      logo: safeImageUrl(away?.logo),
    },
    homeScore: asInteger(goals?.home),
    awayScore: asInteger(goals?.away),
  };
}

export function parseStandings(payload: unknown): FootballStandingsRow[] {
  const data = asObject(payload);
  const rows = Array.isArray(payload)
    ? payload.flatMap((group) => asArray(group))
    : asArray(data?.response);

  return rows.flatMap((value) => {
    const row = asObject(value);
    const team = asObject(row?.team);
    const all = asObject(row?.all);
    const allGoals = asObject(all?.goals);
    const home = asObject(row?.home);
    const homeGoals = asObject(home?.goals);
    const away = asObject(row?.away);
    const awayGoals = asObject(away?.goals);
    const teamId = asInteger(team?.id);
    const teamName = asString(team?.name);
    const rank = asInteger(row?.rank);

    if (teamId === null || !teamName || rank === null) return [];

    const homePlayed = asInteger(home?.played) ?? 0;
    const homePoints =
      (asInteger(home?.win) ?? 0) * 3 + (asInteger(home?.draw) ?? 0);
    const awayPlayed = asInteger(away?.played) ?? 0;
    const awayPoints =
      (asInteger(away?.win) ?? 0) * 3 + (asInteger(away?.draw) ?? 0);

    return [
      {
        rank,
        teamId,
        teamName,
        teamLogo: safeImageUrl(team?.logo),
        played: asInteger(all?.played) ?? 0,
        goalDifference: asInteger(row?.goalsDiff) ?? 0,
        points: asInteger(row?.points) ?? 0,
        form: asString(row?.form) ?? "",
        homePlayed,
        homePoints,
        homeGoalDifference:
          (asInteger(homeGoals?.for) ?? 0) -
          (asInteger(homeGoals?.against) ?? 0),
        awayPlayed,
        awayPoints,
        awayGoalDifference:
          (asInteger(awayGoals?.for) ?? 0) -
          (asInteger(awayGoals?.against) ?? 0),
      },
    ];
  });
}

export function oddsCategory(name: string): FootballOddsMarketCategory {
  const normalized = name.toLowerCase();
  if (/\b(first|1st|second|2nd)\s*half\b|half[- ]time/.test(normalized)) {
    return "first-half";
  }
  if (/\b(handicap|asian|spread)\b/.test(normalized)) return "handicap";
  if (
    /\b(goal|total|over\/under|both teams|btts|score)\b/.test(normalized)
  ) {
    return "goals";
  }
  if (/\b(1x2|match winner|match result|full time result)\b/.test(normalized)) {
    return "1x2";
  }
  return "other";
}

function parseOdds(payload: unknown): FootballOddsMarket[] {
  const rows = Array.isArray(payload) ? payload : [payload];
  const markets = new Map<
    string,
    {
      marketId: string;
      name: string;
      category: FootballOddsMarketCategory;
      selections: Map<
        string,
        {
          selection: string;
          odd: number;
          bookmaker: string;
          bookmakers: Set<string>;
        }
      >;
    }
  >();

  for (const rowValue of rows) {
    const row = asObject(rowValue);
    for (const bookmakerValue of asArray(row?.bookmakers)) {
      const bookmaker = asObject(bookmakerValue);
      const bookmakerName = asString(bookmaker?.name);
      if (!bookmakerName) continue;

      for (const betValue of asArray(bookmaker?.bets)) {
        const bet = asObject(betValue);
        const marketName = asString(bet?.name);
        if (!marketName) continue;
        const marketId =
          asString(bet?.id) ?? String(asInteger(bet?.id) ?? marketName);
        const key = `${marketId}:${marketName}`;
        const market = markets.get(key) ?? {
          marketId,
          name: marketName,
          category: oddsCategory(marketName),
          selections: new Map(),
        };
        markets.set(key, market);

        for (const selectionValue of asArray(bet?.values)) {
          const value = asObject(selectionValue);
          const selection = asString(value?.value);
          const odd = asNumber(value?.odd);
          if (!selection || odd === null || odd <= 0) continue;

          const current = market.selections.get(selection) ?? {
            selection,
            odd,
            bookmaker: bookmakerName,
            bookmakers: new Set<string>(),
          };
          current.bookmakers.add(bookmakerName);
          if (odd > current.odd) {
            current.odd = odd;
            current.bookmaker = bookmakerName;
          }
          market.selections.set(selection, current);
        }
      }
    }
  }

  return [...markets.values()].flatMap((market) => {
    const selections: FootballOddsSelection[] = [...market.selections.values()]
      .map((selection) => ({
        selection: selection.selection,
        odd: selection.odd,
        bookmaker: selection.bookmaker,
        bookmakerCount: selection.bookmakers.size,
      }))
      .sort((left, right) => left.selection.localeCompare(right.selection));

    return selections.length
      ? [
          {
            marketId: market.marketId,
            name: market.name,
            category: market.category,
            selections,
          },
        ]
      : [];
  });
}

function parseHistory(
  payload: unknown,
  fixtureId: number,
  beforeDate: Date,
): FootballRecentMatch[] {
  const beforeTimestamp = beforeDate.getTime();
  return asArray(payload)
    .flatMap((value) => {
      const match = parseRecentMatch(value);
      if (
        !match ||
        match.fixtureId === fixtureId ||
        match.homeScore === null ||
        match.awayScore === null ||
        match.date.getTime() >= beforeTimestamp
      ) {
        return [];
      }
      return [match];
    })
    .sort((left, right) => right.date.getTime() - left.date.getTime());
}

async function loadSection<T>(
  section: FootballMatchDetailsIssueSection,
  issues: FootballMatchDetailsIssue[],
  loader: () => Promise<T[]>,
): Promise<T[]> {
  try {
    return await loader();
  } catch (error) {
    if (error instanceof UpstreamRateLimitError) throw error;
    issues.push({
      section,
      message: `KickoffScore could not load ${sectionLabel(section)} right now.`,
    });
    return [];
  }
}

function sectionLabel(section: FootballMatchDetailsIssueSection): string {
  switch (section) {
    case "standings":
      return "the league table";
    case "odds":
      return "odds";
    case "homeRecent":
      return "the home team's recent results";
    case "awayRecent":
      return "the away team's recent results";
    case "headToHead":
      return "head-to-head results";
  }
}

async function loadMatchDetails(
  fixtureId: number,
): Promise<FootballMatchDetails> {
  const fixturePayload = await fetchKickoffScoreJson("/api/fixtures", {
    id: String(fixtureId),
  });
  const fixtureObject = Array.isArray(fixturePayload)
    ? fixturePayload[0]
    : fixturePayload;
  const match = parseMatchSummary(fixtureObject, fixtureId);
  if (!match) throw new KickoffScoreMatchNotFoundError();

  const rawFixture = asObject(fixtureObject);
  const rawLeague = asObject(rawFixture?.league);
  const leagueId = asInteger(rawLeague?.id);
  const season = asInteger(rawLeague?.season);
  const issues: FootballMatchDetailsIssue[] = [];
  const recentQuery = { last: "100", summary: "true" };
  const [standings, oddsMarkets, homeRecent, awayRecent, headToHead] =
    await Promise.all([
      loadSection("standings", issues, async () => {
        if (leagueId === null || season === null) return [];
        const payload = await fetchKickoffScoreJson("/api/standings", {
          leagueId: String(leagueId),
          season: String(season),
        });
        return parseStandings(payload);
      }),
      loadSection("odds", issues, async () => {
        const payload = await fetchKickoffScoreJson("/api/odds", {
          fixture: String(fixtureId),
        });
        return parseOdds(payload);
      }),
      loadSection("homeRecent", issues, async () => {
        const payload = await fetchKickoffScoreJson("/api/fixtures", {
          team: String(match.home.id),
          ...recentQuery,
        });
        return parseHistory(payload, fixtureId, match.date).slice(0, 15);
      }),
      loadSection("awayRecent", issues, async () => {
        const payload = await fetchKickoffScoreJson("/api/fixtures", {
          team: String(match.away.id),
          ...recentQuery,
        });
        return parseHistory(payload, fixtureId, match.date).slice(0, 15);
      }),
      loadSection("headToHead", issues, async () => {
        const payload = await fetchKickoffScoreJson("/api/fixtures/h2h", {
          h2h: `${match.home.id}-${match.away.id}`,
        });
        return parseHistory(payload, fixtureId, match.date);
      }),
    ]);

  return {
    sourceUrl: sourceMatchUrl(fixtureId, match.home.name, match.away.name),
    match,
    standings,
    oddsMarkets,
    homeRecent,
    awayRecent,
    headToHead,
    issues,
  };
}

export function getKickoffScoreMatchDetails(
  fixtureId: number,
): Promise<FootballMatchDetails> {
  const cached = detailsCache.get(fixtureId);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.details);

  const activeRequest = inFlightDetails.get(fixtureId);
  if (activeRequest) return activeRequest;

  const request = loadMatchDetails(fixtureId)
    .then((details) => {
      detailsCache.set(fixtureId, {
        details,
        expiresAt: Date.now() + DETAILS_CACHE_TTL_MS,
      });
      if (detailsCache.size > MAX_DETAILS_CACHE_ENTRIES) {
        const oldestFixtureId = detailsCache.keys().next().value;
        if (oldestFixtureId !== undefined) detailsCache.delete(oldestFixtureId);
      }
      return details;
    })
    .finally(() => {
      inFlightDetails.delete(fixtureId);
    });

  inFlightDetails.set(fixtureId, request);
  return request;
}
