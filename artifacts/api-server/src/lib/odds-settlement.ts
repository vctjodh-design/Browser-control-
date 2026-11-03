// Settle a bookmaker board against one played match.
//
// The 3D match reports what happened; this grades every price on the board
// against that report and adds up what a one-unit stake on each selection would
// have returned. It is the same settlement the batch uses, so a watched match
// and a 5,000-round run are graded by identical rules.

import { profitAt, settleSelection, type SettlementOutcome, type SimMatchSummary } from "./match-settlement";
import type { OddsBoard } from "./odds-board";

export type SettledSelection = {
  market: string;
  selection: string;
  outcome: SettlementOutcome;
  detail: string;
  bestBookmaker: string;
  bestPrice: number;
  books: number;
  profit: number;
};

export type SettledMarket = {
  market: string;
  category: string;
  selections: SettledSelection[];
  wins: number;
  losses: number;
  pushes: number;
  profit: number;
};

export type OddsSettlement = {
  fixtureId: number;
  teams: [string, string] | null;
  summary: SimMatchSummary;
  markets: SettledMarket[];
  totals: {
    selections: number;
    wins: number;
    losses: number;
    pushes: number;
    staked: number;
    returned: number;
    profit: number;
    roi: number;
  };
  untracked: { market: string; selection: string }[];
};

export function settleBoard(board: OddsBoard, summary: SimMatchSummary): OddsSettlement {
  const markets: SettledMarket[] = [];
  const untracked: { market: string; selection: string }[] = [];
  let selections = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let staked = 0;
  let profit = 0;

  for (const market of board.markets) {
    const settled: SettledSelection[] = [];
    for (const entry of market.selections) {
      const settlement = settleSelection(market.name, entry.selection, summary, {
        handicapLine: entry.handicapLine,
      });
      if (!settlement) {
        untracked.push({ market: market.name, selection: entry.selection });
        continue;
      }
      const value = profitAt(settlement.outcome, entry.best.price);
      settled.push({
        market: market.name,
        selection: entry.selection,
        outcome: settlement.outcome,
        detail: settlement.detail,
        bestBookmaker: entry.best.bookmaker,
        bestPrice: entry.best.price,
        books: entry.books,
        profit: value,
      });
      selections += 1;
      staked += 1;
      profit += value;
      if (settlement.outcome === "win" || settlement.outcome === "half-win") wins += 1;
      else if (settlement.outcome === "push") pushes += 1;
      else losses += 1;
    }

    if (!settled.length) continue;
    markets.push({
      market: market.name,
      category: market.category,
      selections: settled.sort((left, right) => right.profit - left.profit),
      wins: settled.filter((entry) => entry.outcome === "win" || entry.outcome === "half-win").length,
      losses: settled.filter(
        (entry) => entry.outcome === "lose" || entry.outcome === "half-loss",
      ).length,
      pushes: settled.filter((entry) => entry.outcome === "push").length,
      profit: settled.reduce((sum, entry) => sum + entry.profit, 0),
    });
  }

  return {
    fixtureId: board.fixtureId,
    teams: null,
    summary,
    markets,
    totals: {
      selections,
      wins,
      losses,
      pushes,
      staked,
      returned: staked + profit,
      profit,
      roi: staked > 0 ? profit / staked : 0,
    },
    untracked,
  };
}
