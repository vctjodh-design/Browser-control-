import type { FootballOddsMarket } from '@workspace/api-client-react';

const GOAL_CAP = 10;
const RESULT_KEYS = ['home', 'draw', 'away'];
const BTTS_KEYS = ['yes', 'no'];

type ScoreCell = { homeGoals: number; awayGoals: number; index: number };
type OutcomeProbability = { key: string; probability: number };
type PartitionInput = {
  key: string;
  family: string;
  probabilities: OutcomeProbability[];
  marketId: string;
};
type OddsPartition = {
  key: string;
  family: string;
  outcomes: { key: string; probability: number; cells: number[] }[];
  marketIds: string[];
};

const scoreCells: ScoreCell[] = Array.from({ length: GOAL_CAP + 1 }, (_, homeGoals) =>
  Array.from({ length: GOAL_CAP + 1 }, (_, awayGoals) => ({
    homeGoals,
    awayGoals,
    index: homeGoals * (GOAL_CAP + 1) + awayGoals,
  })),
).flat();

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function isFullTimeMarket(market: FootballOddsMarket) {
  return market.category !== 'first-half' &&
    !/\b(first|second|1st|2nd)\s*[- ]?half\b|\bhalf[- ]time\b/i.test(market.name);
}

function getResultKey(selection: string, homeName: string, awayName: string) {
  const value = normalize(selection);
  if (value === 'x' || value === 'draw' || value === 'tie' || value === 'drawmatch') return 'draw';
  if (value === '1' || value === 'home' || value === 'hometeam' || value === 'homewin' ||
    value === normalize(homeName)) return 'home';
  if (value === '2' || value === 'away' || value === 'awayteam' || value === 'awaywin' ||
    value === normalize(awayName)) return 'away';
  return null;
}

function getYesNoKey(selection: string) {
  const value = normalize(selection);
  if (value === 'yes' || value === 'bts' || value === 'btts' || value.startsWith('yes')) return 'yes';
  if (value === 'no' || value === 'ots' || value === 'oneteamscores' || value.startsWith('no')) return 'no';
  return null;
}

function getOverUnder(selection: string, marketName = '') {
  const directionMatch = selection.match(/\b(over|under|ovr|und|o|u)\b/i);
  const lineMatch = selection.match(/\d+(?:\.\d+)?/) ?? marketName.match(/\d+(?:\.\d+)?/);
  if (!directionMatch || !lineMatch) return null;
  const direction = /^(?:over|ovr|o)$/i.test(directionMatch[1]) ? 'over' : 'under';
  const line = Number(lineMatch[0]);
  if (!Number.isFinite(line) || Math.abs(line % 1 - 0.5) > 0.001) return null;
  return { direction, line };
}

function makeProbabilities(rows: { key: string; odd: number }[]): OutcomeProbability[] | null {
  const valid = rows.filter((row) => Number.isFinite(row.odd) && row.odd > 0);
  const total = valid.reduce((sum, row) => sum + 1 / row.odd, 0);
  if (valid.length !== rows.length || !Number.isFinite(total) || total <= 0) return null;
  return valid.map((row) => ({ key: row.key, probability: (1 / row.odd) / total }));
}

function addPartition(
  output: PartitionInput[],
  market: FootballOddsMarket,
  key: string,
  family: string,
  rows: { key: string; odd: number }[],
  requiredKeys: string[],
) {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  if (requiredKeys.some((required) => !byKey.has(required))) return;
  const probabilities = makeProbabilities(requiredKeys.map((required) => byKey.get(required)!));
  if (!probabilities) return;
  output.push({ key, family, probabilities, marketId: market.marketId });
}

function resultBttsKeys() {
  return RESULT_KEYS.flatMap((result) => BTTS_KEYS.map((btts) => `${result}-${btts}`));
}

function resultTotalKeys() {
  return RESULT_KEYS.flatMap((result) => ['over', 'under'].map((direction) => `${result}-${direction}`));
}

function totalBttsKeys() {
  return ['over', 'under'].flatMap((direction) => BTTS_KEYS.map((btts) => `${direction}-${btts}`));
}

