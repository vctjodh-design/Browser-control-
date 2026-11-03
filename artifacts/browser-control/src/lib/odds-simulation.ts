// Client side of the odds simulation.
//
// The board keeps every bookmaker's price; the batch endpoint runs the fixture
// thousands of times and grades each selection against what the simulation did;
// the settle call grades the same board against one played match. Prices are
// never input to the simulation.

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
  implied: number;
  fair: number;
  fairSource: 'normalised' | 'raw';
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

export type SettlementCounts = {
  win: number;
  lose: number;
  push: number;
  'half-win': number;
  'half-loss': number;
};

export type MarketSimulationRow = {
  marketId: string;
  market: string;
  category: string;
  selection: string;
  counts: SettlementCounts;
  probability: number;
  pushRate: number;
  halfRate: number;
  bestBookmaker: string;
  bestPrice: number;
  books: number;
  implied: number;
  fair: number;
  fairSource: 'normalised' | 'raw';
  ev: number;
  edge: number;
};

export type OddsSimulationResult = {
  fixtureId: number;
  rounds: number;
  seed: number;
  elapsedMs: number;
  teams: [string, string];
  summary: {
    homeWin: number;
    draw: number;
    awayWin: number;
    averageGoals: number;
    averageHomeGoals: number;
    averageAwayGoals: number;
    averageFirstHalfGoals: number;
    averageSecondHalfGoals: number;
    btts: number;
    over25: number;
    over15: number;
    averageCorners: number;
    averageCards: number;
    averageShotsOnTarget: number;
    cleanSheetHome: number;
    cleanSheetAway: number;
    scorelines: { score: string; home: number; away: number; count: number }[];
  };
  markets: MarketSimulationRow[];
  untrackedMarkets: { market: string; selections: number }[];
};

export type SimGoalEvent = {
  side: 'home' | 'away';
  minute: number;
  scorer: string;
  assist: string | null;
  ownGoal: boolean;
};

export type SimMatchSummary = {
  home: { goals: number; corners: number; cards: number; shotsOnTarget: number };
  away: { goals: number; corners: number; cards: number; shotsOnTarget: number };
  goals: SimGoalEvent[];
  halfTime: { home: number; away: number };
  secondHalf: { home: number; away: number };
  firstGoal: 'home' | 'away' | 'none';
  players: { name: string; side: 'home' | 'away'; goals: number; assists: number; shotsOnTarget: number }[];
};

export type SettledSelection = {
  market: string;
  selection: string;
  outcome: 'win' | 'lose' | 'push' | 'half-win' | 'half-loss';
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

async function readError(response: Response, fallback: string): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: string } | null;
  return body?.error ?? `${fallback} (${response.status}).`;
}

export async function fetchOddsBoard(fixtureId: number, signal?: AbortSignal): Promise<OddsBoard> {
  const response = await fetch(`/api/football/matches/${fixtureId}/odds-board`, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw new Error(await readError(response, 'Odds request failed'));
  return (await response.json()) as OddsBoard;
}

export async function runOddsSimulation(
  fixtureId: number,
  rounds: number,
  signal?: AbortSignal,
): Promise<OddsSimulationResult> {
  const response = await fetch(`/api/football/matches/${fixtureId}/odds-simulation`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ rounds }),
  });
  if (!response.ok) throw new Error(await readError(response, 'Simulation request failed'));
  return (await response.json()) as OddsSimulationResult;
}

export async function settleOddsBoard(
  fixtureId: number,
  summary: SimMatchSummary,
  signal?: AbortSignal,
): Promise<OddsSettlement> {
  const response = await fetch(`/api/football/matches/${fixtureId}/odds-settle`, {
    method: 'POST',
    signal,
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ summary }),
  });
  if (!response.ok) throw new Error(await readError(response, 'Settlement request failed'));
  return (await response.json()) as OddsSettlement;
}

// The simulation frame reports the match it just finished. The report is cached
// at module scope so the odds tab can settle a match that ended while another
// tab was open — the listener below is registered once, not per component.
let cachedSummary: SimMatchSummary | null = null;
let cachedTeams: [string, string] | null = null;
const summaryListeners = new Set<(summary: SimMatchSummary, teams: [string, string] | null) => void>();

if (typeof window !== 'undefined') {
  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data as
      | { source?: string; type?: string; summary?: SimMatchSummary; teams?: unknown }
      | undefined;
    if (!data || data.source !== 'match-sim' || data.type !== 'sim-match-summary') return;
    if (!data.summary) return;
    cachedSummary = data.summary;
    cachedTeams = Array.isArray(data.teams) && data.teams.length === 2
      ? [String(data.teams[0]), String(data.teams[1])]
      : null;
    for (const listener of summaryListeners) listener(data.summary, cachedTeams);
  });
}

/**
 * Called with every match summary the frame reports, and immediately with the
 * last one if a match has already finished.
 */
export function onMatchSummary(
  handler: (summary: SimMatchSummary, teams: [string, string] | null) => void,
): () => void {
  summaryListeners.add(handler);
  if (cachedSummary) handler(cachedSummary, cachedTeams);
  return () => {
    summaryListeners.delete(handler);
  };
}
