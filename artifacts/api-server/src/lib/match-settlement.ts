// Settlement for a simulated match.
//
// The simulation produces what happened — goals with minutes and scorers,
// corners, cards, shots on target — and this module answers a single question
// for every selection a bookmaker offers: did that bet land? Nothing here reads
// a price except to convert a result into profit, so the settlement is driven by
// the match, never by the odds.
//
// Lines follow normal betting convention: integer lines push, quarter lines are
// split into two half stakes (a .25 or .75 line), and a push returns the stake.

export type Side = "home" | "away";

export type SimGoalEvent = {
  side: Side;
  /** Match minute, 1..90+. */
  minute: number;
  scorer: string;
  assist: string | null;
  ownGoal: boolean;
};

export type SimPlayerLine = {
  name: string;
  side: Side;
  goals: number;
  assists: number;
  shotsOnTarget: number;
};

export type SimTeamLine = {
  goals: number;
  corners: number;
  cards: number;
  shotsOnTarget: number;
};

export type SimMatchSummary = {
  home: SimTeamLine;
  away: SimTeamLine;
  goals: SimGoalEvent[];
  halfTime: { home: number; away: number };
  secondHalf: { home: number; away: number };
  firstGoal: Side | "none";
  players: SimPlayerLine[];
};

export type SettlementOutcome = "win" | "lose" | "push" | "half-win" | "half-loss";

export type Settlement = {
  outcome: SettlementOutcome;
  /** Why it landed the way it did, e.g. "2 goals, line 1.5". */
  detail: string;
};

export type SettlementAccumulator = Record<SettlementOutcome, number>;

export function emptyAccumulator(): SettlementAccumulator {
  return { win: 0, lose: 0, push: 0, "half-win": 0, "half-loss": 0 };
}

/** Stake-weighted chance the selection was right, with pushes counting half. */
export function settlementProbability(counts: SettlementAccumulator): number {
  const total = counts.win + counts.lose + counts.push + counts["half-win"] + counts["half-loss"];
  if (!total) return 0;
  return (
    (counts.win + counts["half-win"] * 0.5 + counts.push * 0.5) / total
  );
}

/** Mean profit per unit staked at `price`, from the accumulated outcomes. */
export function settlementEv(counts: SettlementAccumulator, price: number): number {
  const total = counts.win + counts.lose + counts.push + counts["half-win"] + counts["half-loss"];
  if (!total) return 0;
  const profit =
    counts.win * (price - 1) +
    counts["half-win"] * ((price - 1) / 2) +
    counts.push * 0 +
    counts["half-loss"] * -0.5 +
    counts.lose * -1;
  return profit / total;
}

export function profitAt(outcome: SettlementOutcome, price: number): number {
  switch (outcome) {
    case "win":
      return price - 1;
    case "half-win":
      return (price - 1) / 2;
    case "push":
      return 0;
    case "half-loss":
      return -0.5;
    default:
      return -1;
  }
}

export function addSettlement(counts: SettlementAccumulator, settlement: Settlement): void {
  counts[settlement.outcome] += 1;
}

/** Build the summary the settle functions read, deriving halves and totals. */
export function createSimMatchSummary(input: {
  goals: SimGoalEvent[];
  corners: { home: number; away: number };
  cards: { home: number; away: number };
  shotsOnTarget: { home: number; away: number };
  players?: SimPlayerLine[];
}): SimMatchSummary {
  const goals = [...input.goals].sort((left, right) => left.minute - right.minute);
  const homeGoals = goals.filter((goal) => goal.side === "home").length;
  const awayGoals = goals.filter((goal) => goal.side === "away").length;
  const first = goals.find((goal) => goal.minute <= 45) ?? null;
  const second = goals.filter((goal) => goal.minute > 45);
  const halfTime = {
    home: goals.filter((goal) => goal.minute <= 45 && goal.side === "home").length,
    away: goals.filter((goal) => goal.minute <= 45 && goal.side === "away").length,
  };

  return {
    home: {
      goals: homeGoals,
      corners: input.corners.home,
      cards: input.cards.home,
      shotsOnTarget: input.shotsOnTarget.home,
    },
    away: {
      goals: awayGoals,
      corners: input.corners.away,
      cards: input.cards.away,
      shotsOnTarget: input.shotsOnTarget.away,
    },
    goals,
    halfTime,
    secondHalf: {
      home: second.filter((goal) => goal.side === "home").length,
      away: second.filter((goal) => goal.side === "away").length,
    },
    firstGoal: goals.length ? goals[0].side : "none",
    players: input.players ?? [],
  };
}

