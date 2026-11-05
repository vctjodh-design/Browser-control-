// Applies what the players actually did — and who is unavailable — to the
// predicted elevens, without changing the profile the rest of the page reads.
//
// Two things happen here:
//
// 1. Availability. Anyone the feed lists as injured, doubtful or suspended is
//    taken out of the eleven before the engine sees it, and replaced by the
//    best available substitute in the same band of the pitch. The bench stays
//    the bench: a keeper replaces a keeper, a defender a defender.
//
// 2. Weights. Every remaining player carries the additive adjustments his own
//    match history argues for (see player-form.ts). They travel with him into
//    the engine, where they are added to the skills his level gave him.
import type { SimFormProfile, SimLineupPlayer, SimTeamProfile } from "./sim-form-profile";
import {
  loadFixturePlayerForm,
  nameSimilarity,
  type FotMobMatchForm,
  type PlayerFormPlayer,
  type PlayerFormWeights,
} from "./player-form";

export type AvailabilityNote = {
  name: string;
  kind: "injury" | "suspension" | "other";
  expectedReturn: string | null;
  replacement: string | null;
};

export type AppliedPlayerForm = {
  form: FotMobMatchForm | null;
  /** Set when the player feed could not be read for this fixture. */
  note: string | null;
};

type Band = "GK" | "DEF" | "MID" | "FWD";

function bandOf(role: string | null | undefined): Band {
  const value = (role ?? "").toUpperCase();
  if (value.startsWith("GK")) return "GK";
  if (value.startsWith("D") || value === "LB" || value === "RB" || value === "CB") return "DEF";
  if (value.startsWith("M") || value === "DM" || value === "CM" || value === "LM" || value === "RM") {
    return "MID";
  }
  return "FWD";
}

function matchFormTeam(
  form: FotMobMatchForm,
  team: SimTeamProfile,
): { players: Map<number, PlayerFormPlayer>; byName: (name: string) => PlayerFormPlayer | null } {
  const side =
    form.teams
      .map((candidate) => ({ candidate, score: nameSimilarity(candidate.name, team.name) }))
      .sort((left, right) => right.score - left.score)[0]?.candidate ?? form.teams[0];

  const byName = (name: string): PlayerFormPlayer | null => {
    let best: { player: PlayerFormPlayer; score: number } | null = null;
    for (const player of side.players) {
      const score = nameSimilarity(player.name, name);
      if (!best || score > best.score) best = { player, score };
    }
    return best && best.score >= 0.62 ? best.player : null;
  };

  const players = new Map<number, PlayerFormPlayer>();
  for (const player of side.players) players.set(player.playerId, player);
  return { players, byName };
}

/** A player's weights, or neutral when the feed has never seen him play. */
function weightsFor(player: PlayerFormPlayer | null): PlayerFormWeights {
  if (!player) return { skills: {}, level: 0, games: 0, rating: null, trend: null, notes: [] };
  return player.weights;
}

function withForm(player: SimLineupPlayer, form: PlayerFormPlayer | null): SimLineupPlayer {
  if (!form) return player;
  return {
    ...player,
    form: weightsFor(form),
    formRating: form.rating,
    formMinutes: form.minutes,
    formGames: form.weights.games,
  };
}

/**
 * Rebuild one side's eleven with the unavailable players replaced.
 *
 * Only a player the feed says cannot play is moved; the rest of the predicted
 * lineup keeps the order and slots the form model gave it, so the shape does
 * not change just because someone is injured.
 */
function applyAvailability(
  team: SimTeamProfile,
  byName: (name: string) => PlayerFormPlayer | null,
  unavailable: { playerId: number; name: string; kind: AvailabilityNote["kind"]; expectedReturn: string | null }[],
): SimTeamProfile {
  const isOut = (player: SimLineupPlayer): AvailabilityNote["kind"] | null => {
    let best: { kind: AvailabilityNote["kind"]; score: number } | null = null;
    for (const entry of unavailable) {
      const score = nameSimilarity(entry.name, player.name);
      if (score >= 0.82 && (!best || score > best.score)) best = { kind: entry.kind, score };
    }
    return best?.kind ?? null;
  };

  const notes: AvailabilityNote[] = [];
  const bench = [...team.bench];
  const lineup = team.lineup.map((player) => {
    const kind = isOut(player);
    if (!kind) return withForm(player, byName(player.name));
    const band = bandOf(player.role);
    // A like-for-like replacement first. When the bench has none — a club with
    // one keeper and a keeper ruled out — the best available substitute plays
    // out of position rather than the ruled-out man playing at all.
    let index = bench.findIndex((candidate) => isOut(candidate) === null && bandOf(candidate.role) === band);
    if (index < 0) index = bench.findIndex((candidate) => isOut(candidate) === null);
    const replacement = index >= 0 ? bench.splice(index, 1)[0] : null;
    notes.push({
      name: player.name,
      kind,
      expectedReturn: unavailable.find((entry) => nameSimilarity(entry.name, player.name) >= 0.82)?.expectedReturn ?? null,
      replacement: replacement?.name ?? null,
    });
    return withForm(replacement ?? player, byName(replacement?.name ?? player.name));
  });

  for (const entry of unavailable) {
    if (notes.some((note) => nameSimilarity(note.name, entry.name) >= 0.82)) continue;
    notes.push({ name: entry.name, kind: entry.kind, expectedReturn: entry.expectedReturn, replacement: null });
  }

  return {
    ...team,
    lineup,
    bench: bench.filter((player) => isOut(player) === null).map((player) => withForm(player, byName(player.name))),
    unavailable: notes,
  };
}

const applied = new Map<string, Promise<AppliedPlayerForm>>();

/**
 * The profile with availability and form applied.
 *
 * Returns a copy: the profile the live page and the odds board read is left
 * exactly as it was. Cached per (fixture, observedAt) so the replay and the
 * viewer cannot disagree about who is playing.
 */
export async function applyPlayerForm(profile: SimFormProfile): Promise<{
  profile: SimFormProfile;
  applied: AppliedPlayerForm;
}> {
  const key = `${profile.fixtureId}:${profile.observedAt}`;
  const cached = applied.get(key);
  if (cached) {
    const result = await cached;
    return { profile: result.form ? applyNow(profile, result.form) : profile, applied: result };
  }

  const pending = (async (): Promise<AppliedPlayerForm> => {
    try {
      const form = await loadFixturePlayerForm(
        profile.fixtureId,
        profile.teams[0].name,
        profile.teams[1].name,
      );
      return { form, note: null };
    } catch (error) {
      return {
        form: null,
        note:
          error instanceof Error
            ? error.message
            : "Player ratings could not be read for this fixture.",
      };
    }
  })();

  applied.set(key, pending);
  if (applied.size > 24) {
    const oldest = applied.keys().next().value;
    if (oldest !== undefined) applied.delete(oldest);
  }

  const result = await pending;
  return { profile: result.form ? applyNow(profile, result.form) : profile, applied: result };
}

function applyNow(profile: SimFormProfile, form: FotMobMatchForm): SimFormProfile {
  const teams = profile.teams.map((team, index) => {
    const mapped = matchFormTeam(form, team);
    const side =
      form.teams
        .map((candidate) => ({ candidate, score: nameSimilarity(candidate.name, team.name) }))
        .sort((left, right) => right.score - left.score)[0]?.candidate ?? form.teams[index] ?? form.teams[0];
    return applyAvailability(team, mapped.byName, side.unavailable);
  }) as [SimTeamProfile, SimTeamProfile];

  return { ...profile, teams };
}
