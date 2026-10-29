import type {
  FootballLastFiveEvent,
  FootballLastFiveLineup,
  FootballLastFivePlayerGroup,
  FootballLastFiveTeamStatistics,
  FootballMatchReplayEvent,
} from "@workspace/api-zod";

type FixtureContext = {
  match: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
};

type SourcePlayer = {
  id?: number;
  name?: string;
  jerseyNumber?: number;
  competitorId?: number;
};

type SourceLineupMember = {
  id?: number;
  statusText?: string;
  position?: { name?: string };
  formation?: { name?: string; shortName?: string };
  ranking?: number;
  stats?: Array<{ name?: string; shortName?: string; value?: string | number }>;
  yardFormation?: { fieldLine?: number; fieldSide?: number };
};

type SourceTeam = {
  id?: number;
  lineups?: {
    formation?: string;
    members?: SourceLineupMember[];
  };
};

type SourceGame = {
  homeCompetitor?: SourceTeam;
  awayCompetitor?: SourceTeam;
  members?: SourcePlayer[] | Record<string, SourcePlayer>;
  events?: Array<{
    gameTime?: number;
    gameTimeDisplay?: string;
    order?: number;
    playerId?: number;
    competitorNum?: number;
    eventType?: { name?: string };
  }> | Record<string, {
    gameTime?: number;
    gameTimeDisplay?: string;
    order?: number;
    playerId?: number;
    competitorNum?: number;
    eventType?: { name?: string };
  }>;
};

type SourceStatsResponse = {
  statistics?: Array<{
    name?: string;
    value?: string | number;
    competitorId?: number;
  }>;
};

export type FootballMatchForensicsFallback = {
  halfTimeScore?: string | null;
  statistics: FootballLastFiveTeamStatistics[];
  events: FootballLastFiveEvent[];
  lineups: FootballLastFiveLineup[];
  players: FootballLastFivePlayerGroup[];
};

function entries<T>(value: T[] | Record<string, T> | undefined): T[] {
  if (!value) return [];
  return Array.isArray(value) ? value : Object.values(value);
}

function playerMap(game: SourceGame): Map<number, SourcePlayer> {
  return new Map(
    entries(game.members)
      .filter((player): player is SourcePlayer & { id: number } =>
        typeof player.id === "number",
      )
      .map((player) => [player.id, player]),
  );
}

function sourceSide(
  game: SourceGame,
  player: SourcePlayer | undefined,
  competitorNum: number | undefined,
): "home" | "away" | null {
  if (
    typeof player?.competitorId === "number" &&
    player.competitorId === game.homeCompetitor?.id
  ) return "home";
  if (
    typeof player?.competitorId === "number" &&
    player.competitorId === game.awayCompetitor?.id
  ) return "away";
  if (competitorNum === 1) return "home";
  if (competitorNum === 2) return "away";
  return null;
}

function forensicsStatistics(
  game: SourceGame,
  details: FixtureContext,
  responses: Array<{ label: string; response: SourceStatsResponse | null }>,
): FootballLastFiveTeamStatistics[] {
  const sourceHomeId = game.homeCompetitor?.id;
  const sourceAwayId = game.awayCompetitor?.id;
  if (typeof sourceHomeId !== "number" || typeof sourceAwayId !== "number") {
    return [];
  }
  const byTeam = new Map<number, FootballLastFiveTeamStatistics>();
  for (const { label, response } of responses) {
    for (const statistic of response?.statistics ?? []) {
      const statName = statistic.name?.trim();
      if (!statName || typeof statistic.competitorId !== "number") continue;
      const teamId = statistic.competitorId === sourceHomeId
        ? details.match.home.id
        : statistic.competitorId === sourceAwayId
          ? details.match.away.id
          : null;
      if (teamId === null) continue;
      const teamName = teamId === details.match.home.id
        ? details.match.home.name
        : details.match.away.name;
      const teamStats = byTeam.get(teamId) ?? {
        teamId,
        teamName,
        statistics: [],
      };
      teamStats.statistics.push({
        label: `${label} · ${statName}`,
        value: statistic.value ?? null,
      });
      byTeam.set(teamId, teamStats);
    }
  }
  return [...byTeam.values()];
}

