// Client-side reader for the simulation form profile.
//
// The profile is descriptive: recent results, the way each club plays and the
// XI its team sheets point to. The simulation turns those into traits and
// shape; it never decides the result for you.

export type SimFormResult = {
  fixtureId: number;
  date: string;
  competition: string;
  opponent: string;
  home: boolean;
  scored: number;
  conceded: number;
  result: 'W' | 'D' | 'L';
  scoreline: string;
};

export type SimFormRecord = {
  games: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  goalDifference: number;
  pointsPerGame: number;
  goalsForPerGame: number;
  goalsAgainstPerGame: number;
  cleanSheets: number;
  failedToScore: number;
  form: string;
  homePointsPerGame: number | null;
  awayPointsPerGame: number | null;
};

export type SimTeamStyle = {
  matches: number;
  possession: number | null;
  shots: number | null;
  shotsOnTarget: number | null;
  shotAccuracy: number | null;
  expectedGoals: number | null;
  passes: number | null;
  passAccuracy: number | null;
  longBallShare: number | null;
  crosses: number | null;
  corners: number | null;
  fouls: number | null;
  yellows: number | null;
  reds: number | null;
  tackles: number | null;
  interceptions: number | null;
  recoveries: number | null;
  aerialDuelsWon: number | null;
  boxTouches: number | null;
  bigChances: number | null;
};

export type SimPlayerMatchLine = {
  fixtureId: number;
  date: string;
  opponent: string;
  rating: number | null;
  minutes: number;
};

export type SimLineupPlayer = {
  id: number | null;
  name: string;
  number: number | null;
  position: string | null;
  role: string;
  grid: string | null;
  starts: number;
  appearances: number;
  averageMinutes: number;
  averageRating: number | null;
  ratingTrend: number | null;
  goals: number;
  assists: number;
  shots: number;
  shotsOnTarget: number;
  passAccuracy: number | null;
  keyPasses: number;
  tackles: number;
  interceptions: number;
  duelsWon: number;
  dribblesCompleted: number;
  fouls: number;
  yellowCards: number;
  redCards: number;
  saves: number | null;
  impact: number;
  quality: number;
  signals: Record<string, number>;
  matchRatings: SimPlayerMatchLine[];
};

export type SimLeagueTable = {
  rank: number;
  teams: number;
  points: number;
  played: number;
  goalDifference: number;
  pointsPerGame: number;
  form: string;
  /** -1 (bottom) .. 1 (top) relative to the league's own average. */
  edge: number;
};

export type SimTeamProfile = {
  side: 'home' | 'away';
  teamId: number;
  name: string;
  short: string;
  record: SimFormRecord;
  recent: SimFormResult[];
  style: SimTeamStyle;
  formation: string;
  /** 'team-sheets' when the archived sheets agree on a shape, 'roles' when it
   *  was read from what the predicted XI's midfielders actually do. */
  formationSource: 'team-sheets' | 'roles';
  formationConfidence: number;
  table: SimLeagueTable | null;
  lineup: SimLineupPlayer[];
  bench: SimLineupPlayer[];
  slots: { role: string; nx: number; nz: number }[];
  lineupSample: number;
  squadQuality: number;
  tactics: {
    press: number;
    line: number;
    width: number;
    risk: number;
    tempo: number;
    direct: number;
    label: string;
  };
};

export type SimFormProfile = {
  fixtureId: number;
  observedAt: string;
  formGames: number;
  detailGames: number;
  teams: [SimTeamProfile, SimTeamProfile];
  issues: string[];
};

export const formProfileStorageKey = (fixtureId: number) => `sim-form-profile:${fixtureId}`;

export async function loadSimFormProfile(
  fixtureId: number,
  signal?: AbortSignal,
): Promise<SimFormProfile> {
  const response = await fetch(`/api/football/matches/${fixtureId}/sim-profile`, {
    signal,
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Form profile request failed (${response.status}).`);
  }
  return (await response.json()) as SimFormProfile;
}

/** Hand the profile to the simulation frame. Frames are same-origin. */
export function stashFormProfile(profile: SimFormProfile): void {
  try {
    window.sessionStorage.setItem(
      formProfileStorageKey(profile.fixtureId),
      JSON.stringify(profile),
    );
  } catch {
    // Storage can be unavailable or full; the simulation then runs its
    // default squads, which is a graceful fallback rather than an error.
  }
}
