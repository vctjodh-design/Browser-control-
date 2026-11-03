// The full odds board for a fixture.
//
// The match page's market board shows the best price per selection, which is
// enough to read but hides the thing that matters when you want to compare
// bookmakers: every shop's own price. This module keeps all of them — price,
// opening price and previous move per bookmaker — while still exposing the best
// price and a margin-free probability for each selection.
//
// Prices are descriptive. Nothing here is fed back into the simulation.

import { fetchKickoffScoreJson } from "./kickoffscore-match-details";

export type OddsQuote = {
  bookmaker: string;
  price: number;
  opening: number | null;
  previous: number | null;
};

export type OddsBoardSelection = {
  selection: string;
  quotes: OddsQuote[];
  best: { bookmaker: string; price: number };
  books: number;
  /** 1 / best price. */
  implied: number;
  /** Best price with the market's overround taken out, when it can be. */
  fair: number;
  fairSource: "normalised" | "raw";
  /**
   * The handicap in the usual convention (positive = the side receives goals),
   * corrected when a bookmaker feed writes one side's signs the other way
   * round. Settlement uses this rather than the label.
   */
  handicapLine: number | null;
};

export type OddsBoardMarket = {
  marketId: string;
  name: string;
  category: string;
  selections: OddsBoardSelection[];
};

export type OddsBoard = {
  fixtureId: number;
  observedAt: string;
  bookmakers: string[];
  bookmakerCount: number;
  quoteCount: number;
  markets: OddsBoardMarket[];
};

type RawValue = {
  value?: unknown;
  odd?: unknown;
  opening?: unknown;
  previous?: unknown;
};

type RawBet = { id?: unknown; name?: unknown; values?: unknown };
type RawBookmaker = { name?: unknown; bets?: unknown };

const CACHE_TTL_MS = 60_000;
const cache = new Map<number, { at: number; board: OddsBoard }>();

function asNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** Track markets where a total or handicap pairs a line with its opposite. */
function pairKey(selection: string): { pair: string; side: string } | null {
  const over = selection.match(/^(over|under)\s+([0-9.]+)$/i);
  if (over) {
    return { pair: `line:${Number(over[2]).toFixed(2)}`, side: over[1].toLowerCase() };
  }
  const handicap = selection.match(/^(home|away)\s*([+-]\s*[0-9.]+)$/i);
  if (handicap) {
    return {
      pair: `ah:${handicap[2].replace(/\s+/g, "")}`,
      side: handicap[1].toLowerCase(),
    };
  }
  return null;
}

/**
 * Some feeds label one side of a handicap with the opposite sign: away -0.5 is
 * priced like away +0.5, and the same inversion shows up on corner ladders.
 * Rather than trusting the label, read the price curve. In the usual
 * convention a bigger head start is always more likely, so a home ladder gets
 * cheaper as the line rises, while an away ladder gets shorter. When a side's
 * ladder runs the other way, its lines are flipped.
 */
function applyHandicapConvention(selections: OddsBoardSelection[]): void {
  const ladders = new Map<string, { line: number; implied: number }[]>();
  for (const entry of selections) {
    const parsed = parseHandicapLabel(entry.selection);
    if (!parsed) continue;
    const ladder = ladders.get(parsed.side) ?? [];
    ladder.push({ line: parsed.line, implied: entry.implied });
    ladders.set(parsed.side, ladder);
  }

  const inverted = new Set<string>();
  for (const [side, ladder] of ladders) {
    if (ladder.length < 2) continue;
    const sorted = [...ladder].sort((left, right) => left.line - right.line);
    const low = sorted[0];
    const high = sorted[sorted.length - 1];
    if (low.implied === high.implied) continue;
    // A bigger head start is always more likely, so in the usual convention a
    // ladder gets shorter as the line rises. A falling price means the labels
    // run the other way and the side's lines need flipping.
    if (high.implied < low.implied) inverted.add(side);
  }
  if (!inverted.size) {
    for (const entry of selections) {
      const parsed = parseHandicapLabel(entry.selection);
      if (parsed) entry.handicapLine = parsed.line;
    }
    return;
  }

  for (const entry of selections) {
    const parsed = parseHandicapLabel(entry.selection);
    if (!parsed) continue;
    entry.handicapLine = inverted.has(parsed.side) ? -parsed.line : parsed.line;
  }
}

function parseHandicapLabel(selection: string): { side: string; line: number } | null {
  const match = selection.trim().match(/^(home|away|draw)\s*([+-])\s*([0-9]+(?:\.[0-9]+)?)$/i);
  if (!match) return null;
  const magnitude = Number(match[3]);
  return {
    side: match[1].toLowerCase(),
    line: match[2] === "-" ? -magnitude : magnitude,
  };
}

/** Markets whose selections overlap (player props) can never be normalised. */
function isClosedMarket(name: string): boolean {
  return !/player|scorer|exact score|correct score|exact goals/i.test(name);
}

function categoryOf(name: string): string {
  const normalized = name.toLowerCase();
  if (/\b(first|1st|second|2nd)\s*half\b|half[- ]time/.test(normalized)) return "first-half";
  if (/\b(handicap|asian|spread)\b/.test(normalized)) return "handicap";
  if (/\b(goal|total|over\/under|both teams|btts|score)\b/.test(normalized)) return "goals";
  if (/\b(1x2|match winner|match result|full time result)\b/.test(normalized)) return "1x2";
  return "other";
}

