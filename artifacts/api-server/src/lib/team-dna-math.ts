/**
 * Team DNA: what a side actually is, read from its own matches rather than from a
 * league average.
 *
 * Two things make the reading honest. The window is strictly the matches before the
 * kickoff being asked about, and the matches are not weighted equally: a side's last
 * three games say more about the side that will play than its first three of the
 * season, so every average here is weighted by age, halving every ninety days. That
 * is what stops a team being underrated because it changed manager in July, or
 * overrated because it won 4–0 in August.
 *
 * Each match contributes numbers the scoreline cannot show — expected goals against
 * actual goals, big chances taken and missed, where the work happened, when the
 * goals arrived, whether a lead was held or a deficit overturned, what the players
 * were rated. Everything here is arithmetic over stored rows: no model, no guessing,
 * and a field the feed did not have is left out rather than counted as zero.
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
  /** How fast a match stops counting: its weight halves over this many days. */
  halfLifeDays: number;
};

const PHASE_LABELS = ['0–15', '16–30', '31–45', '46–60', '61–75', '76–90'];

/**
 * The ageing of a match. Ninety days is a season quarter: a match from before the
 * last international break counts about half of one from last week, and a match from
 * the opening weekend about a tenth. Short enough that a changed side stops being
 * described by its old self, long enough that one bad afternoon does not become the
 * team's identity.
 */
export const DNA_HALF_LIFE_DAYS = 90;

/** No match is ever discarded entirely: a real result still says something. */
const MIN_WEIGHT = 0.02;

export function phaseLabel(index: number): string {
  return PHASE_LABELS[index] ?? `${index * 15}+`;
}

export function ageInDays(date: string, asOf: string): number {
  const then = Date.parse(`${date}T00:00:00Z`);
  const now = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(then) || !Number.isFinite(now)) return 0;
  return Math.max(0, Math.round((now - then) / 86_400_000));
}

/** A match's weight: one for today, a half at ninety days, a tenth after ten months. */
export function weightOf(date: string, asOf: string): number {
  const weight = 0.5 ** (ageInDays(date, asOf) / DNA_HALF_LIFE_DAYS);
  return Math.max(MIN_WEIGHT, Math.round(weight * 1000) / 1000);
}

/**
 * The goals a side reaches on a good day: its 80th percentile across the window,
 * taken over the weights rather than the raw list, so a hot August does not become
 * the bad afternoon a call has to survive in November.
 */
export function stressGoals(goals: number[], weights?: number[]): number | null {
  if (!goals.length) return null;
  const pairs = goals
    .map((goals, index) => ({ goals, weight: Math.max(MIN_WEIGHT, weights?.[index] ?? 1) }))
    .sort((a, b) => a.goals - b.goals);
  const total = pairs.reduce((sum, pair) => sum + pair.weight, 0);
  let running = 0;
  for (const pair of pairs) {
    running += pair.weight;
    if (running / total >= 0.8) return pair.goals;
  }
  return pairs[pairs.length - 1].goals;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function mean(values: Array<number | null>): number | null {
  const real = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!real.length) return null;
  return round(real.reduce((sum, value) => sum + value, 0) / real.length);
}

/** Weighted average: recent matches move it, old ones only nudge it. */
function wmean(pairs: Array<[number | null, number]>): number | null {
  let total = 0;
  let weight = 0;
  for (const [value, w] of pairs) {
    if (value === null || !Number.isFinite(value)) continue;
    total += value * w;
    weight += w;
  }
  return weight > 0 ? round(total / weight) : null;
}

/** Weighted share of matches where something happened. */
function wshare(pairs: Array<[boolean | null, number]>): number | null {
  let hits = 0;
  let weight = 0;
  for (const [hit, w] of pairs) {
    if (hit === null) continue;
    if (hit) hits += w;
    weight += w;
  }
  return weight > 0 ? round(hits / weight) : null;
}

function sum(values: Array<number | null>): number {
  return values.reduce<number>((total, value) => total + (value ?? 0), 0);
}

function sd(values: number[]): number | null {
  if (values.length < 3) return null;
  const avg = values.reduce((total, value) => total + value, 0) / values.length;
  const variance = values.reduce((total, value) => total + (value - avg) ** 2, 0) / values.length;
  return round(Math.sqrt(variance));
}

