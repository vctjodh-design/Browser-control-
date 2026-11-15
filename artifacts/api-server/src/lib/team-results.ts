import { fetchKickoffScoreJson } from './kickoffscore-match-details';
import { historyForTeam, recordHistory } from './match-history';
import { normalizeTeamName } from './team-shape';
import { parseTeamFixtures } from './team-fixtures-parse';
import { enqueueTeamDna } from './team-dna';

// Filling a team's window from the source, not from whichever dates the app happened
// to sweep.
//
// The history table is only ever as wide as the last sweep of dates, so a national
// side that played three matches inside it looked like a side that had played three
// matches. The feed answers for the team directly: one call for its last hundred
// fixtures, no date needed. That list is the window — clipped to the fifty matches
// before the kickoff being asked about — and each of those matches is then read for
// its detail. Once the results are stored, everything downstream (form, the window's
// vote, the DNA) is looking at fifty matches and does not know or care where they
// came from.

const TEAM_SEARCH_LIMIT = 8;
const FIXTURE_LIST_LIMIT = 100;

export type TeamDiscovery = {
  team: string;
  teamId: number | null;
  /** Matches the feed returned for the team, before any filtering. */
  listed: number;
  /** Matches kept: finished, before the kickoff, inside the window. */
  kept: number;
  /** Rows actually written; re-reading a team's list writes nothing new. */
  recorded: number;
  /** The window the team already had before this call. */
  hadBefore: number;
  /** True when the feed could not be asked (offline, rate limited, no such team). */
  failed: boolean;
  note: string;
};

type Row = Record<string, unknown>;

function asObject(value: unknown): Row | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Row) : null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function integer(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  if (typeof value === 'string' && /^-?\d+$/.test(value.trim())) return Number(value);
  return null;
}

/** The id the feed uses for a team, resolved by name and remembered for the session. */
const teamIdCache = new Map<string, number | null>();

export async function resolveTeamId(name: string): Promise<number | null> {
  const key = normalizeTeamName(name);
  if (teamIdCache.has(key)) return teamIdCache.get(key) ?? null;
  try {
    const payload = await fetchKickoffScoreJson('/api/teams', { search: name });
    const rows = Array.isArray(payload) ? payload.slice(0, TEAM_SEARCH_LIMIT) : [];
    const candidates = rows.flatMap((value) => {
      const row = asObject(value);
      const team = asObject(row?.team);
      const id = integer(team?.id) ?? integer(row?.apiId) ?? integer(row?._id);
      const found = text(team?.name) ?? text(row?.name);
      return id !== null && found ? [{ id, found }] : [];
    });
    // Only an exact name is trusted: "Inter" must never resolve to another club that
    // merely contains the word.
    const exact = candidates.find((candidate) => normalizeTeamName(candidate.found) === key);
    teamIdCache.set(key, exact?.id ?? null);
    return exact?.id ?? null;
  } catch {
    // Not remembered: a failed lookup is worth retrying, an absent team is not.
    return null;
  }
}

/**
 * Reads a team's own fixture list into history.
 *
 * This is the step that makes a window fifty matches rather than "whatever the date
 * sweep happened to cover". One feed call, idempotent, and safe to repeat: rows are
 * keyed by fixture, so a second pass writes nothing.
 */
export async function ingestTeamResults(
  team: string,
  asOf: string,
  depth = 50,
): Promise<TeamDiscovery> {
  const hadBefore = historyForTeam(team, asOf, depth).length;
  const teamId = await resolveTeamId(team);
  if (teamId === null) {
    return {
      team,
      teamId: null,
      listed: 0,
      kept: 0,
      recorded: 0,
      hadBefore,
      failed: true,
      note: `The feed has no team matching "${team}".`,
    };
  }
  try {
    const payload = await fetchKickoffScoreJson('/api/fixtures', {
      team: String(teamId),
      last: String(FIXTURE_LIST_LIMIT),
      summary: 'true',
    });
    const listed = Array.isArray(payload) ? payload.length : 0;
    const rows = parseTeamFixtures(payload, asOf, depth);
    const recorded = recordHistory(rows);
    return {
      team,
      teamId,
      listed,
      kept: rows.length,
      recorded,
      hadBefore,
      failed: false,
      note: rows.length
        ? `${rows.length} matches before ${asOf}, ${Math.max(0, rows.length - hadBefore)} of them new.`
        : `The feed listed ${listed} fixtures but none finished before ${asOf}.`,
    };
  } catch {
    return {
      team,
      teamId,
      listed: 0,
      kept: 0,
      recorded: 0,
      hadBefore,
      failed: true,
      note: `The feed could not be asked for ${team}'s matches.`,
    };
  }
}

/**
 * Discovery then reading, for the teams on a card.
 *
 * Run without being awaited: settling a card should not wait on two fixture lists,
 * and the detail reads behind them are a paced queue anyway. What matters is that a
 * team's window grows to fifty matches by itself the first time it is seen.
 */
export async function prepareTeamWindows(
  teams: string[],
  asOf: string,
  depth = 50,
): Promise<TeamDiscovery[]> {
  const discoveries: TeamDiscovery[] = [];
  for (const team of [...new Set(teams.filter((name) => name && name.trim().length > 1))]) {
    const discovery = await ingestTeamResults(team, asOf, depth);
    discoveries.push(discovery);
    // Queue a read whenever the window grew; a resolved team already fully read is
    // left alone, and the re-queue itself is free when nothing is missing.
    if (!discovery.failed && discovery.kept > discovery.hadBefore) {
      enqueueTeamDna([team], asOf, depth);
    }
  }
  return discoveries;
}
