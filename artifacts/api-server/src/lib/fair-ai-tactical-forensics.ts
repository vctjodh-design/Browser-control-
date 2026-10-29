import type {
  FootballFairAiFormationSummary,
  FootballFairAiTacticalForensics,
  FootballFairAiTacticalPlayerHighlight,
  FootballLastFiveEvent,
  FootballLastFiveLineup,
  FootballLastFivePlayerGroup,
  FootballLastFiveTeamStatistics,
} from "@workspace/api-zod";
import { buildFairAiTacticalMatchupAssessment } from "./fair-ai-tactical-comparison.ts";

type TacticalSnapshot = {
  fixtureId: number;
  details: {
    match: {
      date: string;
      competition: string;
      home: {
        id: number;
        name: string;
        score: number;
        halfTimeScore: number | null;
      };
      away: {
        id: number;
        name: string;
        score: number;
        halfTimeScore: number | null;
      };
    };
    statistics: FootballLastFiveTeamStatistics[];
    events: FootballLastFiveEvent[];
    lineups: FootballLastFiveLineup[];
    players: FootballLastFivePlayerGroup[];
  };
};

type MatchEvidence =
  FootballFairAiTacticalForensics["home"]["recentMatches"][number];
type PlayerAggregate = {
  name: string;
  position: string | null;
  appearances: number;
  ratings: number[];
  goals: number[];
  assists: number[];
};
type FormationAggregate = {
  formation: string;
  matches: number;
  wins: number;
  draws: number;
  losses: number;
  goalsFor: number[];
  goalsAgainst: number[];
};

type TeamSample = {
  matchesExpected: number;
  matchesAnalyzed: number;
  wins: number;
  draws: number;
  losses: number;
  bttsMatches: number;
  over25Matches: number;
  over35Matches: number;
  goalsFor: Array<number | null>;
  goalsAgainst: Array<number | null>;
  expectedGoalsFor: number[];
  expectedGoalsAgainst: number[];
  expectedGoalsMatchCount: number;
  bigChancesFor: number[];
  bigChancesAgainst: number[];
  bigChancesMatchCount: number;
  firstHalfGoalsFor: number[];
  secondHalfGoalsFor: number[];
  possession: number[];
  shotsFor: number[];
  shotsAgainst: number[];
  shotsOnTargetFor: number[];
  shotsOnTargetAgainst: number[];
  passCompletion: number[];
  longBallCompletion: number[];
  finalThirdPassCompletion: number[];
  defensiveActions: number[];
  recoveries: number[];
  playerRatings: number[];
  playerRatingMatches: number;
  statisticMatchCount: number;
  buildupMatchCount: number;
  defensiveActivityMatchCount: number;
  formationSamples: number;
  formations: Set<string>;
  formationAggregates: Map<string, FormationAggregate>;
  players: Map<string, PlayerAggregate>;
  eventTimelineMatches: number;
  commentaryEventCount: number;
  completeGoalTimelines: number;
  goalsAfterConceding: number;
  lateGoalsFor: number;
  lateGoalsAgainst: number;
  recentMatches: MatchEvidence[];
};

function cleanName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function metricNumber(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().replace(/,/g, ".").replace(/%/g, "");
  const match = normalized.match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter(
    (value): value is number => value !== null && value !== undefined && Number.isFinite(value),
  );
  return valid.length
    ? valid.reduce((total, value) => total + value, 0) / valid.length
    : null;
}

function rounded(value: number | null): number | null {
  return value === null ? null : Math.round(value * 100) / 100;
}

function statValue(
  rows: TacticalSnapshot["details"]["statistics"][number]["statistics"],
  aliases: string[],
  period: "full" | "first" | "second" = "full",
): number | null {
  const normalizedAliases = aliases.map((alias) => cleanName(alias));
  for (const row of rows) {
    const [prefix = "", ...parts] = row.label.split("·").map((part) => part.trim());
    const label = cleanName(parts.at(-1) ?? row.label);
    const normalizedPrefix = cleanName(prefix);
    const periodMatches = period === "full"
      ? normalizedPrefix.includes("full")
      : period === "first"
        ? normalizedPrefix.includes("1st") || normalizedPrefix.includes("first")
        : normalizedPrefix.includes("2nd") || normalizedPrefix.includes("second");
    if (!periodMatches) continue;
    if (normalizedAliases.some((alias) => label === alias || label.includes(alias))) {
      return metricNumber(row.value);
    }
  }
  return null;
}

