import { archiveDatabase } from './decision-store';
import { getHistoricalMatchSnapshot } from './kickoffscore-last-five';
import { historyForTeam } from './match-history';
import { normalizeTeamName } from './team-shape';
import { summarizeDna, type DnaMatch, type TeamDna } from './team-dna-math';

// Reading a team's last fifty matches properly.
//
// One match page on the feed carries the whole story of that match: expected goals
// for both sides, shots, big chances taken and missed, possession, duels, cards,
// the timeline of every goal with its minute, the lineups, and a rating for every
// player. That is what this stores — a row per match per team — so the DNA of a
// side is arithmetic over its own matches rather than a season average.
//
// It is not cheap: one call per match, and fifty matches per team. So it runs as a
// queue, paced, resumed after a restart, and it never re-reads a match it already
// has.

export type DnaQueueState = 'queued' | 'reading' | 'done' | 'failed';

export type DnaStatus = {
  running: boolean;
  current: string | null;
  queued: number;
  done: number;
  failed: number;
  matchesStored: number;
  teamsStored: number;
  lastNote: string | null;
};

const DEFAULT_DEPTH = 50;
const MAX_DEPTH = 60;
const MAX_ATTEMPTS = 3;
const GAP_MS = 900;

let timer: ReturnType<typeof setInterval> | null = null;
let working = false;
let current: string | null = null;
let lastNote: string | null = null;

type StatRow = { label: string; value: unknown };

type SnapshotTeamStats = {
  teamId: number | null;
  teamName: string;
  statistics: StatRow[];
};

type SnapshotPlayerGroup = {
  teamId?: number | null;
  teamName?: string;
  players?: Array<{
    rating?: unknown;
    statistics?: StatRow[];
  }>;
};

type SnapshotEvent = {
  minute?: unknown;
  teamName?: unknown;
  teamId?: unknown;
  type?: unknown;
  detail?: unknown;
};

function schema(): void {
  const handle = archiveDatabase();
  if (!handle) return;
  try {
    handle.exec(`
      CREATE TABLE IF NOT EXISTS team_match_detail (
        fixture_id INTEGER NOT NULL,
        match_date TEXT NOT NULL,
        competition TEXT NOT NULL DEFAULT '',
        team_key TEXT NOT NULL,
        team_name TEXT NOT NULL,
        opponent_name TEXT NOT NULL DEFAULT '',
        venue TEXT NOT NULL,
        goals_for INTEGER NOT NULL,
        goals_against INTEGER NOT NULL,
        xg_for REAL,
        xg_against REAL,
        shots_for REAL,
        sot_for REAL,
        big_chances_for REAL,
        big_missed_for REAL,
        possession_for REAL,
        pass_acc_for REAL,
        corners_for REAL,
        fouls_for REAL,
        yellow_for REAL,
        red_for REAL,
        saves_for REAL,
        scored_phases TEXT NOT NULL DEFAULT '[]',
        conceded_phases TEXT NOT NULL DEFAULT '[]',
        led INTEGER,
        trailed INTEGER,
        rating REAL,
        starters_kept REAL,
        fetched_at INTEGER NOT NULL,
        PRIMARY KEY (fixture_id, team_key)
      );
      CREATE INDEX IF NOT EXISTS team_match_detail_team ON team_match_detail (team_key, match_date);
      CREATE TABLE IF NOT EXISTS dna_queue (
        team_key TEXT PRIMARY KEY,
        team_name TEXT NOT NULL,
        as_of TEXT NOT NULL,
        depth INTEGER NOT NULL,
        state TEXT NOT NULL DEFAULT 'queued',
        attempts INTEGER NOT NULL DEFAULT 0,
        note TEXT,
        updated_at INTEGER NOT NULL
      );
    `);
  } catch {
    // A read-only volume leaves the DNA empty and the app working.
  }
}

function rawNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const cleaned = value.trim().replace(/,/g, '').replace(/%$/, '');
  if (!/^-?\d+(?:\.\d+)?$/.test(cleaned)) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

