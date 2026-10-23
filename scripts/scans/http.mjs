// Request pacing for the scan services' free tiers, and a fetch wrapper that
// waits and retries on "too many requests" and server errors. Clock and sleep
// are injectable so the tests run instantly.

export const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * At most one request every `intervalMs` (VirusTotal free tier: 4 a minute -> 15000)
 * and at most `max` requests in all (a daily quota); past that, wait() throws.
 */
export function limiter(intervalMs, { now = () => Date.now(), sleep = realSleep, max = Infinity } = {}) {
  let next = 0;
  let used = 0;
  return {
    intervalMs,
    get used() {
      return used;
    },
    async wait() {
      if (used >= max) throw new Error(`request budget of ${max} for this run used up`);
      used++;
      const t = now();
      const at = Math.max(t, next);
      next = at + intervalMs;
      if (at > t) await sleep(at - t);
    },
    /** Push the next slot back (after a 429). */
    pause(ms) {
      next = Math.max(next, now() + ms);
    },
  };
}

export class HttpError extends Error {
  constructor(status, what) {
    super(`${what}: HTTP ${status}`);
    this.status = status;
  }
}

/**
 * fetch through `limit`, retrying 429 and 5xx up to `retries` times.
 * Returns the Response (any status); network errors after the last retry throw.
 * Error messages carry only the URL path and status, never headers.
 */
export async function request(fetchImpl, limit, url, init = {}, { retries = 3, backoffMs = 60000, sleep = realSleep } = {}) {
  for (let attempt = 0; ; attempt++) {
    await limit.wait();
    let res;
    try {
      res = await fetchImpl(url, init);
    } catch (e) {
      if (attempt >= retries) throw new Error(`${new URL(url).pathname}: ${e.message}`);
      await sleep(backoffMs);
      continue;
    }
    if ((res.status === 429 || res.status >= 500) && attempt < retries) {
      const after = Number(res.headers?.get?.('retry-after'));
      const wait = Number.isFinite(after) && after > 0 ? after * 1000 : backoffMs;
      limit.pause(wait);
      continue;
    }
    return res;
  }
}
