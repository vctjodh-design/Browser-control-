/**
 * The two questions asked before a call is final.
 *
 * A card says who wins. That is one claim, made from one read. What follows is the
 * part that decides whether the claim is worth anything: put the match into a state
 * the call does not assume — the other side scores first, goes two up at the break,
 * or sits deep — and ask what the same evidence says happens next.
 *
 * Two different questions, answered from the same rows:
 *
 *   WHAT IF ...?  does the state actually change the outcome? Read as what each side
 *                 has done *while in that state*: how often the side behind came back,
 *                 what it created while chasing, how often the side ahead dropped it.
 *   EVEN IF ...?  given the state, does the call survive? Read as resistance: the
 *                 opponent-adjusted defending of the side that has to hold on, the
 *                 chances it concedes, the goals it gives up late.
 *
 * Everything here is a frequency counted over the side's own stored matches. Nothing
 * is a probability about this fixture, and a stat the feed did not carry is left out
 * rather than counted as zero. Where event data cannot see something — a defensive
 * block's shape, a team's intent to sit deep — the answer says so instead of inventing
 * a number for it.
 */

export type ScenarioMatch = {
  date: string;
  venue: 'home' | 'away';
  goalsFor: number;
  goalsAgainst: number;
  xgFor: number | null;
  xgAgainst: number | null;
  shotsFor: number | null;
  shotsOnTargetFor: number | null;
  bigChancesFor: number | null;
  savesFor: number | null;
  scoredPhases: number[];
  concededPhases: number[];
  ledAtSomePoint: boolean | null;
  trailedAtSomePoint: boolean | null;
  /** What the opponent in that match normally creates and concedes, for adjustment. */
  opponentXgFor: number | null;
  opponentXgAgainst: number | null;
  opponentBigChances: number | null;
};

export type SideRead = {
  team: string;
  matches: number;
  /** Matches in which it conceded first, and what it took from them. */
  trailed: number;
  cameBackToWin: number;
  cameBackToDraw: number;
  /** Matches in which it scored first, and what it did with them. */
  led: number;
  leadsHeld: number;
  leadsDropped: number;
  /** Two goals down at half-time: the state a two-goal idea is actually about. */
  twoDownAtBreak: number;
  /** Of those, the ones that ended level or better. */
  twoDownRescued: number;
  /** Its xG per game overall, and while chasing a deficit. */
  xg: number | null;
  xgChasing: number | null;
  shotsOnTarget: number | null;
  bigChances: number | null;
  /** xG conceded per game, and how it compares with an average opponent's allowance. */
  xga: number | null;
  adjustedXga: number | null;
  adjustedXgFor: number | null;
  bigChancesConceded: number | null;
  saves: number | null;
  /** Share of the goals it concedes that arrive after 75 minutes. */
  lateConcededShare: number | null;
  /** xG conceded per match in the matches it led — pressure while protecting. */
  xgaWhileLeading: number | null;
};

export type Scenario = {
  id: 'score-first' | 'two-down' | 'deep-block';
  /** The question, in the state's own words. */
  question: string;
  /** The counts it is answered from, each already a sentence. */
  evidence: string[];
  /** What the evidence says about the state, not about the fixture. */
  answer: string;
  /** How much of the evidence was actually there: 0 when nothing could be read. */
  depth: 'read' | 'thin' | 'none';
};

export type ResistanceLine = {
  label: string;
  value: number;
  unit: 'perGame' | 'share' | 'multiple';
  reading: string;
};

export type StructuralFailure = {
  side: string;
  /** The mechanism, named as an action the opponent can repeat. */
  mechanism: string;
  detail: string;
};

export type ScenarioRead = {
  whatIf: Scenario[];
  evenIf: {
    /** The side the call needs to hold, and the state it is challenged in. */
    statement: string;
    resistance: ResistanceLine[];
  } | null;
  structure: StructuralFailure | null;
  /** Sample sizes behind every line, so a reader can weigh the whole thing. */
  depth: { home: number; away: number };
};

function mean(values: Array<number | null>): number | null {
  const real = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!real.length) return null;
  return real.reduce((sum, value) => sum + value, 0) / real.length;
}

function round(value: number, places = 2): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}

function pct(share: number | null): string {
  return share === null ? '—' : `${Math.round(share * 100)}%`;
}

