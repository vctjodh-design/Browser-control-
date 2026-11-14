import { buildInevitability } from './inevitability-engine';
import { DECISION_CARD_VERSION, buildDecisionTree, summarizeDecisionTree } from './decision-tree';
import { readStoredCard, writeStoredCard } from './decision-store';
import { recordCardLines } from './decision-ledger';
import { applyPlayerForm } from './player-form-apply';
import { getSimFormProfile } from './sim-form-profile';

// Settling one card, in one place.
//
// The match page asks for the card, the date sweep asks for the same card, and the
// backfill asks for it again weeks later from the books. All three have to end up
// with the same fourteen lines written to the same ledger, so the order — memory,
// then the archive, then a real read of the board — lives here rather than in any
// one route.

/**
 * The profile the engine plays: the predicted elevens with unavailable players
 * replaced and every player carrying the weights his own matches argue for.
 */
export async function engineProfile(fixtureId: number) {
  const profile = await getSimFormProfile(fixtureId);
  const applied = await applyPlayerForm(profile);
  return applied.profile;
}

// Settling a fixture costs a real squad read upstream — seconds, not milliseconds —
// and the same fixture is asked for twice in normal use: once by the match page's
// tab, once by the date sweep. Nothing in the answer depends on the moment it is
// asked, so a short memo makes the second ask free and lets a half-finished date
// run be continued without paying for every fixture again.
const DECISION_TTL_MS = 10 * 60_000;
const DECISION_MEMO_LIMIT = 400;
const decisionMemo = new Map<number, { at: number; tree: ReturnType<typeof buildDecisionTree> }>();

export function readDecisionMemo(fixtureId: number): ReturnType<typeof buildDecisionTree> | null {
  const hit = decisionMemo.get(fixtureId);
  if (!hit) return null;
  if (Date.now() - hit.at > DECISION_TTL_MS) {
    decisionMemo.delete(fixtureId);
    return null;
  }
  // Re-inserting moves it to the end, so the least recently asked goes first.
  decisionMemo.delete(fixtureId);
  decisionMemo.set(fixtureId, hit);
  return hit.tree;
}

export function writeDecisionMemo(fixtureId: number, tree: ReturnType<typeof buildDecisionTree>): void {
  decisionMemo.set(fixtureId, { at: Date.now(), tree });
  while (decisionMemo.size > DECISION_MEMO_LIMIT) {
    const oldest = decisionMemo.keys().next().value;
    if (oldest === undefined) break;
    decisionMemo.delete(oldest);
  }
}

/** A card this build wrote. Older payloads are re-read rather than served blank. */
export function storedCardFor(
  fixtureId: number,
): { card: ReturnType<typeof buildDecisionTree>; settledAt: number } | null {
  const stored = readStoredCard<ReturnType<typeof buildDecisionTree> & { payloadVersion?: number }>(fixtureId);
  // A card written before this build has none of the newer readings on it, so it
  // is treated as absent and settled again rather than served half-filled.
  if (!stored || stored.card.payloadVersion !== DECISION_CARD_VERSION) return null;
  return stored as { card: ReturnType<typeof buildDecisionTree>; settledAt: number };
}

export type SettledDecision = {
  tree: ReturnType<typeof buildDecisionTree>;
  source: 'memo' | 'stored' | 'fresh';
  settledAt?: number;
  elapsedMs: number;
};

/**
 * The card for one fixture, from wherever it is cheapest to get it, with a fresh
 * settle writing the archive and the ledger on the way out.
 *
 * `matchDate` is what the caller knows about when the fixture is played. It is
 * stored with the lines so the ledger can be listed by date and marked later.
 */
export async function settleDecisionCard(fixtureId: number, matchDate: string): Promise<SettledDecision> {
  const remembered = readDecisionMemo(fixtureId);
  if (remembered) return { tree: remembered, source: 'memo', elapsedMs: 0 };

  const archived = storedCardFor(fixtureId);
  if (archived) {
    writeDecisionMemo(fixtureId, archived.card);
    return { tree: archived.card, source: 'stored', settledAt: archived.settledAt, elapsedMs: 0 };
  }

  const profile = await engineProfile(fixtureId);
  const startedAt = Date.now();
  const verdict = buildInevitability(profile);
  const tree = buildDecisionTree(profile, verdict);
  const elapsedMs = Date.now() - startedAt;
  writeDecisionMemo(fixtureId, tree);
  writeStoredCard({
    fixtureId,
    matchDate,
    homeTeam: tree.teams[0] ?? '',
    awayTeam: tree.teams[1] ?? '',
    competition: '',
    summary: summarizeDecisionTree(tree),
    payload: { payloadVersion: DECISION_CARD_VERSION, elapsedMs, cached: false, ...tree },
  });
  // Every line goes into the book with the reading it was given before kick-off,
  // so the upset bands can be scored once the match is final.
  recordCardLines({
    fixtureId,
    matchDate,
    settledAt: Date.now(),
    markets: tree.markets,
    homeWorth: tree.worth.home,
    awayWorth: tree.worth.away,
  });
  return { tree, source: 'fresh', elapsedMs };
}
