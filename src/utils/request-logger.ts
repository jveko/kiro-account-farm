/**
 * Request Logger
 * Captures and stores browser network requests for debugging
 */

import type { Page, HTTPRequest, HTTPResponse } from "puppeteer-core";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface RequestLogEntry {
  timestamp: string;
  method: string;
  url: string;
  resourceType: string;
  headers: Record<string, string>;
  postData?: string;
  response?: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body?: string;
    timing?: number;
  };
  error?: string;
}

export interface RequestLogger {
  entries: RequestLogEntry[];
  start: () => void;
  stop: () => void;
  save: () => Promise<string>;
  clear: () => void;
}

const LOG_DIR = join("output", "logs");

const SKIP_RESOURCE_TYPES = new Set([
  "stylesheet",
  "script",
  "image",
  "font",
  "media",
]);

// Capture all resource types when profiling bandwidth
const SKIP_RESOURCE_TYPES_NONE = new Set<string>();

/**
 * Create a request logger for a Puppeteer page
 */
export function createRequestLogger(page: Page, sessionId: string, options?: { captureAll?: boolean }): RequestLogger {
  const entries: RequestLogEntry[] = [];
  const pendingRequests = new Map<string, { entry: RequestLogEntry; startTime: number }>();
  let isActive = false;
  const skipTypes = options?.captureAll ? SKIP_RESOURCE_TYPES_NONE : SKIP_RESOURCE_TYPES;

  const onRequest = (request: HTTPRequest) => {
    if (!isActive) return;
    
    // Skip static assets
    if (skipTypes.has(request.resourceType())) return;

    const entry: RequestLogEntry = {
      timestamp: new Date().toISOString(),
      method: request.method(),
      url: request.url(),
      resourceType: request.resourceType(),
      headers: request.headers(),
      postData: request.postData(),
    };

    pendingRequests.set(request.url() + request.method(), {
      entry,
      startTime: Date.now(),
    });
  };

  const onResponse = async (response: HTTPResponse) => {
    if (!isActive) return;

    const request = response.request();
    const key = request.url() + request.method();
    const pending = pendingRequests.get(key);

    if (pending) {
      let body: string | undefined;
      
      // Try to capture response body for API calls
      const contentType = response.headers()["content-type"] || "";
      const isApiResponse = contentType.includes("application/json") || 
                            contentType.includes("text/") ||
                            request.resourceType() === "fetch" ||
                            request.resourceType() === "xhr";
      
      if (isApiResponse) {
        try {
          body = await response.text();
          // Truncate large responses
          if (body.length > 10000) {
            body = body.substring(0, 10000) + "... [truncated]";
          }
        } catch {
          // Response body may not be available
        }
      }

      pending.entry.response = {
        status: response.status(),
        statusText: response.statusText(),
        headers: response.headers(),
        body,
        timing: Date.now() - pending.startTime,
      };
      entries.push(pending.entry);
      pendingRequests.delete(key);
    }
  };

  const onRequestFailed = (request: HTTPRequest) => {
    if (!isActive) return;

    const key = request.url() + request.method();
    const pending = pendingRequests.get(key);

    if (pending) {
      pending.entry.error = request.failure()?.errorText || "Unknown error";
      entries.push(pending.entry);
      pendingRequests.delete(key);
    }
  };

  return {
    entries,

    start() {
      isActive = true;
      page.on("request", onRequest);
      page.on("response", onResponse);
      page.on("requestfailed", onRequestFailed);
    },

    stop() {
      isActive = false;
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfailed", onRequestFailed);

      // Flush pending requests
      for (const [, pending] of pendingRequests) {
        pending.entry.error = "Request incomplete (logger stopped)";
        entries.push(pending.entry);
      }
      pendingRequests.clear();
    },

    async save(): Promise<string> {
      await mkdir(LOG_DIR, { recursive: true });

      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filename = `requests-${sessionId}-${timestamp}.json`;
      const filepath = join(LOG_DIR, filename);

      const summary = {
        sessionId,
        capturedAt: new Date().toISOString(),
        totalRequests: entries.length,
        byStatus: entries.reduce(
          (acc, e) => {
            const status = e.response?.status || 0;
            const key = status === 0 ? "failed" : `${Math.floor(status / 100)}xx`;
            acc[key] = (acc[key] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        ),
        requests: entries,
      };

      await Bun.write(filepath, JSON.stringify(summary, null, 2));
      return filepath;
    },

    clear() {
      entries.length = 0;
      pendingRequests.clear();
    },
  };
}

export interface BandwidthSummary {
  totalBytes: number;
  networkBytes: number;
  cachedBytes: number;
  totalRequests: number;
  networkRequests: number;
  cachedRequests: number;
  byResourceType: Record<string, { count: number; bytes: number; cached: number; cachedBytes: number }>;
  byDomain: Record<string, { count: number; bytes: number; cached: number; cachedBytes: number }>;
  topRequests: { url: string; bytes: number; resourceType: string; cached: boolean }[];
}

/**
 * Summarize bandwidth usage from captured request entries.
 * Separates network vs cache-served traffic when a cache checker is provided.
 */
export function summarizeBandwidth(
  entries: RequestLogEntry[],
  isCached?: (url: string) => boolean
): BandwidthSummary {
  const byResourceType: Record<string, { count: number; bytes: number; cached: number; cachedBytes: number }> = {};
  const byDomain: Record<string, { count: number; bytes: number; cached: number; cachedBytes: number }> = {};
  const allRequests: { url: string; bytes: number; resourceType: string; cached: boolean }[] = [];
  let totalBytes = 0;
  let networkBytes = 0;
  let cachedBytes = 0;
  let networkRequests = 0;
  let cachedRequests = 0;

  for (const entry of entries) {
    const contentLength = Number(entry.response?.headers?.["content-length"] || 0);
    const bodyLength = entry.response?.body?.length || 0;
    const bytes = contentLength || bodyLength;
    totalBytes += bytes;

    const cached = isCached ? isCached(entry.url) : false;
    if (cached) {
      cachedBytes += bytes;
      cachedRequests++;
    } else {
      networkBytes += bytes;
      networkRequests++;
    }

    // By resource type
    const rt = entry.resourceType || "other";
    if (!byResourceType[rt]) byResourceType[rt] = { count: 0, bytes: 0, cached: 0, cachedBytes: 0 };
    byResourceType[rt].count++;
    byResourceType[rt].bytes += bytes;
    if (cached) {
      byResourceType[rt].cached++;
      byResourceType[rt].cachedBytes += bytes;
    }

    // By domain
    let domain: string;
    try {
      domain = new URL(entry.url).hostname;
    } catch {
      domain = "unknown";
    }
    if (!byDomain[domain]) byDomain[domain] = { count: 0, bytes: 0, cached: 0, cachedBytes: 0 };
    byDomain[domain]!.count++;
    byDomain[domain]!.bytes += bytes;
    if (cached) {
      byDomain[domain]!.cached++;
      byDomain[domain]!.cachedBytes += bytes;
    }

    allRequests.push({ url: entry.url, bytes, resourceType: rt, cached });
  }

  // Top 20 requests by size
  const topRequests = allRequests
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 20);

  return {
    totalBytes, networkBytes, cachedBytes,
    totalRequests: entries.length, networkRequests, cachedRequests,
    byResourceType, byDomain, topRequests,
  };
}

/**
 * Format bandwidth summary as a human-readable string
 */
export function formatBandwidthSummary(summary: BandwidthSummary): string {
  const fmt = (bytes: number) => {
    if (bytes > 1_000_000) return `${(bytes / 1_000_000).toFixed(2)} MB`;
    if (bytes > 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
    return `${bytes} B`;
  };

  const lines: string[] = [
    `\n═══ BANDWIDTH SUMMARY ═══`,
    `Total: ${fmt(summary.totalBytes)} across ${summary.totalRequests} requests`,
  ];

  if (summary.cachedRequests > 0) {
    lines.push(`  Network: ${fmt(summary.networkBytes)} (${summary.networkRequests} reqs)`);
    lines.push(`  Cached:  ${fmt(summary.cachedBytes)} (${summary.cachedRequests} reqs, served from disk)`);
  }

  lines.push(``, `── By Resource Type ──`);
  const sortedTypes = Object.entries(summary.byResourceType)
    .sort(([, a], [, b]) => b.bytes - a.bytes);
  for (const [type, { count, bytes, cached, cachedBytes }] of sortedTypes) {
    const cacheNote = cached > 0 ? `  [${cached} cached: ${fmt(cachedBytes)}]` : "";
    lines.push(`  ${type.padEnd(14)} ${fmt(bytes).padStart(10)}  (${count} reqs)${cacheNote}`);
  }

  lines.push(``, `── By Domain (top 15) ──`);
  const sortedDomains = Object.entries(summary.byDomain)
    .sort(([, a], [, b]) => b.bytes - a.bytes)
    .slice(0, 15);
  for (const [domain, { count, bytes, cached, cachedBytes }] of sortedDomains) {
    const cacheNote = cached > 0 ? `  [${cached} cached: ${fmt(cachedBytes)}]` : "";
    lines.push(`  ${domain.padEnd(40)} ${fmt(bytes).padStart(10)}  (${count} reqs)${cacheNote}`);
  }

  lines.push(``, `── Top 10 Largest Requests ──`);
  for (const { url, bytes, resourceType, cached } of summary.topRequests.slice(0, 10)) {
    const shortUrl = url.length > 80 ? url.substring(0, 77) + "..." : url;
    const tag = cached ? "💾" : "🌐";
    lines.push(`  ${tag} ${fmt(bytes).padStart(10)}  [${resourceType}] ${shortUrl}`);
  }

  lines.push(`═════════════════════════\n`);
  return lines.join("\n");
}

/**
 * Filter entries by domain or pattern
 */
export function filterEntries(
  entries: RequestLogEntry[],
  filter: { domain?: string; pattern?: RegExp; resourceType?: string }
): RequestLogEntry[] {
  return entries.filter((e) => {
    if (filter.domain && !e.url.includes(filter.domain)) return false;
    if (filter.pattern && !filter.pattern.test(e.url)) return false;
    if (filter.resourceType && e.resourceType !== filter.resourceType) return false;
    return true;
  });
}
