// Team tactics: a base identity per side, modulated by the game state, the
// score line, the clock and how tired the squad is. These numbers feed the
// positional model and the utility scores, so the shape of the match changes
// over ninety minutes instead of staying flat.

export const STYLES = [
  {
    key: 'press',
    label: 'HIGH PRESS',
    press: 0.84, line: 0.74, width: 0.6, risk: 0.62, tempo: 0.74, direct: 0.52,
  },
  {
    key: 'control',
    label: 'MID BLOCK',
    press: 0.5, line: 0.52, width: 0.56, risk: 0.46, tempo: 0.5, direct: 0.38,
  },
];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

/** Stable, side-independent pick of a base style for a club name. */
function clubStyleIndex(name) {
  let hash = 7;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) % 9973;
  return hash % STYLES.length;
}

const blend = (fallback, value) =>
  typeof value === 'number' && Number.isFinite(value)
    ? clamp(fallback * 0.35 + value * 0.65, 0.12, 1)
    : fallback;

export function createTactics(idx, override = null, name = '') {
  // A host page can hand over a style read from the club's own matches. It is
  // blended with the default identity so the shape of play still reads like
  // football rather than a raw statistical average.
  //
  // The identity comes from the club, not from the team index: keying it on
  // home/away handed the home side a high line in every fixture, and this
  // engine punishes a high line hard, so the home team lost about two thirds
  // of the goals it should have scored.
  const base = STYLES[clubStyleIndex(name || String(idx))];
  const style = override
    ? {
        key: 'data',
        label: override.label ?? base.label,
        press: blend(base.press, override.press),
        line: blend(base.line, override.line),
        width: blend(base.width, override.width),
        risk: blend(base.risk, override.risk),
        tempo: blend(base.tempo, override.tempo),
        direct: blend(base.direct, override.direct),
      }
    : base;
  return {
    style,
    press: style.press,
    line: style.line,
    width: style.width,
    risk: style.risk,
    tempo: style.tempo,
    direct: style.direct,
    // live state
    phase: 'possession',
    transition: 0,
    counter: 0,
    label: style.label,
    mood: 'BALANCED',
  };
}

/**
 * Recompute the live tactical numbers. Cheap enough to run a few times a second.
 */
export function updateTactics(match, team, dt) {
  const t = team.tactics;
  t.transition = Math.max(0, t.transition - dt);
  t.counter = Math.max(0, t.counter - dt);

  const st = t.style;
  const diff = match.score[team.idx] - match.score[1 - team.idx];
  const minutes = match.clock / 60;

  // --- game state: chasing / protecting -------------------------------
  let riskShift = 0;
  let lineShift = 0;
  let pressShift = 0;
  let mood = 'BALANCED';

  if (minutes > 55 && diff < 0) {
    const urgency = clamp((minutes - 55) / 30, 0, 1);
    riskShift += 0.26 * urgency;
    lineShift += 0.16 * urgency;
    pressShift += 0.14 * urgency;
    mood = minutes > 80 ? 'DESPERATE' : 'CHASING';
  } else if (minutes > 62 && diff > 0) {
    const protect = clamp((minutes - 62) / 26, 0, 1);
    riskShift -= 0.2 * protect;
    lineShift -= 0.12 * protect;
    pressShift -= 0.08 * protect;
    mood = 'PROTECTING';
  } else if (minutes < 15) {
    // opening spell: cagey, everyone still finding their shape
    riskShift -= 0.08;
    mood = 'SETTLING';
  } else if (minutes > 40 && minutes < 46) {
    // before the break teams take fewer risks
    riskShift -= 0.06;
  }

  // --- fatigue: a tired side cannot press ------------------------------
  let stamina = 0;
  let n = 0;
  for (const a of team.agents) {
    if (a.sentOff) continue;
    stamina += a.stamina;
    n++;
  }
  stamina = n ? stamina / n : 1;
  const tired = clamp((0.62 - stamina) / 0.42, 0, 1);
  pressShift -= tired * 0.26;
  lineShift -= tired * 0.12;
  riskShift += tired * 0.05;

  // --- transition bonus: the first seconds after a turnover ------------
  const transitionBoost = t.transition > 0 ? 0.18 : 0;

  t.press = clamp(st.press + pressShift + transitionBoost, 0.12, 1);
  t.line = clamp(st.line + lineShift - transitionBoost * 0.3, 0.18, 0.95);
  t.risk = clamp(st.risk + riskShift + transitionBoost * 0.5, 0.05, 1);
  t.tempo = clamp(st.tempo + riskShift * 0.4 + transitionBoost * 0.4, 0.3, 1);
  t.width = st.width;
  t.direct = clamp(st.direct + (riskShift > 0 ? 0.16 : riskShift < 0 ? -0.1 : 0), 0.2, 0.95);
  t.mood = mood;
  t.stamina = stamina;
  t.label = `${st.label}${mood !== 'BALANCED' ? ` · ${mood}` : ''}`;
}

/** Called on every change of possession. */
export function onTurnover(winner, loser) {
  winner.tactics.transition = 5.5;
  winner.tactics.counter = 6;
  loser.tactics.transition = 0;
}

/** Line height in metres from the team's own goal, for the back four. */
export function backLineDistance(team, ballNormX) {
  // 0.18..0.95 line setting -> 14m..52m off the own goal, following the ball
  const t = team.tactics;
  const base = 14 + t.line * 40;
  const push = (ballNormX - 0.5) * 26;
  return clamp(base + push, 10, 50);
}