// ------------------------------------------------------------------ helpers

type Period = "ft" | "h1" | "h2";

function periodOf(market: string): Period {
  const name = market.toLowerCase();
  if (/second half|2nd half/.test(name)) return "h2";
  if (/first half|1st half|half[- ]time|half time/.test(name)) return "h1";
  return "ft";
}

function periodGoals(summary: SimMatchSummary, period: Period): { home: number; away: number; total: number } {
  if (period === "h1") {
    return {
      home: summary.halfTime.home,
      away: summary.halfTime.away,
      total: summary.halfTime.home + summary.halfTime.away,
    };
  }
  if (period === "h2") {
    return {
      home: summary.secondHalf.home,
      away: summary.secondHalf.away,
      total: summary.secondHalf.home + summary.secondHalf.away,
    };
  }
  return {
    home: summary.home.goals,
    away: summary.away.goals,
    total: summary.home.goals + summary.away.goals,
  };
}

function goalDiff(home: number, away: number): "home" | "draw" | "away" {
  if (home > away) return "home";
  if (home < away) return "away";
  return "draw";
}

function sideOfLabel(label: string): "home" | "away" | null {
  const value = label.trim().toLowerCase();
  if (value === "home") return "home";
  if (value === "away") return "away";
  return null;
}

/** Split a handicap / total line into the one or two stakes it really is. */
function lineComponents(line: number): number[] {
  const magnitude = Math.abs(line);
  const fraction = Math.round((magnitude % 1) * 100) / 100;
  const sign = line < 0 ? -1 : 1;
  if (fraction === 0.25 || fraction === 0.75) {
    return [(magnitude - 0.25) * sign, (magnitude + 0.25) * sign];
  }
  return [line];
}

type HalfOutcome = "win" | "push" | "lose";

function combineHalves(halves: HalfOutcome[], detail: string): Settlement {
  if (halves.length === 1) {
    return { outcome: halves[0], detail };
  }
  const wins = halves.filter((half) => half === "win").length;
  const pushes = halves.filter((half) => half === "push").length;
  const losses = halves.filter((half) => half === "lose").length;
  if (wins === 2) return { outcome: "win", detail };
  if (wins === 1 && pushes === 1) return { outcome: "half-win", detail };
  if (pushes === 2) return { outcome: "push", detail };
  if (losses === 1 && pushes === 1) return { outcome: "half-loss", detail };
  if (losses === 2) return { outcome: "lose", detail };
  return { outcome: "half-loss", detail };
}

function overUnder(selection: string, line: number, value: number, label: string): Settlement | null {
  const isOver = /^over\b/i.test(selection);
  const isUnder = /^under\b/i.test(selection);
  if (!isOver && !isUnder) return null;
  const halves: HalfOutcome[] = lineComponents(line).map((component) => {
    if (value === component) return "push";
    const higher = value > component;
    return isOver ? (higher ? "win" : "lose") : higher ? "lose" : "win";
  });
  return combineHalves(halves, `${label} ${value} vs line ${formatLine(line)}`);
}

function handicap(selection: string, handicapValue: number, margin: number, label: string): Settlement | null {
  const side = sideOfLabel(selection.split(/\s*[+-]/)[0]);
  if (!side) return null;
  const halves: HalfOutcome[] = lineComponents(handicapValue).map((component) => {
    const adjusted = side === "home" ? margin + component : -margin + component;
    if (Math.abs(adjusted) < 1e-9) return "push";
    return adjusted > 0 ? "win" : "lose";
  });
  return combineHalves(halves, `${label} margin ${margin} with ${handicapValue}`);
}