/** "Full match · expected_goals" and "1st half · Total Shots" in one lookup. */
function statLookup(rows: StatRow[]): (name: string, half?: 'full' | 1 | 2) => number | null {
  const table = new Map<string, number>();
  for (const row of rows) {
    const label = String(row.label ?? '');
    const [phase, name] = label.split('·').map((part) => part.trim());
    if (!phase || !name) continue;
    const value = rawNumber(row.value);
    if (value === null) continue;
    const key = `${phase.toLowerCase()}|${name.toLowerCase()}`;
    if (!table.has(key)) table.set(key, value);
  }
  return (name, half = 'full') => {
    const phase = half === 'full' ? 'full match' : half === 1 ? '1st half' : '2nd half';
    return table.get(`${phase}|${name.toLowerCase()}`) ?? null;
  };
}

function phaseOf(minute: number): number {
  if (minute <= 15) return 0;
  if (minute <= 30) return 1;
  if (minute <= 45) return 2;
  if (minute <= 60) return 3;
  if (minute <= 75) return 4;
  return 5;
}

const GOAL_TYPES = new Set(['goal', 'own goal', 'penalty', 'penalty - scored']);

function minuteOf(event: SnapshotEvent): number | null {
  const minute = rawNumber(event.minute);
  return minute === null ? null : Math.max(0, Math.min(120, Math.round(minute)));
}

function isGoal(event: SnapshotEvent): boolean {
  const type = String(event.type ?? '').toLowerCase();
  const detail = String(event.detail ?? '').toLowerCase();
  if (type === 'goal') return true;
  return GOAL_TYPES.has(detail) && !detail.includes('missed');
}

/** Which side put the ball in the net, own goals credited to the other side. */
function goalSide(event: SnapshotEvent, homeName: string): 'home' | 'away' | null {
  const detail = String(event.detail ?? '').toLowerCase();
  const team = String(event.teamName ?? '');
  if (!team) return null;
  const scoredBy = normalizeTeamName(team) === normalizeTeamName(homeName) ? 'home' : 'away';
  if (!detail.includes('own')) return scoredBy;
  return scoredBy === 'home' ? 'away' : 'home';
}

type ParsedMatch = {
  homeName: string;
  awayName: string;
  homeScore: number;
  awayScore: number;
  goals: Array<{ minute: number; side: 'home' | 'away' }>;
  stats: Map<string, SnapshotTeamStats>;
  ratings: Map<string, number | null>;
  starters: Map<string, string[]>;
  date: string;
  competition: string;
};

function parseSnapshot(fixtureId: number, snapshot: unknown): ParsedMatch | null {
  const payload = snapshot as {
    statistics?: SnapshotTeamStats[];
    players?: SnapshotPlayerGroup[];
    events?: SnapshotEvent[];
    lineups?: Array<{ teamName?: string; players?: Array<{ name?: string }> }>;
  };
  const statistics = Array.isArray(payload.statistics) ? payload.statistics : [];
  if (!statistics.length) return null;

  const homeName = String(statistics[0]?.teamName ?? '');
  const awayName = String(statistics[1]?.teamName ?? '');
  if (!homeName || !awayName) return null;

  const shortName = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 3).map((part) => part[0]).join('').toUpperCase();
  const date = String(
    (snapshot as { match?: { date?: string } }).match?.date ??
      (snapshot as { date?: string }).date ??
      '',
  ).slice(0, 10);

  const events = Array.isArray(payload.events) ? payload.events : [];
  const goals = events
    .filter(isGoal)
    .flatMap((event) => {
      const minute = minuteOf(event);
      const side = goalSide(event, homeName);
      return minute === null || !side ? [] : [{ minute, side }];
    })
    .sort((a, b) => a.minute - b.minute);

  const homeScore = goals.filter((goal) => goal.side === 'home').length;
  const awayScore = goals.filter((goal) => goal.side === 'away').length;

  const stats = new Map<string, SnapshotTeamStats>();
  stats.set(normalizeTeamName(homeName), statistics[0]);
  stats.set(normalizeTeamName(awayName), statistics[1]);

  const ratings = new Map<string, number | null>();
  for (const group of Array.isArray(payload.players) ? payload.players : []) {
    const name = String(group?.teamName ?? '');
    if (!name) continue;
    const values = (group.players ?? []).flatMap((player) => {
      const minutes = rawNumber(
        (player.statistics ?? []).find((row) => String(row.label).toLowerCase().includes('minutes'))?.value,
      );
      const rating = rawNumber(player.rating);
      if (rating === null || rating <= 0) return [];
      if (minutes !== null && minutes < 45) return [];
      return [rating];
    });
    ratings.set(
      normalizeTeamName(name),
      values.length ? Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100 : null,
    );
  }

  const starters = new Map<string, string[]>();
  for (const lineup of Array.isArray(payload.lineups) ? payload.lineups : []) {
    const name = String(lineup?.teamName ?? '');
    if (!name) continue;
    starters.set(
      normalizeTeamName(name),
      (lineup.players ?? []).map((player) => String(player?.name ?? '')).filter(Boolean),
    );
  }

  return {
    homeName,
    awayName,
    homeScore,
    awayScore,
    goals,
    stats,
    ratings,
    starters,
    date,
    competition: '',
  };
}