function goals(value: number | null): string {
  return value === null ? '—' : value.toFixed(2);
}

/** The window read as a side's behaviour in the states a call has to survive. */
export function readSide(team: string, matches: ScenarioMatch[]): SideRead {
  const played = matches.length;
  const trailedRows = matches.filter((match) => match.trailedAtSomePoint);
  const ledRows = matches.filter((match) => match.ledAtSomePoint);
  const cameBackToWin = trailedRows.filter((match) => match.goalsFor > match.goalsAgainst).length;
  const cameBackToDraw = trailedRows.filter((match) => match.goalsFor === match.goalsAgainst).length;
  const leadsHeld = ledRows.filter((match) => match.goalsFor > match.goalsAgainst).length;
  const leadsDropped = ledRows.filter((match) => match.goalsFor <= match.goalsAgainst).length;

  // Two down at the break: at least two conceded inside the first 45 minutes.
  const twoDownRows = matches.filter(
    (match) => (match.concededPhases[0] ?? 0) + (match.concededPhases[1] ?? 0) + (match.concededPhases[2] ?? 0) >= 2,
  );
  const twoDownAtBreak = twoDownRows.length;
  const twoDownRescued = twoDownRows.filter((match) => match.goalsFor >= match.goalsAgainst).length;

  const concededTotal = matches.reduce(
    (sum, match) => sum + match.concededPhases.reduce((inner, value) => inner + value, 0),
    0,
  );
  const lateConceded = matches.reduce((sum, match) => sum + (match.concededPhases[5] ?? 0), 0);

  // Opponent adjustment: what this side gave up against what that opponent normally
  // creates, match by match. 1.00 means "as expected against these opponents", above
  // it means the defence leaks against everyone, below it means it holds good sides.
  const adjustedXgaSamples = matches.map((match) => {
    if (match.xgAgainst === null || match.opponentXgFor === null) return null;
    if (match.opponentXgFor <= 0.1) return null;
    return match.xgAgainst / match.opponentXgFor;
  });
  const adjustedXgSamples = matches.map((match) => {
    if (match.xgFor === null || match.opponentXgAgainst === null) return null;
    if (match.opponentXgAgainst <= 0.1) return null;
    return match.xgFor / match.opponentXgAgainst;
  });

  return {
    team,
    matches: played,
    trailed: trailedRows.length,
    cameBackToWin,
    cameBackToDraw,
    led: ledRows.length,
    leadsHeld,
    leadsDropped,
    twoDownAtBreak,
    twoDownRescued,
    xg: mean(matches.map((match) => match.xgFor)),
    xgChasing: mean(trailedRows.map((match) => match.xgFor)),
    shotsOnTarget: mean(matches.map((match) => match.shotsOnTargetFor)),
    bigChances: mean(matches.map((match) => match.bigChancesFor)),
    xga: mean(matches.map((match) => match.xgAgainst)),
    adjustedXga: mean(adjustedXgaSamples),
    adjustedXgFor: mean(adjustedXgSamples),
    // Big chances conceded is read off the opponent's own creation average rather
    // than guessed: how many clear chances the sides it faced normally make.
    bigChancesConceded: mean(matches.map((match) => match.opponentBigChances)),
    saves: mean(matches.map((match) => match.savesFor)),
    lateConcededShare: concededTotal > 0 ? lateConceded / concededTotal : null,
    xgaWhileLeading: mean(ledRows.map((match) => match.xgAgainst)),
  };
}

export type ScenarioInput = {
  home: { team: string; short: string; matches: ScenarioMatch[] };
  away: { team: string; short: string; matches: ScenarioMatch[] };
  /** The side the card is calling to win, when it calls one at all. */
  call: { winner: 'home' | 'away' | null; line: string };
};

const THIN = 8;

/** How a side reads when it is the one that has to hold on. */
function holdsLeads(read: SideRead): { share: number | null; text: string } {
  if (!read.led) return { share: null, text: `${read.team} has not led in any match read.` };
  const share = read.leadsHeld / read.led;
  const text =
    share >= 0.75
      ? `${read.team} held ${read.leadsHeld} of ${read.led} leads (${pct(share)}) — the lead tends to stay a lead.`
      : share >= 0.5
        ? `${read.team} held ${read.leadsHeld} of ${read.led} leads (${pct(share)}) — it holds more often than not, not always.`
        : `${read.team} held only ${read.leadsHeld} of ${read.led} leads (${pct(share)}) — leads are not safe in its hands.`;
  return { share, text };
}

