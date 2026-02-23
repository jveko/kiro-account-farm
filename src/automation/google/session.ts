/**
 * Google Session Utilities - Login status and logout
 */
import type { Page } from "puppeteer-core";
import { URLS, TIMEOUTS } from "../../config";
import type { SessionResult } from "../../types/google";

export async function isLoggedIn(
  page: Page,
): Promise<{ loggedIn: boolean; reason: string }> {
  try {
    await page.goto(URLS.GOOGLE_MYACCOUNT, {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUTS.MEDIUM,
    });

    await page
      .waitForSelector("header#gb, #gb", { timeout: TIMEOUTS.SHORT })
      .catch(() => null);

    const currentUrl = page.url();

    if (currentUrl.includes("accounts.google.com/signin")) {
      return { loggedIn: false, reason: "Redirected to signin page" };
    }

    const profileElement = await page.$("header#gb, #gb");
    if (profileElement) {
      return { loggedIn: true, reason: "Google header found" };
    }

    return { loggedIn: false, reason: "No profile element found" };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { loggedIn: false, reason: `Error: ${errorMsg}` };
  }
}

export async function logout(page: Page): Promise<SessionResult> {
  try {
    await page.goto(URLS.GOOGLE_LOGOUT, {
      waitUntil: "domcontentloaded",
      timeout: TIMEOUTS.MEDIUM,
    });
    return { success: true };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}