function buildMarketPartitions(
  markets: FootballOddsMarket[],
  homeName: string,
  awayName: string,
) {
  const inputs: PartitionInput[] = [];
  const scoreCandidates: { marketId: string; probabilities: Map<number, number>; coverage: number }[] = [];

  for (const market of markets) {
    if (!isFullTimeMarket(market)) continue;
    const marketName = normalize(market.name);
    const selections = market.selections;

    if (/exactscore|correctscore/.test(marketName)) {
      const scoreOdds = new Map<number, number>();
      for (const selection of selections) {
        const score = selection.selection.match(/^\s*(\d{1,2})\s*[:\-–]\s*(\d{1,2})\s*$/);
        if (!score || !Number.isFinite(selection.odd) || selection.odd <= 0) continue;
        const homeGoals = Number(score[1]);
        const awayGoals = Number(score[2]);
        if (homeGoals > GOAL_CAP || awayGoals > GOAL_CAP) continue;
        const index = homeGoals * (GOAL_CAP + 1) + awayGoals;
        scoreOdds.set(index, selection.odd);
      }
      const sum = [...scoreOdds.values()].reduce((total, odd) => total + 1 / odd, 0);
      if (sum > 0) {
        scoreCandidates.push({
          marketId: market.marketId,
          coverage: scoreOdds.size,
          probabilities: new Map([...scoreOdds].map(([index, odd]) => [index, (1 / odd) / sum])),
        });
      }
      continue;
    }

    if (/result.*bothteams.*score/.test(marketName)) {
      const rows = selections.flatMap((selection) => {
        const [resultName, bttsName] = selection.selection.split('/');
        const result = resultName ? getResultKey(resultName, homeName, awayName) : null;
        const btts = bttsName ? getYesNoKey(bttsName) : null;
        return result && btts ? [{ key: `${result}-${btts}`, odd: selection.odd }] : [];
      });
      addPartition(inputs, market, 'result-btts', 'combined', rows, resultBttsKeys());
      continue;
    }

    if (/total.*bothteams.*score/.test(marketName)) {
      const grouped = new Map<number, { key: string; odd: number }[]>();
      for (const selection of selections) {
        const [directionName, bttsName] = selection.selection.split('/');
        const direction = directionName && /^o(?:ver)?$/i.test(directionName.trim()) ? 'over'
          : directionName && /^u(?:nder)?$/i.test(directionName.trim()) ? 'under' : null;
        const btts = bttsName ? getYesNoKey(bttsName) : null;
        const lineMatch = selection.selection.match(/\d+(?:\.\d+)?/);
        const line = lineMatch ? Number(lineMatch[0]) : Number.NaN;
        if (!direction || !btts || !Number.isFinite(line) || Math.abs(line % 1 - 0.5) > 0.001) continue;
        const group = grouped.get(line) ?? [];
        group.push({ key: `${direction}-${btts}`, odd: selection.odd });
        grouped.set(line, group);
      }
      for (const [line, rows] of grouped) {
        addPartition(inputs, market, `total-btts:${line}`, 'combined', rows, totalBttsKeys());
      }
      continue;
    }

    if (/result.*total.*goal/.test(marketName) || /result.*over.*under/.test(marketName)) {
      const grouped = new Map<number, { key: string; odd: number }[]>();
      for (const selection of selections) {
        const [resultName, totalName] = selection.selection.split('/');
        const result = resultName ? getResultKey(resultName, homeName, awayName) : null;
        const total = totalName ? getOverUnder(totalName, market.name) : null;
        if (!result || !total) continue;
        const group = grouped.get(total.line) ?? [];
        group.push({ key: `${result}-${total.direction}`, odd: selection.odd });
        grouped.set(total.line, group);
      }
      for (const [line, rows] of grouped) {
        addPartition(inputs, market, `result-total:${line}`, 'combined', rows, resultTotalKeys());
      }
      continue;
    }

    if (/doublechance/.test(marketName)) {
      const pairs = new Map<string, number>();
      for (const selection of selections) {
        const [first, second] = selection.selection.split('/');
        const firstKey = first ? getResultKey(first, homeName, awayName) : null;
        const secondKey = second ? getResultKey(second, homeName, awayName) : null;
        if (!firstKey || !secondKey || !Number.isFinite(selection.odd) || selection.odd <= 0) continue;
        pairs.set([firstKey, secondKey].sort().join('-'), 1 / selection.odd);
      }
      const homeDraw = pairs.get('draw-home');
      const drawAway = pairs.get('away-draw');
      const homeAway = pairs.get('away-home');
      if (homeDraw !== undefined && drawAway !== undefined && homeAway !== undefined) {
        const raw = [
          (homeDraw + homeAway - drawAway) / 2,
          (homeDraw + drawAway - homeAway) / 2,
          (drawAway + homeAway - homeDraw) / 2,
        ];
        if (raw.every((value) => value > 0)) {
          const total = raw.reduce((sum, value) => sum + value, 0);
          inputs.push({
            key: 'result',
            family: 'result',
            marketId: market.marketId,
            probabilities: RESULT_KEYS.map((key, index) => ({ key, probability: raw[index] / total })),
          });
        }
      }
      continue;
    }

    if (market.category === '1x2' || /matchwinner|matchresult|fulltimeresult|standard1x2/.test(marketName)) {
      if (/corner/.test(marketName)) continue;
      const rows = selections.flatMap((selection) => {
        const key = getResultKey(selection.selection, homeName, awayName);
        return key ? [{ key, odd: selection.odd }] : [];
      });
      addPartition(inputs, market, 'result', 'result', rows, RESULT_KEYS);
      continue;
    }

    if (/bothteams.*score|btts/.test(marketName)) {
      const rows = selections.flatMap((selection) => {
        const key = getYesNoKey(selection.selection);
        return key ? [{ key, odd: selection.odd }] : [];
      });
      addPartition(inputs, market, 'btts', 'btts', rows, BTTS_KEYS);
      continue;
    }

    const isTeamTotal = /totalhome|totalaway|hometeamtotalgoals|awayteamtotalgoals/.test(marketName);
    const team = isTeamTotal
      ? (/away/.test(marketName) ? 'away' : 'home')
      : null;
    const isMatchTotal = !team &&
      /goalsoverunder|overunder|goalline|totalgoals/.test(marketName) &&
      !/corner|card|player|shot|team/.test(marketName);
    if (team || isMatchTotal) {
      const grouped = new Map<number, { key: string; odd: number }[]>();
      for (const selection of selections) {
        const total = getOverUnder(selection.selection, market.name);
        if (!total) continue;
        const group = grouped.get(total.line) ?? [];
        group.push({ key: total.direction, odd: selection.odd });
        grouped.set(total.line, group);
      }
      for (const [line, rows] of grouped) {
        const key = team ? `${team}-goals:${line}` : `total:${line}`;
        addPartition(inputs, market, key, team ? 'team-goals' : 'total-goals', rows, ['over', 'under']);
      }
    }
  }

  const completeScoreMarket = scoreCandidates
    .filter((candidate) => candidate.coverage >= 100)
    .sort((left, right) => right.coverage - left.coverage)[0] ?? null;

  const groupedInputs = new Map<string, PartitionInput[]>();
  for (const input of inputs) {
    const group = groupedInputs.get(input.key) ?? [];
    group.push(input);
    groupedInputs.set(input.key, group);
  }

  const partitions: OddsPartition[] = [...groupedInputs].map(([key, entries]) => {
    const first = entries[0];
    const probabilities = first.probabilities.map(({ key: outcomeKey }) => ({
      key: outcomeKey,
      probability: entries.reduce((sum, entry) =>
        sum + (entry.probabilities.find((item) => item.key === outcomeKey)?.probability ?? 0), 0,
      ) / entries.length,
      cells: scoreCells.filter((cell) => outcomeMatches(key, outcomeKey, cell)).map((cell) => cell.index),
    }));
    return {
      key,
      family: first.family,
      outcomes: probabilities,
      marketIds: [...new Set(entries.map((entry) => entry.marketId))],
    };
  }).filter((partition) =>
    partition.outcomes.every((outcome) => outcome.cells.length > 0) &&
    partition.outcomes.reduce((sum, outcome) => sum + outcome.cells.length, 0) === scoreCells.length,
  );

  return { partitions, completeScoreMarket };
}