function percentageOrRatio(
  rows: TacticalSnapshot["details"]["statistics"][number]["statistics"],
  directAliases: string[],
  accurateAliases: string[],
  totalAliases: string[],
): number | null {
  const direct = statValue(rows, directAliases);
  if (direct !== null) return direct;
  const accurate = statValue(rows, accurateAliases);
  const total = statValue(rows, totalAliases);
  return accurate !== null && total !== null && total > 0
    ? accurate / total * 100
    : null;
}

function playerStatistic(
  player: FootballLastFivePlayerGroup["players"][number],
  aliases: string[],
): number | null {
  const normalizedAliases = aliases.map(cleanName);
  const row = player.statistics.find((stat) => {
    const parts = stat.label.split("·").map((part) => cleanName(part.trim()));
    return normalizedAliases.some((alias) =>
      parts.some((part) => part === alias || part.includes(alias)),
    );
  });
  return metricNumber(row?.value);
}

function playerHighlight(
  player: FootballLastFivePlayerGroup["players"][number],
  appearances: number,
): FootballFairAiTacticalPlayerHighlight {
  return {
    name: player.name,
    position: player.position,
    appearances,
    averageRating: rounded(metricNumber(player.rating)),
    goals: playerStatistic(player, ["goals", "goal"]),
    assists: playerStatistic(player, ["assists", "assist"]),
  };
}

function playerGroupForTeam(
  groups: FootballLastFivePlayerGroup[],
  teamId: number,
  teamName: string,
): FootballLastFivePlayerGroup | undefined {
  return groups.find((group) =>
    group.teamId === teamId ||
    cleanName(group.teamName) === cleanName(teamName),
  );
}

function eventTeamMatches(
  event: FootballLastFiveEvent,
  teamId: number,
  teamName: string,
): boolean {
  if (event.teamId !== null) return event.teamId === teamId;
  return event.teamName !== null &&
    cleanName(event.teamName) === cleanName(teamName);
}

function eventMinute(event: FootballLastFiveEvent): number | null {
  return event.minute === null
    ? null
    : event.minute + (event.extraMinute ?? 0);
}

function isGoalEvent(event: FootballLastFiveEvent): boolean {
  const text = cleanName(`${event.type} ${event.detail ?? ""}`);
  return text.includes("goal") && !text.includes("no goal") &&
    !text.includes("disallowed");
}

