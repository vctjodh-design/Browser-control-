import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import type { DecisionMarket, UpsetLevel } from "./decision-tree";

// The upset ledger: every line the card ever called, kept until full time, then
// marked against what actually happened.
//
// Nothing here models anything. It is the book that makes modelling possible: a
// line is recorded with the call, the tier and the upset reading it was given
// before kick-off, and once the match is final the same line is marked held or
// turned over. Everything after this — learned weights, calibrated bands, honest
// percentages — is a question asked of these rows, and a band nobody can score is
// a band nobody should trust.

export type LedgerLine = {
  id: string;
  label: string;
  call: string;
  tier: string;
  upset: { level: UpsetLevel; flipDistance: number | null };
  boardShare: number | null;
};

type LedgerRow = {
  market_id: string;
  upset_level: string;
  held_total: number;
  resolved_total: number;
};

const FORMATTED_LINES: Record<string, (total: number, line: number) => boolean> = {
  over: (total, line) => total > line,
};

/** Parses "Over 2.5" / "Under 1.5" and answers whether the total beat the line. */
function overUnderHeld(call: string, total: number): boolean | null {
  const match = /^(over|under)\s*([\d.]+)$/i.exec(call.trim());
  if (!match) return null;
  const line = Number(match[2]);
  if (!Number.isFinite(line)) return null;
  return match[1].toLowerCase() === "over" ? FORMATTED_LINES.over(total, line) : !FORMATTED_LINES.over(total, line);
}

/** Parses "1–0" (an en dash) and answers whether the scoreline landed on it. */
function exactScoreHeld(call: string, home: number, away: number): boolean | null {
  const match = /^(\d+)\s*[–-]\s*(\d+)$/.exec(call.trim());
  if (!match) return null;
  return Number(match[1]) === home && Number(match[2]) === away;
}

/**
 * Did the call hold, given the final score?
 *
 * The line's identity is what settles it — a clean sheet is a clean sheet — so
 * this reads each market by name rather than by any model output. A call the
 * ledger cannot parse answers null and is left out of the rates rather than being
 * counted as a win.
 */
export function judgeCall(
  market: { id: string; call: string },
  home: number,
  away: number,
  favourite: "home" | "away" | null = null,
): boolean | null {
  const total = home + away;
  const { id, call } = market;

  switch (id) {
    case "result":
      if (call === "Home win") return home > away;
      if (call === "Away win") return away > home;
      if (call === "Draw") return home === away;
      return null;
    case "double-chance":
      if (/1X/.test(call)) return home >= away;
      if (/X2/.test(call)) return away >= home;
      if (/12/.test(call)) return home !== away;
      return null;
    case "draw-no-bet":
      if (call === "Home") return home > away;
      if (call === "Away") return away > home;
      if (call.startsWith("No side")) return home === away;
      return null;
    case "handicap": {
      if (!favourite) return null;
      const margin = favourite === "home" ? home - away : away - home;
      if (call === "Favourite −1") return margin >= 2;
      if (call === "Underdog +1") return margin <= 1;
      return null;
    }
    case "win-to-nil": {
      const homeWonToNil = home > away && away === 0;
      const awayWonToNil = away > home && home === 0;
      if (call === "Home to win to nil") return homeWonToNil;
      if (call === "Away to win to nil") return awayWonToNil;
      if (call === "No") return !homeWonToNil && !awayWonToNil;
      return null;
    }
    case "over-1.5":
    case "over-2.5":
    case "over-3.5":
      return overUnderHeld(call, total);
    case "team-total-home":
    case "team-total-away": {
      const side = id === "team-total-home" ? home : away;
      const match = /^(over|under)\s*([\d.]+)$/i.exec(call.trim());
      if (!match) return null;
      const line = Number(match[2]);
      if (!Number.isFinite(line)) return null;
      return match[1].toLowerCase() === "over" ? side > line : side <= line;
    }
    case "btts":
      if (call === "Yes") return home > 0 && away > 0;
      if (call === "No") return !(home > 0 && away > 0);
      return null;
    case "clean-home":
      if (call === "Yes") return away === 0;
      if (call === "No") return away > 0;
      return null;
    case "clean-away":
      if (call === "Yes") return home === 0;
      if (call === "No") return home > 0;
      return null;
    case "correct-score":
      return exactScoreHeld(call, home, away);
    default:
      return null;
  }
}

/** The favourite by worth, which the handicap line needs to be read at all. */
export function favouriteSide(homeWorth: number, awayWorth: number): "home" | "away" | null {
  if (homeWorth === awayWorth) return null;
  return homeWorth > awayWorth ? "home" : "away";
}

// This module opens the archive file itself rather than importing the store's
// handle: it takes no runtime import from another module, so the ledger can be
// exercised directly by the test runner without a build step.
const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const databasePath =
  process.env.PROCESSED_MATCH_DB_PATH ?? resolve(moduleDirectory, "../data/processed-matches.sqlite");

let database: DatabaseSync | null = null;
let unusable = false;

function archiveDatabase(): DatabaseSync | null {
  if (unusable) return null;
  if (database) return database;
  try {
    mkdirSync(dirname(databasePath), { recursive: true });
    database = new DatabaseSync(databasePath);
    return database;
  } catch {
    unusable = true;
    return null;
  }
}

