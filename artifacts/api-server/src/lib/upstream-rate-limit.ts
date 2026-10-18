type RateLimitState = {
  retryAt: number;
  consecutiveHits: number;
};

const MAX_FALLBACK_DELAY_MS = 60_000;
const rateLimits = new Map<string, RateLimitState>();

export class UpstreamRateLimitError extends Error {
  constructor(
    readonly retryAfterSeconds: number,
  ) {
    super("The data source is temporarily rate limiting requests.");
    this.name = "UpstreamRateLimitError";
  }
}

function retryAfterMilliseconds(value: string | null): number | null {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return seconds * 1_000;
  }

  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - Date.now());
}

function resetAfterMilliseconds(value: string | null): number | null {
  if (!value) return null;

  const reset = Number(value);
  if (Number.isFinite(reset) && reset >= 0) {
    return reset > 1_000_000_000
      ? Math.max(0, reset * 1_000 - Date.now())
      : reset * 1_000;
  }

  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  return Math.max(0, date - Date.now());
}

function rateLimitError(state: RateLimitState): UpstreamRateLimitError {
  return new UpstreamRateLimitError(
    Math.max(1, Math.ceil((state.retryAt - Date.now()) / 1_000)),
  );
}

export async function fetchRespectingRateLimits(
  input: string | URL,
  init: RequestInit,
): Promise<Response> {
  const origin = new URL(input).origin;
  const now = Date.now();
  const existing = rateLimits.get(origin);

  if (existing && existing.retryAt > now) {
    throw rateLimitError(existing);
  }

  const response = await fetch(input, init);

  const remainingHeader =
    response.headers.get("x-ratelimit-remaining") ??
    response.headers.get("ratelimit-remaining");
  const quotaExhausted =
    remainingHeader !== null &&
    Number.isFinite(Number(remainingHeader)) &&
    Number(remainingHeader) <= 0;
  const isRateLimited = response.status === 429 || quotaExhausted;

  if (isRateLimited) {
    const receivedAt = Date.now();
    const latest = rateLimits.get(origin) ?? existing;
    const previousStillCooling = Boolean(
      latest && latest.retryAt > receivedAt,
    );
    const consecutiveHits = latest
      ? previousStillCooling
        ? latest.consecutiveHits
        : latest.consecutiveHits + (response.status === 429 ? 1 : 0)
      : 1;
    const fallbackDelay =
      response.status === 429
        ? Math.min(
            1_000 * 2 ** Math.min(consecutiveHits - 1, 6),
            MAX_FALLBACK_DELAY_MS,
          )
        : 1_000;
    const serverDelay = retryAfterMilliseconds(
      response.headers.get("retry-after"),
    );
    const resetDelay = resetAfterMilliseconds(
      response.headers.get("x-ratelimit-reset") ??
        response.headers.get("ratelimit-reset"),
    );
    const delay = Math.max(
      1_000,
      serverDelay ?? 0,
      resetDelay ?? 0,
      serverDelay === null && resetDelay === null ? fallbackDelay : 0,
      latest ? latest.retryAt - receivedAt : 0,
    );
    const state = {
      retryAt: receivedAt + delay,
      consecutiveHits,
    };
    rateLimits.set(origin, state);
    if (response.status === 429) throw rateLimitError(state);
  }

  const latest = rateLimits.get(origin);
  if (!latest || latest.retryAt <= now) rateLimits.delete(origin);
  return response;
}