function comebackText(read: SideRead): string {
  if (!read.trailed) return `${read.team} has not trailed in any match read.`;
  const rescued = read.cameBackToWin + read.cameBackToDraw;
  const share = rescued / read.trailed;
  return `${read.team} conceded first in ${read.trailed} matches: ${read.cameBackToWin} won, ${read.cameBackToDraw} drawn (${pct(
    share,
  )} recovered something).`;
}

function chasingText(read: SideRead): string | null {
  if (read.xg === null || read.xgChasing === null || read.xg <= 0.2) return null;
  const lift = read.xgChasing / read.xg - 1;
  if (Math.abs(lift) < 0.1) {
    return `Chasing, it creates ${goals(read.xgChasing)} xG against ${goals(read.xg)} overall — the same team.`;
  }
  return lift > 0
    ? `Chasing, it creates ${goals(read.xgChasing)} xG against ${goals(read.xg)} overall (+${Math.round(lift * 100)}%) — it does push.`
    : `Chasing, it creates ${goals(read.xgChasing)} xG against ${goals(read.xg)} overall (${Math.round(
        lift * 100,
      )}%) — chasing makes it worse, not better.`;
}

/**
 * The three states worth asking about, for the two sides on a card.
 *
 * The questions are chosen by the call: the side the card says will lose is the one
 * given the first goal, because that is the state that would break the call. When the
 * card calls no winner, the weaker side by the board takes the role.
 */