function formatLine(line: number): string {
  return Number.isInteger(line) ? String(line) : line.toFixed(2).replace(/0$/, "");
}

function parseTotalsSelection(selection: string): { direction: "over" | "under"; line: number } | null {
  const match = selection.trim().match(/^(over|under)\s+([0-9]+(?:\.[0-9]+)?)$/i);
  if (!match) return null;
  const line = Number(match[2]);
  if (!Number.isFinite(line)) return null;
  return { direction: match[1].toLowerCase() as "over" | "under", line };
}

function parseHandicapSelection(selection: string): { side: "home" | "away"; line: number } | null {
  const match = selection.trim().match(/^(home|away)\s*([+-])\s*([0-9]+(?:\.[0-9]+)?)$/i);
  if (!match) return null;
  const magnitude = Number(match[3]);
  if (!Number.isFinite(magnitude)) return null;
  return {
    side: match[1].toLowerCase() as "home" | "away",
    line: match[2] === "-" ? -magnitude : magnitude,
  };
}

function parseScore(selection: string): { home: number; away: number } | null {
  const match = selection.trim().match(/^(\d+):(\d+)$/);
  if (!match) return null;
  return { home: Number(match[1]), away: Number(match[2]) };
}

/** Names arrive with initials from the team sheets and in full from the odds. */
function normaliseName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[.'\u2019-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function surnameOf(value: string): string {
  const parts = normaliseName(value).split(" ");
  return parts[parts.length - 1] ?? "";
}

function findPlayer(
  summary: SimMatchSummary,
  name: string,
  side?: "home" | "away",
): SimPlayerLine | null {
  const pool = side ? summary.players.filter((player) => player.side === side) : summary.players;
  const exact = pool.find((player) => player.name === name);
  if (exact) return exact;
  const target = normaliseName(name);
  const normalised = pool.find((player) => normaliseName(player.name) === target);
  if (normalised) return normalised;
  const surname = surnameOf(name);
  if (!surname) return null;
  return pool.find((player) => surnameOf(player.name) === surname) ?? null;
}

function marketSide(market: string): "home" | "away" | undefined {
  if (/\bhome\b/.test(market)) return "home";
  if (/\baway\b/.test(market)) return "away";
  return undefined;
}

function resultToken(label: string): "home" | "draw" | "away" | null {
  const value = label.trim().toLowerCase();
  if (value === "home") return "home";
  if (value === "away") return "away";
  if (value === "draw") return "draw";
  return null;
}

// ------------------------------------------------------------------ settle

type CompiledOutcome = (summary: SimMatchSummary) => SettlementOutcome;

/**
 * One selection, pre-parsed.
 *
 * Parsing a market and a selection — lowercasing, a dozen regexes, splitting a
 * line into its two stakes — is the expensive part, and it only depends on the
 * strings a bookmaker sent. A batch of a hundred thousand matches settles the
 * same selection again and again, so the parsing happens once here and the hot
 * loop only reads the finished match.
 */
export type CompiledSettlement = {
  /** Hot path: the outcome, with no strings built. */
  outcome: CompiledOutcome;
  /** Human sentence for the result card; built only when someone shows it. */
  detail: (summary: SimMatchSummary) => string;
};

/** Combine the one or two stakes of a line into the settlement outcome. */
function combineStakes(first: HalfOutcome, second?: HalfOutcome): SettlementOutcome {
  if (second === undefined) return first;
  if (first === "win" && second === "win") return "win";
  if (first === "push" && second === "push") return "push";
  if (first === "lose" && second === "lose") return "lose";
  if ((first === "win" && second === "push") || (first === "push" && second === "win")) {
    return "half-win";
  }
  return "half-loss";
}

