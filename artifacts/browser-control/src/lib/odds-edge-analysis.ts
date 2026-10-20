import type { FootballOddsMarket } from '@workspace/api-client-react';

export type OddsScoreCell = {
  homeGoals: number;
  awayGoals: number;
  probability: number;
};

export type OddsModelInput = {
  result: number[] | null;
  btts: number[] | null;
  scoreMatrix: OddsScoreCell[][];
  evidenceSufficient: boolean;
};

export type OddsEdgeAssessment =
  | 'potential-edge'
  | 'small-upside'
  | 'below-price'
  | 'aligned'
  | 'limited-evidence'
  | 'not-screened'
  | 'not-modelled';

export type OddsComparedSelection = {
  selection: string;
  odd: number;
  bookmaker: string;
  bookmakerCount: number;
  rawImpliedProbability: number | null;
  fairProbability: number | null;
  modelProbability: number | null;
  probabilityGap: number | null;
  expectedValue: number | null;
  marginPercent: number | null;
  assessment: OddsEdgeAssessment;
  referenceType: 'de-vig' | 'raw-implied';
};

export type OddsComparedMarket = {
  marketId: string;
  name: string;
  category: string;
  kind: '1x2' | 'btts' | 'goals' | 'correct-score' | 'other';
  selections: OddsComparedSelection[];
};

function normalize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function marketKind(market: FootballOddsMarket): OddsComparedMarket['kind'] {
  const name = normalize(market.name);
  if (market.category === 'first-half') return 'other';
  if (/correctscore|exactscore/.test(name)) return 'correct-score';
  if (market.category === '1x2' || /1x2|matchresult|fulltimeresult|matchwinner/.test(name)) return '1x2';
  if (/btts|bothteamstoscore/.test(name)) return 'btts';
  if (market.category === 'goals' || /overunder|totalgoals|goals/.test(name)) return 'goals';
  return 'other';
}

function resultKey(selection: string, homeName: string, awayName: string) {
  const value = normalize(selection);
  const home = normalize(homeName);
  const away = normalize(awayName);
  if (value === 'x' || value === 'draw' || value === 'tie' || value === 'drawmatch') return 'draw';
  if (value === '1' || value === 'home' || value === 'hometeam' || value === 'homewin' ||
    (home && value.includes(home))) return 'home';
  if (value === '2' || value === 'away' || value === 'awayteam' || value === 'awaywin' ||
    (away && value.includes(away))) return 'away';
  return null;
}

function yesNoKey(selection: string) {
  const value = normalize(selection);
  if (value === 'yes' || value === 'btts yes' || value.startsWith('yes')) return 'yes';
  if (value === 'no' || value === 'btts no' || value.startsWith('no')) return 'no';
  return null;
}

function overUnder(selection: string, marketName: string) {
  const direction = /\bover\b/i.test(selection) ? 'over' : /\bunder\b/i.test(selection) ? 'under' : null;
  if (!direction) return null;
  const lineMatch = selection.match(/\d+(?:\.\d+)?/) ?? marketName.match(/\d+(?:\.\d+)?/);
  if (!lineMatch) return null;
  const line = Number(lineMatch[0]);
  return Number.isFinite(line) ? { direction, line, key: `${direction}:${line}` } : null;
}

function correctScoreKey(selection: string) {
  const match = selection.match(/(?:^|\D)(\d{1,2})\s*[-:–]\s*(\d{1,2})(?:\D|$)/);
  return match ? `${Number(match[1])}-${Number(match[2])}` : null;
}

function modelProbability(
  kind: OddsComparedMarket['kind'],
  key: string | null,
  model: OddsModelInput,
) {
  if (!key) return null;
  if (kind === '1x2' && model.result) {
    const index = key === 'home' ? 0 : key === 'draw' ? 1 : key === 'away' ? 2 : -1;
    return index >= 0 ? model.result[index] ?? null : null;
  }
  if (kind === 'btts') {
    if (!model.btts) return null;
    const index = key === 'yes' ? 0 : key === 'no' ? 1 : -1;
    return index >= 0 ? model.btts[index] ?? null : null;
  }
  if (kind === 'goals') {
    if (!model.scoreMatrix.length) return null;
    const [direction, lineText] = key.split(':');
    const line = Number(lineText);
    if (!Number.isFinite(line) || line >= 10) return null;
    const overProbability = model.scoreMatrix.flat().reduce((sum, cell) => {
      const totalGoals = cell.homeGoals >= 10 || cell.awayGoals >= 10 ? 10 : cell.homeGoals + cell.awayGoals;
      return sum + (totalGoals > line ? cell.probability : 0);
    }, 0);
    return direction === 'over' ? overProbability : direction === 'under' ? 1 - overProbability : null;
  }
  if (kind === 'correct-score') {
    if (!model.scoreMatrix.length) return null;
    const [home, away] = key.split('-').map(Number);
    return model.scoreMatrix.flat().find((cell) => cell.homeGoals === home && cell.awayGoals === away)?.probability ?? null;
  }
  return null;
}