type DetailRow = {
  fixtureId: number;
  matchDate: string;
  competition: string;
  teamKey: string;
  teamName: string;
  opponentName: string;
  venue: 'home' | 'away';
  goalsFor: number;
  goalsAgainst: number;
  xgFor: number | null;
  xgAgainst: number | null;
  shotsFor: number | null;
  shotsOnTargetFor: number | null;
  bigChancesFor: number | null;
  bigChancesMissedFor: number | null;
  possessionFor: number | null;
  passAccuracyFor: number | null;
  cornersFor: number | null;
  foulsFor: number | null;
  yellowFor: number | null;
  redFor: number | null;
  savesFor: number | null;
  scoredPhases: number[];
  concededPhases: number[];
  ledAtSomePoint: boolean | null;
  trailedAtSomePoint: boolean | null;
  rating: number | null;
  startersKept: number | null;
};

/**
 * Turns one fetched match into a row per side: what each team did, and what was
 * done to it, taken from the other side's own statistics rather than inferred.
 */
export function detailRowsForMatch(
  fixtureId: number,
  snapshot: unknown,
  matchDate: string,
  competition = '',
): DetailRow[] {
  const parsed = parseSnapshot(fixtureId, snapshot);
  if (!parsed) return [];
  const date = matchDate || parsed.date;

  const build = (venue: 'home' | 'away'): DetailRow => {
    const ownName = venue === 'home' ? parsed.homeName : parsed.awayName;
    const otherName = venue === 'home' ? parsed.awayName : parsed.homeName;
    const ownKey = normalizeTeamName(ownName);
    const otherKey = normalizeTeamName(otherName);
    const own = parsed.stats.get(ownKey);
    const other = parsed.stats.get(otherKey);
    const ownStat = statLookup(own?.statistics ?? []);
    const otherStat = statLookup(other?.statistics ?? []);

    const goalsFor = venue === 'home' ? parsed.homeScore : parsed.awayScore;
    const goalsAgainst = venue === 'home' ? parsed.awayScore : parsed.homeScore;

    const scoredPhases = Array.from({ length: 6 }, () => 0);
    const concededPhases = Array.from({ length: 6 }, () => 0);
    let running = 0;
    let led = false;
    let trailed = false;
    for (const goal of parsed.goals) {
      const mine = goal.side === venue;
      if (mine) scoredPhases[phaseOf(goal.minute)] += 1;
      else concededPhases[phaseOf(goal.minute)] += 1;
      running += mine ? 1 : -1;
      if (running > 0) led = true;
      if (running < 0) trailed = true;
    }

    return {
      fixtureId,
      matchDate: date,
      competition: competition || parsed.competition,
      teamKey: ownKey,
      teamName: ownName,
      opponentName: otherName,
      venue,
      goalsFor,
      goalsAgainst,
      xgFor: ownStat('expected_goals'),
      xgAgainst: otherStat('expected_goals'),
      shotsFor: ownStat('total shots'),
      shotsOnTargetFor: ownStat('shots on goal'),
      bigChancesFor: ownStat('big chances'),
      bigChancesMissedFor: ownStat('big chances missed'),
      possessionFor: ownStat('ball possession'),
      passAccuracyFor: ownStat('passes %'),
      cornersFor: ownStat('corner kicks'),
      foulsFor: ownStat('fouls'),
      yellowFor: ownStat('yellow cards'),
      redFor: ownStat('red cards'),
      savesFor: ownStat('goalkeeper saves'),
      scoredPhases,
      concededPhases,
      ledAtSomePoint: led,
      trailedAtSomePoint: trailed,
      rating: parsed.ratings.get(ownKey) ?? null,
      startersKept: null,
    };
  };

  return [build('home'), build('away')];
}

