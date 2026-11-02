// Per-player attributes. Every value is 0..1 and drives both decisions and
// execution error, so two players in the same role behave differently.

const ROLE_BASE = {
  GK: { pace: 0.52, accel: 0.6, stamina: 0.6, passing: 0.6, vision: 0.58, dribbling: 0.28, shooting: 0.22, tackling: 0.35, marking: 0.3, aerial: 0.72, composure: 0.76, discipline: 0.84, aggression: 0.42, workRate: 0.45, flair: 0.25, strength: 0.75 },
  CB: { pace: 0.66, accel: 0.7, stamina: 0.78, passing: 0.6, vision: 0.54, dribbling: 0.48, shooting: 0.32, tackling: 0.86, marking: 0.86, aerial: 0.88, composure: 0.7, discipline: 0.74, aggression: 0.76, workRate: 0.74, flair: 0.28, strength: 0.88 },
  RB: { pace: 0.86, accel: 0.86, stamina: 0.94, passing: 0.68, vision: 0.6, dribbling: 0.68, shooting: 0.38, tackling: 0.78, marking: 0.74, aerial: 0.52, composure: 0.62, discipline: 0.7, aggression: 0.72, workRate: 0.94, flair: 0.52, strength: 0.7 },
  LB: { pace: 0.86, accel: 0.86, stamina: 0.94, passing: 0.68, vision: 0.6, dribbling: 0.68, shooting: 0.38, tackling: 0.78, marking: 0.74, aerial: 0.52, composure: 0.62, discipline: 0.7, aggression: 0.72, workRate: 0.94, flair: 0.52, strength: 0.7 },
  DM: { pace: 0.66, accel: 0.72, stamina: 0.9, passing: 0.78, vision: 0.76, dribbling: 0.64, shooting: 0.48, tackling: 0.86, marking: 0.82, aerial: 0.7, composure: 0.84, discipline: 0.86, aggression: 0.68, workRate: 0.86, flair: 0.4, strength: 0.82 },
  CM: { pace: 0.72, accel: 0.76, stamina: 0.92, passing: 0.86, vision: 0.86, dribbling: 0.78, shooting: 0.64, tackling: 0.58, marking: 0.54, aerial: 0.48, composure: 0.78, discipline: 0.68, aggression: 0.54, workRate: 0.9, flair: 0.72, strength: 0.62 },
  RM: { pace: 0.93, accel: 0.94, stamina: 0.86, passing: 0.72, vision: 0.7, dribbling: 0.9, shooting: 0.68, tackling: 0.4, marking: 0.36, aerial: 0.34, composure: 0.6, discipline: 0.58, aggression: 0.44, workRate: 0.8, flair: 0.9, strength: 0.5 },
  LM: { pace: 0.93, accel: 0.94, stamina: 0.86, passing: 0.72, vision: 0.7, dribbling: 0.9, shooting: 0.68, tackling: 0.4, marking: 0.36, aerial: 0.34, composure: 0.6, discipline: 0.58, aggression: 0.44, workRate: 0.8, flair: 0.9, strength: 0.5 },
  RW: { pace: 0.95, accel: 0.95, stamina: 0.85, passing: 0.7, vision: 0.72, dribbling: 0.92, shooting: 0.72, tackling: 0.36, marking: 0.32, aerial: 0.32, composure: 0.62, discipline: 0.56, aggression: 0.42, workRate: 0.8, flair: 0.92, strength: 0.48 },
  LW: { pace: 0.95, accel: 0.95, stamina: 0.85, passing: 0.7, vision: 0.72, dribbling: 0.92, shooting: 0.72, tackling: 0.36, marking: 0.32, aerial: 0.32, composure: 0.62, discipline: 0.56, aggression: 0.42, workRate: 0.8, flair: 0.92, strength: 0.48 },
  ST: { pace: 0.9, accel: 0.9, stamina: 0.82, passing: 0.6, vision: 0.64, dribbling: 0.8, shooting: 0.9, tackling: 0.3, marking: 0.24, aerial: 0.78, composure: 0.86, discipline: 0.64, aggression: 0.56, workRate: 0.72, flair: 0.8, strength: 0.74 },
};

const ROLE_PACE = {
  GK: 5.5, CB: 7.0, RB: 7.6, LB: 7.6, DM: 7.2, CM: 7.3,
  RM: 7.7, LM: 7.7, RW: 8.0, LW: 8.0, ST: 8.1,
};

const rnd = () => Math.random();

function jitter(v, spread) {
  return Math.max(0.08, Math.min(0.99, v + (rnd() - 0.5) * spread));
}

/**
 * Build a full attribute set for one player.
 * `quality` nudges the whole profile (0.9 squad player .. 1.06 star).
 */
export function makeAttributes(role, quality = 1) {
  const base = ROLE_BASE[role] || ROLE_BASE.CM;
  const attrs = {};
  for (const [k, v] of Object.entries(base)) {
    attrs[k] = jitter(v * quality, 0.14);
  }
  // a couple of stand-out traits so squads feel uneven
  const trait = rnd();
  if (trait < 0.18) attrs.shooting = jitter(attrs.shooting + 0.16, 0.06);
  else if (trait < 0.36) attrs.vision = jitter(attrs.vision + 0.16, 0.06);
  else if (trait < 0.54) attrs.tackling = jitter(attrs.tackling + 0.14, 0.06);
  else if (trait < 0.72) attrs.dribbling = jitter(attrs.dribbling + 0.14, 0.06);
  else if (trait < 0.86) attrs.flair = jitter(attrs.flair + 0.18, 0.06);
  else attrs.discipline = jitter(attrs.discipline + 0.18, 0.06);

  const heightCm = role === 'GK' ? 186 + Math.round(rnd() * 10)
    : role === 'CB' ? 182 + Math.round(rnd() * 10)
    : role === 'ST' ? 176 + Math.round(rnd() * 14)
    : 170 + Math.round(rnd() * 15);

  return {
    ...attrs,
    maxSpeed: ROLE_PACE[role] * (0.93 + attrs.pace * 0.14),
    accel: (role === 'GK' ? 6.4 : 8.0) + attrs.accel * 3.4,
    heightCm,
    weightKg: 62 + attrs.strength * 26,
    // left-footed players get a slight finishing/technique flourish
    foot: rnd() < 0.24 ? 'left' : 'right',
  };
}

/** Rough overall for UI/debug. */
export function overall(attrs) {
  const keys = ['passing', 'vision', 'dribbling', 'shooting', 'tackling', 'marking', 'composure'];
  const sum = keys.reduce((s, k) => s + attrs[k], 0);
  return Math.round((sum / keys.length) * 99);
}

/** Grade label used in the HUD. */
export function grade(attrs) {
  const v = overall(attrs);
  if (v >= 82) return 'elite';
  if (v >= 74) return 'strong';
  if (v >= 66) return 'solid';
  return 'squad';
}
