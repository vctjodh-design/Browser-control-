import type {
  FootballMatchDetails,
  FootballMatchReplay,
  FootballMatchReplayEvent,
  FootballMatchReplaySection,
} from "@workspace/api-zod";
import {
  clickBrowserText,
  closeBrowserSession,
  createBrowserSession,
  getBrowserState,
  navigateBrowser,
  waitForBrowserPage,
} from "./browser-controller";

const DAY_LIST_URL = "https://www.365scores.com/football/yesterdays-matches";
const RESULTS_LIST_URL = "https://www.365scores.com/football/match-results";
const PAGE_LOAD_SETTLE_MS = 3_500;
const REPLAY_CACHE_TTL_MS = 10 * 60 * 1_000;
const MAX_REPLAY_CACHE_ENTRIES = 60;

type BrowserSnapshot = Awaited<ReturnType<typeof getBrowserState>>;
type SectionKey = FootballMatchReplaySection["key"];

const replayCache = new Map<
  number,
  { expiresAt: number; replay: FootballMatchReplay }
>();

const teamAliases: string[][] = [
  ["psg", "paris saint germain", "paris saint-germain", "paris sg"],
  ["lyon", "olympique lyonnais", "olympique de lyon"],
  ["marseille", "olympique marseille", "olympique de marseille"],
  ["man utd", "manchester united"],
  ["man city", "manchester city"],
  ["atletico madrid", "atlético madrid", "atletico de madrid"],
  ["inter", "internazionale", "inter milan"],
  ["ac milan", "milan"],
  ["bayern", "bayern munich", "fc bayern münchen"],
  ["barcelona", "fc barcelona", "barça", "barca"],
];

export class MatchReplayNotFoundError extends Error {
  constructor(message = "No matching 365Scores report was found for this match date.") {
    super(message);
    this.name = "MatchReplayNotFoundError";
  }
}

export class MatchReplaySourceError extends Error {
  constructor(message = "365Scores could not be read right now. Please try again.") {
    super(message);
    this.name = "MatchReplaySourceError";
  }
}

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function variantsForTeam(name: string): string[] {
  const normalized = normalizeText(name);
  const aliases = teamAliases.find((group) =>
    group.some((alias) => normalizeText(alias) === normalized),
  );
  return [...new Set((aliases ?? [name]).map(normalizeText).filter(Boolean))];
}

function containsTeam(source: string, name: string): boolean {
  const normalizedSource = normalizeText(source);
  return variantsForTeam(name).some((variant) =>
    normalizedSource.includes(variant),
  );
}

function matchDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isAllowedMatchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      (url.hostname === "www.365scores.com" ||
        url.hostname === "365scores.com") &&
      url.pathname.startsWith("/football/match/") &&
      url.username === "" &&
      url.password === ""
    );
  } catch {
    return false;
  }
}

function listCandidates(
  snapshot: BrowserSnapshot,
  details: FootballMatchDetails,
): Array<{ url: string; text: string }> {
  const match = details.match;
  const potential = snapshot.pageContent.links.flatMap((link) => {
    if (!isAllowedMatchUrl(link.href)) return [];
    const searchable = `${link.text} ${link.href}`;
    if (
      !containsTeam(searchable, match.home.name) ||
      !containsTeam(searchable, match.away.name)
    ) {
      return [];
    }
    return [{ url: link.href, text: searchable }];
  });

  const expectedScore =
    match.home.score !== null && match.away.score !== null
      ? new RegExp(
          `\\b${match.home.score}\\s*[-–:]\\s*${match.away.score}\\b`,
        )
      : null;
  const scoreMatches = expectedScore
    ? potential.filter((candidate) => expectedScore.test(candidate.text))
    : [];
  return scoreMatches.length ? scoreMatches : potential;
}

function extractMatchArea(text: string): string {
  const footerIndex = text.indexOf("365Scores is the fastest");
  const bounded = footerIndex >= 0 ? text.slice(0, footerIndex) : text;
  const headerPattern =
    /(?:^|\n)[^\n]{2,100}\s+Vs\s+[^\n]{2,100}\n[^\n]{2,160}\bRound\s+\d+/g;
  const headers = [...bounded.matchAll(headerPattern)];
  const header = headers.at(-1);
  if (!header || header.index === undefined) return bounded.slice(-18_000);
  return bounded.slice(header.index + (header[0].startsWith("\n") ? 1 : 0));
}

function sectionText(
  key: SectionKey,
  title: string,
  text: string,
): FootballMatchReplaySection {
  const normalized = text.trim();
  return {
    key,
    title,
    text: normalized || null,
    available: Boolean(normalized),
  };
}

function sectionFromHeading(
  content: string,
  heading: string,
  endHeadings: string[],
): string | null {
  const start = content.indexOf(heading);
  if (start < 0) return null;
  const contentStart = start + heading.length;
  const ends = endHeadings
    .map((endHeading) => content.indexOf(endHeading, contentStart))
    .filter((index) => index >= 0);
  const end = ends.length ? Math.min(...ends) : content.length;
  return content.slice(contentStart, end).trim() || null;
}

