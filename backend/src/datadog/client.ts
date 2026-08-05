import axios, { AxiosInstance, AxiosError, AxiosResponse } from 'axios';
import { logger } from '../utils/logger';
import { redactString } from '../utils/redact';
import type { DatadogSite, DDCollectionResult, DDValidationResult } from '../types/datadog.types';

export interface DDClientConfig {
  site: DatadogSite;
  apiKey: string;
  appKey: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class DatadogClient {
  private readonly client: AxiosInstance;
  private readonly site: string;
  private rateLimitRemaining = 1000;
  private rateLimitReset = 0;

  constructor(config: DDClientConfig) {
    this.site = config.site;
    const baseURL = `https://api.${config.site}`;

    this.client = axios.create({
      baseURL,
      timeout: config.timeoutMs ?? 30000,
      headers: {
        'DD-API-KEY': config.apiKey,
        'DD-APPLICATION-KEY': config.appKey,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
    });

    this.client.interceptors.response.use(
      (response) => {
        const remaining = response.headers['x-ratelimit-remaining'];
        const reset = response.headers['x-ratelimit-reset'];
        if (remaining) this.rateLimitRemaining = parseInt(remaining);
        if (reset) this.rateLimitReset = parseInt(reset);
        return response;
      },
      (error) => {
        // Never log headers which may contain keys
        const safeMsg = error.message ? redactString(error.message) : 'Unknown error';
        logger.warn(`Datadog API error: ${safeMsg}`);
        return Promise.reject(error);
      }
    );
  }

  async validate(): Promise<DDValidationResult> {
    try {
      const response = await this.client.get('/api/v1/validate');
      const orgResponse = await this.client.get('/api/v1/org');
      const orgName = orgResponse.data?.orgs?.[0]?.name ?? orgResponse.data?.org?.name;
      const orgId = orgResponse.data?.orgs?.[0]?.public_id ?? orgResponse.data?.org?.public_id;
      return {
        valid: response.data?.valid === true,
        orgName,
        orgId,
      };
    } catch (err) {
      return {
        valid: false,
        error: this.extractErrorMessage(err),
      };
    }
  }

  async get<T>(endpoint: string, params?: Record<string, unknown>): Promise<DDCollectionResult<T>> {
    const collectedAt = new Date().toISOString();
    try {
      await this.checkRateLimit();
      const { response, attempts } = await this.requestWithRetry(() =>
        this.client.get<{ data?: T[]; [key: string]: unknown }>(endpoint, { params })
      );
      const data = this.extractData<T>(response.data, endpoint);
      return {
        data,
        status: 'success',
        endpoint,
        itemCount: data.length,
        collectedAt,
        requestCount: attempts,
        pageCount: 1,
        truncated: false,
        rateLimitRemaining: this.rateLimitRemaining,
      };
    } catch (err) {
      return this.handleCollectionError<T>(err, endpoint, collectedAt);
    }
  }

  async getPaginated<T>(
    endpoint: string,
    params: Record<string, unknown> = {},
    maxPages = 20
  ): Promise<DDCollectionResult<T>> {
    const collectedAt = new Date().toISOString();
    const allData: T[] = [];
    let page = 0;
    let hasMore = true;
    let requestCount = 0;

    try {
      while (hasMore && page < maxPages) {
        await this.checkRateLimit();
        const { response, attempts } = await this.requestWithRetry(() =>
          this.client.get<Record<string, unknown>>(endpoint, {
            params: { ...params, page, count: 1000 },
          })
        );
        requestCount += attempts;

        const pageData = this.extractData<T>(response.data, endpoint);
        allData.push(...pageData);

        hasMore = pageData.length >= 1000;
        page++;
      }

      return {
        data: allData,
        status: 'success',
        endpoint,
        itemCount: allData.length,
        collectedAt,
        requestCount,
        pageCount: page,
        truncated: hasMore && page >= maxPages,
        rateLimitRemaining: this.rateLimitRemaining,
      };
    } catch (err) {
      if (allData.length > 0) {
        return {
          data: allData, status: 'success', endpoint, itemCount: allData.length, collectedAt,
          requestCount, pageCount: page, truncated: hasMore, rateLimitRemaining: this.rateLimitRemaining,
        };
      }
      return this.handleCollectionError<T>(err, endpoint, collectedAt);
    }
  }

  async getV2Paginated<T>(
    endpoint: string,
    params: Record<string, unknown> = {},
    maxPages = 20
  ): Promise<DDCollectionResult<T>> {
    const collectedAt = new Date().toISOString();
    const allData: T[] = [];
    let cursor: string | undefined;
    let pageCount = 0;
    let requestCount = 0;
    let hasMoreAtStop = false;

    try {
      while (pageCount < maxPages) {
        await this.checkRateLimit();
        const queryParams: Record<string, unknown> = { ...params, 'page[limit]': 100 };
        if (cursor) queryParams['page[cursor]'] = cursor;

        const { response, attempts } = await this.requestWithRetry(() =>
          this.client.get<{ data?: T[]; meta?: { pagination?: { next_cursor?: string } } }>(
            endpoint, { params: queryParams }
          )
        );
        requestCount += attempts;

        const pageData = Array.isArray(response.data?.data) ? response.data.data : [];
        allData.push(...pageData);
        cursor = response.data?.meta?.pagination?.next_cursor;
        pageCount++;
        if (!cursor || pageData.length === 0) { hasMoreAtStop = false; break; }
        hasMoreAtStop = true;
      }

      return {
        data: allData,
        status: 'success',
        endpoint,
        itemCount: allData.length,
        collectedAt,
        requestCount,
        pageCount,
        truncated: hasMoreAtStop && pageCount >= maxPages,
        rateLimitRemaining: this.rateLimitRemaining,
      };
    } catch (err) {
      if (allData.length > 0) {
        return {
          data: allData, status: 'success', endpoint, itemCount: allData.length, collectedAt,
          requestCount, pageCount, truncated: Boolean(cursor), rateLimitRemaining: this.rateLimitRemaining,
        };
      }
      return this.handleCollectionError<T>(err, endpoint, collectedAt);
    }
  }

  async getRaw<T = unknown>(endpoint: string, params?: Record<string, unknown>): Promise<{ data: T | null; status: 'success' | 'permission_denied' | 'not_available' | 'error'; error?: string }> {
    try {
      await this.checkRateLimit();
      const { response } = await this.requestWithRetry(() => this.client.get<T>(endpoint, { params }));
      return { data: response.data, status: 'success' };
    } catch (err) {
      const result = this.handleCollectionError<unknown>(err, endpoint, new Date().toISOString());
      return { data: null, status: result.status as 'permission_denied' | 'not_available' | 'error', error: result.error };
    }
  }

  getRateLimitInfo(): { remaining: number; resetAt: number } {
    return { remaining: this.rateLimitRemaining, resetAt: this.rateLimitReset };
  }

  private async checkRateLimit(): Promise<void> {
    if (this.rateLimitRemaining < 5) {
      const now = Math.floor(Date.now() / 1000);
      const wait = Math.max(0, this.rateLimitReset - now + 1) * 1000;
      if (wait > 0 && wait < 60000) {
        logger.warn(`Rate limit nearly exhausted, waiting ${wait}ms`);
        await new Promise((r) => setTimeout(r, wait));
      }
    } else if (this.rateLimitRemaining < 20) {
      // Lighter proactive pacing before things get critical — smooths consumption
      // for large orgs making hundreds of paginated requests in one scan.
      await new Promise((r) => setTimeout(r, 300));
    }
  }

  // Retries a request on HTTP 429 (rate limited), honoring `retry-after` or the
  // `x-ratelimit-reset` header. Non-429 errors propagate immediately.
  private async requestWithRetry<T>(
    fn: () => Promise<AxiosResponse<T>>,
    maxAttempts = 3
  ): Promise<{ response: AxiosResponse<T>; attempts: number }> {
    let attempt = 0;
    while (true) {
      attempt++;
      try {
        const response = await fn();
        return { response, attempts: attempt };
      } catch (err) {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined;
        if (status === 429 && attempt < maxAttempts) {
          const headers = (err as AxiosError).response?.headers ?? {};
          const retryAfter = headers['retry-after'] as string | number | undefined;
          const resetHeader = headers['x-ratelimit-reset'] as string | number | undefined;
          let waitMs = 1000 * attempt;
          if (retryAfter) waitMs = parseInt(String(retryAfter)) * 1000;
          else if (resetHeader) waitMs = Math.max(0, parseInt(String(resetHeader)) - Math.floor(Date.now() / 1000) + 1) * 1000;
          waitMs = Math.min(Math.max(waitMs, 500), 30000);
          logger.warn(`Rate limited (429), retrying in ${waitMs}ms (attempt ${attempt}/${maxAttempts})`);
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }
        throw err;
      }
    }
  }

  private extractData<T>(responseData: unknown, endpoint: string): T[] {
    if (!responseData || typeof responseData !== 'object') return [];
    const data = responseData as Record<string, unknown>;

    // v2 standard: { data: [...] }
    if (Array.isArray(data.data)) return data.data as T[];
    // v1 hosts: { host_list: [...] }
    if (Array.isArray(data.host_list)) return data.host_list as T[];
    // v1 monitors: top-level array
    if (Array.isArray(responseData)) return responseData as T[];
    // v1 metrics: { metrics: [...] }
    if (Array.isArray(data.metrics)) return data.metrics as T[];
    // synthetics: { tests: [...] }
    if (Array.isArray(data.tests)) return data.tests as T[];
    // logs indexes: { indexes: [...] }
    if (Array.isArray(data.indexes)) return data.indexes as T[];
    // logs pipelines: { pipelines: [...] }
    if (Array.isArray(data.pipelines)) return data.pipelines as T[];
    // dashboards: { dashboards: [...] }
    if (Array.isArray(data.dashboards)) return data.dashboards as T[];
    // AWS integration: { accounts: [...] }
    if (Array.isArray(data.accounts)) return data.accounts as T[];
    // SLOs: { data: [...] } already handled
    // Single object responses: wrap
    if (data.orgs && Array.isArray(data.orgs)) return data.orgs as T[];

    logger.debug(`Unknown data shape from ${endpoint}, keys: ${Object.keys(data).join(',')}`);
    return [];
  }

  private handleCollectionError<T>(
    err: unknown,
    endpoint: string,
    collectedAt: string
  ): DDCollectionResult<T> {
    const base = { data: [], endpoint, itemCount: 0, collectedAt, requestCount: 1, pageCount: 0, truncated: false, rateLimitRemaining: this.rateLimitRemaining };
    if (axios.isAxiosError(err)) {
      const status = (err as AxiosError).response?.status;
      if (status === 403 || status === 401) {
        return { ...base, status: 'permission_denied', error: `HTTP ${status}: Permission denied` };
      }
      if (status === 404) {
        return { ...base, status: 'not_available', error: 'Endpoint not available' };
      }
      if (status === 422) {
        return { ...base, status: 'not_detected', error: 'Feature not enabled or detected' };
      }
      if (status === 400) {
        return { ...base, status: 'not_detected', error: 'Integration not configured in this org' };
      }
    }
    return { ...base, status: 'error', error: this.extractErrorMessage(err) };
  }

  private extractErrorMessage(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const axiosErr = err as AxiosError<{ errors?: string[] }>;
      const errors = axiosErr.response?.data?.errors;
      if (errors?.length) return errors[0];
      return `HTTP ${axiosErr.response?.status ?? 'unknown'}: ${axiosErr.message}`;
    }
    if (err instanceof Error) return err.message;
    return 'Unknown error';
  }
}

export function createClient(config: DDClientConfig): DatadogClient {
  return new DatadogClient(config);
}