function parseMinute(value: string | undefined): {
  minute: number | null;
  extraMinute: number | null;
} {
  const match = value?.match(/\b(\d{1,3})(?:\s*\+\s*(\d{1,2}))?/);
  return {
    minute: match ? Number(match[1]) : null,
    extraMinute: match?.[2] ? Number(match[2]) : null,
  };
}

function forensicsEvents(
  game: SourceGame,
  details: FixtureContext,
  commentary: FootballMatchReplayEvent[],
): FootballLastFiveEvent[] {
  const playersById = playerMap(game);
  const unusedCommentary = new Set(commentary.map((_, index) => index));
  const sourceEvents = entries(game.events).sort(
    (left, right) =>
      (left.gameTime ?? Number.MAX_SAFE_INTEGER) -
        (right.gameTime ?? Number.MAX_SAFE_INTEGER) ||
      (left.order ?? 0) - (right.order ?? 0),
  );
  const events = sourceEvents.map((event) => {
    const player = typeof event.playerId === "number"
      ? playersById.get(event.playerId)
      : undefined;
    const side = sourceSide(game, player, event.competitorNum);
    const teamId = side === "home"
      ? details.match.home.id
      : side === "away"
        ? details.match.away.id
        : null;
    const teamName = side === "home"
      ? details.match.home.name
      : side === "away"
        ? details.match.away.name
        : null;
    const time = parseMinute(
      event.gameTimeDisplay ??
        (typeof event.gameTime === "number" ? String(event.gameTime) : undefined),
    );
    const commentaryIndex = commentary.findIndex((entry, index) => {
      if (!unusedCommentary.has(index)) return false;
      const commentTime = parseMinute(entry.minute);
      return commentTime.minute === time.minute &&
        commentTime.extraMinute === time.extraMinute;
    });
    const comment = commentaryIndex >= 0
      ? commentary[commentaryIndex]
      : undefined;
    if (commentaryIndex >= 0) unusedCommentary.delete(commentaryIndex);
    const type = event.eventType?.name?.trim() || comment?.kind || "Match event";
    return {
      minute: time.minute,
      extraMinute: time.extraMinute,
      teamId,
      teamName,
      player: player?.name?.trim() || null,
      playerId: typeof event.playerId === "number" ? event.playerId : null,
      assist: null,
      assistId: null,
      type,
      detail: comment?.detail || null,
      comments: comment
        ? [comment.title, comment.detail].filter(Boolean).join(" — ")
        : null,
    };
  });

  for (const index of unusedCommentary) {
    const entry = commentary[index];
    if (!entry) continue;
    const time = parseMinute(entry.minute);
    const text = `${entry.title} ${entry.detail}`.toLocaleLowerCase();
    const homeName = details.match.home.name.toLocaleLowerCase();
    const awayName = details.match.away.name.toLocaleLowerCase();
    const side = text.includes(homeName)
      ? "home"
      : text.includes(awayName)
        ? "away"
        : null;
    events.push({
      minute: time.minute,
      extraMinute: time.extraMinute,
      teamId: side === "home"
        ? details.match.home.id
        : side === "away"
          ? details.match.away.id
          : null,
      teamName: side === "home"
        ? details.match.home.name
        : side === "away"
          ? details.match.away.name
          : null,
      player: null,
      playerId: null,
      assist: null,
      assistId: null,
      type: entry.kind,
      detail: entry.detail || null,
      comments: [entry.title, entry.detail].filter(Boolean).join(" — "),
    });
  }
  return events.sort((left, right) =>
    (left.minute ?? Number.MAX_SAFE_INTEGER) -
      (right.minute ?? Number.MAX_SAFE_INTEGER) ||
    (left.extraMinute ?? 0) - (right.extraMinute ?? 0),
  );
}

