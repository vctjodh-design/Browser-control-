// Reader for the player-duel simulation: the fixture played as a chain of
// man-versus-man contests rather than as a draw around a goal average.

export type DuelSide = 'home' | 'away';

export type DuelPairing = {
  lane: string;
  side: DuelSide;
  label: string;
  kind: 'carry' | 'progression' | 'final third';
  attacker: { name: string; role: string; rating: number };
  defender: { name: string; role: string; rating: number };
  winPct: number;
  edge: number;
};

export type DuelBoard = {
  lanes: DuelPairing[];
  midfield: DuelPairing[];
  keepers: { side: DuelSide; name: string; rating: number; faces: string }[];
  strength: { home: number; away: number; gap: number };
  bands: { band: string; home: number; away: number }[];
};

export type DuelScoreline = { home: number; away: number; count: number; pct: number };

export type DuelPlayerLine = {
  name: string;
  side: DuelSide;
  role: string;
  duels: number;
  won: number;
  winPct: number;
  shots: number;
  goals: number;
  saves: number;
  conceded: number;
};

export type DuelTwist = { label: string; detail: string; pct: number; kind: string };

export type DuelSimulation = {
  fixtureId: number;
  teams: [string, string];
  short: [string, string];
  formation: [string, string];
  expectations: { totalGoals: number; homeGoals: number; awayGoals: number } | null;
  elapsedMs: number;
  trials: number;
  seed: number;
  board: DuelBoard;
  outcome: {
    home: number;
    draw: number;
    away: number;
    mostLikely: DuelScoreline | null;
    homeGoals: number;
    awayGoals: number;
    totalGoals: number;
    btts: number;
    over25: number;
    cleanSheetHome: number;
    cleanSheetAway: number;
  };
  scorelines: DuelScoreline[];
  twists: DuelTwist[];
  players: DuelPlayerLine[];
  sample: { minute: number; side: DuelSide; text: string; goal: boolean }[];
  note: string;
};

export async function loadDuels(
  fixtureId: number,
  options: { trials?: number; seed?: number; signal?: AbortSignal } = {},
): Promise<DuelSimulation> {
  const query = new URLSearchParams();
  if (options.trials) query.set('trials', String(options.trials));
  if (options.seed) query.set('seed', String(options.seed));
  const response = await fetch(`/api/football/matches/${fixtureId}/duels?${query.toString()}`, {
    signal: options.signal,
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `The duels could not be played (${response.status}).`);
  }
  return (await response.json()) as DuelSimulation;
}
