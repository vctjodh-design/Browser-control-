// Reader for the decision tree: one board read, then every market settled from
// it, with the form, table and availability readings that shaded each line.
//
// Nothing here is a probability. Each market is a call and a tier, because the
// tree settles lines at their crossing points rather than pricing them.

export type DecisionSide = 'home' | 'away';
export type DecisionTier = 'firm' | 'leaning' | 'knife-edge';

/** How easily a line turns over. */
export type UpsetLevel = 'low' | 'live' | 'high';

export type DecisionUpset = {
  level: UpsetLevel;
  /** Goals between the reading and the point where the call flips. */
  flipDistance: number | null;
  basis: string;
};

export type DecisionNode = {
  id: string;
  depth: number;
  branch: 'board' | 'result' | 'goals' | 'scoring' | 'record' | 'availability' | 'window';
  question: string;
  reads: string;
  answer: string;
  settles: string[];
};

export type DecisionMarket = {
  id: string;
  group: 'Result' | 'Goals' | 'Both sides' | 'Score';
  label: string;
  call: string;
  tier: DecisionTier;
  tierLabel: string;
  node: string;
  reads: string;
  why: string;
  /** The board's weight on the side this line called, 0..1. Null when unpriced. */
  boardShare: number | null;
  agrees: boolean | null;
  /** How exposed the line is: distance to its crossing, and the board against it. */
  upset: DecisionUpset;
  /**
   * The "even if" check: the call asked again at the scoreline the two sides' own
   * last fifty matches call a normal bad afternoon.
   */
  challenge: DecisionChallenge | null;
};

export type DecisionChallenge = {
  scoreline: string;
  holds: boolean;
  reading: string;
};

export type DecisionWindow = {
  team: string;
  matches: number;
  reached: number;
  scoredAtHome: number | null;
  scoredAway: number | null;
  concededAtHome: number | null;
  concededAway: number | null;
  p80: number | null;
};

export type DecisionWithheld = {
  label: string;
  reason: string;
};

export type DecisionTree = {
  elapsedMs: number;
  fixtureId: number;
  teams: [string, string];
  short: [string, string];
  scoreline: string;
  worth: { home: number; away: number };
  separation: number;
  total: number;
  nodes: DecisionNode[];
  markets: DecisionMarket[];
  withheld: DecisionWithheld[];
  trace: string[];
  referenceSource: string | null;
  /** The question asked before the card is final, and how many lines survive it. */
  challenge: {
    question: string;
    scenario: string;
    note: string;
    holds: number;
    asked: number;
    matches: number;
    vote: boolean;
    thin: boolean;
  } | null;
  dna: {
    home: DecisionWindow;
    away: DecisionWindow;
    note: string;
    vote: boolean;
    boardWorth: { home: number; away: number };
  } | null;
  note: string;
  /** True when the server answered from its short memo instead of reading again. */
  cached?: boolean;
};

/**
 * The calls a date row prints. The full card is re-read when the row is opened,
 * so a saved run stays small enough to keep a whole date in storage.
 */
export type DecisionSummary = {
  /** Which shape of summary this is; older saved rows are dropped rather than printed blank. */
  version?: number;
  scoreline: string;
  result: string;
  resultTier: DecisionTier;
  goals: string;
  btts: string;
  /** What the board is worth for each side, in goals — the card's xG reading. */
  homeWorth: number;
  awayWorth: number;
  /** How many of the settled lines came back firm — the card's own thermometer. */
  firms: number;
  /** Lines the market board could be read on at all. */
  compared: number;
  /** Lines where the board prices the side the card called. */
  agreed: number;
  /** Mean of the per-line shares: the card's board agreement in one figure. */
  boardWeight: number | null;
  /** The board's weight on each call a row prints, so every call carries its own figure. */
  resultShare: number | null;
  bttsShare: number | null;
  goalsShare: number | null;
  /** Lines on this card that are one bad afternoon from turning over. */
  upsetHigh: number;
  resultUpset: UpsetLevel | null;
  bttsUpset: UpsetLevel | null;
  goalsUpset: UpsetLevel | null;
};

/**
 * How much of the card the market board is on the same side of, as a whole
 * number. Null when the board priced nothing this card compares to — an empty
 * board is not 0% agreement, it is no reading.
 */
export function boardAgreementPercent(summary: Pick<DecisionSummary, 'boardWeight'>): number | null {
  if (summary.boardWeight === null || !Number.isFinite(summary.boardWeight)) return null;
  return Math.round(summary.boardWeight * 100);
}

