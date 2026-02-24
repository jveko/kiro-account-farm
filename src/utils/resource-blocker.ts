/**
 * Browser Resource Blocker & Disk Cache
 * Blocks non-AWS tracking requests and caches static assets
 * to reduce bandwidth usage during automation
 */

import type { Page, HTTPRequest } from "puppeteer-core";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";

/**
 * Non-AWS domains safe to block (third-party tracking/ads)
 * AWS tracking/analytics are kept to maintain consistent session data
 */
const BLOCKED_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "facebook.net",
  "hotjar.com",
  "sentry.io",
];

/**
 * Resource types safe to block (never needed for form automation)
 */
const BLOCKED_RESOURCE_TYPES = new Set([
  "image",
  "media",
]);

/**
 * URL patterns to block
 */
const BLOCKED_URL_PATTERNS = [
  "/favicon.ico",
];

/**
 * Resource types eligible for disk caching
 */
const CACHEABLE_RESOURCE_TYPES = new Set([
  "script",
  "stylesheet",
  "font",
]);

const CACHE_DIR = join(import.meta.dir, "../../.cache/resources");

/**
 * Generate a cache key from a URL
 */
function cacheKey(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  const urlPath = new URL(url).pathname;
  const filename = urlPath.split("/").pop() || "unknown";
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `${hash}-${safe}`;
}

/**
 * Read a cached response from disk
 */
async function readCache(url: string): Promise<{ body: Buffer; contentType: string } | null> {
  const key = cacheKey(url);
  const bodyPath = join(CACHE_DIR, key);
  const metaPath = join(CACHE_DIR, `${key}.meta`);

  if (!existsSync(bodyPath) || !existsSync(metaPath)) return null;

  try {
    const [body, metaRaw] = await Promise.all([
      readFile(bodyPath),
      readFile(metaPath, "utf-8"),
    ]);
    const meta = JSON.parse(metaRaw);
    return { body, contentType: meta.contentType || "application/octet-stream" };
  } catch {
    return null;
  }
}

/**
 * Write a response to disk cache
 */
async function writeCache(url: string, body: Buffer, contentType: string): Promise<void> {
  try {
    await mkdir(CACHE_DIR, { recursive: true });
    const key = cacheKey(url);
    await Promise.all([
      writeFile(join(CACHE_DIR, key), body),
      writeFile(join(CACHE_DIR, `${key}.meta`), JSON.stringify({
        url,
        contentType,
        cachedAt: new Date().toISOString(),
      })),
    ]);
  } catch {
    // Cache write failure is non-fatal
  }
}

let cacheHits = 0;
let cacheMisses = 0;
const cachedUrls = new Set<string>();

/**
 * Get cache stats for logging
 */
export function getCacheStats(): { hits: number; misses: number } {
  return { hits: cacheHits, misses: cacheMisses };
}

/**
 * Check if a URL was served from disk cache
 */
export function wasCached(url: string): boolean {
  return cachedUrls.has(url);
}

/**
 * Reset cache stats (call at start of each worker run)
 */
export function resetCacheStats(): void {
  cacheHits = 0;
  cacheMisses = 0;
  cachedUrls.clear();
}

/**
 * Handle a cacheable request: serve from disk or let it through and cache the response
 */
async function handleCacheableRequest(request: HTTPRequest, page: Page): Promise<boolean> {
  const url = request.url();

  // Try serving from disk cache
  const cached = await readCache(url);
  if (cached) {
    cacheHits++;
    cachedUrls.add(url);
    await request.respond({
      status: 200,
      contentType: cached.contentType,
      body: cached.body,
    }).catch(() => {});
    return true;
  }

  // Cache miss — let the request through, then cache the response
  cacheMisses++;

  const responseHandler = async (response: import("puppeteer-core").HTTPResponse) => {
    if (response.url() !== url) return;
    page.off("response", responseHandler);

    try {
      const buffer = await response.buffer();
      const contentType = response.headers()["content-type"] || "application/octet-stream";
      if (buffer.length > 0) {
        await writeCache(url, buffer, contentType);
      }
    } catch {
      // Response body may not be available (redirects, etc.)
    }
  };

  page.on("response", responseHandler);
  request.continue().catch(() => {});
  return true;
}

/**
 * Enable request interception to block non-AWS trackers and cache static assets
 */
export async function enableResourceBlocking(page: Page): Promise<void> {
  await page.setRequestInterception(true);

  page.on("request", (request) => {
    const resourceType = request.resourceType();

    // Block images and media only
    if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
      request.abort().catch(() => {});
      return;
    }

    const url = request.url();

    // Block non-AWS third-party trackers
    if (BLOCKED_DOMAINS.some((domain) => url.includes(domain))) {
      request.abort().catch(() => {});
      return;
    }

    // Block specific URL patterns
    if (BLOCKED_URL_PATTERNS.some((pattern) => url.includes(pattern))) {
      request.abort().catch(() => {});
      return;
    }

    // Cache all static assets (scripts, stylesheets, fonts) from any domain
    if (CACHEABLE_RESOURCE_TYPES.has(resourceType)) {
      handleCacheableRequest(request, page).catch(() => {
        request.continue().catch(() => {});
      });
      return;
    }

    request.continue().catch(() => {});
  });
}
