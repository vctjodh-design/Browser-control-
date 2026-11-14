/**
 * Team DNA: what a side actually is, read from its own matches rather than from a
 * league average.
 *
 * Each match contributes numbers the scoreline cannot show — expected goals against
 * actual goals, big chances taken and missed, where on the pitch the work happened,
 * when the goals arrived, whether a lead was held or a deficit was overturned, what
 * the players were rated. Fifty of those read together say more about a team than
 * fifty results, and the window is always the fifty before the kickoff being asked
 * about.
 *
 * Everything here is arithmetic over stored rows. No model, no guessing: if a field
 * is missing for a match, the average is taken over the matches that have it, and
 * the coverage says how many that was.
 */

export type DnaMatch = {
  fixtureId: number;
  date: string;
  competition: string;
  venue: 'home' | 'away';
  goalsFor: number;
  goalsAgainst: number;
  xgFor: number | null;
  xgAgainst: number | null;
  shotsFor: number | null;
  shotsOnTargetFor: number | null;
  bigChancesFor: number | null;
  bigChancesMissedFor: number | null;
  possessionFor: number | null;
  passAccuracyFor: number | null;
  cornersFor: number | null;
  foulsFor: number | null;
  yellowFor: number | null;
  redFor: number | null;
  savesFor: number | null;
  goalsPreventedFor: number | null;
  /** Goals scored and conceded in six fifteen-minute bands, from the timeline. */
  scoredPhases: number[];
  concededPhases: number[];
  /** Whether this side was ahead at any point, and behind at any point. */
  ledAtSomePoint: boolean | null;
  trailedAtSomePoint: boolean | null;
  /** Mean rating of the side's players in this match, when the feed rated them. */
  rating: number | null;
  /** Starters kept from the previous match in the window, as a share of eleven. */
  startersKept: number | null;
};

export type DnaTrait = {
  label: string;
  value: number;
  /** How the number should be read: a rate, a per-match average, or a plain count. */
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
  /** Where the results and the underlying numbers disagree. */
  verdict: { scoring: string; control: string; late: string };
};

const PHASE_LABELS = ['0–15', '16–30', '31–45', '46–60', '61–75', '76–90'];

export function phaseLabel(index: number): string {
  return PHASE_LABELS[index] ?? `${index * 15}+`;
}

function mean(values: Array<number | null>): number | null {
  const real = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!real.length) return null;
  return round(real.reduce((sum, value) => sum + value, 0) / real.length);
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function share(values: Array<number | null>): number | null {
  const real = values.filter((value): value is number => value !== null);
  if (!real.length) return null;
  return round(sum(real) / real.length);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function sd(values: number[]): number | null {
  if (values.length < 3) return null;
  const avg = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - avg) ** 2, 0) / values.length;
  return round(Math.sqrt(variance));
}

/**
 * The DNA of one team over the matches given, newest first.
 *
 * The verdict lines are deliberately comparative rather than predictive: they say
 * where the finishing and the chance creation disagree, which is the thing a
 * scoreline hides and the thing that makes a run look better or worse than it is.
 */