function storeDetails(rows: DetailRow[]): number {
  const handle = archiveDatabase();
  if (!handle || !rows.length) return 0;
  schema();
  let written = 0;
  try {
    const statement = handle.prepare(
      `INSERT INTO team_match_detail
        (fixture_id, match_date, competition, team_key, team_name, opponent_name, venue,
         goals_for, goals_against, xg_for, xg_against, shots_for, sot_for, big_chances_for,
         big_missed_for, possession_for, pass_acc_for, corners_for, fouls_for, yellow_for,
         red_for, saves_for, scored_phases, conceded_phases, led, trailed, rating,
         starters_kept, fetched_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(fixture_id, team_key) DO UPDATE SET
         goals_for = excluded.goals_for, goals_against = excluded.goals_against,
         xg_for = excluded.xg_for, xg_against = excluded.xg_against,
         shots_for = excluded.shots_for, sot_for = excluded.sot_for,
         big_chances_for = excluded.big_chances_for, big_missed_for = excluded.big_missed_for,
         possession_for = excluded.possession_for, pass_acc_for = excluded.pass_acc_for,
         corners_for = excluded.corners_for, fouls_for = excluded.fouls_for,
         yellow_for = excluded.yellow_for, red_for = excluded.red_for, saves_for = excluded.saves_for,
         scored_phases = excluded.scored_phases, conceded_phases = excluded.conceded_phases,
         led = excluded.led, trailed = excluded.trailed, rating = excluded.rating,
         fetched_at = excluded.fetched_at`,
    );
    const now = Date.now();
    for (const row of rows) {
      statement.run(
        row.fixtureId,
        row.matchDate,
        row.competition,
        row.teamKey,
        row.teamName,
        row.opponentName,
        row.venue,
        row.goalsFor,
        row.goalsAgainst,
        row.xgFor,
        row.xgAgainst,
        row.shotsFor,
        row.shotsOnTargetFor,
        row.bigChancesFor,
        row.bigChancesMissedFor,
        row.possessionFor,
        row.passAccuracyFor,
        row.cornersFor,
        row.foulsFor,
        row.yellowFor,
        row.redFor,
        row.savesFor,
        JSON.stringify(row.scoredPhases),
        JSON.stringify(row.concededPhases),
        row.ledAtSomePoint === null ? null : row.ledAtSomePoint ? 1 : 0,
        row.trailedAtSomePoint === null ? null : row.trailedAtSomePoint ? 1 : 0,
        row.rating,
        row.startersKept,
        now,
      );
      written += 1;
    }
  } catch {
    return written;
  }
  return written;
}

/** How much of a team's fifty matches the detail table actually holds. */
export function dnaCoverage(team: string, asOf: string, depth = DEFAULT_DEPTH): { expected: number; stored: number } {
  const handle = archiveDatabase();
  const expected = historyForTeam(team, asOf, depth).length;
  if (!handle) return { expected, stored: 0 };
  schema();
  try {
    const row = handle
      .prepare(
        `SELECT COUNT(*) AS stored FROM team_match_detail
         WHERE team_key = ? AND match_date < ?`,
      )
      .get(normalizeTeamName(team), asOf) as { stored: number } | undefined;
    return { expected, stored: Math.min(expected, Number(row?.stored ?? 0)) };
  } catch {
    return { expected, stored: 0 };
  }
}

