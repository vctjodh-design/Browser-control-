// Reading the feed's own list of a team's matches.
//
// Kept apart from the fetching so the shape of the answer can be tested without a
// network call: this parser is where a window quietly loses matches, and the filters
// here decide what counts as evidence.

export type TeamFixtureRow = {
  fixtureId: number;
  matchDate: string;
  competition: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
};

type Row = Record<string, unknown>;

function asObject(value: unknown): Row | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value);
  return null;
}

/** The feed marks a completed match by its short code; older rows only by text. */
function isFinished(fixture: Row | null): boolean {
  const status = asObject(fixture?.status);
  const short = (text(status?.short) ?? '').toUpperCase();
  if (['FT', 'AET', 'PEN'].includes(short)) return true;
  if (['NS', 'TBD', '1H', 'HT', '2H', 'ET', 'P', 'BT', 'SUSP', 'INT', 'LIVE'].includes(short)) {
    return false;
  }
  return /finished|full.?time/i.test(text(status?.long) ?? '');
}

/**
 * A team's fixtures as history rows: finished, strictly before the kickoff being
 * asked about, newest first, clipped to the window.
 *
 * A window is what happened before a kickoff, so the kickoff itself and anything
 * after it are dropped even when the feed returns them — otherwise a card settled
 * after the fact would be reading the result it is supposed to be tested against.
 */
export function parseTeamFixtures(payload: unknown, asOf: string, depth: number): TeamFixtureRow[] {
  const rows = Array.isArray(payload) ? payload : [];
  const kept: TeamFixtureRow[] = [];
  for (const value of rows) {
    const row = asObject(value);
    const fixture = asObject(row?.fixture);
    if (!row || !fixture || !isFinished(fixture)) continue;
    const fixtureId = integer(fixture.id) ?? integer(row._id);
    if (fixtureId === null || fixtureId <= 0) continue;
    const kickoff = text(fixture.date);
    if (!kickoff) continue;
    const date = kickoff.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date >= asOf) continue;
    const teams = asObject(row.teams);
    const home = asObject(teams?.home);
    const away = asObject(teams?.away);
    const homeTeam = text(home?.name);
    const awayTeam = text(away?.name);
    const goals = asObject(row.goals);
    const homeScore = integer(goals?.home);
    const awayScore = integer(goals?.away);
    if (!homeTeam || !awayTeam || homeScore === null || awayScore === null) continue;
    const league = asObject(row.league);
    kept.push({
      fixtureId,
      matchDate: date,
      competition: [text(league?.country), text(league?.name)].filter(Boolean).join(': '),
      homeTeam,
      awayTeam,
      homeScore,
      awayScore,
    });
  }
  kept.sort((a, b) => (a.matchDate < b.matchDate ? 1 : a.matchDate > b.matchDate ? -1 : 0));
  return kept.slice(0, Math.max(1, Math.min(depth, 100)));
}
