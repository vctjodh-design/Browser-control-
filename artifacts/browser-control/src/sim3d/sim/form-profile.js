// Turns the host page's form profile into engine inputs.
//
// The profile is descriptive: it carries recent results, the way each club
// actually plays and the XI their team sheets point to. Nothing in here picks a
// winner. Players start from their role's base attributes and are nudged by
// what they have actually done (shot value, passing value, duel win rates,
// ratings), and teams press and push the line the way their own matches say
// they do.

let profile = null;

const SIGNAL_TARGETS = {
  finishing: [['shooting', 0.34], ['composure', 0.08]],
  creation: [['passing', 0.24], ['vision', 0.2]],
  retention: [['dribbling', 0.26], ['flair', 0.24]],
  defending: [['tackling', 0.3], ['marking', 0.28]],
  duels: [['aerial', 0.24], ['strength', 0.18]],
  discipline: [['discipline', 0.4]],
  activity: [['stamina', 0.16], ['workRate', 0.18]],
  goalkeeping: [['composure', 0.16]],
  // Match intelligence: players who keep the ball, find team-mates and stay
  // out of trouble read the game better, so they see more and panic less.
  intelligence: [['vision', 0.2], ['composure', 0.14], ['marking', 0.1], ['discipline', 0.08]],
};

/** Flatten the profile's trait signals into attribute deltas. */
export function attributeBias(signals) {
  if (!signals) return null;
  const bias = {};
  for (const [signal, targets] of Object.entries(SIGNAL_TARGETS)) {
    const value = signals[signal];
    if (typeof value !== 'number') continue;
    const centred = Math.max(-1, Math.min(1, (value - 0.5) * 2));
    for (const [attribute, weight] of targets) {
      bias[attribute] = (bias[attribute] ?? 0) + centred * weight;
    }
  }
  return bias;
}

export function setFormProfile(value) {
  profile = value && Array.isArray(value.teams) && value.teams.length >= 2 ? value : null;
  return profile;
}

export function getFormProfile() {
  return profile;
}

/**
 * Ready-to-use setup for one side, or null when the host supplied nothing
 * usable for it. `slots` are the usual `{ role, nx, nz }` formation entries.
 */
export function teamSetup(index) {
  const team = profile?.teams?.[index];
  if (!team) return null;
  const slots = Array.isArray(team.slots) ? team.slots : [];
  const lineup = Array.isArray(team.lineup) ? team.lineup : [];
  if (slots.length !== 11 || lineup.length !== 11) return null;

  const tactics = team.tactics && typeof team.tactics.press === 'number'
    ? team.tactics
    : null;

  return {
    slots,
    lineup,
    tactics,
    formation: team.formation ?? null,
    formationSource: team.formationSource ?? null,
    squadQuality: typeof team.squadQuality === 'number' ? team.squadQuality : 1,
    table: team.table ?? null,
    record: team.record ?? null,
    sample: team.lineupSample ?? null,
    name: team.name ?? null,
    short: team.short ?? null,
  };
}

/** Short form string (newest last) for the scoreboard/banner copy. */
export function recentForm(index, games = 5) {
  const record = profile?.teams?.[index]?.record;
  if (!record || typeof record.form !== 'string' || !record.form) return '';
  return record.form.slice(-games);
}

/** One-line description of where the inputs came from. */
export function profileBasis() {
  if (!profile) return null;
  const sample = Math.max(...profile.teams.map((team) => team.lineupSample ?? 0));
  return {
    formGames: profile.formGames ?? null,
    detailGames: profile.detailGames ?? null,
    lineupSample: sample,
  };
}
