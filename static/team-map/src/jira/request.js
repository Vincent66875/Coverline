// JSON wrapper around a fetch-like call (Forge's requestJira), with retry on 429/503.
// Pure: the raw fetcher is injected, so tests run in node with a mock Jira.

export class JiraError extends Error {
  constructor(status, path, detail) {
    super(`Jira ${status} on ${path}${detail ? `: ${detail}` : ''}`);
    this.status = status;
    this.path = path;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * makeRequest(fetcher) -> request(path, { method, body }) resolving to parsed JSON (or null for 204).
 * fetcher(path, init) must return a fetch Response-like object ({ status, ok, headers.get, json, text }).
 */
export function makeRequest(fetcher, { retries = 3, baseDelayMs = 1000, wait = sleep } = {}) {
  return async function request(path, { method = 'GET', body } = {}) {
    for (let attempt = 0; ; attempt++) {
      const res = await fetcher(path, {
        method,
        headers: { Accept: 'application/json', ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if ((res.status === 429 || res.status === 503) && attempt < retries) {
        const after = Number(res.headers?.get?.('Retry-After'));
        await wait(Number.isFinite(after) && after > 0 ? after * 1000 : baseDelayMs * 2 ** attempt);
        continue;
      }
      if (res.status === 204) return null;
      if (!res.ok) {
        let detail = '';
        try {
          const j = await res.json();
          detail = [...(j.errorMessages ?? []), ...Object.values(j.errors ?? {})].join('; ');
        } catch {
          /* no JSON body */
        }
        throw new JiraError(res.status, path, detail);
      }
      const text = await res.text();
      return text ? JSON.parse(text) : null;
    }
  };
}
