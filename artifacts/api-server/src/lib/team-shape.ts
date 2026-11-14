/**
 * One team's shape, read from its own matches only.
 *
 * This is the replacement for leaning on a league average: three windows over the
 * matches a side actually played before a given date, so the app can say what a
 * team is (50), what it has become (25) and what it is right now (10). The gap
 * between the shortest and the longest window is the volatility — a side whose
 * last ten say 1.9 goals and whose last fifty say 2.6 is not a 2.2 side, it is a
 * coin flip, and that belongs in the upset reading rather than being averaged away.
 *
 * Nothing here adjusts for the opponent yet. A 2.4 against weak defences is still
 * counted as 2.4, which is why the browser shows these as shape and not as worths.
 */

export type HistoryMatch = {
  /** Present when the row came from the history table rather than a caller. */
  fixtureId?: number;
  date: string;
  homeTeam: string;
  awayTeam: string;
  homeScore: number;
  awayScore: number;
  competition?: string;
};

export type TeamWindow = {
  window: number;
  played: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number;
  goalsAgainst: number;
  perGameFor: number;
  perGameAgainst: number;
  /** Goals scored per game in the matches this side hosted, when it hosted any. */
  homePerGameFor: number | null;
  /** Goals scored per game away from home, when it played any. */
  awayPerGameFor: number | null;
  pointsPerGame: number;
  /** Share of these matches in which the side both scored and conceded. */
  openGames: number;
};

export type TeamShape = {
  team: string;
  asOf: string;
  windows: TeamWindow[];
  /** How far the current side is from its own long-run level, in goals per game. */
  volatility: number | null;
  trend: 'rising' | 'steady' | 'falling' | null;
};

const DEFAULT_WINDOWS = [10, 25, 50] as const;

/**
 * Club-form words that say nothing about which side it is: "Liverpool FC" and
 * "Liverpool" are one team.
 *
 * Note what is deliberately *not* here. "Liverpool W", "Liverpool U21" and
 * "Liverpool UY" are different sides with different results, not spelling of the
 * same one, so those markers survive normalisation and the keys stay apart.
 */
const CLUB_FORM_WORDS = new Set(['fc', 'afc', 'acf', 'cf', 'sc', 'ac', 'club']);

/** Team names across a season arrive with accents, dots and stray spacing. */
export function normalizeTeamName(name: string): string {
  const tokens = name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 0);
  const kept = tokens.filter((token) => !CLUB_FORM_WORDS.has(token));
  // A side actually named "FC" alone would normalise to nothing; keep it whole.
  return (kept.length ? kept : tokens).join(' ');
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function windowOf(team: string, matches: HistoryMatch[], window: number): TeamWindow {
  const key = normalizeTeamName(team);
  const played = matches.slice(0, window);
  let goalsFor = 0;
  let goalsAgainst = 0;
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let homeGames = 0;
  let homeGoals = 0;
  let awayGames = 0;
  let awayGoals = 0;
  let openGames = 0;

  for (const match of played) {
    const atHome = normalizeTeamName(match.homeTeam) === key;
    const scored = atHome ? match.homeScore : match.awayScore;
    const conceded = atHome ? match.awayScore : match.homeScore;
    goalsFor += scored;
    goalsAgainst += conceded;
    if (scored > conceded) wins += 1;
    else if (scored === conceded) draws += 1;
    else losses += 1;
    if (scored > 0 && conceded > 0) openGames += 1;
    if (atHome) {
      homeGames += 1;
      homeGoals += scored;
    } else {
      awayGames += 1;
      awayGoals += scored;
    }
  }

  const count = played.length;
  return {
    window,
    played: count,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    perGameFor: count ? round(goalsFor / count) : 0,
    perGameAgainst: count ? round(goalsAgainst / count) : 0,
    homePerGameFor: homeGames ? round(homeGoals / homeGames) : null,
    awayPerGameFor: awayGames ? round(awayGoals / awayGames) : null,
    pointsPerGame: count ? round((wins * 3 + draws) / count) : 0,
    openGames: count ? round(openGames / count) : 0,
  };
}

/**
 * Every match that side played strictly before `asOf`, newest first. Strictly: a
 * window that can see the fixture being predicted is not a prediction, it is a
 * memory of the answer.
 */
export function matchesBefore(
  team: string,
  asOf: string,
  history: HistoryMatch[],
): HistoryMatch[] {
  const key = normalizeTeamName(team);
  return history
    .filter(
      (match) =>
        match.date < asOf &&
        (normalizeTeamName(match.homeTeam) === key || normalizeTeamName(match.awayTeam) === key),
    )
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

export function summarizeTeamShape(
  team: string,
  asOf: string,
  history: HistoryMatch[],
  windows: readonly number[] = DEFAULT_WINDOWS,
): TeamShape {
  const eligible = matchesBefore(team, asOf, history);
  const built = windows.map((depth) => windowOf(team, eligible, depth));
  const shortest = built[0];
  const longest = built[built.length - 1];

  // Volatility needs both ends to be real samples: a side with four matches has a
  // current run, not a long-run level to be far from.
  const volatility =
    shortest && longest && shortest.played >= 5 && longest.played >= 15
      ? round(
          (Math.abs(shortest.perGameFor - longest.perGameFor) +
            Math.abs(shortest.perGameAgainst - longest.perGameAgainst)) /
            2,
        )
      : null;

  const middle = built[1] ?? longest;
  let trend: TeamShape['trend'] = null;
  if (shortest && middle && shortest.played >= 5 && middle.played >= 10) {
    const shift = shortest.pointsPerGame - middle.pointsPerGame;
    trend = shift >= 0.45 ? 'rising' : shift <= -0.45 ? 'falling' : 'steady';
  }

  return { team, asOf, windows: built, volatility, trend };
}
