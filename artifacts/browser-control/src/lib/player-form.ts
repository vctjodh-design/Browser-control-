// Client-side reader for what the players actually did.
//
// The server keeps one row per player per match: the rating the feed gave him,
// his minutes, his stat block, the coordinates of his shots and his heat map.
// Here we just fetch it for one fixture, plus (on demand) every match the feed
// has for one player.

export type PlayerFormShot = {
  minute: number | null;
  x: number;
  y: number;
  expectedGoals: number | null;
  expectedGoalsOnTarget: number | null;
  onTarget: boolean;
  blocked: boolean;
  insideBox: boolean;
  situation: string | null;
  bodyPart: string | null;
  outcome: string;
};

export type PlayerHeatPoint = { x: number; y: number; intensity: number };

export type PlayerFormWeights = {
  skills: Record<string, number>;
  level: number;
  games: number;
  rating: number | null;
  trend: number | null;
  notes: string[];
};

export type PlayerFormEntry = {
  playerId: number;
  name: string;
  shirt: number | null;
  starter: boolean;
  rating: number | null;
  minutes: number;
  stats: Record<string, number | null>;
  shots: PlayerFormShot[];
  heat: PlayerHeatPoint[];
  weights: PlayerFormWeights;
};

export type PlayerFormSide = {
  name: string;
  formation: string | null;
  unavailable: { playerId: number; name: string; kind: 'injury' | 'suspension' | 'other'; expectedReturn: string | null }[];
  players: PlayerFormEntry[];
};

export type FixturePlayerForm = {
  fixtureId: number;
  source: string;
  matchId: number;
  date: string;
  teams: [PlayerFormSide, PlayerFormSide];
  error?: string;
};

export type PlayerMatchLogEntry = {
  matchId: number;
  date: string;
  opponent: string;
  home: boolean;
  minutes: number;
  rating: number | null;
  goals: number;
  assists: number;
  league: string;
};

async function readJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/football/${path}`, { signal });
  if (!response.ok) {
    let message = `The player feed answered ${response.status}.`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // Keep the status message.
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export function loadFixturePlayerForm(fixtureId: number, signal?: AbortSignal): Promise<FixturePlayerForm> {
  return readJson<FixturePlayerForm>(`matches/${fixtureId}/player-form`, signal);
}

export function loadPlayerMatches(
  playerId: number,
  signal?: AbortSignal,
): Promise<{ playerId: number; matches: PlayerMatchLogEntry[]; weights: PlayerFormWeights }> {
  return readJson(`players/${playerId}/matches`, signal);
}

/** The numbers the card shows first, labelled the way football labels them. */
export const TOP_STATS: { key: string; label: string; suffix?: string }[] = [
  { key: 'minutes_played', label: 'Min' },
  { key: 'goals', label: 'Goals' },
  { key: 'assists', label: 'Assists' },
  { key: 'expected_goals', label: 'xG' },
  { key: 'expected_assists', label: 'xA' },
  { key: 'total_shots', label: 'Shots' },
  { key: 'chances_created', label: 'Chances' },
  { key: 'accurate_passes', label: 'Passes' },
  { key: 'tackles', label: 'Tackles' },
  { key: 'interceptions', label: 'Interceptions' },
  { key: 'duels_won', label: 'Duels won' },
  { key: 'saves', label: 'Saves' },
  { key: 'goals_prevented', label: 'Goals prevented' },
  { key: 'aerial_duels_won', label: 'Aerials' },
];

/** A rating's colour, the way every scores app does it. */
export function ratingTone(rating: number | null): string {
  if (rating === null) return 'border-[#334b5d] bg-[#22384a] text-[#8ba39c]';
  if (rating >= 8) return 'border-[#3f7f6a] bg-[#255445] text-[#b6f0d3]';
  if (rating >= 7) return 'border-[#3d6156] bg-[#25463c] text-[#cdf0de]';
  if (rating >= 6) return 'border-[#5b6537] bg-[#3d4526] text-[#e2ecc0]';
  return 'border-[#7a4a3a] bg-[#3a2320] text-[#f0d3cb]';
}