/** One line's share, printed as a whole percentage. */
export function boardSharePercent(market: Pick<DecisionMarket, 'boardShare'>): number | null {
  if (market.boardShare === null) return null;
  return Math.round(market.boardShare * 100);
}

function callOf(tree: DecisionTree, id: string): DecisionMarket | undefined {
  return tree.markets.find((market) => market.id === id);
}

export function summarizeDecision(tree: DecisionTree): DecisionSummary {
  const result = callOf(tree, 'result');
  const compared = tree.markets.filter((market) => market.boardShare !== null);
  const weightSum = compared.reduce((sum, market) => sum + (market.boardShare ?? 0), 0);
  const goals = callOf(tree, 'over-2.5');
  const btts = callOf(tree, 'btts');
  return {
    scoreline: tree.scoreline,
    result: result?.call ?? 'Not called',
    resultTier: result?.tier ?? 'knife-edge',
    goals: goals?.call ?? 'Not called',
    btts: btts?.call ?? 'Not called',
    homeWorth: tree.worth.home,
    awayWorth: tree.worth.away,
    firms: tree.markets.filter((market) => market.tier === 'firm').length,
    compared: compared.length,
    agreed: compared.filter((market) => (market.boardShare ?? 0) > 0.5).length,
    boardWeight: compared.length ? weightSum / compared.length : null,
    resultShare: result?.boardShare ?? null,
    bttsShare: btts?.boardShare ?? null,
    goalsShare: goals?.boardShare ?? null,
    upsetHigh: tree.markets.filter((market) => market.upset.level === 'high').length,
    resultUpset: result?.upset.level ?? null,
    bttsUpset: btts?.upset.level ?? null,
    goalsUpset: goals?.upset.level ?? null,
  };
}

