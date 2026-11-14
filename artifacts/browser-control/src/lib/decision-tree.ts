// Reader for the decision tree: one board read, then every market settled from
// it, with the form, table and availability readings that shaded each line.
//
// Nothing here is a probability. Each market is a call and a tier, because the
// tree settles lines at their crossing points rather than pricing them.

export type DecisionSide = 'home' | 'away';
export type DecisionTier = 'firm' | 'leaning' | 'knife-edge';

export type DecisionNode = {
  id: string;
  depth: number;
  branch: 'board' | 'result' | 'goals' | 'scoring' | 'record' | 'availability';
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
  agrees: boolean | null;
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
  note: string;
  /** True when the server answered from its short memo instead of reading again. */
  cached?: boolean;
};

/**
 * The calls a date row prints. The full card is re-read when the row is opened,
 * so a saved run stays small enough to keep a whole date in storage.
 */
export type DecisionSummary = {
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
};

/**
 * How much of the card the market board is on the same side of, as a whole
 * number. Null when the board priced nothing this card compares to — an empty
 * board is not 0% agreement, it is no reading.
 */
export function boardAgreementPercent(summary: Pick<DecisionSummary, 'agreed' | 'compared'>): number | null {
  if (summary.compared <= 0) return null;
  return Math.round((summary.agreed / summary.compared) * 100);
}

function callOf(tree: DecisionTree, id: string): DecisionMarket | undefined {
  return tree.markets.find((market) => market.id === id);
}

export function summarizeDecision(tree: DecisionTree): DecisionSummary {
  const result = callOf(tree, 'result');
  const compared = tree.markets.filter((market) => market.agrees !== null);
  return {
    scoreline: tree.scoreline,
    result: result?.call ?? 'Not called',
    resultTier: result?.tier ?? 'knife-edge',
    goals: callOf(tree, 'over-2.5')?.call ?? 'Not called',
    btts: callOf(tree, 'btts')?.call ?? 'Not called',
    homeWorth: tree.worth.home,
    awayWorth: tree.worth.away,
    firms: tree.markets.filter((market) => market.tier === 'firm').length,
    compared: compared.length,
    agreed: compared.filter((market) => market.agrees === true).length,
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

export async function loadDecisionTree(
  fixtureId: number,
  signal?: AbortSignal,
): Promise<DecisionTree> {
  const response = await fetch(`/api/football/matches/${fixtureId}/decision`, {
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