function parseEvents(commentary: string): FootballMatchReplayEvent[] {
  const lines = commentary
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const rawEvents: Array<{ minute: string; lines: string[]; order: number }> =
    [];
  let pendingAddedTime: string | null = null;
  let current: { minute: string; lines: string[]; order: number } | null = null;

  for (const line of lines) {
    const added = line.match(/^\+(\d{1,2})['’]?$/);
    if (added) {
      pendingAddedTime = added[1] ?? null;
      continue;
    }

    const minute = line.match(/^(\d{1,3})['’]?$/);
    if (minute) {
      if (current?.lines.length) rawEvents.push(current);
      const baseMinute = minute[1] ?? line;
      current = {
        minute: pendingAddedTime ? `${baseMinute}+${pendingAddedTime}` : baseMinute,
        lines: [],
        order: rawEvents.length,
      };
      pendingAddedTime = null;
      continue;
    }

    if (current) current.lines.push(line);
  }
  if (current?.lines.length) rawEvents.push(current);

  return rawEvents.map((event) => {
    const title = event.lines[0] ?? "Match event";
    const kind = title.match(
      /\b(goal|assist|substitution|yellow card|red card|penalty|missed penalty|own goal|half-time|full-time|var|injury)\b/i,
    )?.[1]?.toLowerCase() ?? "commentary";
    return {
      minute: event.minute,
      kind,
      title,
      detail: event.lines.slice(1).join(" "),
      sourceOrder: event.order,
    };
  });
}

function parseHalfTimeScore(content: string): string | null {
  const match = content.match(/Halftime\s+(\d+)\s*[-–:]\s*(\d+)/i);
  return match ? `${match[1]}–${match[2]}` : null;
}

function parseDuration(content: string, label: "Actual" | "Total"): string | null {
  const match = content.match(
    new RegExp(`\\b${label}\\s+(\\d{1,3}:\\d{2})`, "i"),
  );
  return match?.[1] ?? null;
}

function reportDateMatches(
  date: Date,
  title: string,
  matchArea: string,
): boolean {
  const source = `${title}\n${matchArea}`;
  const displayed = source.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
  if (!displayed) return false;
  const month = Number(displayed[1]);
  const day = Number(displayed[2]);
  const yearText = displayed[3];
  if (month !== date.getUTCMonth() + 1 || day !== date.getUTCDate()) return false;
  if (!yearText) return true;
  const year = Number(yearText.length === 2 ? `20${yearText}` : yearText);
  return year === date.getUTCFullYear();
}

function replayErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "365Scores could not be read right now. Please try again.";
}

export async function get365ScoresMatchReplay(
  details: FootballMatchDetails,
): Promise<FootballMatchReplay> {
  const cached = replayCache.get(details.match.fixtureId);
  if (cached && cached.expiresAt > Date.now()) return cached.replay;

  const fixtureDate = new Date(details.match.date);
  if (!Number.isFinite(fixtureDate.getTime())) {
    throw new MatchReplaySourceError("The match date is unavailable.");
  }
  const date = matchDate(fixtureDate);
  const dayListUrl = new URL(DAY_LIST_URL);
  dayListUrl.searchParams.set("date", date);
  const resultsListUrl = new URL(RESULTS_LIST_URL);
  resultsListUrl.searchParams.set("date", date);

  let sessionId: string | null = null;
  try {
    const listState = await createBrowserSession(dayListUrl.toString());
    sessionId = listState.sessionId;
    await waitForBrowserPage(sessionId, PAGE_LOAD_SETTLE_MS);
    let snapshot = await getBrowserState(sessionId);
    let sourceDateListUrl = dayListUrl.toString();
    let candidates = listCandidates(snapshot, details);

    if (!candidates.length) {
      await navigateBrowser(sessionId, resultsListUrl.toString());
      await waitForBrowserPage(sessionId, PAGE_LOAD_SETTLE_MS);
      snapshot = await getBrowserState(sessionId);
      sourceDateListUrl = resultsListUrl.toString();
      candidates = listCandidates(snapshot, details);
    }

    if (!candidates.length) throw new MatchReplayNotFoundError();
    if (candidates.length > 1) {
      throw new MatchReplayNotFoundError(
        "More than one 365Scores result matched these teams. The replay was stopped to avoid attaching the wrong match.",
      );
    }

    const candidate = candidates[0];
    if (!candidate) throw new MatchReplayNotFoundError();
    const sourceMatchUrl = new URL(candidate.url);
    if (!isAllowedMatchUrl(sourceMatchUrl.toString())) {
      throw new MatchReplaySourceError();
    }

    await navigateBrowser(sessionId, sourceMatchUrl.toString());
    await waitForBrowserPage(sessionId, PAGE_LOAD_SETTLE_MS);
    let matchSnapshot = await getBrowserState(sessionId);
    const initialMatchArea = extractMatchArea(matchSnapshot.pageContent.text);
    if (!reportDateMatches(fixtureDate, matchSnapshot.title, initialMatchArea)) {
      throw new MatchReplayNotFoundError(
        "365Scores returned a result from a different date. No replay was attached.",
      );
    }

    await clickBrowserText(sessionId, "Lineups");
    matchSnapshot = await getBrowserState(sessionId);
    const lineupsText = sectionFromHeading(
      extractMatchArea(matchSnapshot.pageContent.text),
      "Lineups",
      ["365Scores is the fastest"],
    );

    await clickBrowserText(sessionId, "Stats");
    matchSnapshot = await getBrowserState(sessionId);
    const fullMatchArea = extractMatchArea(matchSnapshot.pageContent.text);
    const fullTimeStats =
      sectionFromHeading(fullMatchArea, "Top Stats", ["365Scores is the fastest"]) ??
      sectionFromHeading(fullMatchArea, "Stats", ["365Scores is the fastest"]);
    const shotMapText = sectionFromHeading(
      fullMatchArea,
      "Shot Map",
      ["Actual Play Time", "Top Stats", "365Scores is the fastest"],
    );
    const timeDetailsText = sectionFromHeading(
      fullMatchArea,
      "Actual Play Time",
      ["Top Stats", "365Scores is the fastest"],
    );

    let firstHalfStats: string | null = null;
    let secondHalfStats: string | null = null;
    try {
      await clickBrowserText(sessionId, "1st Half");
      matchSnapshot = await getBrowserState(sessionId);
      const firstHalfArea = extractMatchArea(matchSnapshot.pageContent.text);
      const firstHalfText = sectionFromHeading(
        firstHalfArea,
        "Top Stats",
        ["365Scores is the fastest"],
      );
      if (firstHalfText && firstHalfText !== fullTimeStats) {
        firstHalfStats = firstHalfText;
      }
    } catch {
      firstHalfStats = null;
    }
    try {
      await clickBrowserText(sessionId, "2nd Half");
      matchSnapshot = await getBrowserState(sessionId);
      const secondHalfArea = extractMatchArea(matchSnapshot.pageContent.text);
      const secondHalfText = sectionFromHeading(
        secondHalfArea,
        "Top Stats",
        ["365Scores is the fastest"],
      );
      if (secondHalfText && secondHalfText !== fullTimeStats) {
        secondHalfStats = secondHalfText;
      }
    } catch {
      secondHalfStats = null;
    }

    await clickBrowserText(sessionId, "Commentary");
    matchSnapshot = await getBrowserState(sessionId);
    const commentaryArea = extractMatchArea(matchSnapshot.pageContent.text);
    const commentary = sectionFromHeading(
      commentaryArea,
      "Commentary",
      ["365Scores is the fastest"],
    );
    const events = commentary ? parseEvents(commentary) : [];

    const sections: FootballMatchReplaySection[] = [
      sectionText("lineups", "Lineups, ratings, and substitutions", lineupsText ?? ""),
      sectionText("commentary", "Commentary", commentary ?? ""),
      sectionText("full-time-stats", "Full-time statistics", fullTimeStats ?? ""),
      sectionText("first-half-stats", "First-half statistics", firstHalfStats ?? ""),
      sectionText("second-half-stats", "Second-half statistics", secondHalfStats ?? ""),
      sectionText("shot-map", "Shot map details", shotMapText ?? ""),
      sectionText("time-details", "Playing time and stoppages", timeDetailsText ?? ""),
    ];
    const dateListText = snapshot.pageContent.text;
    if (!dateListText) throw new MatchReplaySourceError();

    const replay: FootballMatchReplay = {
      fixtureId: details.match.fixtureId,
      date: fixtureDate,
      competition: details.match.competition,
      homeTeam: details.match.home.name,
      awayTeam: details.match.away.name,
      homeScore: details.match.home.score,
      awayScore: details.match.away.score,
      halfTimeScore:
        parseHalfTimeScore(initialMatchArea) ??
        parseHalfTimeScore(commentaryArea),
      actualPlayTime: parseDuration(fullMatchArea, "Actual"),
      totalDuration: parseDuration(fullMatchArea, "Total"),
      sourceDateListUrl,
      sourceMatchUrl: sourceMatchUrl.toString(),
      events,
      sections,
    };

    replayCache.set(details.match.fixtureId, {
      replay,
      expiresAt: Date.now() + REPLAY_CACHE_TTL_MS,
    });
    if (replayCache.size > MAX_REPLAY_CACHE_ENTRIES) {
      const oldestFixtureId = replayCache.keys().next().value;
      if (oldestFixtureId !== undefined) replayCache.delete(oldestFixtureId);
    }
    return replay;
  } catch (error) {
    if (
      error instanceof MatchReplayNotFoundError ||
      error instanceof MatchReplaySourceError
    ) {
      throw error;
    }
    throw new MatchReplaySourceError(replayErrorMessage(error));
  } finally {
    if (sessionId) await closeBrowserSession(sessionId).catch(() => undefined);
  }
}
