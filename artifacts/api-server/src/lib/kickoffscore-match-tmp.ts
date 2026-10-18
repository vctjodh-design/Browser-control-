import type {
  FootballHistoricalMarket,
  FootballHistoricalMarketSelection,
  FootballMatchOddsHistory,
  FootballMatchTmpContext,
  FootballMatchTmpIssue,
  FootballRecentMatch,
  FootballSeasonStanding,
} from "@workspace/api-zod";
import {
  fetchKickoffScoreJson,
  getKickoffScoreMatchDetails,
  oddsCategory,
  parseStandings,
} from "./kickoffscore-match-details";
import { UpstreamRateLimitError } from "./upstream-rate-limit";

const ODDS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const STANDINGS_CACHE_TTL_MS = 60 * 60 * 1000;
const TMP_CONTEXT_CACHE_TTL_MS = 5 * 60 * 1000;
const MAX_TMP_CACHE_ENTRIES = 80;

type JsonObject = Record<string, unknown>;
type QuoteSource = FootballMatchOddsHistory["quoteSource"];
type MarketCategory = FootballHistoricalMarket["category"];

interface Quote {
  odd: number;
  verified: boolean;
}

interface SelectionAccumulator {
  probabilityTotal: number;
  bookmakerCount: number;
}

interface MarketAccumulator {
  marketId: string;
  name: string;
  category: MarketCategory;
  selections: Map<string, SelectionAccumulator>;
}

interface Cached<T> {
  expiresAt: number;
  value: T;
}

interface LeagueSeason {
  leagueId: number;
  season: number;
}

const oddsCache = new Map<number, Cached<FootballMatchOddsHistory>>();
const oddsInFlight = new Map<number, Promise<FootballMatchOddsHistory>>();
const standingsCache = new Map<string, Cached<FootballSeasonStanding[]>>();
const standingsInFlight = new Map<string, Promise<FootballSeasonStanding[]>>();
const tmpContextCache = new Map<number, Cached<FootballMatchTmpContext>>();
const tmpContextInFlight = new Map<number, Promise<FootballMatchTmpContext>>();

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
  const number = asNumber(value);
  return number !== null && Number.isInteger(number) ? number : null;
}