/** over / under on a single number, with quarter lines split in two. */
function compiledOverUnder(
  selection: string,
  line: number,
  label: string,
  valueOf: (summary: SimMatchSummary) => number,
): CompiledSettlement | null {
  const isOver = /^over\b/i.test(selection);
  const isUnder = /^under\b/i.test(selection);
  if (!isOver && !isUnder) return null;
  const [first, second] = lineComponents(line);
  const stake = (component: number, value: number): HalfOutcome => {
    if (value === component) return "push";
    const higher = value > component;
    return isOver ? (higher ? "win" : "lose") : higher ? "lose" : "win";
  };
  return {
    outcome: (summary) => {
      const value = valueOf(summary);
      return combineStakes(
        stake(first, value),
        second === undefined ? undefined : stake(second, value),
      );
    },
    detail: (summary) => `${label} ${valueOf(summary)} vs line ${formatLine(line)}`,
  };
}

/** A handicap priced on a goal or corner margin. */
function compiledHandicap(
  selection: string,
  handicapValue: number,
  label: string,
  marginOf: (summary: SimMatchSummary) => number,
): CompiledSettlement | null {
  const side = sideOfLabel(selection.split(/\s*[+-]/)[0]);
  if (!side) return null;
  const [first, second] = lineComponents(handicapValue);
  const stake = (component: number, margin: number): HalfOutcome => {
    const adjusted = side === "home" ? margin + component : -margin + component;
    if (Math.abs(adjusted) < 1e-9) return "push";
    return adjusted > 0 ? "win" : "lose";
  };
  return {
    outcome: (summary) => {
      const margin = marginOf(summary);
      return combineStakes(
        stake(first, margin),
        second === undefined ? undefined : stake(second, margin),
      );
    },
    detail: (summary) => `${label} margin ${marginOf(summary)} with ${handicapValue}`,
  };
}

/**
 * Resolve a player once and remember where he sits in the team sheet, so a
 * million lookups over a batch do not re-normalise every name.
 */
function playerResolver(name: string, side?: Side): (summary: SimMatchSummary) => SimPlayerLine | null {
  let resolvedName: string | null = null;
  let index = -1;
  let missing = false;
  return (summary) => {
    if (missing) return null;
    if (index >= 0 && resolvedName !== null) {
      const line = summary.players[index];
      if (line && line.name === resolvedName) return line;
    }
    const line = findPlayer(summary, name, side);
    if (!line) {
      missing = true;
      return null;
    }
    resolvedName = line.name;
    index = summary.players.indexOf(line);
    return line;
  };
}

