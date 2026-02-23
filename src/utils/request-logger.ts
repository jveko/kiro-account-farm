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

const LOG_DIR = "output/logs";

const SKIP_RESOURCE_TYPES = new Set([
  "stylesheet",
  "script",
  "image",
  "font",
  "media",
]);

/**
 * Create a request logger for a Puppeteer page
 */
export function createRequestLogger(page: Page, sessionId: string): RequestLogger {
  const entries: RequestLogEntry[] = [];
  const pendingRequests = new Map<string, { entry: RequestLogEntry; startTime: number }>();
  let isActive = false;

  const onRequest = (request: HTTPRequest) => {
    if (!isActive) return;
    
    // Skip static assets
    if (SKIP_RESOURCE_TYPES.has(request.resourceType())) return;

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