function dateTimestamp(value: unknown): number | null {
  if (typeof value !== "string" || !value) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

function readQuote(value: JsonObject, kickoff: number): Quote | null {
  const odd = asNumber(value.odd);
  const observedAt = dateTimestamp(value.observedAt);
  if (odd !== null && odd > 0 && observedAt !== null && observedAt <= kickoff) {
    return { odd, verified: true };
  }

  const opening = asNumber(value.opening);
  const openingAt = dateTimestamp(value.openingAt);
  if (
    opening !== null &&
    opening > 0 &&
    openingAt !== null &&
    openingAt <= kickoff
  ) {
    return { odd: opening, verified: true };
  }

  if (
    odd !== null &&
    odd > 0 &&
    observedAt === null &&
    openingAt === null
  ) {
    return { odd, verified: false };
  }

  return null;
}

function canonicalOutcome(
  value: string,
  match: FootballRecentMatch,
): "home" | "draw" | "away" | null {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");
  const home = match.homeTeam.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  const away = match.awayTeam.name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ");
  if (normalized === "1" || normalized === "home" || normalized === "home win" || normalized === home) {
    return "home";
  }
  if (normalized === "x" || normalized === "draw" || normalized === "tie") {
    return "draw";
  }
  if (normalized === "2" || normalized === "away" || normalized === "away win" || normalized === away) {
    return "away";
  }
  return null;
}

function matchWinnerMarket(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return (
    !/\b(first|1st|second|2nd)\s*half\b|half[- ]time/.test(normalized) &&
    /^(?:1x2|match winner|match result|full[\s-]?time result)\b/.test(normalized)
  );
}

function averageProbabilities(
  quotes: Map<string, SelectionAccumulator>,
): Map<string, number> {
  const averages = new Map<string, number>();
  let total = 0;
  for (const [selection, accumulator] of quotes) {
    if (!accumulator.bookmakerCount) continue;
    const average =
      accumulator.probabilityTotal / accumulator.bookmakerCount;
    averages.set(selection, average);
    total += average;
  }
  if (total <= 0) return new Map();
  for (const [selection, probability] of averages) {
    averages.set(selection, probability / total);
  }
  return averages;
}

function selectionProbabilities(
  values: unknown[],
  kickoff: number,
  outcomeResolver?: (selection: string) => string | null,
): { probabilities: Map<string, number>; verified: boolean } | null {
  const quotes = new Map<string, Quote>();
  for (const valueObject of values) {
    const value = asObject(valueObject);
    const rawSelection = asString(value?.value);
    if (!value || !rawSelection) continue;
    const selection = outcomeResolver
      ? outcomeResolver(rawSelection)
      : rawSelection;
    if (!selection) continue;
    const quote = readQuote(value, kickoff);
    if (selection && quote) quotes.set(selection, quote);
  }
  if (quotes.size < 2) return null;

  const implied = [...quotes].map(([selection, quote]) => ({
    selection,
    quote,
    probability: 1 / quote.odd,
  }));
  const total = implied.reduce((sum, item) => sum + item.probability, 0);
  if (!Number.isFinite(total) || total <= 0) return null;

  return {
    probabilities: new Map(
      implied.map(({ selection, probability }) => [
        selection,
        probability / total,
      ]),
    ),
    verified: implied.every((item) => item.quote.verified),
  };
}

function addMarketProbabilities(
  markets: Map<string, MarketAccumulator>,
  marketId: string,
  name: string,
  category: MarketCategory,
  probabilities: Map<string, number>,
): void {
  const key = `${marketId}:${name}`;
  const market = markets.get(key) ?? {
    marketId,
    name,
    category,
    selections: new Map<string, SelectionAccumulator>(),
  };
  markets.set(key, market);

  for (const [selection, probability] of probabilities) {
    const accumulator = market.selections.get(selection) ?? {
      probabilityTotal: 0,
      bookmakerCount: 0,
    };
    accumulator.probabilityTotal += probability;
    accumulator.bookmakerCount += 1;
    market.selections.set(selection, accumulator);
  }
}

function mapHistoricalMarket(
  market: MarketAccumulator,
): FootballHistoricalMarket | null {
  const probabilities = averageProbabilities(market.selections);
  const selections: FootballHistoricalMarketSelection[] = [
    ...probabilities,
  ]
    .map(([selection, probability]) => ({
      selection,
      probability: Number(probability.toFixed(6)),
      bookmakerCount: market.selections.get(selection)?.bookmakerCount ?? 0,
    }))
    .sort((left, right) => right.probability - left.probability);
  if (!selections.length) return null;

  return {
    marketId: market.marketId,
    name: market.name,
    category: market.category,
    selections,
  };
}

function unavailableOdds(fixtureId: number): FootballMatchOddsHistory {
  return {
    fixtureId,
    homeProbability: null,
    drawProbability: null,
    awayProbability: null,
    bookmakerCount: 0,
    verifiedBookmakerCount: 0,
    unverifiedBookmakerCount: 0,
    marketCount: 0,
    marketCategories: [],
    markets: [],
    quoteSource: "unavailable",
  };
}

function parseHistoricalOdds(
  payload: unknown,
  match: FootballRecentMatch,
): FootballMatchOddsHistory {
  const rawRows = Array.isArray(payload) ? payload : [payload];
  const kickoff = match.date.getTime();
  const marketAccumulators = new Map<string, MarketAccumulator>();
  const oneXTwo: {
    probabilities: Map<string, number>;
    verified: boolean;
  }[] = [];

  for (const rowValue of rawRows) {
    const row = asObject(rowValue);
    const bookmakers = asArray(row?.bookmakers);
    for (const bookmakerValue of bookmakers) {
      const bookmaker = asObject(bookmakerValue);
      if (!bookmaker) continue;

      const bets = asArray(bookmaker.bets);
      for (const betValue of bets) {
        const bet = asObject(betValue);
        const name = asString(bet?.name);
        if (!bet || !name) continue;

        const values = asArray(bet.values);
        const probabilities = selectionProbabilities(values, kickoff);
        if (!probabilities) continue;
        const marketId =
          asString(bet.id) ??
          String(asInteger(bet.id) ?? name);
        const category = oddsCategory(name);
        addMarketProbabilities(
          marketAccumulators,
          marketId,
          name,
          category,
          probabilities.probabilities,
        );
      }

      const resultBets = bets
        .map((value) => asObject(value))
        .filter((bet): bet is JsonObject => {
          const name = asString(bet?.name);
          return name !== null && matchWinnerMarket(name);
        })
        .sort((left, right) => {
          const leftName = (asString(left.name) ?? "").toLowerCase();
          const rightName = (asString(right.name) ?? "").toLowerCase();
          const priority = (name: string) =>
            name.includes("match winner") ? 0 : name.includes("match result") ? 1 : 2;
          return priority(leftName) - priority(rightName);
        });

      for (const bet of resultBets) {
        const values = asArray(bet.values);
        const probabilities = selectionProbabilities(
          values,
          kickoff,
          (selection) => canonicalOutcome(selection, match),
        );
        if (
          !probabilities ||
          !["home", "draw", "away"].every((selection) =>
            probabilities.probabilities.has(selection),
          )
        ) {
          continue;
        }
        oneXTwo.push(probabilities);
        break;
      }
    }
  }

  const outcomeTotals = new Map([
    ["home", 0],
    ["draw", 0],
    ["away", 0],
  ]);
  let verifiedBookmakerCount = 0;
  let unverifiedBookmakerCount = 0;
  for (const quote of oneXTwo) {
    for (const [outcome, probability] of quote.probabilities) {
      outcomeTotals.set(
        outcome,
        (outcomeTotals.get(outcome) ?? 0) + probability,
      );
    }
    if (quote.verified) verifiedBookmakerCount += 1;
    else unverifiedBookmakerCount += 1;
  }

  const bookmakerCount = oneXTwo.length;
  const homeProbability =
    bookmakerCount && outcomeTotals.get("home") !== undefined
      ? Number(
          ((outcomeTotals.get("home") ?? 0) / bookmakerCount).toFixed(6),
        )
      : null;
  const drawProbability =
    bookmakerCount && outcomeTotals.get("draw") !== undefined
      ? Number(
          ((outcomeTotals.get("draw") ?? 0) / bookmakerCount).toFixed(6),
        )
      : null;
  const awayProbability =
    bookmakerCount && outcomeTotals.get("away") !== undefined
      ? Number(
          ((outcomeTotals.get("away") ?? 0) / bookmakerCount).toFixed(6),
        )
      : null;

  const markets = [...marketAccumulators.values()]
    .map(mapHistoricalMarket)
    .filter((market): market is FootballHistoricalMarket => market !== null)
    .sort((left, right) => {
      const categoryOrder = left.category.localeCompare(right.category);
      return categoryOrder || left.name.localeCompare(right.name);
    });
  const marketCategories = [
    ...new Set(markets.map((market) => market.category)),
  ].sort();
  const quoteSource: QuoteSource =
    bookmakerCount === 0
      ? "unavailable"
      : verifiedBookmakerCount && unverifiedBookmakerCount
        ? "mixed"
        : verifiedBookmakerCount
          ? "verified"
          : "unverified";

  return {
    fixtureId: match.fixtureId,
    homeProbability,
    drawProbability,
    awayProbability,
    bookmakerCount,
    verifiedBookmakerCount,
    unverifiedBookmakerCount,
    marketCount: markets.length,
    marketCategories,
    markets,
    quoteSource,
  };
}

async function withConcurrency<T, R>(
  values: T[],
  concurrency: number,
  mapper: (value: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, values.length) },
    async () => {
      while (true) {
        const index = cursor++;
        if (index >= values.length) return;
        results[index] = await mapper(values[index]);
      }
    },
  );
  await Promise.all(workers);
  return results;
}

