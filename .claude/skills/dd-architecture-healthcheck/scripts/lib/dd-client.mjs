// Minimal Datadog API client — no npm install required (Node 18+ global fetch).
// Ports the pagination/rate-limit/retry behavior of backend/src/datadog/client.ts
// so a single resource can be pulled in isolation without the full app running.

function readCreds() {
  const site = process.env.DD_SITE || 'datadoghq.com';
  const apiKey = process.env.DD_API_KEY;
  const appKey = process.env.DD_APP_KEY;
  if (!apiKey || !appKey) {
    throw new Error(
      'DD_API_KEY and DD_APP_KEY must be set in the environment (never pass them as CLI args — they would land in shell history/process listings).'
    );
  }
  return { site, apiKey, appKey };
}

export class DDClient {
  constructor() {
    const { site, apiKey, appKey } = readCreds();
    this.baseUrl = `https://api.${site}`;
    this.headers = {
      'DD-API-KEY': apiKey,
      'DD-APPLICATION-KEY': appKey,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };
    this.rateLimitRemaining = 1000;
    this.rateLimitReset = 0;
  }

  async _checkRateLimit() {
    if (this.rateLimitRemaining < 5) {
      const now = Math.floor(Date.now() / 1000);
      const wait = Math.max(0, this.rateLimitReset - now + 1) * 1000;
      if (wait > 0 && wait < 60000) await new Promise((r) => setTimeout(r, wait));
    } else if (this.rateLimitRemaining < 20) {
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  async _requestWithRetry(url, opts, maxAttempts = 3) {
    let attempt = 0;
    while (true) {
      attempt++;
      await this._checkRateLimit();
      const res = await fetch(url, { ...opts, headers: this.headers });
      const remaining = res.headers.get('x-ratelimit-remaining');
      const reset = res.headers.get('x-ratelimit-reset');
      if (remaining) this.rateLimitRemaining = parseInt(remaining, 10);
      if (reset) this.rateLimitReset = parseInt(reset, 10);

      if (res.status === 429 && attempt < maxAttempts) {
        const retryAfter = res.headers.get('retry-after');
        let waitMs = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : Math.max(0, this.rateLimitReset - Math.floor(Date.now() / 1000) + 1) * 1000;
        waitMs = Math.min(Math.max(waitMs || 1000 * attempt, 500), 30000);
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      return res;
    }
  }

  _buildUrl(endpoint, params = {}) {
    const url = new URL(this.baseUrl + endpoint);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
    return url;
  }

  _extractData(json) {
    if (!json || typeof json !== 'object') return [];
    if (Array.isArray(json.data)) return json.data;
    if (Array.isArray(json.host_list)) return json.host_list;
    if (Array.isArray(json)) return json;
    if (Array.isArray(json.metrics)) return json.metrics;
    if (Array.isArray(json.tests)) return json.tests;
    if (Array.isArray(json.indexes)) return json.indexes;
    if (Array.isArray(json.pipelines)) return json.pipelines;
    if (Array.isArray(json.dashboards)) return json.dashboards;
    if (Array.isArray(json.accounts)) return json.accounts;
    if (Array.isArray(json.orgs)) return json.orgs;
    return [];
  }

  async _handleResponse(res, endpoint, collectedAt, requestCount) {
    if (res.status === 401 || res.status === 403) {
      return { status: 'permission_denied', error: `HTTP ${res.status}: permission denied`, endpoint, data: [], itemCount: 0, collectedAt, requestCount };
    }
    if (res.status === 404) {
      return { status: 'not_available', error: 'endpoint not available', endpoint, data: [], itemCount: 0, collectedAt, requestCount };
    }
    if (res.status === 422 || res.status === 400) {
      return { status: 'not_detected', error: 'feature not enabled / integration not configured', endpoint, data: [], itemCount: 0, collectedAt, requestCount };
    }
    if (!res.ok) {
      let error = `HTTP ${res.status}`;
      try {
        const body = await res.json();
        if (body?.errors?.length) error = body.errors[0];
      } catch {}
      return { status: 'error', error, endpoint, data: [], itemCount: 0, collectedAt, requestCount };
    }
    return null;
  }

  // Single-shot GET, no pagination — use for endpoints that already return everything (e.g. config probes).
  async get(endpoint, params = {}) {
    const collectedAt = new Date().toISOString();
    const url = this._buildUrl(endpoint, params);
    const res = await this._requestWithRetry(url, { method: 'GET' });
    const errResult = await this._handleResponse(res, endpoint, collectedAt, 1);
    if (errResult) return errResult;
    const json = await res.json();
    const data = this._extractData(json);
    return { status: 'success', endpoint, data, itemCount: data.length, collectedAt, requestCount: 1, raw: data.length ? undefined : json };
  }

  // Raw GET — returns the parsed body untouched (for single-object responses like usage summaries).
  async getRaw(endpoint, params = {}) {
    const collectedAt = new Date().toISOString();
    const url = this._buildUrl(endpoint, params);
    const res = await this._requestWithRetry(url, { method: 'GET' });
    const errResult = await this._handleResponse(res, endpoint, collectedAt, 1);
    if (errResult) return { ...errResult, data: null };
    const json = await res.json();
    return { status: 'success', endpoint, data: json, collectedAt, requestCount: 1 };
  }

  // v1-style page-index pagination: ?page=N&count=1000
  async getPaginated(endpoint, params = {}, maxPages = 20) {
    const collectedAt = new Date().toISOString();
    const allData = [];
    let page = 0, hasMore = true, requestCount = 0;
    while (hasMore && page < maxPages) {
      const url = this._buildUrl(endpoint, { ...params, page, count: 1000 });
      const res = await this._requestWithRetry(url, { method: 'GET' });
      requestCount++;
      const errResult = await this._handleResponse(res, endpoint, collectedAt, requestCount);
      if (errResult) return allData.length ? { status: 'success', endpoint, data: allData, itemCount: allData.length, collectedAt, requestCount, truncated: hasMore } : errResult;
      const json = await res.json();
      const pageData = this._extractData(json);
      allData.push(...pageData);
      hasMore = pageData.length >= 1000;
      page++;
    }
    return { status: 'success', endpoint, data: allData, itemCount: allData.length, collectedAt, requestCount, pageCount: page, truncated: hasMore && page >= maxPages };
  }

  // v2-style cursor pagination: ?page[cursor]=...&page[limit]=100
  async getV2Paginated(endpoint, params = {}, maxPages = 20) {
    const collectedAt = new Date().toISOString();
    const allData = [];
    let cursor, pageCount = 0, requestCount = 0, hasMoreAtStop = false;
    while (pageCount < maxPages) {
      const q = { ...params, 'page[limit]': 100 };
      if (cursor) q['page[cursor]'] = cursor;
      const url = this._buildUrl(endpoint, q);
      const res = await this._requestWithRetry(url, { method: 'GET' });
      requestCount++;
      const errResult = await this._handleResponse(res, endpoint, collectedAt, requestCount);
      if (errResult) return allData.length ? { status: 'success', endpoint, data: allData, itemCount: allData.length, collectedAt, requestCount, pageCount, truncated: hasMoreAtStop } : errResult;
      const json = await res.json();
      const pageData = Array.isArray(json?.data) ? json.data : [];
      allData.push(...pageData);
      cursor = json?.meta?.pagination?.next_cursor;
      pageCount++;
      if (!cursor || pageData.length === 0) { hasMoreAtStop = false; break; }
      hasMoreAtStop = true;
    }
    return { status: 'success', endpoint, data: allData, itemCount: allData.length, collectedAt, requestCount, pageCount, truncated: hasMoreAtStop && pageCount >= maxPages };
  }
}
