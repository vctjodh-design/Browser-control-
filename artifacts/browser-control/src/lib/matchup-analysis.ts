import type { FootballMatchLastFive } from '@workspace/api-client-react';

type MatchRecord = FootballMatchLastFive['home']['matches'][number];
type TeamRecord = FootballMatchLastFive['home'];
type PlayerRecord = TeamRecord['matches'][number]['players'][number]['players'][number];

export type MatchupTrendPoint = {
  fixtureId: number;
  date: string;
  opponent: string;
  score: string;
  result: 'W' | 'D' | 'L';
  goalsFor: number;
  goalsAgainst: number;
  expectedGoalsFor: number | null;
  expectedGoalsAgainst: number | null;
  shotsFor: number | null;
  shotsAgainst: number | null;
  possession: number | null;
};

export type MatchupPlayerLeader = {
  id: number | null;
  name: string;
  photo: string | null;
  position: string | null;
  appearances: number;
  starts: number;
  minutes: number;
  averageRating: number | null;
  goals: number;
  assists: number;
  expectedGoals: number | null;
  expectedAssists: number | null;
  keyPasses: number;
  tackles: number;
};

export type MatchupAvailability = {
  playerId: number | null;
  playerName: string;
  withMatches: number;
  withoutMatches: number;
  pointsPerMatchWith: number | null;
  pointsPerMatchWithout: number | null;
  goalDifferenceWith: number | null;
  goalDifferenceWithout: number | null;
  coverage: number;
};

export type MatchupLossReview = {
  fixtureId: number;
  date: string;
  opponent: string;
  score: string;
  expectedGoalsFor: number | null;
  expectedGoalsAgainst: number | null;
  shotsFor: number | null;
  shotsAgainst: number | null;
  errorsLeadingToGoal: number | null;
  bigChancesFor: number | null;
  bigChancesAgainst: number | null;
};

export type MatchupTeamAnalysis = {
  id: number;
  name: string;
  sample: number;
  wins: number;
  draws: number;
  losses: number;
  pointsPerMatch: number | null;
  goalsForAverage: number | null;
  goalsAgainstAverage: number | null;
  goalsForVolatility: number | null;
  goalsAgainstVolatility: number | null;
  expectedGoalsForAverage: number | null;
  expectedGoalsAgainstAverage: number | null;
  expectedGoalsCoverage: number;
  forecastAttackRate: number | null;
  forecastDefenseRate: number | null;
  shotsForAverage: number | null;
  shotsAgainstAverage: number | null;
  shotsOnTargetAverage: number | null;
  possessionAverage: number | null;
  passAccuracyAverage: number | null;
  bigChancesForAverage: number | null;
  bigChancesAgainstAverage: number | null;
  errorsLeadingToGoalAverage: number | null;
  cleanSheets: number;
  formations: { name: string; count: number }[];
  trends: MatchupTrendPoint[];
  lossReviews: MatchupLossReview[];
  playerLeaders: MatchupPlayerLeader[];
  playerAvailability: MatchupAvailability[];
  substitutions: {
    matchesWithChanges: number;
    changesPerMatch: number | null;
    firstChangeMinute: number | null;
    goalsForAfterFirstChange: number;
    goalsAgainstAfterFirstChange: number;
  };
  evidence: string[];
};

export type MatchupComparisonRow = {
  label: string;
  homeValue: number | null;
  awayValue: number | null;
  unit: string;
  lowerIsBetter?: boolean;
};