function remember<K, V>(
  cache: Map<K, Cached<V>>,
  key: K,
  value: V,
  ttl: number,
  maxEntries?: number,
): V {
  cache.set(key, { value, expiresAt: Date.now() + ttl });
  if (maxEntries && cache.size > maxEntries) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return value;
}

function readCached<K, V>(cache: Map<K, Cached<V>>, key: K): V | null {
  const item = cache.get(key);
  if (!item) return null;
  if (item.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

async function getOddsForMatch(
  match: FootballRecentMatch,
): Promise<FootballMatchOddsHistory> {
  const cached = readCached(oddsCache, match.fixtureId);
  if (cached) return cached;
  const active = oddsInFlight.get(match.fixtureId);
  if (active) return active;

  const request = fetchKickoffScoreJson("/api/odds", {
    fixture: String(match.fixtureId),
  })
    .then((payload) =>
      remember(
        oddsCache,
        match.fixtureId,
        parseHistoricalOdds(payload, match),
        ODDS_CACHE_TTL_MS,
      ),
    )
    .finally(() => oddsInFlight.delete(match.fixtureId));
  oddsInFlight.set(match.fixtureId, request);
  return request;
}

async function getSeasonStandings(
  leagueSeason: LeagueSeason,
): Promise<FootballSeasonStanding[]> {
  const key = `${leagueSeason.leagueId}:${leagueSeason.season}`;
  const cached = readCached(standingsCache, key);
  if (cached) return cached;
  const active = standingsInFlight.get(key);
  if (active) return active;

  const request = fetchKickoffScoreJson("/api/standings", {
    leagueId: String(leagueSeason.leagueId),
    season: String(leagueSeason.season),
  })
    .then((payload) =>
      remember(
        standingsCache,
        key,
        parseStandings(payload).map((row) => ({
          leagueId: leagueSeason.leagueId,
          season: leagueSeason.season,
          teamId: row.teamId,
          teamName: row.teamName,
          rank: row.rank,
          played: row.played,
          points: row.points,
          goalDifference: row.goalDifference,
        })),
        STANDINGS_CACHE_TTL_MS,
      ),
    )
    .finally(() => standingsInFlight.delete(key));
  standingsInFlight.set(key, request);
  return request;
}

function uniqueMatches(matches: FootballRecentMatch[]): FootballRecentMatch[] {
  return [...new Map(matches.map((match) => [match.fixtureId, match])).values()];
}

function uniqueLeagueSeasons(
  matches: FootballRecentMatch[],
): LeagueSeason[] {
  const keys = new Map<string, LeagueSeason>();
  for (const match of matches) {
    if (match.leagueId === null || match.season === null) continue;
    const key = `${match.leagueId}:${match.season}`;
    keys.set(key, { leagueId: match.leagueId, season: match.season });
  }
  return [...keys.values()];
}

async function loadTmpContext(
  fixtureId: number,
): Promise<FootballMatchTmpContext> {
  const details = await getKickoffScoreMatchDetails(fixtureId);
  const matches = uniqueMatches([
    ...details.homeRecent.slice(0, 15),
    ...details.awayRecent.slice(0, 15),
  ]);
  const issues: FootballMatchTmpIssue[] = [];

  const oddsHistory = await withConcurrency(matches, 6, async (match) => {
    try {
      return await getOddsForMatch(match);
    } catch (error) {
      if (error instanceof UpstreamRateLimitError) throw error;
      return unavailableOdds(match.fixtureId);
    }
  });
  const unavailableOddsCount = oddsHistory.filter(
    (item) => item.quoteSource === "unavailable",
  ).length;
  if (unavailableOddsCount) {
    issues.push({
      section: "oddsHistory",
      message: `Historical 1X2 odds were unavailable for ${unavailableOddsCount} of ${matches.length} recent matches.`,
    });
  }

  const leagueSeasons = uniqueLeagueSeasons(matches);
  const standingsResults = await withConcurrency(
    leagueSeasons,
    4,
    async (leagueSeason) => {
      try {
        return {
          rows: await getSeasonStandings(leagueSeason),
          failed: false,
        };
      } catch (error) {
        if (error instanceof UpstreamRateLimitError) throw error;
        return { rows: [] as FootballSeasonStanding[], failed: true };
      }
    },
  );
  if (standingsResults.some((result) => result.failed)) {
    issues.push({
      section: "standingsHistory",
      message:
        "Latest standings were unavailable for one or more recent-match competitions.",
    });
  }

  return {
    fixtureId,
    oddsHistory,
    seasonStandings: standingsResults.flatMap((result) => result.rows),
    issues,
  };
}

export function getKickoffScoreMatchTmp(
  fixtureId: number,
): Promise<FootballMatchTmpContext> {
  const cached = readCached(tmpContextCache, fixtureId);
  if (cached) return Promise.resolve(cached);
  const active = tmpContextInFlight.get(fixtureId);
  if (active) return active;

  const request = loadTmpContext(fixtureId)
    .then((context) =>
      remember(
        tmpContextCache,
        fixtureId,
        context,
        TMP_CONTEXT_CACHE_TTL_MS,
        MAX_TMP_CACHE_ENTRIES,
      ),
    )
    .finally(() => tmpContextInFlight.delete(fixtureId));
  tmpContextInFlight.set(fixtureId, request);
  return request;
}
