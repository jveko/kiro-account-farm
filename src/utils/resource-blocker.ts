/**
 * Browser Resource Blocker & Disk Cache
 * Blocks unnecessary network requests and caches large static assets
 * to reduce bandwidth usage during automation
 */

import type { Page, HTTPRequest } from "puppeteer-core";
import { existsSync } from "fs";
import { mkdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { createHash } from "crypto";

/**
 * Domains that are safe to block (analytics, tracking, ads)
 * Only exact domain matches — no substring matching on URLs
 */
const BLOCKED_DOMAINS = [
  // Google tracking
  "google-analytics.com",
  "googletagmanager.com",
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "facebook.net",
  "hotjar.com",
  "sentry.io",
  // AWS telemetry/analytics (54+ failed requests per run, adds latency)
  "shortbread.aws.dev",
  "shortbread.console.api.aws",
  "shortbread.analytics.console.aws.a2z.com",
  "prod.log.shortbread.aws.dev",
  "prod.tools.shortbread.aws.dev",
  "prod.log.shortbread.console.api.aws",
  "prod.tools.shortbread.console.api.aws",
  "prod.log.shortbread.analytics.console.aws.a2z.com",
  "prod.tools.shortbread.analytics.console.aws.a2z.com",
  "prod.tools.shortbread.panorama.console.api.aws",
  // AWS logging/metrics
  "log.sso-portal.us-east-1.amazonaws.com",
  "d2c.aws.amazon.com",
  "unagi-na.amazon.com",
  "us-east-1.prod.pl.panorama.console.api.aws",
  "vs.aws.amazon.com",
];

/**
 * Resource types that are safe to block for form automation
 */
const BLOCKED_RESOURCE_TYPES = new Set([
  "image",
  "media",
  "font",
]);

/**
 * URL patterns to block (e.g., favicon from local proxy — 285 KB per run)
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
]);

/**
 * Domains whose static assets are cacheable (large JS/CSS bundles)
 */
const CACHEABLE_DOMAINS = [
  "profile.aws.amazon.com",
  "us-east-1.signin.aws",
  "assets.sso-portal.us-east-1.amazonaws.com",
];

const CACHE_DIR = join(import.meta.dir, "../../.cache/resources");

/**
 * Generate a cache key from a URL
 */
function cacheKey(url: string): string {
  const hash = createHash("sha256").update(url).digest("hex").slice(0, 16);
  // Extract filename for readability
  const urlPath = new URL(url).pathname;
  const filename = urlPath.split("/").pop() || "unknown";
  // Sanitize filename
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  return `${hash}-${safe}`;
}

/**
 * Check if a URL is cacheable (static asset from known domains)
 */
function isCacheable(url: string, resourceType: string): boolean {
  if (!CACHEABLE_RESOURCE_TYPES.has(resourceType)) return false;
  return CACHEABLE_DOMAINS.some((domain) => url.includes(domain));
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

  // Listen for the response to this specific request
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
 * Enable request interception to block unnecessary resources and cache static assets
 */
export async function enableResourceBlocking(page: Page): Promise<void> {
  await page.setRequestInterception(true);

  page.on("request", (request) => {
    const resourceType = request.resourceType();

    // Block images, media, fonts
    if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
      request.abort().catch(() => {});
      return;
    }

    // Allow stylesheets from domains required for SPA loading
    // view.awsapps.com loads its app bundle from assets.sso-portal
    if (resourceType === "stylesheet") {
      const url = request.url();
      if (url.includes("assets.sso-portal") || url.includes("view.awsapps.com")) {
        // Check cache for allowed stylesheets too
        if (isCacheable(url, resourceType)) {
          handleCacheableRequest(request, page).catch(() => {
            request.continue().catch(() => {});
          });
          return;
        }
        request.continue().catch(() => {});
        return;
      }
      request.abort().catch(() => {});
      return;
    }

    const url = request.url();

    // Block known tracking/analytics domains
    if (BLOCKED_DOMAINS.some((domain) => url.includes(domain))) {
      request.abort().catch(() => {});
      return;
    }

    // Block specific URL patterns (favicon, etc.)
    if (BLOCKED_URL_PATTERNS.some((pattern) => url.includes(pattern))) {
      request.abort().catch(() => {});
      return;
    }

    // Cache eligible static assets (scripts from known domains)
    if (isCacheable(url, resourceType)) {
      handleCacheableRequest(request, page).catch(() => {
        request.continue().catch(() => {});
      });
      return;
    }

    request.continue().catch(() => {});
  });
}