export function summarizeDna(team: string, matches: DnaMatch[]): TeamDna {
  const played = matches.length;
  const ordered = [...matches].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const goalsFor = sum(ordered.map((m) => m.goalsFor));
  const goalsAgainst = sum(ordered.map((m) => m.goalsAgainst));
  const wins = ordered.filter((m) => m.goalsFor > m.goalsAgainst).length;
  const draws = ordered.filter((m) => m.goalsFor === m.goalsAgainst).length;
  const losses = ordered.filter((m) => m.goalsFor < m.goalsAgainst).length;

  const perGame = (total: number) => (played ? round(total / played) : 0);

  const xgFor = mean(ordered.map((m) => m.xgFor));
  const xgAgainst = mean(ordered.map((m) => m.xgAgainst));
  const shotsFor = mean(ordered.map((m) => m.shotsFor));
  const shotsOnTarget = mean(ordered.map((m) => m.shotsOnTargetFor));
  const bigChances = mean(ordered.map((m) => m.bigChancesFor));
  const bigMissed = mean(ordered.map((m) => m.bigChancesMissedFor));
  const possession = mean(ordered.map((m) => m.possessionFor));
  const passAccuracy = mean(ordered.map((m) => m.passAccuracyFor));
  const corners = mean(ordered.map((m) => m.cornersFor));

  const homeMatches = ordered.filter((m) => m.venue === 'home');
  const awayMatches = ordered.filter((m) => m.venue === 'away');
  const homeFor = homeMatches.length ? round(sum(homeMatches.map((m) => m.goalsFor)) / homeMatches.length) : null;
  const awayFor = awayMatches.length ? round(sum(awayMatches.map((m) => m.goalsFor)) / awayMatches.length) : null;
  const homeAgainst = homeMatches.length
    ? round(sum(homeMatches.map((m) => m.goalsAgainst)) / homeMatches.length)
    : null;
  const awayAgainst = awayMatches.length
    ? round(sum(awayMatches.map((m) => m.goalsAgainst)) / awayMatches.length)
    : null;

  const scoredPhases = Array.from({ length: PHASE_LABELS.length }, (_, index) =>
    sum(ordered.map((m) => m.scoredPhases[index] ?? 0)),
  );
  const concededPhases = Array.from({ length: PHASE_LABELS.length }, (_, index) =>
    sum(ordered.map((m) => m.concededPhases[index] ?? 0)),
  );
  const totalScored = scoredPhases.reduce((total, value) => total + value, 0);
  const totalConceded = concededPhases.reduce((total, value) => total + value, 0);
  const lateScored = scoredPhases[5] ?? 0;
  const lateConceded = concededPhases[5] ?? 0;
  const firstHalfScored = (scoredPhases[0] ?? 0) + (scoredPhases[1] ?? 0) + (scoredPhases[2] ?? 0);
  const firstHalfConceded = (concededPhases[0] ?? 0) + (concededPhases[1] ?? 0) + (concededPhases[2] ?? 0);

  const led = ordered.filter((m) => m.ledAtSomePoint === true).length;
  const trailed = ordered.filter((m) => m.trailedAtSomePoint === true).length;
  const ledAndWon = ordered.filter(
    (m) => m.ledAtSomePoint === true && m.goalsFor > m.goalsAgainst,
  ).length;
  const trailedUnbeaten = ordered.filter(
    (m) => m.trailedAtSomePoint === true && m.goalsFor >= m.goalsAgainst,
  ).length;
  const failedToScore = ordered.filter((m) => m.goalsFor === 0).length;
  const cleanSheets = ordered.filter((m) => m.goalsAgainst === 0).length;
  const bothScored = ordered.filter((m) => m.goalsFor > 0 && m.goalsAgainst > 0).length;

  const ratings = ordered.map((m) => m.rating);
  const recentRatings = mean(ratings.slice(0, 5));
  const overallRating = mean(ratings);
  const ratingTrend =
    recentRatings !== null && overallRating !== null ? round(recentRatings - overallRating) : null;

  const startersKept = mean(ordered.map((m) => m.startersKept));

  const goalForSd = sd(ordered.map((m) => m.goalsFor));
  const goalAgainstSd = sd(ordered.map((m) => m.goalsAgainst));
  const finishing = xgFor !== null && played ? round(perGame(goalsFor) - xgFor) : null;

  const identity: DnaTrait[] = [
    { label: 'Goals scored', value: perGame(goalsFor), unit: 'perGame' },
    { label: 'Goals conceded', value: perGame(goalsAgainst), unit: 'perGame' },
  ];
  if (xgFor !== null) identity.push({ label: 'xG created', value: xgFor, unit: 'perGame' });
  if (xgAgainst !== null) identity.push({ label: 'xG conceded', value: xgAgainst, unit: 'perGame' });
  if (finishing !== null) {
    identity.push({
      label: 'Goals vs xG',
      value: finishing,
      unit: 'perGame',
      note: finishing > 0 ? 'finishing above the chances made' : finishing < 0 ? 'chances going unconverted' : 'level with the chances made',
    });
  }
  if (shotsFor !== null) identity.push({ label: 'Shots', value: shotsFor, unit: 'perGame' });
  if (shotsOnTarget !== null) identity.push({ label: 'On target', value: shotsOnTarget, unit: 'perGame' });
  if (possession !== null) identity.push({ label: 'Possession', value: possession, unit: 'share' });
  if (passAccuracy !== null) identity.push({ label: 'Pass accuracy', value: passAccuracy, unit: 'share' });
  if (corners !== null) identity.push({ label: 'Corners', value: corners, unit: 'perGame' });

  const dynamics: DnaTrait[] = [
    { label: 'Scored in 1st half', value: totalScored ? round((firstHalfScored / totalScored) * 100) : 0, unit: 'share' },
    { label: 'Scored after 75′', value: totalScored ? round((lateScored / totalScored) * 100) : 0, unit: 'share' },
    { label: 'Conceded after 75′', value: totalConceded ? round((lateConceded / totalConceded) * 100) : 0, unit: 'share' },
    { label: 'Failed to score', value: played ? round((failedToScore / played) * 100) : 0, unit: 'share' },
    { label: 'Both teams scored', value: played ? round((bothScored / played) * 100) : 0, unit: 'share' },
    { label: 'Clean sheets', value: played ? round((cleanSheets / played) * 100) : 0, unit: 'share' },
  ];
  if (homeFor !== null || awayFor !== null) {
    dynamics.push({
      label: 'Home / away scoring',
      value: homeFor ?? 0,
      unit: 'perGame',
      note: `${homeFor ?? '—'} at home, ${awayFor ?? '—'} away${homeAgainst !== null || awayAgainst !== null ? ` · ${homeAgainst ?? '—'} / ${awayAgainst ?? '—'} conceded` : ''}`,
    });
  }
  if (goalForSd !== null) dynamics.push({ label: 'Goal spread (sd)', value: goalForSd, unit: 'perGame' });
  if (goalAgainstSd !== null) dynamics.push({ label: 'Leak spread (sd)', value: goalAgainstSd, unit: 'perGame' });

  const pressure: DnaTrait[] = [
    { label: 'Took the lead', value: played ? round((led / played) * 100) : 0, unit: 'share' },
    {
      label: 'Held a lead',
      value: led ? round((ledAndWon / led) * 100) : 0,
      unit: 'share',
      note: `${ledAndWon} of ${led} leads turned into wins`,
    },
    { label: 'Went behind', value: played ? round((trailed / played) * 100) : 0, unit: 'share' },
    {
      label: 'Unbeaten behind',
      value: trailed ? round((trailedUnbeaten / trailed) * 100) : 0,
      unit: 'share',
      note: `${trailedUnbeaten} of ${trailed} deficits rescued`,
    },
  ];

  const mistakes: DnaTrait[] = [];
  if (bigChances !== null) mistakes.push({ label: 'Big chances', value: bigChances, unit: 'perGame' });
  if (bigMissed !== null) {
    mistakes.push({
      label: 'Big chances missed',
      value: bigMissed,
      unit: 'perGame',
      note: bigChances ? `${Math.round((bigMissed / bigChances) * 100)}% of them` : undefined,
    });
  }
  const yellows = mean(ordered.map((m) => m.yellowFor));
  const reds = mean(ordered.map((m) => m.redFor));
  const fouls = mean(ordered.map((m) => m.foulsFor));
  if (yellows !== null) mistakes.push({ label: 'Yellows', value: yellows, unit: 'perGame' });
  if (reds !== null && reds > 0) mistakes.push({ label: 'Reds', value: reds, unit: 'perGame' });
  if (fouls !== null) mistakes.push({ label: 'Fouls', value: fouls, unit: 'perGame' });
  const saves = mean(ordered.map((m) => m.savesFor));
  if (saves !== null) mistakes.push({ label: 'Saves', value: saves, unit: 'perGame' });
  if (overallRating !== null) mistakes.push({ label: 'Team rating', value: overallRating, unit: 'rating' });
  if (ratingTrend !== null) {
    mistakes.push({
      label: 'Rating trend',
      value: ratingTrend,
      unit: 'rating',
      note: ratingTrend > 0 ? 'last five rated above the run' : ratingTrend < 0 ? 'last five rated below the run' : 'steady',
    });
  }
  if (startersKept !== null) mistakes.push({ label: 'Starters kept', value: startersKept, unit: 'share' });

  const scoringRead =
    finishing === null
      ? 'No expected goals in these matches, so the finishing is unmeasured.'
      : finishing >= 0.3
        ? `Scoring ${finishing.toFixed(2)} a game above its chances — a rate that tends to fall back.`
        : finishing <= -0.3
          ? `Creating ${Math.abs(finishing).toFixed(2)} more than it scores — the goals are the part to question.`
          : 'Scoring about what its chances are worth.';
  const controlRead =
    xgFor === null
      ? 'Control unmeasured.'
      : xgFor >= 1.6
        ? 'Creates enough to win most weeks.'
        : xgFor >= 1.1
          ? 'Creates enough to be competitive, not to dominate.'
          : 'Creates little; its points come from the other end.';
  const lateShare = totalScored ? lateScored / totalScored : 0;
  const lateRead =
    lateShare >= 0.3
      ? `${Math.round(lateShare * 100)}% of its goals arrive after 75′ — a side that stays in games and takes them late.`
      : lateShare <= 0.1
        ? 'Almost nothing after 75′ — what it builds early is what it keeps.'
        : 'Goals spread through the match.';

  return {
    team,
    matches: played,
    from: ordered.length ? ordered[ordered.length - 1].date : null,
    to: ordered.length ? ordered[0].date : null,
    record: { wins, draws, losses, goalsFor, goalsAgainst },
    identity,
    dynamics,
    pressure,
    mistakes,
    verdict: { scoring: scoringRead, control: controlRead, late: lateRead },
  };
}