function requiredOutcomes(groupKey: string) {
  if (groupKey === '1x2') return ['home', 'draw', 'away'];
  if (groupKey === 'btts') return ['yes', 'no'];
  if (groupKey.startsWith('goals:')) {
    const line = groupKey.slice('goals:'.length);
    return [`over:${line}`, `under:${line}`];
  }
  return [];
}

function assessment(
  modelProbability: number | null,
  probabilityGap: number | null,
  expectedValue: number | null,
  sufficientEvidence: boolean,
  kind: OddsComparedMarket['kind'],
): OddsEdgeAssessment {
  if (modelProbability === null || probabilityGap === null || expectedValue === null) return 'not-modelled';
  if (kind === 'correct-score') return 'not-screened';
  if (!sufficientEvidence) return 'limited-evidence';
  if (probabilityGap >= 3 && expectedValue >= 5) return 'potential-edge';
  if (probabilityGap > 0 && expectedValue > 0) return 'small-upside';
  if (expectedValue < 0) return 'below-price';
  return 'aligned';
}

export function compareOddsWithModel(
  markets: FootballOddsMarket[],
  homeName: string,
  awayName: string,
  model: OddsModelInput,
): OddsComparedMarket[] {
  return markets.map((market) => {
    const kind = marketKind(market);
    const rows = market.selections.map((selection) => {
      let key: string | null = null;
      let groupKey: string | null = null;
      if (kind === '1x2') {
        key = resultKey(selection.selection, homeName, awayName);
        groupKey = key ? '1x2' : null;
      } else if (kind === 'btts') {
        key = yesNoKey(selection.selection);
        groupKey = key ? 'btts' : null;
      } else if (kind === 'goals') {
        const total = overUnder(selection.selection, market.name);
        key = total?.key ?? null;
        groupKey = total ? `goals:${total.line}` : null;
      } else if (kind === 'correct-score') {
        key = correctScoreKey(selection.selection);
      }
      return {
        selection,
        key,
        groupKey,
        modelProbability: modelProbability(kind, key, model),
        rawImpliedProbability: selection.odd > 0 ? 1 / selection.odd : null,
        fairProbability: null as number | null,
        marginPercent: null as number | null,
      };
    });

    const groups = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!row.groupKey || !row.key) continue;
      const group = groups.get(row.groupKey) ?? [];
      group.push(row);
      groups.set(row.groupKey, group);
    }
    for (const [groupKey, group] of groups) {
      const required = requiredOutcomes(groupKey);
      const byKey = new Map(group.filter((row) => row.key).map((row) => [row.key!, row]));
      if (!required.length || required.some((key) => !byKey.has(key))) continue;
      const commonBookmaker = byKey.get(required[0])?.selection.bookmaker ?? '';
      const coherentBookmaker = required.every((key) =>
        commonBookmaker.trim().length > 0 &&
        normalize(byKey.get(key)?.selection.bookmaker ?? '') === normalize(commonBookmaker),
      );
      if (!coherentBookmaker) continue;
      if (required.some((key) => byKey.get(key)?.rawImpliedProbability === null)) continue;
      const rawTotal = required.reduce((sum, key) => sum + (byKey.get(key)?.rawImpliedProbability ?? 0), 0);
      if (!Number.isFinite(rawTotal) || rawTotal <= 0) continue;
      const marginPercent = (rawTotal - 1) * 100;
      for (const key of required) {
        const row = byKey.get(key);
        if (row?.rawImpliedProbability !== null && row?.rawImpliedProbability !== undefined) {
          row.fairProbability = row.rawImpliedProbability / rawTotal;
          row.marginPercent = marginPercent;
        }
      }
    }

    return {
      marketId: market.marketId,
      name: market.name,
      category: market.category,
      kind,
      selections: rows.map((row): OddsComparedSelection => {
        const modelProbability = row.modelProbability;
        const rawImpliedProbability = row.rawImpliedProbability;
        const referenceProbability = row.fairProbability ?? rawImpliedProbability;
        const probabilityGap = modelProbability !== null && referenceProbability !== null
          ? (modelProbability - referenceProbability) * 100
          : null;
        const expectedValue = modelProbability !== null && row.selection.odd > 0
          ? (modelProbability * row.selection.odd - 1) * 100
          : null;
        return {
          selection: row.selection.selection,
          odd: row.selection.odd,
          bookmaker: row.selection.bookmaker,
          bookmakerCount: row.selection.bookmakerCount,
          rawImpliedProbability,
          fairProbability: row.fairProbability,
          modelProbability,
          probabilityGap,
          expectedValue,
          marginPercent: row.marginPercent,
          assessment: assessment(modelProbability, probabilityGap, expectedValue, model.evidenceSufficient, kind),
          referenceType: row.fairProbability === null ? 'raw-implied' : 'de-vig',
        };
      }),
    };
  });
}

export function potentialOddsEdges(markets: OddsComparedMarket[]) {
  return markets.flatMap((market) =>
    market.selections
      .filter((selection) => selection.assessment === 'potential-edge')
      .map((selection) => ({ market, selection })),
  ).sort((left, right) => (right.selection.expectedValue ?? 0) - (left.selection.expectedValue ?? 0));
}
