type RateLimitState = {
  retryAt: number;
  consecutiveHits: number;
};

const MAX_FALLBACK_DELAY_MS = 60_000;
const MIN_REQUEST_INTERVAL_MS = 400;
const rateLimits = new Map<string, RateLimitState>();
const requestTails = new Map<string, Promise<void>>();
const lastRequestAt = new Map<string, number>();

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

function pause(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function fetchAtPoliteRate(
  origin: string,
  input: string | URL,
  init: RequestInit,
): Promise<Response> {
  const previous = requestTails.get(origin) ?? Promise.resolve();
  let release = () => {};
  const turn = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => turn);
  requestTails.set(origin, tail);
  await previous;
  try {
    const wait = (lastRequestAt.get(origin) ?? 0) + MIN_REQUEST_INTERVAL_MS - Date.now();
    if (wait > 0) await pause(wait);

    const activeLimit = rateLimits.get(origin);
    if (activeLimit && activeLimit.retryAt > Date.now()) {
      throw rateLimitError(activeLimit);
    }

    lastRequestAt.set(origin, Date.now());
    return await fetch(input, init);
  } finally {
    release();
    if (requestTails.get(origin) === tail) requestTails.delete(origin);
  }
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

  const response = await fetchAtPoliteRate(origin, input, init);

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
