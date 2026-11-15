/**
 * The board, translated into scorelines.
 *
 * A priced match is not a pile of separate markets: the 1X2, the goal lines and
 * both-teams-to-score are one opinion about how many goals each side scores. This
 * turns that opinion into the thing a reader actually wants — the scorelines it
 * implies, including the ones the card would otherwise never print: 0–0, 1–1, 2–2,
 * 3–3.
 *
 * The two worths the board settles on are the means of two independent Poisson
 * counts, so the translation is the exact product of those two distributions rather
 * than a guess at a "most likely" score. It is a translation of prices, not a
 * forecast: every number here is what the market implies, and is labelled as such.
 *
 * Then the contest: the translation gives a baseline, and the evidence from the two
 * sides' own matches argues for or against each candidate scoreline. A challenger
 * only takes the spot when it beats the baseline by a decisive margin — the rest of
 * the time the board keeps it and the card says which challenger came closest and
 * why it did not get there.
 */

export type Scoreline = {
  home: number;
  away: number;
  /** "2–1" */
  label: string;
  /** What the prices imply for this exact score, 0..1. */
  implied: number;
  /** True for 0–0, 1–1, 2–2, 3–3 — the results a card tends to forget. */
  drawn: boolean;
};

export type MarketTranslation = {
  homeGoals: number;
  awayGoals: number;
  total: number;
  /** Up to the ten likeliest scorelines, plus every draw up to 3–3. */
  rows: Scoreline[];
  shares: { home: number; draw: number; away: number; over25: number; bothScore: number };
  /** The single likeliest scoreline the prices imply. */
  baseline: Scoreline;
};

function factorial(n: number): number {
  let value = 1;
  for (let i = 2; i <= n; i += 1) value *= i;
  return value;
}

export function poisson(mean: number, goals: number): number {
  if (mean <= 0) return goals === 0 ? 1 : 0;
  return (Math.exp(-mean) * mean ** goals) / factorial(goals);
}

function label(home: number, away: number): string {
  return `${home}–${away}`;
}

/**
 * The scorelines the board's two means imply.
 *
 * Draws are kept even when they fall outside the top ten, because the whole point of
 * showing the translation is that a card calling 2–1 should still show the reader
 * what 1–1 and 0–0 are worth.
 */
export function translateBoard(homeGoals: number, awayGoals: number): MarketTranslation {
  const home = Math.max(0.05, homeGoals);
  const away = Math.max(0.05, awayGoals);
  const max = 7;
  const grid: Scoreline[] = [];
  for (let h = 0; h <= max; h += 1) {
    for (let a = 0; a <= max; a += 1) {
      const implied = poisson(home, h) * poisson(away, a);
      grid.push({ home: h, away: a, label: label(h, a), implied, drawn: h === a });
    }
  }
  const shares = { home: 0, draw: 0, away: 0, over25: 0, bothScore: 0 };
  for (const row of grid) {
    if (row.home > row.away) shares.home += row.implied;
    else if (row.home === row.away) shares.draw += row.implied;
    else shares.away += row.implied;
    if (row.home + row.away > 2.5) shares.over25 += row.implied;
    if (row.home > 0 && row.away > 0) shares.bothScore += row.implied;
  }

  const ranked = [...grid].sort((left, right) => right.implied - left.implied);
  const top = ranked.slice(0, 10);
  const draws = ranked.filter((row) => row.drawn && row.home <= 3);
  const rows = [...top, ...draws.filter((row) => !top.some((other) => other.label === row.label))].sort(
    (left, right) => right.implied - left.implied,
  );

  const round = (value: number) => Math.round(value * 1000) / 1000;
  return {
    homeGoals: Math.round(homeGoals * 100) / 100,
    awayGoals: Math.round(awayGoals * 100) / 100,
    total: Math.round((homeGoals + awayGoals) * 100) / 100,
    rows: rows.map((row) => ({ ...row, implied: round(row.implied) })),
    shares: {
      home: round(shares.home),
      draw: round(shares.draw),
      away: round(shares.away),
      over25: round(shares.over25),
      bothScore: round(shares.bothScore),
    },
    baseline: { ...ranked[0], implied: round(ranked[0].implied) },
  };
}