export type MatchupAnalysis = {
  fixtureId: number;
  home: MatchupTeamAnalysis;
  away: MatchupTeamAnalysis;
  comparisons: MatchupComparisonRow[];
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function numberValue(value: string | number | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number.parseFloat(value.replace(/,/g, ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: Array<number | null>) {
  const valid = values.filter((value): value is number => value !== null && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

function standardDeviation(values: number[]) {
  if (values.length < 2) return null;
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length);
}

function statFor(
  group: MatchRecord['statistics'][number] | undefined,
  label: string,
): number | null {
  if (!group) return null;
  const target = normalize(label);
  const row = group.statistics.find((item) => {
    const normalized = normalize(item.label);
    return normalized.startsWith('fullmatch') && normalized.slice('fullmatch'.length) === target;
  });
  return numberValue(row?.value);
}

function playerStat(player: PlayerRecord, label: string): number | null {
  const target = normalize(label);
  const row = player.statistics.find((item) => normalize(item.label) === target);
  return numberValue(row?.value);
}

function points(result: 'W' | 'D' | 'L') {
  return result === 'W' ? 3 : result === 'D' ? 1 : 0;
}

function outcome(goalsFor: number, goalsAgainst: number): 'W' | 'D' | 'L' {
  return goalsFor > goalsAgainst ? 'W' : goalsFor < goalsAgainst ? 'L' : 'D';
}

function groupFor(
  record: MatchRecord,
  team: TeamRecord,
) {
  return record.statistics.find((group) => group.teamId === team.team.id)
    ?? record.statistics.find((group) => group.teamName === team.team.name);
}

function opponentGroupFor(
  record: MatchRecord,
  team: TeamRecord,
) {
  return record.statistics.find((group) => group.teamId !== null && group.teamId !== team.team.id)
    ?? record.statistics.find((group) => group.teamName !== team.team.name);
}

function scoreFor(record: MatchRecord, team: TeamRecord) {
  const home = record.match.homeTeam.id === team.team.id;
  const homeScore = record.match.homeScore;
  const awayScore = record.match.awayScore;
  if (homeScore === null || awayScore === null) return null;
  return {
    scored: home ? homeScore : awayScore,
    conceded: home ? awayScore : homeScore,
    opponent: home ? record.match.awayTeam.name : record.match.homeTeam.name,
    score: `${homeScore}–${awayScore}`,
  };
}

function minutesFor(player: PlayerRecord) {
  return playerStat(player, 'Player · games · minutes') ?? 0;
}

function buildPlayerLeaders(team: TeamRecord): MatchupPlayerLeader[] {
  const players = new Map<string, {
    id: number | null;
    name: string;
    photo: string | null;
    position: string | null;
    appearances: number;
    starts: number;
    minutes: number;
    ratings: number[];
    goals: number;
    assists: number;
    expectedGoals: number[];
    expectedAssists: number[];
    keyPasses: number;
    tackles: number;
  }>();

  for (const record of team.matches) {
    const group = record.players.find((item) => item.teamId === team.team.id)
      ?? record.players.find((item) => item.teamName === team.team.name);
    for (const player of group?.players ?? []) {
      const key = player.id === null ? normalize(player.name) : String(player.id);
      const item = players.get(key) ?? {
        id: player.id,
        name: player.name,
        photo: player.photo,
        position: player.position,
        appearances: 0,
        starts: 0,
        minutes: 0,
        ratings: [],
        goals: 0,
        assists: 0,
        expectedGoals: [],
        expectedAssists: [],
        keyPasses: 0,
        tackles: 0,
      };
      const minutes = minutesFor(player);
      if (minutes > 0) {
        item.appearances += 1;
        item.minutes += minutes;
      }
      const rating = numberValue(player.rating);
      if (rating !== null && minutes > 0) item.ratings.push(rating);
      item.goals += playerStat(player, 'Player · goals · total') ?? 0;
      item.assists += playerStat(player, 'Player · goals · assists') ?? 0;
      const expectedGoals = playerStat(player, 'Player · bsd · statistics · expected_goals')
        ?? playerStat(player, 'Player · expected_goals');
      const expectedAssists = playerStat(player, 'Player · bsd · statistics · expected_assists')
        ?? playerStat(player, 'Player · expected_assists');
      if (minutes > 0 && expectedGoals !== null) item.expectedGoals.push(expectedGoals);
      if (minutes > 0 && expectedAssists !== null) item.expectedAssists.push(expectedAssists);
      item.keyPasses += playerStat(player, 'Player · passes · key') ?? 0;
      item.tackles += playerStat(player, 'Player · tackles · total') ?? 0;
      players.set(key, item);
    }

    const lineup = record.lineups.find((item) => item.teamId === team.team.id)
      ?? record.lineups.find((item) => item.teamName === team.team.name);
    if (lineup) {
      for (const player of lineup.starters) {
        const key = player.id === null ? normalize(player.name) : String(player.id);
        const item = players.get(key);
        if (item) item.starts += 1;
      }
    }
  }

  return [...players.values()]
    .map((player): MatchupPlayerLeader => ({
      id: player.id,
      name: player.name,
      photo: player.photo,
      position: player.position,
      appearances: player.appearances,
      starts: player.starts,
      minutes: player.minutes,
      averageRating: average(player.ratings),
      goals: player.goals,
      assists: player.assists,
      expectedGoals: average(player.expectedGoals),
      expectedAssists: average(player.expectedAssists),
      keyPasses: player.keyPasses,
      tackles: player.tackles,
    }))
    .filter((player) => player.appearances > 0)
    .sort((left, right) => {
      const ratingDelta = (right.averageRating ?? 0) - (left.averageRating ?? 0);
      return ratingDelta || right.appearances - left.appearances || right.goals + right.assists - left.goals - left.assists;
    })
    .slice(0, 5);
}

function buildPlayerAvailability(team: TeamRecord, leaders: MatchupPlayerLeader[]): MatchupAvailability[] {
  const rows = leaders.map((leader) => {
    let withMatches = 0;
    let withoutMatches = 0;
    let pointsWith = 0;
    let pointsWithout = 0;
    let goalDifferenceWith = 0;
    let goalDifferenceWithout = 0;
    let coverage = 0;

    for (const record of team.matches) {
      const lineup = record.lineups.find((item) => item.teamId === team.team.id)
        ?? record.lineups.find((item) => item.teamName === team.team.name);
      const playerGroup = record.players.find((item) => item.teamId === team.team.id)
        ?? record.players.find((item) => item.teamName === team.team.name);
      if (!lineup || !playerGroup) continue;
      coverage += 1;
      const player = playerGroup.players.find((item) =>
        leader.id !== null ? item.id === leader.id : normalize(item.name) === normalize(leader.name),
      );
      const scored = scoreFor(record, team);
      if (!scored) continue;
      const result = outcome(scored.scored, scored.conceded);
      const appeared = player ? minutesFor(player) > 0 : false;
      if (appeared) {
        withMatches += 1;
        pointsWith += points(result);
        goalDifferenceWith += scored.scored - scored.conceded;
      } else {
        withoutMatches += 1;
        pointsWithout += points(result);
        goalDifferenceWithout += scored.scored - scored.conceded;
      }
    }

    return {
      playerId: leader.id,
      playerName: leader.name,
      withMatches,
      withoutMatches,
      pointsPerMatchWith: withMatches ? pointsWith / withMatches : null,
      pointsPerMatchWithout: withoutMatches ? pointsWithout / withoutMatches : null,
      goalDifferenceWith: withMatches ? goalDifferenceWith / withMatches : null,
      goalDifferenceWithout: withoutMatches ? goalDifferenceWithout / withoutMatches : null,
      coverage,
    };
  });

  return rows.filter((row) => row.coverage >= 2).slice(0, 3);
}

function buildSubstitutions(team: TeamRecord): MatchupTeamAnalysis['substitutions'] {
  const rows = team.matches.flatMap((record) => {
    const events = record.events
      .filter((event) => event.teamId === team.team.id && /substitution|subst/i.test(`${event.type} ${event.detail ?? ''}`))
      .filter((event) => event.minute !== null)
      .sort((left, right) => (left.minute ?? 0) - (right.minute ?? 0));
    if (!events.length) return [];
    const firstMinute = events[0].minute;
    if (firstMinute === null) return [];
    const laterGoals = record.events.filter((event) =>
      event.minute !== null && event.minute > firstMinute && /goal/i.test(`${event.type} ${event.detail ?? ''}`),
    );
    return [{
      changes: events.length,
      firstMinute,
      forAfter: laterGoals.filter((event) => event.teamId === team.team.id).length,
      againstAfter: laterGoals.filter((event) => event.teamId !== team.team.id).length,
    }];
  });

  return {
    matchesWithChanges: rows.length,
    changesPerMatch: average(team.matches.map((record) =>
      record.events.filter((event) => event.teamId === team.team.id && /substitution|subst/i.test(`${event.type} ${event.detail ?? ''}`)).length,
    )),
    firstChangeMinute: average(rows.map((row) => row.firstMinute)),
    goalsForAfterFirstChange: rows.reduce((sum, row) => sum + row.forAfter, 0),
    goalsAgainstAfterFirstChange: rows.reduce((sum, row) => sum + row.againstAfter, 0),
  };
}

function buildTeamAnalysis(team: TeamRecord): MatchupTeamAnalysis {
  const chronological = [...team.matches].sort(
    (left, right) => new Date(left.match.date).getTime() - new Date(right.match.date).getTime(),
  );
  const trends: MatchupTrendPoint[] = [];
  const lossReviews: MatchupLossReview[] = [];
  const formations = new Map<string, number>();
  const goalsForValues: number[] = [];
  const goalsAgainstValues: number[] = [];
  const xgForValues: number[] = [];
  const xgAgainstValues: number[] = [];
  const shotsForValues: number[] = [];
  const shotsAgainstValues: number[] = [];
  const shotsOnTargetValues: number[] = [];
  const possessionValues: number[] = [];
  const passAccuracyValues: number[] = [];
  const bigChancesForValues: number[] = [];
  const bigChancesAgainstValues: number[] = [];
  const errorsLeadingToGoalValues: number[] = [];
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let cleanSheets = 0;

  for (const record of chronological) {
    const score = scoreFor(record, team);
    if (!score) continue;
    const result = outcome(score.scored, score.conceded);
    if (result === 'W') wins += 1;
    else if (result === 'D') draws += 1;
    else losses += 1;
    if (score.conceded === 0) cleanSheets += 1;
    goalsForValues.push(score.scored);
    goalsAgainstValues.push(score.conceded);

    const own = groupFor(record, team);
    const opponent = opponentGroupFor(record, team);
    const expectedGoalsFor = statFor(own, 'expected_goals');
    const expectedGoalsAgainst = statFor(opponent, 'expected_goals');
    const shotsFor = statFor(own, 'total_shots');
    const shotsAgainst = statFor(opponent, 'total_shots');
    const shotsOnTarget = statFor(own, 'shots_on_goal');
    const possession = statFor(own, 'ball_possession');
    const passAccuracy = statFor(own, 'passes %');
    const bigChancesFor = statFor(own, 'big_chances');
    const bigChancesAgainst = statFor(opponent, 'big_chances');
    const errorsLeadingToGoal = statFor(own, 'errors_leading_to_goal');
    for (const [value, target] of [
      [expectedGoalsFor, xgForValues],
      [expectedGoalsAgainst, xgAgainstValues],
      [shotsFor, shotsForValues],
      [shotsAgainst, shotsAgainstValues],
      [shotsOnTarget, shotsOnTargetValues],
      [possession, possessionValues],
      [passAccuracy, passAccuracyValues],
      [bigChancesFor, bigChancesForValues],
      [bigChancesAgainst, bigChancesAgainstValues],
      [errorsLeadingToGoal, errorsLeadingToGoalValues],
    ] as const) {
      if (value !== null) target.push(value);
    }

    const lineup = record.lineups.find((item) => item.teamId === team.team.id)
      ?? record.lineups.find((item) => item.teamName === team.team.name);
    if (lineup?.formation) formations.set(lineup.formation, (formations.get(lineup.formation) ?? 0) + 1);

    trends.push({
      fixtureId: record.match.fixtureId,
      date: record.match.date,
      opponent: score.opponent,
      score: score.score,
      result,
      goalsFor: score.scored,
      goalsAgainst: score.conceded,
      expectedGoalsFor,
      expectedGoalsAgainst,
      shotsFor,
      shotsAgainst,
      possession,
    });

    if (result === 'L') {
      lossReviews.push({
        fixtureId: record.match.fixtureId,
        date: record.match.date,
        opponent: score.opponent,
        score: score.score,
        expectedGoalsFor,
        expectedGoalsAgainst,
        shotsFor,
        shotsAgainst,
        errorsLeadingToGoal,
        bigChancesFor,
        bigChancesAgainst,
      });
    }
  }

  const sample = trends.length;
  const goalsForAverage = average(goalsForValues);
  const goalsAgainstAverage = average(goalsAgainstValues);
  const expectedGoalsForAverage = average(xgForValues);
  const expectedGoalsAgainstAverage = average(xgAgainstValues);
  const expectedGoalsCoverage = Math.min(xgForValues.length, xgAgainstValues.length);
  const useExpectedGoals = expectedGoalsCoverage >= 3;
  const forecastAttackRate = goalsForAverage === null
    ? null
    : useExpectedGoals && expectedGoalsForAverage !== null
      ? expectedGoalsForAverage * 0.7 + goalsForAverage * 0.3
      : goalsForAverage;
  const forecastDefenseRate = goalsAgainstAverage === null
    ? null
    : useExpectedGoals && expectedGoalsAgainstAverage !== null
      ? expectedGoalsAgainstAverage * 0.7 + goalsAgainstAverage * 0.3
      : goalsAgainstAverage;
  const playerLeaders = buildPlayerLeaders(team);
  const playerAvailability = buildPlayerAvailability(team, playerLeaders);
  const formationsList = [...formations.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => right.count - left.count);
  const evidence: string[] = [];

  if (sample) {
    if (expectedGoalsForAverage !== null && expectedGoalsAgainstAverage !== null) {
      const xgDifference = expectedGoalsForAverage - expectedGoalsAgainstAverage;
      evidence.push(`${team.team.name} averaged ${expectedGoalsForAverage.toFixed(2)} xG for and ${expectedGoalsAgainstAverage.toFixed(2)} xG against per match.`);
      if (xgDifference >= 0.45) evidence.push('The five-match chance balance is positive; this attacking signal is worth testing against the opponent.');
      else if (xgDifference <= -0.45) evidence.push('The five-match chance balance is negative; the opponent may find space to create chances.');
    } else {
      evidence.push('Expected-goals coverage is incomplete, so the comparison falls back to completed scores where needed.');
    }
    if (expectedGoalsForAverage !== null && goalsForAverage !== null && goalsForAverage - expectedGoalsForAverage >= 0.5) {
      evidence.push('Goals have run above xG, indicating strong recent finishing; the small sample may regress.');
    } else if (expectedGoalsForAverage !== null && goalsForAverage !== null && expectedGoalsForAverage - goalsForAverage >= 0.5) {
      evidence.push('Goals have run below xG, suggesting chances created have not consistently become goals.');
    }
    if (goalsForVolatility(goalsForValues) >= 1) {
      evidence.push('Scoring has varied sharply from match to match, so the recent attacking output is less predictable.');
    }
    if (goalsAgainstAverage !== null && goalsAgainstAverage >= 1.6) {
      evidence.push(`The side conceded ${goalsAgainstAverage.toFixed(2)} goals per match across this sample.`);
    }
    if (errorsLeadingToGoalValues.reduce((sum, value) => sum + value, 0) > 0) {
      evidence.push(`The source recorded ${errorsLeadingToGoalValues.reduce((sum, value) => sum + value, 0)} own-team errors leading to a goal in the sample.`);
    }
    if (possessionValues.length && expectedGoalsForAverage !== null) {
      const possessionAverage = average(possessionValues);
      if (possessionAverage !== null && possessionAverage >= 55 && expectedGoalsForAverage < 1.1) {
        evidence.push('Possession has been relatively high without consistently producing strong xG totals.');
      }
    }
  }

  return {
    id: team.team.id,
    name: team.team.name,
    sample,
    wins,
    draws,
    losses,
    pointsPerMatch: sample ? (wins * 3 + draws) / sample : null,
    goalsForAverage,
    goalsAgainstAverage,
    goalsForVolatility: standardDeviation(goalsForValues),
    goalsAgainstVolatility: standardDeviation(goalsAgainstValues),
    expectedGoalsForAverage,
    expectedGoalsAgainstAverage,
    expectedGoalsCoverage,
    forecastAttackRate,
    forecastDefenseRate,
    shotsForAverage: average(shotsForValues),
    shotsAgainstAverage: average(shotsAgainstValues),
    shotsOnTargetAverage: average(shotsOnTargetValues),
    possessionAverage: average(possessionValues),
    passAccuracyAverage: average(passAccuracyValues),
    bigChancesForAverage: average(bigChancesForValues),
    bigChancesAgainstAverage: average(bigChancesAgainstValues),
    errorsLeadingToGoalAverage: average(errorsLeadingToGoalValues),
    cleanSheets,
    formations: formationsList,
    trends,
    lossReviews: lossReviews.reverse(),
    playerLeaders,
    playerAvailability,
    substitutions: buildSubstitutions(team),
    evidence,
  };
}

function goalsForVolatility(values: number[]) {
  return standardDeviation(values) ?? 0;
}

export function buildMatchupAnalysis(data: FootballMatchLastFive): MatchupAnalysis {
  const home = buildTeamAnalysis(data.home);
  const away = buildTeamAnalysis(data.away);
  return {
    fixtureId: data.fixtureId,
    home,
    away,
    comparisons: [
      { label: 'Points per match', homeValue: home.pointsPerMatch, awayValue: away.pointsPerMatch, unit: 'pts' },
      { label: 'Goals scored', homeValue: home.goalsForAverage, awayValue: away.goalsForAverage, unit: '/ match' },
      { label: 'Goals conceded', homeValue: home.goalsAgainstAverage, awayValue: away.goalsAgainstAverage, unit: '/ match', lowerIsBetter: true },
      { label: 'Expected goals', homeValue: home.expectedGoalsForAverage, awayValue: away.expectedGoalsForAverage, unit: '/ match' },
      { label: 'Expected goals against', homeValue: home.expectedGoalsAgainstAverage, awayValue: away.expectedGoalsAgainstAverage, unit: '/ match', lowerIsBetter: true },
      { label: 'Shots on target', homeValue: home.shotsOnTargetAverage, awayValue: away.shotsOnTargetAverage, unit: '/ match' },
      { label: 'Possession', homeValue: home.possessionAverage, awayValue: away.possessionAverage, unit: '%' },
      { label: 'Pass accuracy', homeValue: home.passAccuracyAverage, awayValue: away.passAccuracyAverage, unit: '%' },
      { label: 'Big chances', homeValue: home.bigChancesForAverage, awayValue: away.bigChancesForAverage, unit: '/ match' },
      { label: 'Scoring volatility', homeValue: home.goalsForVolatility, awayValue: away.goalsForVolatility, unit: 'goals SD', lowerIsBetter: true },
    ],
  };
}
