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
        url.hostname !== "api.kickoffscore.com")
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
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

function parseFixturePage(
  html: string,
  date: string,
  sourceUrl: string,
): FixturePage {
  let competition = "Football";
  const fixtures: FixturePage["fixtures"] = [];
  const links =
    /<a\b([^>]*\bhref=["'](\/(?:leagues|match)\/[^"']+)["'][^>]*)>([\s\S]*?)<\/a>/gi;

  for (const link of html.matchAll(links)) {
    const href = link[2];
    const linkHtml = link[3] ?? "";
    if (!href) continue;

    if (href.startsWith("/leagues/")) {
      const name = textFromHtml(linkHtml);
      if (name) competition = name;
      continue;
    }

    const matchId = href.match(/^\/match\/[^/]+\/(\d+)$/);
    if (!matchId) continue;

    const matchHtml = linkHtml;
    const images = [...matchHtml.matchAll(/<img\b([^>]*)>/gi)]
      .map((image) => {
        const attributes = image[1] ?? "";
        const alt = attribute(attributes, "alt");
        return {
          alt,
          logo: safeLogoUrl(attribute(attributes, "src")),
        };
      })
      .filter((image) => image.alt && /\s+logo$/i.test(image.alt));

    const homeTeam = images[0]?.alt?.replace(/\s+logo$/i, "") ?? "";
    const awayTeam = images[1]?.alt?.replace(/\s+logo$/i, "") ?? "";
    if (!homeTeam || !awayTeam) continue;

    const scoreValues = [
      ...matchHtml.matchAll(/<span\b[^>]*>\s*(\d{1,3})\s*<\/span>/gi),
    ].map((score) => Number(score[1]));
    const hasScore = scoreValues.length >= 2;
    const { kickoff, status } = readStatusAndKickoff(
      html.slice(Math.max(0, (link.index ?? 0) - 2_500), link.index ?? 0),
      matchHtml,
    );

    fixtures.push({
      competition,
      homeTeam,
      awayTeam,
      homeLogo: images[0]?.logo ?? null,
      awayLogo: images[1]?.logo ?? null,
      kickoff,
      status,
      homeScore: hasScore ? scoreValues[0] ?? null : null,
      awayScore: hasScore ? scoreValues[1] ?? null : null,
      matchUrl: new URL(href, KICKOFFSCORE_ORIGIN).toString(),
    });
  }

  return { date, sourceUrl, fixtures };
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