function summarizeTimeline(
  events: FootballLastFiveEvent[],
  teamId: number,
  teamName: string,
  opponentId: number,
  opponentName: string,
  goalsFor: number,
  goalsAgainst: number,
): {
  summary: string;
  hasFullGoalRecord: boolean;
  goalsAfterConceding: number;
  lateGoalsFor: number;
  lateGoalsAgainst: number;
} {
  if (!events.length) {
    return {
      summary: "No event timeline or commentary was returned for this match.",
      hasFullGoalRecord: false,
      goalsAfterConceding: 0,
      lateGoalsFor: 0,
      lateGoalsAgainst: 0,
    };
  }

  const goals = events.filter(isGoalEvent);
  const hasFullGoalRecord = goals.length === goalsFor + goalsAgainst;
  const comments = events.filter((event) => event.comments?.trim()).length;
  const ownGoals = goals.filter((event) =>
    eventTeamMatches(event, teamId, teamName),
  );
  const opponentGoals = goals.filter((event) =>
    eventTeamMatches(event, opponentId, opponentName),
  );
  const lateGoalsFor = ownGoals.filter((event) => (eventMinute(event) ?? 0) >= 76).length;
  const lateGoalsAgainst = opponentGoals.filter((event) => (eventMinute(event) ?? 0) >= 76).length;
  const redCards = events.filter((event) => {
    const text = cleanName(`${event.type} ${event.detail ?? ""}`);
    return (text.includes("red card") || text.includes("second yellow")) &&
      eventTeamMatches(event, teamId, teamName);
  }).length;
  const substitutions = events.filter((event) => {
    const text = cleanName(`${event.type} ${event.detail ?? ""}`);
    return (text.includes("substitution") || text.includes("subst")) &&
      eventTeamMatches(event, teamId, teamName);
  }).length;
  let goalsAfterConceding = 0;

  const notes = [`${events.length} timeline events; ${comments} include source comments`];
  if (!hasFullGoalRecord) {
    notes.push(`goal-event coverage ${goals.length}/${goalsFor + goalsAgainst}; goal sequence is incomplete`);
  } else if (goals.length) {
    const firstGoal = goals[0];
    const firstTeam = eventTeamMatches(firstGoal, teamId, teamName)
      ? teamName
      : eventTeamMatches(firstGoal, opponentId, opponentName)
        ? opponentName
        : "a team";
    const firstMinute = eventMinute(firstGoal);
    notes.push(
      `${firstTeam} scored first${firstMinute === null ? "" : ` at ${firstMinute}′`}`,
    );
    let opponentScored = false;
    for (const goal of goals) {
      if (eventTeamMatches(goal, opponentId, opponentName)) opponentScored = true;
      if (opponentScored && eventTeamMatches(goal, teamId, teamName)) {
        goalsAfterConceding += 1;
      }
    }
    if (goalsAfterConceding) {
      notes.push(`scored after conceding ${goalsAfterConceding} time${goalsAfterConceding === 1 ? "" : "s"}`);
    }
  }
  if (lateGoalsFor || lateGoalsAgainst) {
    notes.push(`76′+ goals scored/conceded ${lateGoalsFor}/${lateGoalsAgainst}`);
  }
  if (redCards) notes.push(`${redCards} red-card dismissal${redCards === 1 ? "" : "s"}`);
  if (substitutions) notes.push(`${substitutions} recorded substitutions`);
  return {
    summary: notes.join(" · "),
    hasFullGoalRecord,
    goalsAfterConceding,
    lateGoalsFor,
    lateGoalsAgainst,
  };
}

function recordPlayerAppearances(
  sample: TeamSample,
  groups: FootballLastFivePlayerGroup[],
  teamId: number,
  teamName: string,
): FootballFairAiTacticalPlayerHighlight[] {
  const group = playerGroupForTeam(groups, teamId, teamName);
  if (!group) return [];
  const ratedPlayers = group.players
    .map((player) => playerHighlight(player, 1))
    .filter((player) => player.averageRating !== null);
  if (ratedPlayers.length) sample.playerRatingMatches += 1;

  for (const player of group.players) {
    const key = player.id === null
      ? cleanName(player.name)
      : String(player.id);
    const aggregate = sample.players.get(key) ?? {
      name: player.name,
      position: player.position,
      appearances: 0,
      ratings: [],
      goals: [],
      assists: [],
    };
    aggregate.appearances += 1;
    const rating = metricNumber(player.rating);
    const goals = playerStatistic(player, ["goals", "goal"]);
    const assists = playerStatistic(player, ["assists", "assist"]);
    if (rating !== null) {
      aggregate.ratings.push(rating);
      sample.playerRatings.push(rating);
    }
    if (goals !== null) aggregate.goals.push(goals);
    if (assists !== null) aggregate.assists.push(assists);
    sample.players.set(key, aggregate);
  }

  return ratedPlayers
    .sort((left, right) =>
      (right.averageRating ?? -Infinity) - (left.averageRating ?? -Infinity),
    )
    .slice(0, 3);
}