function readDnaMatches(team: string, asOf: string, depth: number): DnaMatch[] {
  const handle = archiveDatabase();
  if (!handle) return [];
  schema();
  try {
    const rows = handle
      .prepare(
        `SELECT * FROM team_match_detail WHERE team_key = ? AND match_date < ?
         ORDER BY match_date DESC LIMIT ?`,
      )
      .all(normalizeTeamName(team), asOf, depth) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      fixtureId: Number(row.fixture_id),
      date: String(row.match_date),
      competition: String(row.competition ?? ''),
      venue: String(row.venue) === 'away' ? 'away' : 'home',
      goalsFor: Number(row.goals_for),
      goalsAgainst: Number(row.goals_against),
      xgFor: row.xg_for === null ? null : Number(row.xg_for),
      xgAgainst: row.xg_against === null ? null : Number(row.xg_against),
      shotsFor: row.shots_for === null ? null : Number(row.shots_for),
      shotsOnTargetFor: row.sot_for === null ? null : Number(row.sot_for),
      bigChancesFor: row.big_chances_for === null ? null : Number(row.big_chances_for),
      bigChancesMissedFor: row.big_missed_for === null ? null : Number(row.big_missed_for),
      possessionFor: row.possession_for === null ? null : Number(row.possession_for),
      passAccuracyFor: row.pass_acc_for === null ? null : Number(row.pass_acc_for),
      cornersFor: row.corners_for === null ? null : Number(row.corners_for),
      foulsFor: row.fouls_for === null ? null : Number(row.fouls_for),
      yellowFor: row.yellow_for === null ? null : Number(row.yellow_for),
      redFor: row.red_for === null ? null : Number(row.red_for),
      savesFor: row.saves_for === null ? null : Number(row.saves_for),
      goalsPreventedFor: null,
      scoredPhases: JSON.parse(String(row.scored_phases ?? '[]')) as number[],
      concededPhases: JSON.parse(String(row.conceded_phases ?? '[]')) as number[],
      ledAtSomePoint: row.led === null ? null : Number(row.led) === 1,
      trailedAtSomePoint: row.trailed === null ? null : Number(row.trailed) === 1,
      rating: row.rating === null ? null : Number(row.rating),
      startersKept: row.starters_kept === null ? null : Number(row.starters_kept),
    }));
  } catch {
    return [];
  }
}

export function teamDna(team: string, asOf: string, depth = DEFAULT_DEPTH): TeamDna {
  return summarizeDna(team, readDnaMatches(team, asOf, depth));
}

function enqueueTeam(team: string, asOf: string, depth: number): boolean {
  const handle = archiveDatabase();
  if (!handle || !team.trim()) return false;
  schema();
  try {
    const result = handle
      .prepare(
        `INSERT INTO dna_queue (team_key, team_name, as_of, depth, state, attempts, note, updated_at)
         VALUES (?, ?, ?, ?, 'queued', 0, NULL, ?)
         ON CONFLICT(team_key) DO UPDATE SET
           as_of = excluded.as_of, depth = MAX(dna_queue.depth, excluded.depth),
           state = CASE WHEN dna_queue.state = 'done' THEN 'done' ELSE 'queued' END,
           updated_at = excluded.updated_at`,
      )
      .run(normalizeTeamName(team), team, asOf, depth, Date.now()) as { changes?: number };
    return Number(result?.changes ?? 0) > 0;
  } catch {
    return false;
  }
}

/**
 * Queues a team's last fifty matches for a proper read.
 *
 * Called when a card is settled and from the app, so opening a decision match is
 * what starts its two dossiers — and a team already read is not read again.
 */
export function enqueueTeamDna(teams: string[], asOf: string, depth = DEFAULT_DEPTH): number {
  const capped = Math.min(MAX_DEPTH, Math.max(5, Math.round(depth)));
  let queued = 0;
  for (const team of teams) {
    if (team && enqueueTeam(team, asOf || new Date().toISOString().slice(0, 10), capped)) queued += 1;
  }
  if (queued) startDna();
  return queued;
}

function nextTeam(): { team_key: string; team_name: string; as_of: string; depth: number } | null {
  const handle = archiveDatabase();
  if (!handle) return null;
  schema();
  try {
    const row = handle
      .prepare(
        `SELECT team_key, team_name, as_of, depth FROM dna_queue
         WHERE state = 'queued' AND attempts < ? ORDER BY updated_at ASC LIMIT 1`,
      )
      .get(MAX_ATTEMPTS) as
      | { team_key: string; team_name: string; as_of: string; depth: number }
      | undefined;
    return row ?? null;
  } catch {
    return null;
  }
}