/**
 * The DNA of one team over the matches given.
 *
 * `asOf` is the kickoff being asked about: it is what makes a match old, so a card
 * settled for a fixture in September and the same card re-read in March read the
 * same side differently, because the side's evidence really is different.
 *
 * The verdict lines are deliberately comparative rather than predictive: they say
 * where the finishing and the chance creation disagree, which is the thing a
 * scoreline hides and the thing that makes a run look better or worse than it is.
 */
export function summarizeDna(team: string, asOf: string, matches: DnaMatch[]): TeamDna {
  const played = matches.length;
  const ordered = [...matches].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const weights = ordered.map((match) => weightOf(match.date, asOf));
  const weighted = <T>(value: (match: DnaMatch) => T) => ordered.map((match, index) => [value(match), weights[index]] as [T, number]);

  const goalsFor = sum(ordered.map((m) => m.goalsFor));
  const goalsAgainst = sum(ordered.map((m) => m.goalsAgainst));
  const wins = ordered.filter((m) => m.goalsFor > m.goalsAgainst).length;
  const draws = ordered.filter((m) => m.goalsFor === m.goalsAgainst).length;
  const losses = ordered.filter((m) => m.goalsFor < m.goalsAgainst).length;

  const weightedGoalsFor = wmean(weighted((m) => m.goalsFor));
  const weightedGoalsAgainst = wmean(weighted((m) => m.goalsAgainst));

  const xgFor = wmean(weighted((m) => m.xgFor)) ?? mean(ordered.map((m) => m.xgFor));
  const shotsFor = wmean(weighted((m) => m.shotsFor));
  const shotsOnTarget = wmean(weighted((m) => m.shotsOnTargetFor));
  const bigChances = wmean(weighted((m) => m.bigChancesFor));
  const bigMissed = wmean(weighted((m) => m.bigChancesMissedFor));
  const possession = wmean(weighted((m) => m.possessionFor));
  const passAccuracy = wmean(weighted((m) => m.passAccuracyFor));
  const corners = wmean(weighted((m) => m.cornersFor));

  const home = ordered.flatMap((match, index) => (match.venue === 'home' ? [{ match, weight: weights[index] }] : []));
  const away = ordered.flatMap((match, index) => (match.venue === 'away' ? [{ match, weight: weights[index] }] : []));
  const homeFor = home.length ? wmean(home.map((row) => [row.match.goalsFor, row.weight])) : null;
  const awayFor = away.length ? wmean(away.map((row) => [row.match.goalsFor, row.weight])) : null;
  const homeAgainst = home.length ? wmean(home.map((row) => [row.match.goalsAgainst, row.weight])) : null;
  const awayAgainst = away.length ? wmean(away.map((row) => [row.match.goalsAgainst, row.weight])) : null;

  // Phases are counted in weighted goals, so "when it scores" follows the side it is
  // now rather than the whole season.
  const scoredPhases = Array.from({ length: PHASE_LABELS.length }, (_, index) =>
    round(ordered.reduce((total, match, position) => total + (match.scoredPhases[index] ?? 0) * weights[position], 0)),
  );
  const concededPhases = Array.from({ length: PHASE_LABELS.length }, (_, index) =>
    round(ordered.reduce((total, match, position) => total + (match.concededPhases[index] ?? 0) * weights[position], 0)),
  );
  const totalScored = scoredPhases.reduce((total, value) => total + value, 0);
  const totalConceded = concededPhases.reduce((total, value) => total + value, 0);
  const lateScored = scoredPhases[5] ?? 0;
  const lateConceded = concededPhases[5] ?? 0;
  const firstHalfScored = (scoredPhases[0] ?? 0) + (scoredPhases[1] ?? 0) + (scoredPhases[2] ?? 0);

  const led = wshare(weighted((m) => m.ledAtSomePoint));
  const trailed = wshare(weighted((m) => m.trailedAtSomePoint));
  // Both shares are read among the matches where the situation happened: a side
  // that never led has no lead to have held, so it belongs in neither count.
  const ledAndWon = wshare(weighted((m) => (m.ledAtSomePoint ? m.goalsFor > m.goalsAgainst : null)));
  const trailedUnbeaten = wshare(weighted((m) => (m.trailedAtSomePoint ? m.goalsFor >= m.goalsAgainst : null)));
  const failedToScore = wshare(weighted((m) => m.goalsFor === 0));
  const cleanSheets = wshare(weighted((m) => m.goalsAgainst === 0));
  const bothScored = wshare(weighted((m) => m.goalsFor > 0 && m.goalsAgainst > 0));

  const ratings = ordered.map((m) => m.rating);
  const recentRatings = mean(ratings.slice(0, 5));
  const overallRating = wmean(weighted((m) => m.rating));
  const ratingTrend = recentRatings !== null && overallRating !== null ? round(recentRatings - overallRating) : null;

  const startersKept = wmean(weighted((m) => m.startersKept));
  const goalForSd = sd(ordered.map((m) => m.goalsFor));
  const goalAgainstSd = sd(ordered.map((m) => m.goalsAgainst));
  const finishing =
    xgFor !== null && weightedGoalsFor !== null ? round(weightedGoalsFor - xgFor) : null;

  const identity: DnaTrait[] = [
    { label: 'Goals scored', value: weightedGoalsFor ?? 0, unit: 'perGame', note: 'weighted to the recent side' },
    { label: 'Goals conceded', value: weightedGoalsAgainst ?? 0, unit: 'perGame', note: 'weighted to the recent side' },
  ];
  if (xgFor !== null) identity.push({ label: 'xG created', value: xgFor, unit: 'perGame' });
  if (xgFor !== null) {
    const xgAgainst = wmean(weighted((m) => m.xgAgainst));
    if (xgAgainst !== null) identity.push({ label: 'xG conceded', value: xgAgainst, unit: 'perGame' });
  }
  if (finishing !== null) {
    identity.push({
      label: 'Goals vs xG',
      value: finishing,
      unit: 'perGame',
      note:
        finishing > 0
          ? 'finishing above the chances made'
          : finishing < 0
            ? 'chances going unconverted'
            : 'level with the chances made',
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
    { label: 'Failed to score', value: failedToScore === null ? 0 : round(failedToScore * 100), unit: 'share' },
    { label: 'Both teams scored', value: bothScored === null ? 0 : round(bothScored * 100), unit: 'share' },
    { label: 'Clean sheets', value: cleanSheets === null ? 0 : round(cleanSheets * 100), unit: 'share' },
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
    { label: 'Took the lead', value: led === null ? 0 : round(led * 100), unit: 'share' },
    {
      label: 'Held a lead',
      value: ledAndWon === null ? 0 : round(ledAndWon * 100),
      unit: 'share',
      note: ledAndWon === null ? undefined : `${Math.round(ledAndWon * 100)}% of leads held, weighted`,
    },
    { label: 'Went behind', value: trailed === null ? 0 : round(trailed * 100), unit: 'share' },
    {
      label: 'Unbeaten behind',
      value: trailedUnbeaten === null ? 0 : round(trailedUnbeaten * 100),
      unit: 'share',
      note: trailedUnbeaten === null ? undefined : `${Math.round(trailedUnbeaten * 100)}% of deficits rescued, weighted`,
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
  const yellows = wmean(weighted((m) => m.yellowFor));
  const reds = wmean(weighted((m) => m.redFor));
  const fouls = wmean(weighted((m) => m.foulsFor));
  if (yellows !== null) mistakes.push({ label: 'Yellows', value: yellows, unit: 'perGame' });
  if (reds !== null && reds > 0) mistakes.push({ label: 'Reds', value: reds, unit: 'perGame' });
  if (fouls !== null) mistakes.push({ label: 'Fouls', value: fouls, unit: 'perGame' });
  const saves = wmean(weighted((m) => m.savesFor));
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
  const agedRead = played
    ? `Weighted to the recent side: a match is worth half after ${DNA_HALF_LIFE_DAYS} days.`
    : 'No matches read.';

  return {
    team,
    matches: played,
    from: ordered.length ? ordered[ordered.length - 1].date : null,
    to: ordered.length ? ordered[0].date : null,
    record: { wins, draws, losses, goalsFor, goalsAgainst },
    identity,
    dynamics,
    pressure,
    mistakes: [...mistakes, { label: 'Window', value: played, unit: 'count', note: agedRead }],
    verdict: { scoring: scoringRead, control: controlRead, late: lateRead },
    halfLifeDays: DNA_HALF_LIFE_DAYS,
  };
}

export type DnaVerdict = TeamDna['verdict'];