function newSample(matchesExpected: number): TeamSample {
  return {
    matchesExpected,
    matchesAnalyzed: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    bttsMatches: 0,
    over25Matches: 0,
    over35Matches: 0,
    goalsFor: [],
    goalsAgainst: [],
    expectedGoalsFor: [],
    expectedGoalsAgainst: [],
    expectedGoalsMatchCount: 0,
    bigChancesFor: [],
    bigChancesAgainst: [],
    bigChancesMatchCount: 0,
    firstHalfGoalsFor: [],
    secondHalfGoalsFor: [],
    possession: [],
    shotsFor: [],
    shotsAgainst: [],
    shotsOnTargetFor: [],
    shotsOnTargetAgainst: [],
    passCompletion: [],
    longBallCompletion: [],
    finalThirdPassCompletion: [],
    defensiveActions: [],
    recoveries: [],
    playerRatings: [],
    playerRatingMatches: 0,
    statisticMatchCount: 0,
    buildupMatchCount: 0,
    defensiveActivityMatchCount: 0,
    formationSamples: 0,
    formations: new Set<string>(),
    formationAggregates: new Map<string, FormationAggregate>(),
    players: new Map<string, PlayerAggregate>(),
    eventTimelineMatches: 0,
    commentaryEventCount: 0,
    completeGoalTimelines: 0,
    goalsAfterConceding: 0,
    lateGoalsFor: 0,
    lateGoalsAgainst: 0,
    recentMatches: [],
  };
}