function retryAfterSecondsOf(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export class DecisionRequestError extends Error {
  status: number;
  retryAfterSeconds: number | null;

  constructor(message: string, status: number, retryAfterSeconds: number | null) {
    super(message);
    this.name = 'DecisionRequestError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/** A card the server already settled for a date, in the shape a row prints. */
export type StoredDecisionCard = {
  fixtureId: number;
  matchDate: string;
  homeTeam: string;
  awayTeam: string;
  competition: string;
  settledAt: number;
  summary: DecisionSummary;
};

export type DnaTrait = {
  label: string;
  value: number;
  unit: 'perGame' | 'share' | 'count' | 'rating';
  note?: string;
};

export type TeamDna = {
  team: string;
  matches: number;
  from: string | null;
  to: string | null;
  record: { wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number };
  identity: DnaTrait[];
  dynamics: DnaTrait[];
  pressure: DnaTrait[];
  mistakes: DnaTrait[];
  verdict: { scoring: string; control: string; late: string };
};

export type DnaResponse = {
  dna: TeamDna;
  coverage: { expected: number; stored: number };
  queue: { running: boolean; current: string | null; queued: number; done: number; failed: number; matchesStored: number; teamsStored: number };
};

/** A side's last matches read properly — xG, chances, phases, ratings. */
export async function loadTeamDna(team: string, asOf: string, depth = 50): Promise<DnaResponse> {
  const response = await fetch(
    `/api/football/teams/${encodeURIComponent(team)}/dna?asOf=${encodeURIComponent(asOf)}&depth=${depth}`,
    { headers: { accept: 'application/json' } },
  );
  const body = (await response.json().catch(() => null)) as (DnaResponse & { error?: string }) | null;
  if (!response.ok || !body?.dna) {
    throw new DecisionRequestError(
      body?.error ?? `This team's DNA could not be read (${response.status}).`,
      response.status,
      retryAfterSecondsOf(response),
    );
  }
  return body;
}

/** Starts reading that team's last fifty matches; safe to call again. */
export async function startTeamDna(team: string, asOf: string, depth = 50): Promise<{ enqueued: number }> {
  const response = await fetch(
    `/api/football/teams/${encodeURIComponent(team)}/dna/start?asOf=${encodeURIComponent(asOf)}&depth=${depth}`,
    { method: 'POST', headers: { accept: 'application/json' } },
  );
  const body = (await response.json().catch(() => null)) as { enqueued?: number; error?: string } | null;
  if (!response.ok) {
    throw new DecisionRequestError(
      body?.error ?? `The read could not be started (${response.status}).`,
      response.status,
      retryAfterSecondsOf(response),
    );
  }
  return { enqueued: body?.enqueued ?? 0 };
}

/** What the paced queue of past fixtures is doing. */
export type BackfillStatus = {
  running: boolean;
  working: boolean;
  current: number | null;
  gapMs: number;
  queued: number;
  done: number;
  skipped: number;
  failed: number;
  lastNote: string | null;
  firstDate: string | null;
  lastDate: string | null;
  history?: { matches: number; teams: number; firstDate: string | null; lastDate: string | null };
  enqueued?: { dates: number; discovered: number; queued: number; failedDates: string[] };
};

async function backfillRequest(path: string, init?: RequestInit): Promise<BackfillStatus> {
  const response = await fetch(`/api/football/backfill${path}`, {
    ...init,
    headers: { accept: 'application/json', ...(init?.body ? { 'content-type': 'application/json' } : {}) },
  });
  const body = (await response.json().catch(() => null)) as (BackfillStatus & { error?: string }) | null;
  if (!response.ok) {
    throw new DecisionRequestError(
      body?.error ?? `The backfill could not be read (${response.status}).`,
      response.status,
      retryAfterSecondsOf(response),
    );
  }
  return body ?? { running: false, working: false, current: null, gapMs: 0, queued: 0, done: 0, skipped: 0, failed: 0, lastNote: null, firstDate: null, lastDate: null };
}

export function loadBackfillStatus(signal?: AbortSignal): Promise<BackfillStatus> {
  return backfillRequest('', { signal });
}

export function startBackfillRange(
  from: string,
  to: string,
  options: { cards?: boolean; cardLimit?: number } = {},
): Promise<BackfillStatus> {
  return backfillRequest('/start', { method: 'POST', body: JSON.stringify({ from, to, ...options }) });
}

export function pauseBackfillRun(): Promise<BackfillStatus> {
  return backfillRequest('/pause', { method: 'POST' });
}

/** How one market's calls have actually held, by upset band. */
export type LedgerStanding = {
  marketId: string;
  label: string;
  upsetLevel: UpsetLevel;
  held: number;
  laid: number;
  rate: number | null;
};

/**
 * The upset ledger: every called line that has since been marked at full time.
 * A rate is only sent where at least one line is marked, so an empty band reads as
 * unmeasured rather than perfect.
 */
export async function loadDecisionLedger(signal?: AbortSignal): Promise<LedgerStanding[]> {
  const response = await fetch('/api/football/decisions/ledger', {
    signal,
    headers: { accept: 'application/json' },
  });
  const body = (await response.json().catch(() => null)) as
    | { standings?: LedgerStanding[]; error?: string }
    | null;
  if (!response.ok) {
    throw new DecisionRequestError(
      body?.error ?? `The ledger could not be read (${response.status}).`,
      response.status,
      retryAfterSecondsOf(response),
    );
  }
  return Array.isArray(body?.standings) ? body.standings : [];
}

/**
 * What a date has already settled, held in the server's database rather than this
 * browser. Rows come back after a refresh, a cleared cache, a phone swap or a
 * restart of the app.
 */
export async function loadDateDecisions(date: string, signal?: AbortSignal): Promise<StoredDecisionCard[]> {
  const response = await fetch(`/api/football/decisions?date=${encodeURIComponent(date)}`, {
    signal,
    headers: { accept: 'application/json' },
  });
  const body = (await response.json().catch(() => null)) as
    | { cards?: StoredDecisionCard[]; error?: string }
    | null;
  if (!response.ok) {
    throw new DecisionRequestError(
      body?.error ?? `The date's settled cards could not be loaded (${response.status}).`,
      response.status,
      retryAfterSecondsOf(response),
    );
  }
  return Array.isArray(body?.cards) ? body.cards : [];
}

export async function loadDecisionTree(
  fixtureId: number,
  signal?: AbortSignal,
  /** The date being worked on, so the server can file the settled card under it. */
  date?: string,
): Promise<DecisionTree> {
  const query = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? `?date=${encodeURIComponent(date)}` : '';
  const response = await fetch(`/api/football/matches/${fixtureId}/decision${query}`, {
    signal,
    headers: { accept: 'application/json' },
  });
  const body = (await response.json().catch(() => null)) as
    | (DecisionTree & { error?: string })
    | null;
  if (!response.ok) {
    throw new DecisionRequestError(
      body?.error ?? `The markets could not be settled (${response.status}).`,
      response.status,
      retryAfterSecondsOf(response),
    );
  }
  return body as DecisionTree;
}