function resultOf(cell: ScoreCell) {
  return cell.homeGoals > cell.awayGoals ? 'home' : cell.homeGoals < cell.awayGoals ? 'away' : 'draw';
}

function outcomeMatches(
  partitionKey: string,
  outcomeKey: string,
  cell: ScoreCell,
) {
  const total = cell.homeGoals + cell.awayGoals;
  const result = resultOf(cell);
  const btts = cell.homeGoals > 0 && cell.awayGoals > 0 ? 'yes' : 'no';

  if (partitionKey === 'result') return result === outcomeKey;
  if (partitionKey === 'btts') return btts === outcomeKey;
  if (partitionKey.startsWith('total:')) {
    const line = Number(partitionKey.slice('total:'.length));
    return outcomeKey === 'over' ? total > line : total < line;
  }
  if (partitionKey.startsWith('home-goals:') || partitionKey.startsWith('away-goals:')) {
    const [side, lineText] = partitionKey.split(':');
    const line = Number(lineText);
    const goals = side === 'home' ? cell.homeGoals : cell.awayGoals;
    return outcomeKey === 'over' ? goals > line : goals < line;
  }
  if (partitionKey === 'result-btts') {
    const [resultKey, bttsKey] = outcomeKey.split('-');
    return result === resultKey && btts === bttsKey;
  }
  if (partitionKey.startsWith('result-total:')) {
    const line = Number(partitionKey.slice('result-total:'.length));
    const [resultKey, direction] = outcomeKey.split('-');
    return result === resultKey && (direction === 'over' ? total > line : total < line);
  }
  if (partitionKey.startsWith('total-btts:')) {
    const line = Number(partitionKey.slice('total-btts:'.length));
    const [direction, bttsKey] = outcomeKey.split('-');
    return (direction === 'over' ? total > line : total < line) && btts === bttsKey;
  }
  return false;
}