function collectTeamSample(
  teamId: number,
  expectedFixtureIds: number[],
  snapshotsByFixture: Map<number, TacticalSnapshot>,
): TeamSample {
  const sample = newSample(expectedFixtureIds.length);
  for (const fixtureId of expectedFixtureIds) {
    const snapshot = snapshotsByFixture.get(fixtureId);
    if (!snapshot) continue;
    const { match } = snapshot.details;
    const ownIsHome = match.home.id === teamId;
    if (!ownIsHome && match.away.id !== teamId) continue;

    const own = ownIsHome ? match.home : match.away;
    const opponent = ownIsHome ? match.away : match.home;
    sample.matchesAnalyzed += 1;
    sample.goalsFor.push(own.score);
    sample.goalsAgainst.push(opponent.score);
    if (own.score > opponent.score) sample.wins += 1;
    else if (own.score === opponent.score) sample.draws += 1;
    else sample.losses += 1;
    if (own.score > 0 && opponent.score > 0) sample.bttsMatches += 1;
    if (own.score + opponent.score > 2) sample.over25Matches += 1;
    if (own.score + opponent.score > 3) sample.over35Matches += 1;

    if (own.halfTimeScore !== null) {
      sample.firstHalfGoalsFor.push(own.halfTimeScore);
      sample.secondHalfGoalsFor.push(own.score - own.halfTimeScore);
    }

    const ownTeamStats = snapshot.details.statistics.find(
      (entry) => entry.teamId === teamId ||
        cleanName(entry.teamName) === cleanName(own.name),
    )?.statistics ?? [];
    const opponentTeamStats = snapshot.details.statistics.find(
      (entry) => entry.teamId === opponent.id ||
        cleanName(entry.teamName) === cleanName(opponent.name),
    )?.statistics ?? [];
    if (ownTeamStats.length) sample.statisticMatchCount += 1;

    const possession = statValue(ownTeamStats, ["ball possession", "possession"]);
    const shotsFor = statValue(ownTeamStats, ["total shots", "total shots"]);
    const shotsAgainst = statValue(opponentTeamStats, ["total shots", "total shots"]);
    const shotsOnTargetFor = statValue(ownTeamStats, ["shots on goal", "shots on target"]);
    const shotsOnTargetAgainst = statValue(opponentTeamStats, ["shots on goal", "shots on target"]);
    const expectedGoalsFor = statValue(ownTeamStats, ["expected goals", "xg"]);
    const expectedGoalsAgainst = statValue(opponentTeamStats, ["expected goals", "xg"]);
    const bigChancesFor = statValue(ownTeamStats, ["big chances"]);
    const bigChancesAgainst = statValue(opponentTeamStats, ["big chances"]);
    if (possession !== null) sample.possession.push(possession);
    if (shotsFor !== null) sample.shotsFor.push(shotsFor);
    if (shotsAgainst !== null) sample.shotsAgainst.push(shotsAgainst);
    if (shotsOnTargetFor !== null) sample.shotsOnTargetFor.push(shotsOnTargetFor);
    if (shotsOnTargetAgainst !== null) sample.shotsOnTargetAgainst.push(shotsOnTargetAgainst);
    if (expectedGoalsFor !== null && expectedGoalsAgainst !== null) {
      sample.expectedGoalsFor.push(expectedGoalsFor);
      sample.expectedGoalsAgainst.push(expectedGoalsAgainst);
      sample.expectedGoalsMatchCount += 1;
    }
    if (bigChancesFor !== null && bigChancesAgainst !== null) {
      sample.bigChancesFor.push(bigChancesFor);
      sample.bigChancesAgainst.push(bigChancesAgainst);
      sample.bigChancesMatchCount += 1;
    }
    const passCompletion = percentageOrRatio(
      ownTeamStats,
      ["passes %", "pass accuracy", "passes percentage"],
      ["passes accurate", "accurate passes"],
      ["total passes", "passes"],
    );
    const longBallCompletion = percentageOrRatio(
      ownTeamStats,
      ["accurate long balls %", "long balls %", "long ball accuracy"],
      ["accurate long balls"],
      ["total long balls", "long balls"],
    );
    const finalThirdPassCompletion = percentageOrRatio(
      ownTeamStats,
      ["passes in final third %", "final third passes %"],
      ["accurate passes in final third", "accurate final third passes"],
      ["passes in final third", "final third passes"],
    );
    if (passCompletion !== null) sample.passCompletion.push(passCompletion);
    if (longBallCompletion !== null) sample.longBallCompletion.push(longBallCompletion);
    if (finalThirdPassCompletion !== null) {
      sample.finalThirdPassCompletion.push(finalThirdPassCompletion);
    }
    if (passCompletion !== null || longBallCompletion !== null || finalThirdPassCompletion !== null) {
      sample.buildupMatchCount += 1;
    }

    const tackles = statValue(ownTeamStats, ["total tackles", "tackles"]);
    const interceptions = statValue(ownTeamStats, ["interceptions"]);
    const recoveries = statValue(ownTeamStats, ["recoveries"]);
    if (tackles !== null || interceptions !== null) {
      sample.defensiveActions.push((tackles ?? 0) + (interceptions ?? 0));
    }
    if (recoveries !== null) sample.recoveries.push(recoveries);
    if (tackles !== null || interceptions !== null || recoveries !== null) {
      sample.defensiveActivityMatchCount += 1;
    }

    const lineup = snapshot.details.lineups.find(
      (entry) => entry.teamId === teamId ||
        cleanName(entry.teamName) === cleanName(own.name),
    );
    if (lineup) {
      sample.formationSamples += 1;
      if (lineup.formation) {
        sample.formations.add(lineup.formation);
        const formationSample = sample.formationAggregates.get(lineup.formation) ?? {
          formation: lineup.formation,
          matches: 0,
          wins: 0,
          draws: 0,
          losses: 0,
          goalsFor: [],
          goalsAgainst: [],
        };
        formationSample.matches += 1;
        formationSample.goalsFor.push(own.score);
        formationSample.goalsAgainst.push(opponent.score);
        if (own.score > opponent.score) formationSample.wins += 1;
        else if (own.score === opponent.score) formationSample.draws += 1;
        else formationSample.losses += 1;
        sample.formationAggregates.set(lineup.formation, formationSample);
      }
    }

    const result = own.score > opponent.score
      ? "win"
      : own.score === opponent.score
        ? "draw"
        : "loss";
    const timeline = summarizeTimeline(
      snapshot.details.events,
      teamId,
      own.name,
      opponent.id,
      opponent.name,
      own.score,
      opponent.score,
    );
    if (snapshot.details.events.length) {
      sample.eventTimelineMatches += 1;
      sample.commentaryEventCount += snapshot.details.events.filter(
        (event) => event.comments?.trim(),
      ).length;
    }
    if (timeline.hasFullGoalRecord) {
      sample.completeGoalTimelines += 1;
      sample.goalsAfterConceding += timeline.goalsAfterConceding;
      sample.lateGoalsFor += timeline.lateGoalsFor;
      sample.lateGoalsAgainst += timeline.lateGoalsAgainst;
    }
    const playerHighlights = recordPlayerAppearances(
      sample,
      snapshot.details.players,
      teamId,
      own.name,
    );
    sample.recentMatches.push({
      fixtureId,
      matchDate: match.date,
      competition: match.competition,
      opponentName: opponent.name,
      goalsFor: own.score,
      goalsAgainst: opponent.score,
      result,
      bothTeamsScored: own.score > 0 && opponent.score > 0,
      totalGoals: own.score + opponent.score,
      halfTimeGoalsFor: own.halfTimeScore,
      halfTimeGoalsAgainst: own.halfTimeScore !== null &&
        opponent.halfTimeScore !== null
        ? opponent.halfTimeScore
        : null,
      expectedGoalsFor,
      expectedGoalsAgainst,
      bigChancesFor,
      bigChancesAgainst,
      possessionPct: possession,
      shotsFor,
      shotsAgainst,
      shotsOnTargetFor,
      shotsOnTargetAgainst,
      passCompletionPct: passCompletion,
      longBallCompletionPct: longBallCompletion,
      finalThirdPassCompletionPct: finalThirdPassCompletion,
      defensiveActions: tackles !== null || interceptions !== null
        ? (tackles ?? 0) + (interceptions ?? 0)
        : null,
      recoveries,
      formation: lineup?.formation ?? null,
      timelineSummary: timeline.summary,
      timelineHasFullGoalRecord: timeline.hasFullGoalRecord,
      events: snapshot.details.events,
      teamStatistics: snapshot.details.statistics,
      lineups: snapshot.details.lineups,
      playerHighlights,
    });
  }
  return sample;
}