/** One side's behaviour in the states that decide whether a scoreline is plausible. */
export type ContestSide = {
  team: string;
  short: string;
  matches: number;
  led: number;
  leadsDropped: number;
  trailed: number;
  rescued: number;
  xg: number | null;
  xga: number | null;
};

export type Contender = {
  scoreline: string;
  implied: number;
  /** The evidence score: the implied chance, moved by what the windows show. */
  support: number;
  /** 'baseline' for the board's likeliest score, 'challenger' for the rest. */
  role: 'baseline' | 'challenger';
  reasons: string[];
  /** 0..1: how much of the evidence agreed. */
  agreement: number;
};

export type Contest = {
  contenders: Contender[];
  baseline: string;
  winner: string;
  /** The winner's support minus the baseline's, in the same units as support. */
  margin: number;
  /** True when a challenger took the spot. */
  moved: boolean;
  /** The draw the evidence favours, when it favours one. */
  drawCandidate: string | null;
  note: string;
};

const MOVE_MARGIN = 0.1;

function pct(share: number): string {
  return `${Math.round(share * 100)}%`;
}

/**
 * The contest for the spot.
 *
 * The baseline is the board's likeliest score. The candidates are the other
 * scorelines the prices find plausible, plus every draw up to 3–3 — because a draw
 * is the outcome a card built from expected goals keeps missing, and it is exactly
 * what "both sides cancel out" looks like.
 *
 * The evidence moves a candidate on three measurable things, and only those:
 *
 *   the window's own expectation, when it lands on this score;
 *   whether the side that would lead has a habit of dropping leads, which argues for
 *   a draw and against a one-goal win;
 *   whether the side that would be behind has a habit of recovering, which argues
 *   for the comeback score and against a comfortable margin.
 *
 * A challenger takes the spot only past a decisive margin. Anything smaller and the
 * card keeps the board's score and says so, with the reason.
 */
