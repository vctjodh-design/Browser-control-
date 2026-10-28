export const RECENT_MATCH_STAT_FEATURE_COUNT = 14;

type JsonObject = Record<string, unknown>;
type HalfStats = {
  matches: number;
  shots: number[];
  shotsOnTarget: number[];
  possession: number[];
};

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonObject
    : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const cleaned = value.trim().replace(/,/g, "").replace(/%$/, "");
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalize(value: unknown): string {
  return typeof value === "string"
    ? value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "")
    : "";
}

function withinCutoff(value: unknown, cutoff: number): boolean {
  if (!Number.isFinite(cutoff)) return true;
  const date = value instanceof Date
    ? value.getTime()
    : typeof value === "string"
      ? Date.parse(value)
      : Number.NaN;
  return Number.isFinite(date) && date < cutoff;
}

function teamMatches(group: JsonObject, teamId: number | null, teamName: string): boolean {
  const groupId = number(group.teamId);
  if (teamId !== null && groupId !== null) return teamId === groupId;
  return normalize(group.teamName) === normalize(teamName);
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function scaled(value: number, maximum: number): number {
  return Math.max(0, Math.min(1, value / maximum));
}

function periodFor(label: string): "first" | "second" | null {
  if (/^(?:1st|first)half/.test(label)) return "first";
  if (/^(?:2nd|second)half/.test(label)) return "second";
  return null;
}

/**
 * Summarize the team's source-provided recent-match stats as a fixed-size,
 * normalized vector for model inputs. The cutoff is strict to prevent target
 * match or future data from entering pre-match features.
 */
export function summarizeRecentMatchStatFeatures(
  lastFivePayload: unknown,
  side: "home" | "away",
  targetDate?: string | Date,
): number[] {
  const sideData = object(object(lastFivePayload)[side]);
  const team = object(sideData.team);
  const teamId = number(team.id);
  const teamName = typeof team.name === "string" ? team.name : "";
  const cutoff = targetDate instanceof Date
    ? targetDate.getTime()
    : typeof targetDate === "string"
      ? Date.parse(targetDate)
      : Number.NaN;
  const matches = array(sideData.matches)
    .map(object)
    .filter((wrapper) => withinCutoff(object(wrapper.match).date, cutoff))
    .slice(0, 5);

  const firstHalf: HalfStats = { matches: 0, shots: [], shotsOnTarget: [], possession: [] };
  const secondHalf: HalfStats = { matches: 0, shots: [], shotsOnTarget: [], possession: [] };
  let playerMatchCount = 0;
  let ratedPlayerCount = 0;
  const ratings: number[] = [];
  const goalsByMatch: number[] = [];
  const assistsByMatch: number[] = [];

  for (const wrapper of matches) {
    const matchStatistics = array(wrapper.statistics)
      .map(object)
      .find((entry) => teamMatches(entry, teamId, teamName));
    const periodValues = {
      first: { shots: null as number | null, shotsOnTarget: null as number | null, possession: null as number | null },
      second: { shots: null as number | null, shotsOnTarget: null as number | null, possession: null as number | null },
    };

    for (const statisticValue of array(matchStatistics?.statistics)) {
      const statistic = object(statisticValue);
      const label = normalize(statistic.label);
      const period = periodFor(label);
      const value = number(statistic.value);
      if (!period || value === null) continue;
      const target = periodValues[period];
      if (label.includes("possession")) target.possession = value;
      else if (label.includes("shotsongoal") || label.includes("shotsontarget")) {
        target.shotsOnTarget = value;
      } else if (label.includes("totalshots") || label.endsWith("shots")) {
        target.shots = value;
      }
    }

    for (const [period, values] of Object.entries(periodValues) as [
      "first" | "second",
      typeof periodValues.first,
    ][]) {
      const summary = period === "first" ? firstHalf : secondHalf;
      const hasAny = values.shots !== null || values.shotsOnTarget !== null || values.possession !== null;
      if (hasAny) summary.matches += 1;
      if (values.shots !== null) summary.shots.push(values.shots);
      if (values.shotsOnTarget !== null) summary.shotsOnTarget.push(values.shotsOnTarget);
      if (values.possession !== null) summary.possession.push(values.possession);
    }

    const playerGroups = array(wrapper.players)
      .map(object)
      .filter((group) => teamMatches(group, teamId, teamName));
    let hasPlayerData = false;
    let matchGoals = 0;
    let matchAssists = 0;
    let hasGoalStats = false;
    let hasAssistStats = false;
    for (const group of playerGroups) {
      for (const playerValue of array(group.players)) {
        const player = object(playerValue);
        hasPlayerData = true;
        const rating = number(player.rating);
        if (rating !== null) {
          ratings.push(rating);
          ratedPlayerCount += 1;
        }
        for (const statisticValue of array(player.statistics)) {
          const statistic = object(statisticValue);
          const label = normalize(statistic.label);
          const value = number(statistic.value);
          if (value === null) continue;
          if (label.includes("assist")) {
            matchAssists += value;
            hasAssistStats = true;
          } else if (label.includes("goal") && !label.includes("goalkeeper")) {
            matchGoals += value;
            hasGoalStats = true;
          }
        }
      }
    }
    if (hasPlayerData) playerMatchCount += 1;
    if (hasGoalStats) goalsByMatch.push(matchGoals);
    if (hasAssistStats) assistsByMatch.push(matchAssists);
  }

  const matchCount = matches.length;
  return [
    scaled(matchCount, 5),
    scaled(firstHalf.matches, 5),
    scaled(mean(firstHalf.shots), 40),
    scaled(mean(firstHalf.shotsOnTarget), 20),
    scaled(mean(firstHalf.possession), 100),
    scaled(secondHalf.matches, 5),
    scaled(mean(secondHalf.shots), 40),
    scaled(mean(secondHalf.shotsOnTarget), 20),
    scaled(mean(secondHalf.possession), 100),
    scaled(playerMatchCount, 5),
    scaled(mean(ratings), 10),
    scaled(ratedPlayerCount, Math.max(1, matchCount * 11)),
    scaled(mean(goalsByMatch), 5),
    scaled(mean(assistsByMatch), 5),
  ];
}