function formationSummaries(
  sample: TeamSample,
): FootballFairAiFormationSummary[] {
  return [...sample.formationAggregates.values()]
    .map((formation) => ({
      formation: formation.formation,
      matches: formation.matches,
      wins: formation.wins,
      draws: formation.draws,
      losses: formation.losses,
      pointsPerMatch: rounded(
        (formation.wins * 3 + formation.draws) / formation.matches,
      ),
      averageGoalsFor: rounded(average(formation.goalsFor)),
      averageGoalsAgainst: rounded(average(formation.goalsAgainst)),
    }))
    .sort((left, right) =>
      right.matches - left.matches ||
      (right.pointsPerMatch ?? -Infinity) - (left.pointsPerMatch ?? -Infinity),
    );
}

function topPlayers(
  sample: TeamSample,
): FootballFairAiTacticalPlayerHighlight[] {
  return [...sample.players.values()]
    .map((player) => ({
      name: player.name,
      position: player.position,
      appearances: player.appearances,
      averageRating: rounded(average(player.ratings)),
      goals: player.goals.length
        ? player.goals.reduce((total, goals) => total + goals, 0)
        : null,
      assists: player.assists.length
        ? player.assists.reduce((total, assists) => total + assists, 0)
        : null,
    }))
    .filter((player) => player.averageRating !== null)
    .sort((left, right) =>
      (right.averageRating ?? -Infinity) - (left.averageRating ?? -Infinity) ||
      right.appearances - left.appearances,
    )
    .slice(0, 5);
}