function poissonBuckets(lambda: number) {
  const values: number[] = [Math.exp(-lambda)];
  for (let goals = 1; goals < GOAL_CAP; goals += 1) {
    values.push(values[goals - 1] * lambda / goals);
  }
  values.push(Math.max(0, 1 - values.reduce((sum, value) => sum + value, 0)));
  return values;
}

function poissonDistribution(homeLambda: number, awayLambda: number) {
  const home = poissonBuckets(homeLambda);
  const away = poissonBuckets(awayLambda);
  return scoreCells.map((cell) => home[cell.homeGoals] * away[cell.awayGoals]);
}

function predictionFor(distribution: number[], cells: number[]) {
  return cells.reduce((sum, index) => sum + distribution[index], 0);
}

function fitError(distribution: number[], partitions: OddsPartition[]) {
  let totalError = 0;
  let outcomeCount = 0;
  for (const partition of partitions) {
    for (const outcome of partition.outcomes) {
      totalError += Math.abs(predictionFor(distribution, outcome.cells) - outcome.probability);
      outcomeCount += 1;
    }
  }
  return outcomeCount ? (totalError / outcomeCount) * 100 : null;
}

function poissonFit(partitions: OddsPartition[]) {
  if (!partitions.length) return null;
  const familyCounts = new Map<string, number>();
  partitions.forEach((partition) => familyCounts.set(partition.family, (familyCounts.get(partition.family) ?? 0) + 1));
  const familyCount = familyCounts.size;
  const loss = (distribution: number[]) => partitions.reduce((sum, partition) => {
    const partitionError = partition.outcomes.reduce((outcomeSum, outcome) => {
      const difference = predictionFor(distribution, outcome.cells) - outcome.probability;
      return outcomeSum + difference * difference;
    }, 0) / partition.outcomes.length;
    return sum + partitionError / (familyCounts.get(partition.family) ?? 1) / familyCount;
  }, 0);

  let bestHome = 1.2;
  let bestAway = 1.0;
  let bestLoss = Number.POSITIVE_INFINITY;
  for (let homeStep = 0; homeStep <= 28; homeStep += 1) {
    const homeLambda = 0.2 + homeStep * 0.15;
    for (let awayStep = 0; awayStep <= 28; awayStep += 1) {
      const awayLambda = 0.2 + awayStep * 0.15;
      const candidateLoss = loss(poissonDistribution(homeLambda, awayLambda));
      if (candidateLoss < bestLoss) {
        bestHome = homeLambda;
        bestAway = awayLambda;
        bestLoss = candidateLoss;
      }
    }
  }

  const coarseHome = bestHome;
  const coarseAway = bestAway;
  for (let homeStep = -6; homeStep <= 6; homeStep += 1) {
    const homeLambda = Math.min(4.4, Math.max(0.2, coarseHome + homeStep * 0.025));
    for (let awayStep = -6; awayStep <= 6; awayStep += 1) {
      const awayLambda = Math.min(4.4, Math.max(0.2, coarseAway + awayStep * 0.025));
      const candidateLoss = loss(poissonDistribution(homeLambda, awayLambda));
      if (candidateLoss < bestLoss) {
        bestHome = homeLambda;
        bestAway = awayLambda;
        bestLoss = candidateLoss;
      }
    }
  }
  return poissonDistribution(bestHome, bestAway);
}

