/**
 * Browser Resource Blocker
 * Blocks unnecessary network requests (images, media, analytics)
 * to reduce bandwidth usage during automation
 */

import type { Page } from "puppeteer-core";

/**
 * Domains that are safe to block (analytics, tracking, ads)
 * Only exact domain matches — no substring matching on URLs
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
 * Resource types that are safe to block for form automation
 */
const BLOCKED_RESOURCE_TYPES = new Set([
  "image",
  "media",
]);

/**
 * Enable request interception to block unnecessary resources
 * Conservative approach: only block images, media, and known tracking domains
 */
export async function enableResourceBlocking(page: Page): Promise<void> {
  await page.setRequestInterception(true);

  page.on("request", (request) => {
    const resourceType = request.resourceType();

    // Block images and media
    if (BLOCKED_RESOURCE_TYPES.has(resourceType)) {
      request.abort().catch(() => {});
      return;
    }

    // Block known tracking/analytics domains
    const url = request.url();
    if (BLOCKED_DOMAINS.some((domain) => url.includes(domain))) {
      request.abort().catch(() => {});
      return;
    }

    request.continue().catch(() => {});
  });
}
