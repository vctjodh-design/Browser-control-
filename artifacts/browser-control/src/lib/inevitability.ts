// Reader for the Inevitability Engine: one fixture resolved a single time,
// with the chain of contests that produced the result.
//
// Nothing here is a distribution. The engine plays the duel board once, at the
// numbers the two squads argue for, and the scoreline is the residue of that
// one trace — so the page can print the reasoning instead of a percentage.

export type InevitabilitySide = 'home' | 'away';

export type InevitabilityLynchpin = {
  side: InevitabilitySide;
  team: string;
  opponent: string;
  lane: string;
  kind: 'carry' | 'progression' | 'final third';
  attacker: string;
  attackerRole: string;
  defender: string;
  defenderRole: string;
  /** How often the attacker wins this contest on the two men's own numbers. */
  share: number;
  edge: number;
  coverDistance: number;
  /** The edge weighted by how far cover has to travel. Ranks the candidates. */
  forcedAdaptation: number;
  response: string;
  opens: string;
};

export type InevitabilityGoal = {
  minute: number;
  side: InevitabilitySide;
  scorer: string;
  team: string;
  channel: string;
  detail: string;
};

export type InevitabilityStep = {
  label: string;
  detail: string;
  value: number;
  unit: string;
};

/**
 * How much of the verdict is the board, and how much is one night's finishing.
 *
 * Deliberately not a percentage: a single resolved match has no distribution
 * behind it to take a percentage of. `separation` is the gap in goals between
 * the two sides' own worth.
 */
export type InevitabilityConfidence = {
  tier: 'firm' | 'leaning' | 'knife-edge';
  label: string;
  separation: number;
  text: string;
  basis: string;
};

/** The sheet a side keeps, and what the opponent brought to break it. */
export type InevitabilityShutout = {
  side: InevitabilitySide | null;
  clean: boolean;
  keeper: string;
  threat: number;
  shotsFaced: number;
  concededPerGame: number;
  cleanSheets: number;
  recentGames: number;
  text: string;
  basis: string;
};

/** One reasoning pass over the fixture, with the numbers it read and what it called. */
export type InevitabilityMethod = {
  id: string;
  label: string;
  reads: string;
  call: string;
};

export type InevitabilityVerdict = {
  fixtureId: number;
  teams: [string, string];
  short: [string, string];
  scoreline: string;
  verdict: {
    home: number;
    away: number;
    winner: InevitabilitySide | 'draw';
    text: string;
  };
  lynchpin: InevitabilityLynchpin;
  shutout: InevitabilityShutout;
  methods: InevitabilityMethod[];
  cascade: InevitabilityStep[];
  goals: InevitabilityGoal[];
  expectedGoals: { home: number; away: number };
  confidence: InevitabilityConfidence;
  trace: string[];
  killCondition: string;
  note: string;
};

export type FixtureOption = {
  competition: string;
  homeTeam: string;
  awayTeam: string;
  kickoff: string;
  status: string;
  matchUrl: string;
  homeScore: number | null;
  awayScore: number | null;
};

/** The fixture id is the last path segment of the match URL the feed gives. */
function fixtureIdOf(matchUrl: string): number | null {
  const id = Number(matchUrl.split('/').filter(Boolean).pop());
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

const FIXTURE_LIST_ATTEMPTS = 3;

/** The feed behind the list can be briefly refused, especially while a run is going. */
function isTransientStatus(status: number): boolean {
  return status === 502 || status === 503 || status === 504;
}

async function readFixtureList(date: string, signal?: AbortSignal): Promise<FixtureOption[]> {
  const response = await fetch(`/api/football/fixtures?date=${encodeURIComponent(date)}`, {
    signal,
    headers: { accept: 'application/json' },
  });
  const body = (await response.json().catch(() => null)) as
    | { fixtures?: FixtureOption[]; error?: string }
    | null;
  if (!response.ok) {
    throw new InevitabilityRequestError(
      body?.error ?? `Fixtures could not be loaded (${response.status}).`,
      response.status,
      retryAfterSecondsOf(response),
    );
  }
  return (body?.fixtures ?? []).filter((fixture) => fixtureIdOf(fixture.matchUrl) !== null);
}

/**
 * One refused read of the list should not empty the page: a transient failure is
 * retried a couple of times, so a reload during a busy run still lands on the date.
 */
export async function loadFixtures(date: string, signal?: AbortSignal): Promise<FixtureOption[]> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await readFixtureList(date, signal);
    } catch (error) {
      const transient = error instanceof InevitabilityRequestError && isTransientStatus(error.status);
      if (!transient || attempt >= FIXTURE_LIST_ATTEMPTS - 1 || signal?.aborted) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_500 * 2 ** attempt));
      if (signal?.aborted) throw error;
    }
  }
}

export function fixtureId(fixture: FixtureOption): number | null {
  return fixtureIdOf(fixture.matchUrl);
}

/** A refused read, kept with its status so a run can tell a skipped fixture from a broken one. */
export class InevitabilityRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** What the source asked us to wait, when it says so. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message);
    this.name = 'InevitabilityRequestError';
  }
}

/** The cooldown the API forwards from the data source, in seconds. */
function retryAfterSecondsOf(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export async function loadInevitability(
  fixtureIdValue: number,
  signal?: AbortSignal,
): Promise<InevitabilityVerdict> {
  const response = await fetch(`/api/football/matches/${fixtureIdValue}/inevitability`, {
    signal,
    headers: { accept: 'application/json' },
  });
  const body = (await response.json().catch(() => null)) as
    | (InevitabilityVerdict & { error?: string })
    | null;
  if (!response.ok) {
    throw new InevitabilityRequestError(
      body?.error ?? `The fixture could not be resolved (${response.status}).`,
      response.status,
      retryAfterSecondsOf(response),
    );
  }
  return body as InevitabilityVerdict;
}