function projectDistribution(
  initial: number[],
  partitions: OddsPartition[],
) {
  const distribution = [...initial];
  for (let iteration = 0; iteration < 45; iteration += 1) {
    for (const partition of partitions) {
      for (const outcome of partition.outcomes) {
        const current = predictionFor(distribution, outcome.cells);
        if (current <= 0) continue;
        const scale = outcome.probability / current;
        for (const index of outcome.cells) distribution[index] *= scale;
      }
      const total = distribution.reduce((sum, value) => sum + value, 0);
      if (total > 0) {
        for (let index = 0; index < distribution.length; index += 1) distribution[index] /= total;
      }
    }
  }
  return distribution;
}

export type OddsExpectationReport = {
  result: { label: string; probability: number }[];
  btts: { label: string; probability: number }[];
  totals: { line: number; over: number; under: number; sources: number }[];
  topScores: { homeGoals: number; awayGoals: number; probability: number }[];
  scorelineDistribution: { homeGoals: number; awayGoals: number; probability: number }[];
  expectedHomeGoals: number;
  expectedAwayGoals: number;
  marketSourceCount: number;
  signalCount: number;
  fitErrorPoints: number | null;
  scoreMarketSeeded: boolean;
};

export function analyzeOddsExpectation(
  markets: FootballOddsMarket[],
  homeName: string,
  awayName: string,
): OddsExpectationReport | null {
  const { partitions, completeScoreMarket } = buildMarketPartitions(markets, homeName, awayName);
  if (!partitions.length && !completeScoreMarket) return null;

  const initial = completeScoreMarket
    ? scoreCells.map((cell) => completeScoreMarket.probabilities.get(cell.index) ?? 0)
    : poissonFit(partitions);
  if (!initial) return null;
  const distribution = projectDistribution(initial, partitions);

  const result = RESULT_KEYS.map((key, index) => ({
    label: key === 'home' ? homeName : key === 'away' ? awayName : 'Draw',
    probability: predictionFor(distribution, scoreCells.filter((cell) => resultOf(cell) === key).map((cell) => cell.index)),
  }));
  const btts = BTTS_KEYS.map((key) => ({
    label: key === 'yes' ? 'Yes' : 'No',
    probability: predictionFor(
      distribution,
      scoreCells.filter((cell) => (cell.homeGoals > 0 && cell.awayGoals > 0 ? 'yes' : 'no') === key).map((cell) => cell.index),
    ),
  }));
  const totalLines = partitions
    .filter((partition) => partition.key.startsWith('total:'))
    .map((partition) => ({ line: Number(partition.key.slice('total:'.length)), sources: partition.marketIds.length }))
    .sort((left, right) => left.line - right.line);
  const totals = totalLines.map(({ line, sources }) => ({
    line,
    over: predictionFor(
      distribution,
      scoreCells.filter((cell) => cell.homeGoals + cell.awayGoals > line).map((cell) => cell.index),
    ),
    under: predictionFor(
      distribution,
      scoreCells.filter((cell) => cell.homeGoals + cell.awayGoals < line).map((cell) => cell.index),
    ),
    sources,
  }));
  const topScores = scoreCells
    .filter((cell) => cell.homeGoals < GOAL_CAP && cell.awayGoals < GOAL_CAP)
    .map((cell) => ({ homeGoals: cell.homeGoals, awayGoals: cell.awayGoals, probability: distribution[cell.index] }))
    .sort((left, right) => right.probability - left.probability)
    .slice(0, 5);
  const expectedHomeGoals = scoreCells.reduce((sum, cell) => sum + cell.homeGoals * distribution[cell.index], 0);
  const expectedAwayGoals = scoreCells.reduce((sum, cell) => sum + cell.awayGoals * distribution[cell.index], 0);
  const marketIds = new Set(partitions.flatMap((partition) => partition.marketIds));
  if (completeScoreMarket) marketIds.add(completeScoreMarket.marketId);

  return {
    result,
    btts,
    totals,
    topScores,
    scorelineDistribution: scoreCells.map((cell) => ({
      homeGoals: cell.homeGoals,
      awayGoals: cell.awayGoals,
      probability: distribution[cell.index] ?? 0,
    })),
    expectedHomeGoals,
    expectedAwayGoals,
    marketSourceCount: marketIds.size,
    signalCount: partitions.length,
    fitErrorPoints: fitError(distribution, partitions),
    scoreMarketSeeded: !!completeScoreMarket,
  };
}