function forensicsLineupsAndPlayers(
  game: SourceGame,
  details: FixtureContext,
): {
  lineups: FootballLastFiveLineup[];
  players: FootballLastFivePlayerGroup[];
} {
  const playersById = playerMap(game);
  const teams = [
    {
      source: game.homeCompetitor,
      targetId: details.match.home.id,
      targetName: details.match.home.name,
    },
    {
      source: game.awayCompetitor,
      targetId: details.match.away.id,
      targetName: details.match.away.name,
    },
  ];
  const lineups: FootballLastFiveLineup[] = [];
  const players: FootballLastFivePlayerGroup[] = [];

  for (const { source, targetId, targetName } of teams) {
    const lineup = source?.lineups;
    if (!source || !lineup) continue;
    const members = lineup.members ?? [];
    const toLineupPlayer = (member: SourceLineupMember) => {
      const player = typeof member.id === "number"
        ? playersById.get(member.id)
        : undefined;
      const name = player?.name?.trim();
      if (!name) return null;
      const fieldLine = member.yardFormation?.fieldLine;
      const fieldSide = member.yardFormation?.fieldSide;
      return {
        id: typeof member.id === "number" ? member.id : null,
        name,
        number:
          typeof player?.jerseyNumber === "number" &&
          Number.isInteger(player.jerseyNumber)
            ? player.jerseyNumber
            : null,
        position:
          member.position?.name?.trim() ||
          member.formation?.shortName?.trim() ||
          member.formation?.name?.trim() ||
          null,
        grid:
          typeof fieldLine === "number" && typeof fieldSide === "number"
            ? `${fieldLine}:${fieldSide}`
            : null,
      };
    };
    const starters = members
      .filter((member) => member.statusText === "Starting")
      .map(toLineupPlayer)
      .filter((player): player is NonNullable<typeof player> => player !== null);
    const substitutes = members
      .filter((member) => member.statusText === "Substitute")
      .map(toLineupPlayer)
      .filter((player): player is NonNullable<typeof player> => player !== null);
    lineups.push({
      teamId: targetId,
      teamName: targetName,
      formation: lineup.formation?.trim() || null,
      coach: null,
      coachId: null,
      starters,
      substitutes,
    });

    const teamPlayers = members.flatMap((member) => {
      const player = typeof member.id === "number"
        ? playersById.get(member.id)
        : undefined;
      const name = player?.name?.trim();
      if (!name) return [];
      return [{
        id: typeof member.id === "number" ? member.id : null,
        name,
        photo: null,
        number:
          typeof player?.jerseyNumber === "number" &&
          Number.isInteger(player.jerseyNumber)
            ? player.jerseyNumber
            : null,
        position:
          member.position?.name?.trim() ||
          member.formation?.shortName?.trim() ||
          member.formation?.name?.trim() ||
          null,
        rating:
          typeof member.ranking === "number" && Number.isFinite(member.ranking)
            ? member.ranking.toFixed(1)
            : null,
        statistics: (member.stats ?? []).flatMap((stat) => {
          const label = stat.name?.trim() || stat.shortName?.trim();
          return label ? [{ label, value: stat.value ?? null }] : [];
        }),
      }];
    });
    if (teamPlayers.length) {
      players.push({ teamId: targetId, teamName: targetName, players: teamPlayers });
    }
  }
  return { lineups, players };
}

export function build365ScoresForensicsFallback(
  game: SourceGame,
  details: FixtureContext,
  fullStatsResponse: SourceStatsResponse | null,
  firstHalfStatsResponse: SourceStatsResponse | null,
  secondHalfStatsResponse: SourceStatsResponse | null,
  commentary: FootballMatchReplayEvent[],
): FootballMatchForensicsFallback {
  const { lineups, players } = forensicsLineupsAndPlayers(game, details);
  return {
    statistics: forensicsStatistics(game, details, [
      { label: "Full match", response: fullStatsResponse },
      { label: "1st half", response: firstHalfStatsResponse },
      { label: "2nd half", response: secondHalfStatsResponse },
    ]),
    events: forensicsEvents(game, details, commentary),
    lineups,
    players,
  };
}