export function buildScenarios(input: ScenarioInput): ScenarioRead {
  const home = readSide(input.home.team, input.home.matches);
  const away = readSide(input.away.team, input.away.matches);
  const depth = { home: home.matches, away: away.matches };

  const winnerSide = input.call.winner ?? (input.home.matches.length >= input.away.matches.length ? 'home' : 'away');
  const challenger = winnerSide === 'home' ? away : home;
  const called = winnerSide === 'home' ? home : away;
  const challengerShort = winnerSide === 'home' ? input.away.short : input.home.short;
  const calledShort = winnerSide === 'home' ? input.home.short : input.away.short;

  const deeper = Math.min(home.matches, away.matches);
  const depthOf = (value: number): Scenario['depth'] => (deeper === 0 ? 'none' : deeper < THIN ? 'thin' : value > 0 ? 'read' : 'thin');

  const leadHold = holdsLeads(challenger);
  const calledComeback = comebackText(called);
  const challengerChase = challenger === away ? chasingText(away) : chasingText(home);

  const scoreFirstEvidence = [calledComeback];
  if (challengerChase) scoreFirstEvidence.push(challengerChase);
  scoreFirstEvidence.push(leadHold.text);
  if (challenger.lateConcededShare !== null) {
    scoreFirstEvidence.push(
      `${pct(challenger.lateConcededShare)} of the goals ${challenger.team} concedes arrive after 75′.`,
    );
  }
  if (challenger.xgaWhileLeading !== null) {
    scoreFirstEvidence.push(
      `While ahead it concedes ${goals(challenger.xgaWhileLeading)} xG a game, across ${challenger.led} matches led.`,
    );
  }

  const comebackStrength = called.trailed ? (called.cameBackToWin + called.cameBackToDraw) / called.trailed : null;
  const holdStrength = leadHold.share;
  let scoreFirstAnswer: string;
  if (deeper < THIN) {
    scoreFirstAnswer = `${deeper} matches read for both sides: too few to answer this without inventing it.`;
  } else if (comebackStrength === null || holdStrength === null) {
    scoreFirstAnswer = 'One of the two sides has no matches read in this state, so the question stays open.';
  } else if (comebackStrength >= 0.4 && holdStrength < 0.7) {
    scoreFirstAnswer = `The comeback route is real: ${calledShort} recovers from a deficit ${pct(
      comebackStrength,
    )} of the time and ${challengerShort} has dropped ${challenger.leadsDropped} of ${challenger.led} leads — the call is exposed to a first goal against it.`;
  } else if (comebackStrength < 0.3) {
    scoreFirstAnswer = `${calledShort} rarely recovers once behind (${pct(
      comebackStrength,
    )}), so a first goal for ${challengerShort} would be the state that breaks this call.`;
  } else {
    scoreFirstAnswer = `${calledShort}'s comeback record (${pct(comebackStrength)}) and ${challengerShort}'s lead-holding (${pct(
      holdStrength,
    )}) both pull the same way: the call survives conceding first more often than not.`;
  }

  const twoDownEvidence = [
    `${calledShort} was two goals down at half-time in ${called.twoDownAtBreak} of ${called.matches} matches read.`,
    `${challengerShort} conceded twice inside the first half in ${challenger.twoDownAtBreak} of ${challenger.matches} matches.`,
  ];
  if (called.xgChasing !== null && called.xg !== null) {
    twoDownEvidence.push(`Its xG while chasing is ${goals(called.xgChasing)} against ${goals(called.xg)} overall.`);
  }
  const twoDownAnswer =
    deeper < THIN
      ? `Too few matches read (${deeper}) to put a two-goal state to either side.`
      : called.twoDownAtBreak === 0
        ? `${calledShort} has not been two down at the break in this window — the state has not been tested on it yet, so nothing here supports a comeback from it.`
        : called.twoDownAtBreak === 1
          ? `${calledShort} has been two down at the break once, and ${called.twoDownRescued === 1 ? 'took a point or more from it' : 'lost it'} — one match is a story, not a record.`
          : `${calledShort} has been two down at the break ${called.twoDownAtBreak} times and taken something from ${called.twoDownRescued} of them — the deficit is not a formality, but it is not a strength either.`;

  const blockEvidence: string[] = [];
  if (called.xg !== null) {
    blockEvidence.push(
      `${calledShort} creates ${goals(called.xg)} xG a game${called.bigChances !== null ? `, with ${goals(called.bigChances)} big chances` : ''}${
        called.shotsOnTarget !== null ? ` and ${goals(called.shotsOnTarget)} shots on target` : ''
      }.`,
    );
  }
  if (challenger.xga !== null) {
    blockEvidence.push(
      `${challengerShort} concedes ${goals(challenger.xga)} xG a game${
        challenger.adjustedXga !== null ? `, ${goals(challenger.adjustedXga)}× what an average opponent creates against it` : ''
      }.`,
    );
  }
  if (challenger.adjustedXga !== null) {
    blockEvidence.push(
      challenger.adjustedXga >= 1.15
        ? `That adjusted figure says the leak is the side's own, not the schedule's.`
        : challenger.adjustedXga <= 0.85
          ? `Adjusted for the opposition, its defence is better than the raw figure reads.`
          : `Adjusted for the opposition, that is about par.`,
    );
  }
  const blockAnswer =
    deeper < THIN
      ? `Too few matches read (${deeper}) to judge whether the block would hold.`
      : `What event data cannot see is the shape of a block: line spacing and compactness need tracking data, so this is not a measurement of one. What it can see is the pressure that would meet it — the creation above against the xG conceded above — and that is where the call is exposed if ${challengerShort} chooses to sit deep.`;

  const whatIf: Scenario[] = [
    {
      id: 'score-first',
      question: `What if ${challengerShort} scores first — can ${calledShort} still win?`,
      evidence: scoreFirstEvidence,
      answer: scoreFirstAnswer,
      depth: depthOf(scoreFirstEvidence.length),
    },
    {
      id: 'two-down',
      question: `What if ${challengerShort} is two up at the break — is the call gone?`,
      evidence: twoDownEvidence,
      answer: twoDownAnswer,
      depth: depthOf(called.matches),
    },
    {
      id: 'deep-block',
      question: `What if ${challengerShort} sits deep — can ${calledShort} break the block?`,
      evidence: blockEvidence,
      answer: blockAnswer,
      depth: depthOf(blockEvidence.length),
    },
  ];

  const resistance: ResistanceLine[] = [];
  const addResistance = (label: string, value: number | null, unit: ResistanceLine['unit'], reading: string) => {
    if (value === null || !Number.isFinite(value)) return;
    resistance.push({ label, value: round(value), unit, reading });
  };
  addResistance(
    'Adjusted xG conceded',
    challenger.adjustedXga,
    'multiple',
    challenger.adjustedXga === null
      ? ''
      : challenger.adjustedXga >= 1.15
        ? 'leaks more than an average defence against the same opponents'
        : challenger.adjustedXga <= 0.85
          ? 'holds up better than the raw numbers suggest'
          : 'about par once the opposition is accounted for',
  );
  addResistance('xG conceded a game', challenger.xga, 'perGame', 'pressure it absorbs, on average');
  addResistance(
    'xG conceded while leading',
    challenger.xgaWhileLeading,
    'perGame',
    challenger.led ? `across ${challenger.led} matches led` : 'no leads to read',
  );
  addResistance(
    'Goals conceded after 75′',
    challenger.lateConcededShare,
    'share',
    challenger.lateConcededShare !== null && challenger.lateConcededShare >= 0.3
      ? 'it fades late, and that is when a lead is lost'
      : 'the late game is not where it breaks',
  );
  addResistance('Leads held', challenger.leadsHeld ? challenger.leadsHeld / Math.max(1, challenger.led) : null, 'share', `${challenger.leadsHeld} of ${challenger.led}`);
  addResistance(
    'Big chances faced',
    challenger.bigChancesConceded,
    'perGame',
    "the opponents' own creation average — the feed does not record chances conceded per match",
  );
  addResistance('Saves a game', challenger.saves, 'perGame', 'the keeper is part of the resistance');

  const statement =
    deeper < THIN
      ? `Even if ${challengerShort} take the lead, only ${deeper} matches are read for both sides — the resistance cannot be judged yet.`
      : resistance.length === 0
        ? `Even if ${challengerShort} take the lead, the feed gave no defensive detail for that side to judge whether they hold it.`
        : (() => {
            const parts: string[] = [];
            if (challenger.xga !== null) {
              parts.push(
                `it concedes ${goals(challenger.xga)} xG a game${
                  challenger.adjustedXga !== null
                    ? ` (${goals(challenger.adjustedXga)}× what an average opponent creates)`
                    : ''
                }`,
              );
            }
            if (challenger.xgaWhileLeading !== null) {
              parts.push(`${goals(challenger.xgaWhileLeading)} of that while it is ahead`);
            }
            if (challenger.led > 0) {
              const dropped = challenger.leadsDropped / challenger.led;
              parts.push(`and it drops ${pct(dropped)} of the leads it takes (${challenger.leadsDropped} of ${challenger.led})`);
            }
            return parts.length
              ? `Even if ${challengerShort} take the lead, whether it survives ${calledShort}'s pressure is what the window measures: ${parts.join(', ')}.`
              : `Even if ${challengerShort} take the lead, the window holds no defensive detail to say whether it survives.`;
          })();

  // Where the structure breaks: the weakest measured mechanism on the side that has
  // to defend the call, named so it can be watched for during the match.
  const candidates: Array<{ mechanism: string; detail: string; score: number }> = [];
  if (challenger.leadsDropped > 0 && challenger.led > 0) {
    const dropped = challenger.leadsDropped / challenger.led;
    if (dropped >= 0.25) {
      candidates.push({
        mechanism: 'losing a lead it already has',
        detail: `${challenger.leadsDropped} of ${challenger.led} leads dropped (${pct(dropped)}).`,
        score: dropped,
      });
    }
  }
  if (challenger.lateConcededShare !== null && challenger.lateConcededShare >= 0.3) {
    candidates.push({
      mechanism: 'the last fifteen minutes',
      detail: `${pct(challenger.lateConcededShare)} of its concessions arrive after 75′.`,
      score: challenger.lateConcededShare,
    });
  }
  if (challenger.adjustedXga !== null && challenger.adjustedXga >= 1.15) {
    candidates.push({
      mechanism: 'chance volume through its own defence',
      detail: `It concedes ${goals(challenger.xga)} xG a game, ${goals(challenger.adjustedXga)}× an average opponent's creation.`,
      score: challenger.adjustedXga - 1,
    });
  }
  if (challenger.bigChancesConceded !== null && challenger.bigChancesConceded >= 2.5) {
    candidates.push({
      mechanism: 'clear chances faced',
      detail: `the sides it meets average ${goals(challenger.bigChancesConceded)} big chances a game — the feed records what opponents create, not what it concedes.`,
      score: (challenger.bigChancesConceded / 5) * 0.6,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const structure: StructuralFailure | null = candidates[0]
    ? { side: challenger.team, mechanism: candidates[0].mechanism, detail: candidates[0].detail }
    : null;

  return {
    whatIf,
    evenIf: {
      statement,
      resistance,
    },
    structure,
    depth,
  };
}