function schema(): void {
  const handle = archiveDatabase();
  if (!handle) return;
  try {
    handle.exec(`
      CREATE TABLE IF NOT EXISTS decision_ledger (
        fixture_id INTEGER NOT NULL,
        market_id TEXT NOT NULL,
        match_date TEXT NOT NULL DEFAULT '',
        market_label TEXT NOT NULL DEFAULT '',
        call TEXT NOT NULL,
        tier TEXT NOT NULL,
        upset_level TEXT NOT NULL,
        flip_distance REAL,
        board_share REAL,
        favourite TEXT,
        settled_at INTEGER NOT NULL,
        home_goals INTEGER,
        away_goals INTEGER,
        held INTEGER,
        resolved_at INTEGER,
        PRIMARY KEY (fixture_id, market_id)
      );
      CREATE INDEX IF NOT EXISTS decision_ledger_date ON decision_ledger (match_date, market_id);
    `);
  } catch {
    // A read-only volume leaves the app working and the ledger empty.
  }
}

/**
 * Writes a card's lines to the book. Re-settling a fixture rewrites the calls but
 * never clears a result that was already marked.
 */
export function recordCardLines(input: {
  fixtureId: number;
  matchDate: string;
  settledAt: number;
  markets: DecisionMarket[];
  homeWorth: number;
  awayWorth: number;
}): void {
  const handle = archiveDatabase();
  if (!handle) return;
  schema();
  const favourite = favouriteSide(input.homeWorth, input.awayWorth);
  try {
    const statement = handle.prepare(
      `INSERT INTO decision_ledger
        (fixture_id, market_id, match_date, market_label, call, tier, upset_level, flip_distance,
         board_share, favourite, settled_at, home_goals, away_goals, held, resolved_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)
       ON CONFLICT(fixture_id, market_id) DO UPDATE SET
         match_date = excluded.match_date,
         market_label = excluded.market_label,
         call = excluded.call,
         tier = excluded.tier,
         upset_level = excluded.upset_level,
         flip_distance = excluded.flip_distance,
         board_share = excluded.board_share,
         favourite = excluded.favourite,
         settled_at = excluded.settled_at`,
    );
    for (const market of input.markets) {
      statement.run(
        input.fixtureId,
        market.id,
        input.matchDate,
        market.label,
        market.call,
        market.tier,
        market.upset.level,
        market.upset.flipDistance,
        market.boardShare,
        favourite,
        input.settledAt,
      );
    }
  } catch {
    // Recording is bookkeeping; failing to write it must not fail the card.
  }
}

export type LedgerResult = { fixtureId: number; home: number; away: number };

/** Marks every line of the given fixtures against its final score. */
/** Dates whose lines are written but not yet marked, newest first. */
export function unsettledLedgerDates(limit = 3): string[] {
  const handle = archiveDatabase();
  if (!handle) return [];
  schema();
  try {
    const rows = handle
      .prepare(
        `SELECT match_date FROM decision_ledger WHERE held IS NULL AND match_date <> ''
         GROUP BY match_date ORDER BY match_date DESC LIMIT ?`,
      )
      .all(limit) as Array<{ match_date: string }>;
    return rows.map((row) => row.match_date);
  } catch {
    return [];
  }
}

export function resolveLedger(results: LedgerResult[]): number {
  const handle = archiveDatabase();
  if (!handle || !results.length) return 0;
  schema();
  let marked = 0;
  try {
    const read = handle.prepare("SELECT market_id, call, favourite FROM decision_ledger WHERE fixture_id = ?");
    const write = handle.prepare(
      "UPDATE decision_ledger SET home_goals = ?, away_goals = ?, held = ?, resolved_at = ? WHERE fixture_id = ? AND market_id = ?",
    );
    const now = Date.now();
    for (const result of results) {
      const rows = read.all(result.fixtureId) as Array<{
        market_id: string;
        call: string;
        favourite: string | null;
      }>;
      for (const row of rows) {
        const favourite = row.favourite === "home" || row.favourite === "away" ? row.favourite : null;
        const held = judgeCall({ id: row.market_id, call: row.call }, result.home, result.away, favourite);
        if (held === null) continue;
        write.run(result.home, result.away, held ? 1 : 0, now, result.fixtureId, row.market_id);
        marked += 1;
      }
    }
  } catch {
    return marked;
  }
  return marked;
}

export type LedgerStanding = {
  marketId: string;
  label: string;
  upsetLevel: UpsetLevel | "all";
  held: number;
  laid: number;
  rate: number | null;
};

/**
 * How each market's calls have actually held, by upset band.
 *
 * A rate is only reported where at least one line has been marked: a band with no
 * settled lines is unmeasured, not perfect.
 */
export function ledgerStandings(): LedgerStanding[] {
  const handle = archiveDatabase();
  if (!handle) return [];
  schema();
  try {
    const rows = handle
      .prepare(
        `SELECT market_id, upset_level,
                SUM(CASE WHEN held IS NOT NULL THEN 1 ELSE 0 END) AS resolved_total,
                SUM(CASE WHEN held = 1 THEN 1 ELSE 0 END) AS held_total
         FROM decision_ledger
         GROUP BY market_id, upset_level
         ORDER BY market_id, upset_level`,
      )
      .all() as unknown as LedgerRow[];
    const labels = handle
      .prepare("SELECT market_id, market_label FROM decision_ledger GROUP BY market_id")
      .all() as Array<{ market_id: string; market_label: string }>;
    const labelOf = new Map(labels.map((row) => [row.market_id, row.market_label]));
    return rows
      .map<LedgerStanding>((row) => {
        const laid = Number(row.resolved_total ?? 0);
        const held = Number(row.held_total ?? 0);
        return {
          marketId: row.market_id,
          label: labelOf.get(row.market_id) ?? row.market_id,
          upsetLevel: row.upset_level as UpsetLevel,
          held,
          laid,
          rate: laid > 0 ? Math.round((held / laid) * 100) : null,
        };
      })
      .filter((standing) => standing.laid > 0);
  } catch {
    return [];
  }
}