export function compileSettlement(
  marketName: string,
  selection: string,
  options: { handicapLine?: number | null } = {},
): CompiledSettlement | null {
  const market = marketName.toLowerCase().replace(/\s+/g, " ").trim();
  const period = periodOf(market);

  // Reading a period's goals without building an object per match.
  const homeOf =
    period === "h1"
      ? (summary: SimMatchSummary) => summary.halfTime.home
      : period === "h2"
        ? (summary: SimMatchSummary) => summary.secondHalf.home
        : (summary: SimMatchSummary) => summary.home.goals;
  const awayOf =
    period === "h1"
      ? (summary: SimMatchSummary) => summary.halfTime.away
      : period === "h2"
        ? (summary: SimMatchSummary) => summary.secondHalf.away
        : (summary: SimMatchSummary) => summary.away.goals;
  const totalOf = (summary: SimMatchSummary) => homeOf(summary) + awayOf(summary);
  const resultOf = (summary: SimMatchSummary) => goalDiff(homeOf(summary), awayOf(summary));

  // --- player markets ----------------------------------------------------
  if (/anytime goal scorer/.test(market)) {
    const player = playerResolver(selection);
    return {
      outcome: (summary) => ((player(summary)?.goals ?? 0) > 0 ? "win" : "lose"),
      detail: (summary) => `${selection} scored ${player(summary)?.goals ?? 0}`,
    };
  }
  if (/player to score or assist/.test(market)) {
    const player = playerResolver(selection);
    const involvement = (summary: SimMatchSummary) => {
      const line = player(summary);
      return (line?.goals ?? 0) + (line?.assists ?? 0);
    };
    return {
      outcome: (summary) => (involvement(summary) > 0 ? "win" : "lose"),
      detail: (summary) => `${selection} goals+assists ${involvement(summary)}`,
    };
  }
  if (/player shots on target/.test(market)) {
    const match = selection.trim().match(/^(.*?)\s*-\s*(\d+)$/);
    // Some books list the player alone, which means the 1+ line.
    const playerName = match ? match[1].trim() : selection.trim();
    const target = match ? Number(match[2]) : 1;
    const player = playerResolver(playerName, marketSide(market));
    const shots = (summary: SimMatchSummary) => player(summary)?.shotsOnTarget ?? 0;
    return {
      outcome: (summary) => (shots(summary) >= target ? "win" : "lose"),
      detail: (summary) => `${playerName} ${shots(summary)} shots on target, needs ${target}`,
    };
  }

  // --- shots on target ---------------------------------------------------
  if (/total shotongoal|total shots on target/.test(market)) {
    const parsed = parseTotalsSelection(selection);
    if (!parsed) return null;
    return compiledOverUnder(
      selection,
      parsed.line,
      "shots on target",
      (summary) => summary.home.shotsOnTarget + summary.away.shotsOnTarget,
    );
  }

  // --- corners -----------------------------------------------------------
  if (/corners/.test(market)) {
    const parsed = parseHandicapSelection(selection);
    if (/asian handicap/.test(market) && parsed) {
      return compiledHandicap(
        selection,
        options.handicapLine ?? parsed.line,
        "corners",
        (summary) => summary.home.corners - summary.away.corners,
      );
    }
    if (/1x2|winner|result/.test(market)) {
      const side = resultToken(selection);
      if (!side) return null;
      return {
        outcome: (summary) =>
          goalDiff(summary.home.corners, summary.away.corners) === side ? "win" : "lose",
        detail: (summary) => `corners ${summary.home.corners}-${summary.away.corners}`,
      };
    }
    const totals = parseTotalsSelection(selection);
    if (!totals) return null;
    const cornersOf = /home/.test(market)
      ? (summary: SimMatchSummary) => summary.home.corners
      : /away/.test(market)
        ? (summary: SimMatchSummary) => summary.away.corners
        : (summary: SimMatchSummary) => summary.home.corners + summary.away.corners;
    return compiledOverUnder(selection, totals.line, "corners", cornersOf);
  }

  // --- cards -------------------------------------------------------------
  if (/cards/.test(market)) {
    const totals = parseTotalsSelection(selection);
    if (!totals) return null;
    const cardsOf = /home/.test(market)
      ? (summary: SimMatchSummary) => summary.home.cards
      : /away/.test(market)
        ? (summary: SimMatchSummary) => summary.away.cards
        : (summary: SimMatchSummary) => summary.home.cards + summary.away.cards;
    return compiledOverUnder(selection, totals.line, "cards", cardsOf);
  }

  // --- handicaps and goal lines -----------------------------------------
  if (/handicap|goal line/.test(market)) {
    const parsed = parseHandicapSelection(selection);
    if (parsed) {
      return compiledHandicap(
        selection,
        options.handicapLine ?? parsed.line,
        `handicap (${period})`,
        (summary) => homeOf(summary) - awayOf(summary),
      );
    }
    const totals = parseTotalsSelection(selection);
    if (totals) return compiledOverUnder(selection, totals.line, "goals", totalOf);
    return null;
  }

  // --- exact scores ------------------------------------------------------
  if (/exact score|correct score/.test(market)) {
    const score = parseScore(selection);
    if (!score) return null;
    const actualOf =
      period === "h1"
        ? (summary: SimMatchSummary) => summary.halfTime
        : period === "h2"
          ? (summary: SimMatchSummary) => summary.secondHalf
          : (summary: SimMatchSummary) => ({ home: summary.home.goals, away: summary.away.goals });
    return {
      outcome: (summary) => {
        const actual = actualOf(summary);
        return actual.home === score.home && actual.away === score.away ? "win" : "lose";
      },
      detail: (summary) => {
        const actual = actualOf(summary);
        return `${actual.home}:${actual.away} vs ${score.home}:${score.away}`;
      },
    };
  }

  // --- half-time / full-time --------------------------------------------
  if (/ht\/ft|half time\/full time|ht-ft/.test(market)) {
    const parts = selection.split("/");
    if (parts.length !== 2) return null;
    const atHalf = resultToken(parts[0]);
    const atFull = resultToken(parts[1]);
    if (!atHalf || !atFull) return null;
    const halfResult = (summary: SimMatchSummary) =>
      goalDiff(summary.halfTime.home, summary.halfTime.away);
    const fullResult = (summary: SimMatchSummary) =>
      goalDiff(summary.home.goals, summary.away.goals);
    return {
      outcome: (summary) =>
        halfResult(summary) === atHalf && fullResult(summary) === atFull ? "win" : "lose",
      detail: (summary) => `${halfResult(summary)}/${fullResult(summary)}`,
    };
  }

  // --- odd / even --------------------------------------------------------
  if (/odd\/even|odd or even/.test(market)) {
    const picked = /even/i.test(selection);
    return {
      outcome: (summary) => {
        const even = totalOf(summary) % 2 === 0;
        return (picked && even) || (!picked && !even) ? "win" : "lose";
      },
      detail: (summary) => `${totalOf(summary)} goals`,
    };
  }

  // --- result / total combinations --------------------------------------
  const totalCombo = selection.match(/^(?:o|u)\/(yes|no)\s+([0-9.]+)$/i);
  if (/total goals\/both teams/.test(market) && totalCombo) {
    const over = selection.toLowerCase().startsWith("o/");
    const line = Number(totalCombo[2]);
    const wantsBtts = totalCombo[1].toLowerCase() === "yes";
    return {
      outcome: (summary) => {
        const total = totalOf(summary);
        const totalWin = over ? total > line : total < line;
        const scored = homeOf(summary) > 0 && awayOf(summary) > 0;
        return totalWin && (wantsBtts ? scored : !scored) ? "win" : "lose";
      },
      detail: (summary) => {
        const scored = homeOf(summary) > 0 && awayOf(summary) > 0;
        return `${totalOf(summary)} goals, btts ${scored ? "yes" : "no"}`;
      },
    };
  }

  const resultCombo = selection.match(/^(home|draw|away)\/(over|under)\s+([0-9.]+)$/i);
  if (/result\/total goals/.test(market) && resultCombo) {
    const result = resultToken(resultCombo[1]);
    const line = Number(resultCombo[3]);
    const over = resultCombo[2].toLowerCase() === "over";
    const totalOutcome = (summary: SimMatchSummary): SettlementOutcome => {
      const total = totalOf(summary);
      if (total === line) return "push";
      return (total > line) === over ? "win" : "lose";
    };
    return {
      outcome: (summary) => (resultOf(summary) === result ? totalOutcome(summary) : "lose"),
      detail: (summary) =>
        resultOf(summary) === result
          ? `${totalOf(summary)} goals vs line ${line}`
          : "result did not match",
    };
  }

  const resultBtts = selection.match(/^(home|draw|away)\/(yes|no)$/i);
  if (/results\/both teams score/.test(market) && resultBtts) {
    const result = resultToken(resultBtts[1]);
    const wantsBtts = resultBtts[2].toLowerCase() === "yes";
    const scored = (summary: SimMatchSummary) => homeOf(summary) > 0 && awayOf(summary) > 0;
    return {
      outcome: (summary) =>
        resultOf(summary) === result && (wantsBtts ? scored(summary) : !scored(summary))
          ? "win"
          : "lose",
      detail: (summary) => `${resultOf(summary)}, btts ${scored(summary) ? "yes" : "no"}`,
    };
  }

  // --- both teams to score ----------------------------------------------
  if (/both teams score|both teams to score|btts/.test(market)) {
    const picked = /^yes$/i.test(selection.trim());
    const scored = (summary: SimMatchSummary) => homeOf(summary) > 0 && awayOf(summary) > 0;
    return {
      outcome: (summary) => ((picked ? scored(summary) : !scored(summary)) ? "win" : "lose"),
      detail: (summary) => `${homeOf(summary)}-${awayOf(summary)}`,
    };
  }

  // --- clean sheets, win to nil, scoring --------------------------------
  if (/clean sheet/.test(market)) {
    const home = !/away/.test(market);
    const conceded = (summary: SimMatchSummary) => (home ? summary.away.goals : summary.home.goals);
    const picked = /^yes$/i.test(selection.trim());
    return {
      outcome: (summary) => {
        const clean = conceded(summary) === 0;
        return (picked ? clean : !clean) ? "win" : "lose";
      },
      detail: (summary) => `conceded ${conceded(summary)}`,
    };
  }
  if (/win to nil/.test(market)) {
    const home = !/away/.test(market);
    const won = (summary: SimMatchSummary) =>
      home ? summary.home.goals > summary.away.goals : summary.away.goals > summary.home.goals;
    const conceded = (summary: SimMatchSummary) => (home ? summary.away.goals : summary.home.goals);
    const picked = /^yes$/i.test(selection.trim());
    return {
      outcome: (summary) => {
        const achieved = won(summary) && conceded(summary) === 0;
        return (picked ? achieved : !achieved) ? "win" : "lose";
      },
      detail: (summary) => `won ${won(summary)}, conceded ${conceded(summary)}`,
    };
  }
  if (/home team score a goal/.test(market)) {
    const scored = (summary: SimMatchSummary) => summary.home.goals > 0;
    const picked = /^yes$/i.test(selection.trim());
    return {
      outcome: (summary) => ((picked ? scored(summary) : !scored(summary)) ? "win" : "lose"),
      detail: (summary) => `home scored ${summary.home.goals}`,
    };
  }
  if (/win both halves/.test(market)) {
    const home = !/away/.test(market);
    const wonFirst = (summary: SimMatchSummary) =>
      goalDiff(summary.halfTime.home, summary.halfTime.away) === (home ? "home" : "away");
    const wonSecond = (summary: SimMatchSummary) =>
      goalDiff(summary.secondHalf.home, summary.secondHalf.away) === (home ? "home" : "away");
    const picked = /^yes$/i.test(selection.trim());
    return {
      outcome: (summary) => {
        const achieved = wonFirst(summary) && wonSecond(summary);
        return (picked ? achieved : !achieved) ? "win" : "lose";
      },
      detail: (summary) => `halves ${wonFirst(summary)}/${wonSecond(summary)}`,
    };
  }
  if (/to score in both halves/.test(market)) {
    // This market is priced per team (Home / Away), unlike its yes/no cousins.
    const side = resultToken(selection);
    const home = side ? side === "home" : !/away/.test(market);
    const scoredFirst = (summary: SimMatchSummary) =>
      (home ? summary.halfTime.home : summary.halfTime.away) > 0;
    const scoredSecond = (summary: SimMatchSummary) =>
      (home ? summary.secondHalf.home : summary.secondHalf.away) > 0;
    const picked = side ? true : /^yes$/i.test(selection.trim());
    return {
      outcome: (summary) => {
        const achieved = scoredFirst(summary) && scoredSecond(summary);
        return (picked ? achieved : !achieved) ? "win" : "lose";
      },
      detail: (summary) => `scored in halves ${scoredFirst(summary)}/${scoredSecond(summary)}`,
    };
  }
  if (/team to score first|first team to score/.test(market)) {
    const noGoal = /no goal/i.test(selection);
    const side = resultToken(selection);
    if (!noGoal && (!side || side === "draw")) return null;
    return {
      outcome: (summary) =>
        summary.firstGoal === (noGoal ? "none" : side) ? "win" : "lose",
      detail: (summary) =>
        noGoal
          ? summary.firstGoal === "none"
            ? "no goals"
            : `first ${summary.firstGoal}`
          : `first goal ${summary.firstGoal}`,
    };
  }
  if (/own goal/.test(market)) {
    const own = (summary: SimMatchSummary) => summary.goals.some((goal) => goal.ownGoal);
    const picked = /^yes$/i.test(selection.trim());
    return {
      outcome: (summary) => ((picked ? own(summary) : !own(summary)) ? "win" : "lose"),
      detail: (summary) => `own goal ${own(summary)}`,
    };
  }

  // --- exact team goals --------------------------------------------------
  if (/exact goals number/.test(market)) {
    const valueOf = /away/.test(market)
      ? (summary: SimMatchSummary) => summary.away.goals
      : (summary: SimMatchSummary) => summary.home.goals;
    // The feed also publishes "more 3" under this heading, which is a 3+ line.
    const more = selection.trim().match(/^more\s+(\d+)$/i);
    if (more) {
      const threshold = Number(more[1]);
      return {
        outcome: (summary) => (valueOf(summary) >= threshold ? "win" : "lose"),
        detail: (summary) => `${valueOf(summary)} goals, needs ${threshold}+`,
      };
    }
    const target = Number(selection.trim());
    if (!Number.isFinite(target)) return null;
    return {
      outcome: (summary) => (valueOf(summary) === target ? "win" : "lose"),
      detail: (summary) => `${valueOf(summary)} goals`,
    };
  }

  // --- team totals -------------------------------------------------------
  // Check the away markets first: "away team total goals" also contains the
  // words "team total goals", so the home test would otherwise swallow it.
  if (/total - away|away team total/.test(market)) {
    const totals = parseTotalsSelection(selection);
    if (!totals) return null;
    return compiledOverUnder(selection, totals.line, "away goals", awayOf);
  }
  if (/total - home|home team total|team total goals/.test(market)) {
    const totals = parseTotalsSelection(selection);
    if (!totals) return null;
    return compiledOverUnder(selection, totals.line, "home goals", homeOf);
  }

  // --- draw no bet -------------------------------------------------------
  if (/draw no bet/.test(market)) {
    const side = resultToken(selection);
    if (!side || side === "draw") return null;
    return {
      outcome: (summary) => {
        const result = resultOf(summary);
        if (result === "draw") return "push";
        return result === side ? "win" : "lose";
      },
      detail: (summary) => (resultOf(summary) === "draw" ? "draw, stake returned" : resultOf(summary)),
    };
  }

  // --- double chance -----------------------------------------------------
  if (/double chance/.test(market)) {
    const parts = selection.split("/").map((part) => resultToken(part));
    if (parts.length !== 2 || parts.some((part) => !part)) return null;
    return {
      outcome: (summary) => (parts.includes(resultOf(summary)) ? "win" : "lose"),
      detail: (summary) => resultOf(summary),
    };
  }

  // --- plain two-way winner (Home/Away market) --------------------------
  if (/^home\/away$/.test(market)) {
    const side = resultToken(selection);
    if (!side || side === "draw") return null;
    return {
      outcome: (summary) => (resultOf(summary) === side ? "win" : "lose"),
      detail: (summary) => resultOf(summary),
    };
  }

  // --- straight result markets ------------------------------------------
  if (/winner|match result|match winner|full time result/.test(market)) {
    const side = resultToken(selection);
    if (!side) return null;
    return {
      outcome: (summary) => (resultOf(summary) === side ? "win" : "lose"),
      detail: (summary) => `${resultOf(summary)} (${period})`,
    };
  }

  // --- plain totals (goals over/under and friends) ----------------------
  if (/over\/under|goals over|total goals/.test(market)) {
    const totals = parseTotalsSelection(selection);
    if (!totals) return null;
    return compiledOverUnder(selection, totals.line, "goals", totalOf);
  }

  return null;
}

/**
 * Settle one selection against one simulated match. Returns null when the
 * market is not one this engine can grade, so callers can report it as
 * untracked rather than pretending it lost.
 */
export function settleSelection(
  marketName: string,
  selection: string,
  summary: SimMatchSummary,
  options: { handicapLine?: number | null } = {},
): Settlement | null {
  const compiled = compileSettlement(marketName, selection, options);
  if (!compiled) return null;
  return { outcome: compiled.outcome(summary), detail: compiled.detail(summary) };
}
