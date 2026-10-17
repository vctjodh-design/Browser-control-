const KICKOFFSCORE_ORIGIN = "https://kickoffscore.com";
const CACHE_TTL_MS = 60_000;
const MAX_CACHED_DATES = 16;

type FixturePage = {
  date: string;
  sourceUrl: string;
  fixtures: {
    competition: string;
    homeTeam: string;
    awayTeam: string;
    homeLogo: string | null;
    awayLogo: string | null;
    kickoff: string;
    status: string;
    homeScore: number | null;
    awayScore: number | null;
    matchUrl: string;
  }[];
};

const fixtureCache = new Map<
  string,
  { expiresAt: number; page: FixturePage }
>();

function decodeHtml(value: string): string {
  return value.replace(
    /&(#x[\da-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi,
    (entity, code: string) => {
      if (code.startsWith("#x")) {
        return String.fromCodePoint(Number.parseInt(code.slice(2), 16));
      }
      if (code.startsWith("#")) {
        return String.fromCodePoint(Number.parseInt(code.slice(1), 10));
      }

      const namedEntities: Record<string, string> = {
        amp: "&",
        lt: "<",
        gt: ">",
        quot: '"',
        apos: "'",
        nbsp: " ",
      };
      return namedEntities[code.toLowerCase()] ?? entity;
    },
  );
}

function textFromHtml(fragment: string): string {
  return decodeHtml(fragment.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function attribute(attributes: string, name: string): string | null {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = attributes.match(
    new RegExp(`\\b${escapedName}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i"),
  );
  const value = match?.[1] ?? match?.[2];
  return value === undefined ? null : decodeHtml(value);
}

function safeLogoUrl(value: string | null): string | null {
  if (!value) return null;

  try {
    const url = new URL(value, KICKOFFSCORE_ORIGIN);
    if (
      url.protocol !== "https:" ||
      (url.hostname !== "kickoffscore.com" &&
        url.hostname !== "api.kickoffscore.com" &&
        url.hostname !== "media.api-sports.io")
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeTeamName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fixturePairKey(homeTeam: string, awayTeam: string): string {
  return `${normalizeTeamName(homeTeam)}\u0000${normalizeTeamName(awayTeam)}`;
}

type EmbeddedMatchDetails = {
  homeLogo: string | null;
  awayLogo: string | null;
  status: string | null;
  homeScore: number | null;
  awayScore: number | null;
};

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function extractEmbeddedMatchDetails(
  html: string,
): Map<string, EmbeddedMatchDetails> {
  for (const script of html.matchAll(
    /<script\b[^>]*>([\s\S]*?)<\/script>/gi,
  )) {
    const body = script[1] ?? "";
    if (!body.includes("initialMatches") || !body.includes("self.__next_f.push")) {
      continue;
    }

    const push = body.match(/self\.__next_f\.push\((\[[\s\S]*\])\);?/);
    if (!push?.[1]) continue;

    let payload: unknown;
    try {
      payload = JSON.parse(push[1]);
    } catch {
      continue;
    }
    if (!Array.isArray(payload) || typeof payload[1] !== "string") continue;

    for (const line of (payload[1] as string).split("\n")) {
      if (!line.includes("initialMatches")) continue;
      const separator = line.indexOf(":");
      if (separator < 0) continue;

      let segment: unknown;
      try {
        segment = JSON.parse(line.slice(separator + 1));
      } catch {
        continue;
      }
      if (!Array.isArray(segment) || !segment[3] || typeof segment[3] !== "object") {
        continue;
      }

      const initialMatches = (
        segment[3] as { initialMatches?: unknown }
      ).initialMatches;
      if (!Array.isArray(initialMatches)) continue;

      const detailsByPair = new Map<string, EmbeddedMatchDetails>();
      for (const item of initialMatches) {
        if (!item || typeof item !== "object") continue;

        const match = item as {
          teams?: {
            home?: { name?: unknown; logo?: unknown };
            away?: { name?: unknown; logo?: unknown };
          };
          fixture?: { status?: { long?: unknown } };
          goals?: { home?: unknown; away?: unknown };
          score?: { fulltime?: { home?: unknown; away?: unknown } };
        };
        const home = match.teams?.home;
        const away = match.teams?.away;
        if (typeof home?.name !== "string" || typeof away?.name !== "string") {
          continue;
        }

        const homeScore =
          numberOrNull(match.goals?.home) ??
          numberOrNull(match.score?.fulltime?.home);
        const awayScore =
          numberOrNull(match.goals?.away) ??
          numberOrNull(match.score?.fulltime?.away);
        detailsByPair.set(fixturePairKey(home.name, away.name), {
          homeLogo:
            typeof home.logo === "string" ? safeLogoUrl(home.logo) : null,
          awayLogo:
            typeof away.logo === "string" ? safeLogoUrl(away.logo) : null,
          status:
            typeof match.fixture?.status?.long === "string"
              ? match.fixture.status.long
              : null,
          homeScore,
          awayScore,
        });
      }
      return detailsByPair;
    }
  }

  return new Map();
}

function readStatusAndKickoff(prefix: string, matchHtml: string) {
  const stateSpans = [
    ...prefix.matchAll(
      /<span\b([^>]*)>([\s\S]*?)<\/span>/gi,
    ),
  ].filter((match) => attribute(match[1] ?? "", "title"));
  const latestState = stateSpans.at(-1);
  const stateTitle = attribute(latestState?.[1] ?? "", "title");
  const stateText = textFromHtml(latestState?.[2] ?? "");
  const kickoff = matchHtml.match(/\b(\d{1,2}:\d{2})\b/)?.[1] ?? "—";

  return {
    kickoff,
    status: stateTitle ?? stateText ?? "Scheduled",
  };
}

function inferFixtureStatus(startTime: string | null, hasScore: boolean): string {
  const startTimestamp = startTime ? Date.parse(startTime) : Number.NaN;
  const now = Date.now();

  if (hasScore) {
    const elapsed = now - startTimestamp;
    return Number.isFinite(startTimestamp) && elapsed >= 0 && elapsed < 3 * 60 * 60 * 1000
      ? "In Play"
      : "Match Finished";
  }

  return Number.isFinite(startTimestamp) && startTimestamp > now
    ? "Not Started"
    : "Status unavailable";
}

function parseFixturePage(
  html: string,
  date: string,
  sourceUrl: string,
): FixturePage {
  const embeddedDetails = extractEmbeddedMatchDetails(html);
  const cardDetails = new Map<
    string,
    {
      homeLogo: string | null;
      awayLogo: string | null;
      kickoff: string;
      status: string;
      homeScore: number | null;
      awayScore: number | null;
    }
  >();

  // KickoffScore also renders logo cards for its featured matches. Keep their
  // extra status and logo data, but use the competition rows below as the full
  // fixture list.
  const matchAnchors =
    /<a\b([^>]*\bhref=["'](\/match\/[^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(matchAnchors)) {
    const href = match[2];
    const matchHtml = match[3] ?? "";
    if (!href || !matchHtml.includes("<img")) continue;

    const images = [...matchHtml.matchAll(/<img\b([^>]*)>/gi)]
      .map((image) => {
        const imageAttributes = image[1] ?? "";
        const alt = attribute(imageAttributes, "alt");
        return {
          alt,
          logo: safeLogoUrl(attribute(imageAttributes, "src")),
        };
      })
      .filter((image) => image.alt && /\s+logo$/i.test(image.alt));
    if (images.length < 2) continue;

    const index = match.index ?? 0;
    const { kickoff, status } = readStatusAndKickoff(
      html.slice(Math.max(0, index - 2_500), index),
      matchHtml,
    );
    const scoreValues = [
      ...matchHtml.matchAll(/<span\b[^>]*>\s*(\d{1,3})\s*<\/span>/gi),
    ].map((score) => Number(score[1]));

    cardDetails.set(new URL(href, KICKOFFSCORE_ORIGIN).toString(), {
      homeLogo: images[0]?.logo ?? null,
      awayLogo: images[1]?.logo ?? null,
      kickoff,
      status,
      homeScore: scoreValues.length >= 2 ? scoreValues[0] ?? null : null,
      awayScore: scoreValues.length >= 2 ? scoreValues[1] ?? null : null,
    });
  }

  let competition = "Football";
  const fixturesByUrl = new Map<
    string,
    FixturePage["fixtures"][number]
  >();
  const sections =
    /<h3\b[^>]*>([\s\S]*?)<\/h3>|<li\b[^>]*>([\s\S]*?)<\/li>/gi;

  for (const section of html.matchAll(sections)) {
    const headingHtml = section[1];
    if (headingHtml !== undefined) {
      const leagueLink = headingHtml.match(
        /<a\b([^>]*\bhref=["']\/leagues\/[^"']+["'][^>]*)>([\s\S]*?)<\/a>/i,
      );
      if (leagueLink?.[2]) competition = textFromHtml(leagueLink[2]);
      continue;
    }

    const rowHtml = section[2] ?? "";
    const matchLink = rowHtml.match(
      /<a\b([^>]*\bhref=["'](\/match\/[^"']+)["'][^>]*)>([\s\S]*?)<\/a>/i,
    );
    const timeElement = rowHtml.match(
      /<time\b([^>]*)>([\s\S]*?)<\/time>/i,
    );
    if (!matchLink?.[2] || !matchLink[3] || !timeElement) continue;

    const href = matchLink[2];
    if (!/^\/match\/[^/]+\/\d+$/.test(href)) continue;
    const matchup = textFromHtml(matchLink[3]).match(
      /^([\s\S]+?)\s+vs\.?\s+([\s\S]+)$/i,
    );
    if (!matchup) continue;

    const kickoff = textFromHtml(timeElement[2] ?? "") || "—";
    const startTime = attribute(timeElement[1] ?? "", "dateTime");
    const rowScore = rowHtml.match(
      /<span\b[^>]*>\s*(\d{1,3})\s*[-–]\s*(\d{1,3})\s*<\/span>/i,
    );
    const matchUrl = new URL(href, KICKOFFSCORE_ORIGIN).toString();
    const embedded = embeddedDetails.get(
      fixturePairKey(matchup[1], matchup[2]),
    );
    const card = cardDetails.get(matchUrl);
    const homeScore = rowScore
      ? Number(rowScore[1])
      : embedded?.homeScore ?? card?.homeScore ?? null;
    const awayScore = rowScore
      ? Number(rowScore[2])
      : embedded?.awayScore ?? card?.awayScore ?? null;
    const hasScore = homeScore !== null && awayScore !== null;

    fixturesByUrl.set(matchUrl, {
      competition,
      homeTeam: matchup[1].trim(),
      awayTeam: matchup[2].trim(),
      homeLogo: embedded?.homeLogo ?? card?.homeLogo ?? null,
      awayLogo: embedded?.awayLogo ?? card?.awayLogo ?? null,
      kickoff: card?.kickoff && card.kickoff !== "—" ? card.kickoff : kickoff,
      status:
        embedded?.status ??
        card?.status ??
        inferFixtureStatus(startTime, hasScore),
      homeScore,
      awayScore,
      matchUrl,
    });
  }

  return { date, sourceUrl, fixtures: [...fixturesByUrl.values()] };
}

export async function getKickoffScoreFixtures(
  date: string,
): Promise<FixturePage> {
  const cached = fixtureCache.get(date);
  if (cached && cached.expiresAt > Date.now()) return cached.page;

  // The host is fixed and the date is validated before this function is called.
  // No user-supplied URL is ever fetched here.
  const sourceUrl = `${KICKOFFSCORE_ORIGIN}/matches/${date}`;
  const response = await fetch(sourceUrl, {
    headers: {
      accept: "text/html",
      "user-agent": "Mozilla/5.0 (compatible; FixturesCalendar/1.0)",
    },
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new Error(`KickoffScore returned HTTP ${response.status}.`);
  }

  const html = await response.text();
  if (html.length > 6_000_000 || !html.includes("KickoffScore")) {
    throw new Error("KickoffScore returned an unexpected page.");
  }

  const page = parseFixturePage(html, date, sourceUrl);
  fixtureCache.set(date, { page, expiresAt: Date.now() + CACHE_TTL_MS });
  if (fixtureCache.size > MAX_CACHED_DATES) {
    const oldestDate = fixtureCache.keys().next().value;
    if (oldestDate) fixtureCache.delete(oldestDate);
  }
  return page;
}