function markTeam(teamKey: string, state: DnaQueueState, note: string, bumpAttempts = false): void {
  const handle = archiveDatabase();
  if (!handle) return;
  try {
    if (bumpAttempts) {
      handle
        .prepare(
          `UPDATE dna_queue SET attempts = attempts + 1, note = ?, updated_at = ?,
             state = CASE WHEN attempts + 1 >= ? THEN 'failed' ELSE 'queued' END
           WHERE team_key = ?`,
        )
        .run(note, Date.now(), MAX_ATTEMPTS, teamKey);
    } else {
      handle
        .prepare('UPDATE dna_queue SET state = ?, note = ?, updated_at = ? WHERE team_key = ?')
        .run(state, note, Date.now(), teamKey);
    }
    lastNote = note;
  } catch {
    // Bookkeeping only.
  }
}

function missingMatches(
  team: string,
  asOf: string,
  depth: number,
): Array<{ fixtureId: number; matchDate: string; competition: string }> {
  const handle = archiveDatabase();
  const history = historyForTeam(team, asOf, depth).flatMap((row) =>
    row.fixtureId
      ? [{ fixtureId: row.fixtureId, matchDate: row.date, competition: row.competition ?? '' }]
      : [],
  );
  if (!handle) return history;
  schema();
  try {
    const statement = handle.prepare(
      'SELECT 1 FROM team_match_detail WHERE fixture_id = ? AND team_key = ? LIMIT 1',
    );
    const key = normalizeTeamName(team);
    return history.filter((part) => !statement.get(part.fixtureId, key));
  } catch {
    return [];
  }
}

async function tick(): Promise<void> {
  if (working) return;
  const job = nextTeam();
  if (!job) {
    stopDna();
    return;
  }
  working = true;
  current = job.team_name;
  try {
    const pending = missingMatches(job.team_name, job.as_of, job.depth).filter((part) => part.fixtureId > 0);
    let read = 0;
    for (const part of pending) {
      try {
        const snapshot = await getHistoricalMatchSnapshot(part.fixtureId);
        read += storeDetails(detailRowsForMatch(part.fixtureId, snapshot, part.matchDate, part.competition));
      } catch {
        // A match the feed will not give back is skipped, not fatal.
      }
    }
    markTeam(job.team_key, 'done', `${read} rows from ${pending.length} matches`);
  } catch (error) {
    markTeam(job.team_key, 'queued', error instanceof Error ? error.name : 'UnknownError', true);
  } finally {
    working = false;
    current = null;
  }
}

export function startDna(): DnaStatus {
  if (!timer) timer = setInterval(() => void tick(), GAP_MS);
  return dnaStatus();
}

export function stopDna(): DnaStatus {
  if (timer) clearInterval(timer);
  timer = null;
  return dnaStatus();
}

export function dnaStatus(): DnaStatus {
  const handle = archiveDatabase();
  const counts: Record<string, number> = { queued: 0, done: 0, failed: 0 };
  let matchesStored = 0;
  let teamsStored = 0;
  if (handle) {
    schema();
    try {
      for (const row of handle.prepare('SELECT state, COUNT(*) AS total FROM dna_queue GROUP BY state').all() as Array<{
        state: string;
        total: number;
      }>) {
        counts[String(row.state)] = Number(row.total ?? 0);
      }
      const detail = handle
        .prepare('SELECT COUNT(*) AS matches, COUNT(DISTINCT team_key) AS teams FROM team_match_detail')
        .get() as { matches: number; teams: number } | undefined;
      matchesStored = Number(detail?.matches ?? 0);
      teamsStored = Number(detail?.teams ?? 0);
    } catch {
      // Zeroes are the honest answer.
    }
  }
  return {
    running: timer !== null,
    current,
    queued: counts.queued ?? 0,
    done: counts.done ?? 0,
    failed: counts.failed ?? 0,
    matchesStored,
    teamsStored,
    lastNote,
  };
}

export function resumeDna(): void {
  if (process.env.DNA_AUTO_RESUME === '0') return;
  if (dnaStatus().queued > 0) startDna();
}