function teamProfile(
  teamName: string,
  sample: TeamSample,
): FootballFairAiTacticalForensics["home"] {
  return {
    teamName,
    matchesExpected: sample.matchesExpected,
    matchesAnalyzed: sample.matchesAnalyzed,
    results: { wins: sample.wins, draws: sample.draws, losses: sample.losses },
    bttsMatches: sample.bttsMatches,
    over25Matches: sample.over25Matches,
    over35Matches: sample.over35Matches,
    averageGoalsFor: rounded(average(sample.goalsFor)),
    averageGoalsAgainst: rounded(average(sample.goalsAgainst)),
    averageExpectedGoalsFor: rounded(average(sample.expectedGoalsFor)),
    averageExpectedGoalsAgainst: rounded(average(sample.expectedGoalsAgainst)),
    expectedGoalsMatchCount: sample.expectedGoalsMatchCount,
    averageBigChancesFor: rounded(average(sample.bigChancesFor)),
    averageBigChancesAgainst: rounded(average(sample.bigChancesAgainst)),
    bigChancesMatchCount: sample.bigChancesMatchCount,
    firstHalfGoalsFor: rounded(average(sample.firstHalfGoalsFor)),
    secondHalfGoalsFor: rounded(average(sample.secondHalfGoalsFor)),
    averagePossessionPct: rounded(average(sample.possession)),
    averageShotsFor: rounded(average(sample.shotsFor)),
    averageShotsAgainst: rounded(average(sample.shotsAgainst)),
    averageShotsOnTargetFor: rounded(average(sample.shotsOnTargetFor)),
    averageShotsOnTargetAgainst: rounded(average(sample.shotsOnTargetAgainst)),
    averagePassCompletionPct: rounded(average(sample.passCompletion)),
    averageLongBallCompletionPct: rounded(average(sample.longBallCompletion)),
    averageFinalThirdPassCompletionPct: rounded(average(sample.finalThirdPassCompletion)),
    averageDefensiveActions: rounded(average(sample.defensiveActions)),
    averageRecoveries: rounded(average(sample.recoveries)),
    averagePlayerRating: rounded(average(sample.playerRatings)),
    playerRatingMatchCount: sample.playerRatingMatches,
    statisticMatchCount: sample.statisticMatchCount,
    buildupMatchCount: sample.buildupMatchCount,
    defensiveActivityMatchCount: sample.defensiveActivityMatchCount,
    formationSamples: sample.formationSamples,
    eventTimelineMatches: sample.eventTimelineMatches,
    commentaryEventCount: sample.commentaryEventCount,
    completeGoalTimelines: sample.completeGoalTimelines,
    goalsAfterConceding: sample.goalsAfterConceding,
    lateGoalsFor: sample.lateGoalsFor,
    lateGoalsAgainst: sample.lateGoalsAgainst,
    observedFormations: [...sample.formations],
    formationSummaries: formationSummaries(sample),
    topPlayers: topPlayers(sample),
    recentMatches: sample.recentMatches,
  };
}

export function buildFairAiTacticalForensics(
  snapshots: TacticalSnapshot[],
  recentFixtureIdsByTeam: Record<number, number[]>,
  homeTeamId: number,
  awayTeamId: number,
  homeTeamName: string,
  awayTeamName: string,
): FootballFairAiTacticalForensics {
  const snapshotsByFixture = new Map(
    snapshots.map((snapshot) => [snapshot.fixtureId, snapshot]),
  );
  const homeSample = collectTeamSample(
    homeTeamId,
    (recentFixtureIdsByTeam[homeTeamId] ?? []).slice(0, 5),
    snapshotsByFixture,
  );
  const awaySample = collectTeamSample(
    awayTeamId,
    (recentFixtureIdsByTeam[awayTeamId] ?? []).slice(0, 5),
    snapshotsByFixture,
  );
  const home = teamProfile(homeTeamName, homeSample);
  const away = teamProfile(awayTeamName, awaySample);

  return {
    source: "Fresh KickoffScore match timelines/comments, full and half statistics, formations, lineups, and player ratings from up to five completed matches per team.",
    home,
    away,
    assessment: buildFairAiTacticalMatchupAssessment(home, away),
    opponentRecentStrengthStatus: "unavailable",
    matchupNote: "The matchup outlook is a qualitative comparison of the evidence areas shown below, not a calibrated probability or a claim that aggregate data proves tactical causation.",
    limitations: [
      "The source does not provide these historical opponents' own as-of-match five-game strength records, so opponent recent strength is unavailable rather than guessed.",
      "Aggregate match statistics do not identify pressing height or efficiency, high-line behavior, overloads, rest-defense shape, counterattacks, tactical confidence, or managerial adaptations.",
      "Scores and BTTS/goal-line frequencies describe only this small historical sample; the outlook is a qualitative lean, not a probability or calibrated forecast.",
      "Pass completion, long-ball completion, recoveries, tackles, interceptions, and shots conceded are indicators, not proof of the tactical mechanisms behind a scoreline.",
      "Observed formations describe historical lineups. They do not establish a structural mismatch without opponent shape and event-level positional evidence.",
      "Timeline-based comeback and late-goal patterns are used only when the recorded goal-event count matches the final score. Commentary and statistics can be missing in source records.",
    ],
  };
}