export function buildOddsBoard(fixtureId: number, payload: unknown): OddsBoard {
  const rows = Array.isArray(payload) ? payload : [payload];
  const bookmakerNames = new Set<string>();
  const markets = new Map<
    string,
    { marketId: string; name: string; selections: Map<string, Map<string, OddsQuote>> }
  >();
  let quoteCount = 0;

  for (const rowValue of rows) {
    const row = (rowValue ?? {}) as { bookmakers?: unknown };
    const bookmakers = Array.isArray(row.bookmakers) ? (row.bookmakers as RawBookmaker[]) : [];
    for (const bookmaker of bookmakers) {
      const name = asString(bookmaker?.name);
      if (!name) continue;
      bookmakerNames.add(name);
      const bets = Array.isArray(bookmaker?.bets) ? (bookmaker.bets as RawBet[]) : [];
      for (const bet of bets) {
        const marketName = asString(bet?.name);
        if (!marketName) continue;
        const marketId = String(bet?.id ?? marketName);
        const key = `${marketId}:${marketName}`;
        const market =
          markets.get(key) ??
          { marketId, name: marketName, selections: new Map<string, Map<string, OddsQuote>>() };
        markets.set(key, market);

        const values = Array.isArray(bet?.values) ? (bet.values as RawValue[]) : [];
        for (const value of values) {
          const selection = asString(value?.value);
          const price = asNumber(value?.odd);
          if (!selection || price === null) continue;
          const quotes = market.selections.get(selection) ?? new Map<string, OddsQuote>();
          const existing = quotes.get(name);
          // One price per bookmaker per selection; keep the freshest reading.
          if (!existing || price !== existing.price) {
            quotes.set(name, {
              bookmaker: name,
              price,
              opening: asNumber(value?.opening),
              previous: asNumber(value?.previous),
            });
            if (!existing) quoteCount += 1;
          }
          market.selections.set(selection, quotes);
        }
      }
    }
  }

  const boardMarkets: OddsBoardMarket[] = [];
  for (const market of markets.values()) {
    const selections: OddsBoardSelection[] = [...market.selections.entries()]
      .map(([selection, quotes]) => {
        const all = [...quotes.values()].sort((left, right) => right.price - left.price);
        const best = all[0] ?? { bookmaker: "", price: 0 };
        return {
          selection,
          quotes: all,
          best: { bookmaker: best.bookmaker, price: best.price },
          books: all.length,
          implied: best.price > 0 ? 1 / best.price : 0,
          fair: best.price > 0 ? 1 / best.price : 0,
          fairSource: "raw" as const,
          handicapLine: null,
        };
      })
      .sort((left, right) => left.selection.localeCompare(right.selection, "en", { numeric: true }));

    if (!selections.length) continue;

    if (/handicap/i.test(market.name)) {
      applyHandicapConvention(selections);
    }

    // Remove the bookmaker margin where the market is a closed set of
    // outcomes: pair a line with its opposite, or normalise the whole market
    // when every outcome is present.
    if (isClosedMarket(market.name)) {
      const pairs = new Map<string, OddsBoardSelection[]>();
      let paired = 0;
      for (const entry of selections) {
        const key = pairKey(entry.selection);
        if (!key) continue;
        paired += 1;
        const group = pairs.get(key.pair) ?? [];
        group.push(entry);
        pairs.set(key.pair, group);
      }

      if (paired >= 2 && paired === selections.length) {
        for (const group of pairs.values()) {
          if (group.length < 2) continue;
          const total = group.reduce((sum, entry) => sum + entry.implied, 0);
          if (total <= 0) continue;
          for (const entry of group) {
            entry.fair = entry.implied / total;
            entry.fairSource = "normalised";
          }
        }
      } else {
        const total = selections.reduce((sum, entry) => sum + entry.implied, 0);
        // Only trust full-market normalisation when the book is plausible;
        // a partial list of outcomes would inflate every probability.
        if (selections.length >= 2 && total > 0.85 && total < 1.8) {
          for (const entry of selections) {
            entry.fair = entry.implied / total;
            entry.fairSource = "normalised";
          }
        }
      }
    }

    boardMarkets.push({
      marketId: market.marketId,
      name: market.name,
      category: categoryOf(market.name),
      selections,
    });
  }

  return {
    fixtureId,
    observedAt: new Date().toISOString(),
    bookmakers: [...bookmakerNames].sort(),
    bookmakerCount: bookmakerNames.size,
    quoteCount,
    markets: boardMarkets.sort((left, right) => left.name.localeCompare(right.name)),
  };
}

export async function getOddsBoard(fixtureId: number): Promise<OddsBoard> {
  const cached = cache.get(fixtureId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.board;

  const payload = await fetchKickoffScoreJson("/api/odds", { fixture: String(fixtureId) });
  const board = buildOddsBoard(fixtureId, payload);
  cache.set(fixtureId, { at: Date.now(), board });
  if (cache.size > 40) {
    const oldest = [...cache.entries()].sort((left, right) => left[1].at - right[1].at)[0];
    if (oldest) cache.delete(oldest[0]);
  }
  return board;
}