export function contestScorelines(
  translation: MarketTranslation,
  home: ContestSide,
  away: ContestSide,
  windowScore: { home: number; away: number } | null,
): Contest {
  const droppedShare = (side: ContestSide) => (side.led > 0 ? side.leadsDropped / side.led : null);
  const rescueShare = (side: ContestSide) => (side.trailed > 0 ? side.rescued / side.trailed : null);
  const homeDrops = droppedShare(home);
  const awayDrops = droppedShare(away);
  const homeRescues = rescueShare(home);
  const awayRescues = rescueShare(away);

  const score = (row: Scoreline): { support: number; reasons: string[]; agreement: number } => {
    const reasons: string[] = [];
    let support = row.implied;
    let checks = 0;
    let agreed = 0;

    if (windowScore && row.home === windowScore.home && row.away === windowScore.away) {
      support += 0.05;
      reasons.push(`the window's own expectation lands exactly here (${windowScore.home}–${windowScore.away})`);
      checks += 1;
      agreed += 1;
    }

    const leadSide = row.home > row.away ? home : row.away > row.home ? away : null;
    const leadDrops = row.home > row.away ? homeDrops : awayDrops;
    const trailRescues = row.home > row.away ? awayRescues : homeRescues;
    const drawDrops = [homeDrops, awayDrops].filter((value): value is number => value !== null);
    const drawRescues = [homeRescues, awayRescues].filter((value): value is number => value !== null);

    if (row.drawn) {
      if (drawDrops.length) {
        const average = drawDrops.reduce((sum, value) => sum + value, 0) / drawDrops.length;
        checks += 1;
        if (average >= 0.3) {
          support += 0.06;
          reasons.push(`both sides drop leads often enough for a level score to be the natural end (${pct(average)} dropped)`);
          agreed += 1;
        } else {
          reasons.push(`neither side drops leads habitually (${pct(average)}), which is the case against a draw`);
        }
      }
      if (drawRescues.length) {
        const average = drawRescues.reduce((sum, value) => sum + value, 0) / drawRescues.length;
        checks += 1;
        if (average >= 0.35) {
          support += 0.03;
          agreed += 1;
        }
      }
    } else if (leadSide === home) {
      if (homeDrops !== null) {
        checks += 1;
        if (homeDrops >= 0.35) {
          support -= 0.04;
          reasons.push(`${home.short} drops ${pct(homeDrops)} of the leads it takes, which argues against a home win`);
        } else {
          support += 0.02;
          agreed += 1;
          reasons.push(`${home.short} holds ${pct(1 - homeDrops)} of its leads`);
        }
      }
      if (awayRescues !== null) {
        checks += 1;
        if (awayRescues >= 0.4) {
          support -= 0.03;
          reasons.push(`${away.short} recovers from a deficit ${pct(awayRescues)} of the time, so one goal may not be enough`);
        } else {
          agreed += 1;
        }
      }
    } else if (leadSide === away) {
      if (awayDrops !== null) {
        checks += 1;
        if (awayDrops >= 0.35) {
          support -= 0.04;
          reasons.push(`${away.short} drops ${pct(awayDrops)} of the leads it takes, which argues against an away win`);
        } else {
          support += 0.02;
          agreed += 1;
          reasons.push(`${away.short} holds ${pct(1 - awayDrops)} of its leads`);
        }
      }
      if (homeRescues !== null) {
        checks += 1;
        if (homeRescues >= 0.4) {
          support -= 0.03;
          reasons.push(`${home.short} recovers from a deficit ${pct(homeRescues)} of the time, so one goal may not be enough`);
        } else {
          agreed += 1;
        }
      }
    }

    if (trailRescues !== null && !row.drawn && row.home !== row.away) {
      checks += 1;
      if (trailRescues >= 0.35) agreed += 1;
    }

    if (!reasons.length) {
      reasons.push(`the prices make this the ${Math.round(row.implied * 1000) / 10}% score with nothing in the windows against it`);
    }
    return {
      support: Math.round(support * 1000) / 1000,
      reasons,
      agreement: checks ? Math.round((agreed / checks) * 100) / 100 : 0,
    };
  };

  const candidates = translation.rows
    .filter((row) => row.implied >= 0.02 || row.drawn)
    .slice(0, 12)
    .map((row) => {
      const read = score(row);
      return {
        scoreline: row.label,
        implied: row.implied,
        support: read.support,
        role: (row.label === translation.baseline.label ? 'baseline' : 'challenger') as Contender['role'],
        reasons: read.reasons,
        agreement: read.agreement,
      };
    })
    .sort((left, right) => right.support - left.support);

  const baselineRow = candidates.find((row) => row.role === 'baseline') ?? candidates[0];
  const best = candidates[0];
  const margin = Math.round((best.support - baselineRow.support) * 1000) / 1000;
  const moved = best.role === 'challenger' && margin >= MOVE_MARGIN;
  // The spot is whoever holds it after the argument: the challenger only when it
  // cleared the margin, otherwise the board's own score.
  const winner = { scoreline: moved ? best.scoreline : baselineRow.scoreline };
  const drawCandidate =
    candidates.find((row) => /^(\d+)–\1$/.test(row.scoreline) && row.role === 'challenger')?.scoreline ?? null;

  const note = moved
    ? `The board's likeliest score is ${baselineRow.scoreline}, but the evidence puts ${best.scoreline} ahead of it by ${margin.toFixed(
        3,
      )} — enough for the challenger to take the spot.`
    : `The board's ${baselineRow.scoreline} keeps the spot: the strongest challenger ${
        best.scoreline === baselineRow.scoreline
          ? 'is the baseline itself'
          : `${best.scoreline} (${best.support.toFixed(3)} against ${baselineRow.support.toFixed(3)})`
      } stays inside the margin the evidence needs to overrule the prices.`;

  return {
    contenders: candidates.slice(0, 6),
    baseline: baselineRow.scoreline,
    winner: winner.scoreline,
    margin,
    moved,
    drawCandidate,
    note,
  };
}

/** The worths a moved contest implies, so every line settles from the same place. */
export function worthsFromContest(
  contest: Contest,
  base: { home: number; away: number },
): { home: number; away: number } {
  if (!contest.moved) return base;
  const [home, away] = contest.winner.split('–').map((part) => Number(part));
  const total = Math.round((base.home + base.away) * 100) / 100;
  if (!Number.isFinite(home) || !Number.isFinite(away)) return base;
  if (home === away) {
    // A draw the evidence won: the two sides are level, and the total stays the
    // board's. Rounding is left to the settlement, which reads its own crossings.
    return { home: total / 2, away: total / 2 };
  }
  const homeShare = home / (home + away);
  return {
    home: Math.round(total * homeShare * 100) / 100,
    away: Math.round(total * (1 - homeShare) * 100) / 100,
  };
}
