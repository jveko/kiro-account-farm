/**
 * Google Login - Authentication functions for Google accounts
 */
import type { Page } from "puppeteer-core";
import { URLS, TIMEOUTS, WAIT, AUTOMATION_DELAYS } from "../../config";
import type { GoogleAccount, LoginResult } from "../../types/google";

async function wait(ms: number): Promise<void> {
  await Bun.sleep(ms);
}

// ============================================================
// URL Pattern Detection
// ============================================================

function isRecaptchaChallengeUrl(url: string): boolean {
  const captchaPatterns = [
    "accounts.google.com/v3/signin/challenge/recaptcha",
    "accounts.google.com/signin/v2/challenge/recaptcha",
    "accounts.google.com/v3/signin/challenge/ipp/collect",
  ];
  return captchaPatterns.some((pattern) => url.includes(pattern));
}

function isPasswordChallengeUrl(url: string): boolean {
  const passwordPatterns = [
    "accounts.google.com/v3/signin/challenge/pwd",
    "accounts.google.com/signin/v2/challenge/password",
  ];
  return passwordPatterns.some((pattern) => url.includes(pattern));
}

// ============================================================
// CAPTCHA Detection
// ============================================================

export function checkCaptchaVisible(page: Page): boolean {
  return isRecaptchaChallengeUrl(page.url());
}

export async function checkCaptchaInContent(page: Page): Promise<boolean> {
  const content = await page.content();
  return content.toLowerCase().includes("captcha");
}

// ============================================================
// Login Helpers
// ============================================================

async function enterEmail(page: Page, email: string): Promise<void> {
  await page.waitForSelector("#identifierId", {
    visible: true,
    timeout: TIMEOUTS.MEDIUM,
  });

  await page.type("#identifierId", email, { delay: AUTOMATION_DELAYS.TYPING_DELAY });
  await wait(AUTOMATION_DELAYS.AFTER_FILL);

  try {
    await wait(AUTOMATION_DELAYS.BEFORE_CLICK);
    await page.click("#identifierNext button");
  } catch {
    await page.keyboard.press("Enter");
  }

  await wait(AUTOMATION_DELAYS.AFTER_CLICK);

  const maxRetries = 10;
  for (let i = 0; i < maxRetries; i++) {
    const currentUrl = page.url();

    if (isPasswordChallengeUrl(currentUrl)) {
      return;
    }

    if (isRecaptchaChallengeUrl(currentUrl)) {
      return;
    }

    const errorText = await page.evaluate(() => {
      const errorEl = document.querySelector('[aria-live="assertive"]');
      return errorEl?.textContent?.trim() || "";
    });

    if (errorText) {
      throw new Error(`Email error: ${errorText}`);
    }

    await wait(WAIT.SHORT);
  }

  throw new Error(`Timeout waiting for password page after email entry`);
}

async function enterPassword(page: Page, password: string): Promise<void> {
  const url = page.url();
  if (!isPasswordChallengeUrl(url)) {
    throw new Error(
      `Unexpected page after email - expected password challenge, got: ${url}`
    );
  }

  await page.waitForSelector('input[type="password"][name="Passwd"]', {
    visible: true,
    timeout: TIMEOUTS.MEDIUM,
  });

  await wait(AUTOMATION_DELAYS.BETWEEN_STEPS);

  await page.type('input[type="password"][name="Passwd"]', password, {
    delay: AUTOMATION_DELAYS.TYPING_DELAY,
  });
  await wait(AUTOMATION_DELAYS.AFTER_FILL);

  try {
    await wait(AUTOMATION_DELAYS.BEFORE_CLICK);
    await page.click("#passwordNext button");
  } catch {
    await page.keyboard.press("Enter");
  }
}

function checkLoginErrors(content: string): string | null {
  const lowerContent = content.toLowerCase();

  const errorChecks = [
    { pattern: "wrong password", error: "Wrong password" },
    { pattern: "couldn't find your google account", error: "Account not found" },
    { pattern: "this account has been disabled", error: "Account disabled" },
    { pattern: "unusual activity", error: "Unusual activity detected" },
    { pattern: "verify it's you", error: "Additional verification required" },
    { pattern: "couldn't sign you in", error: "Could not sign in" },
    {
      pattern: "this browser or app may not be secure",
      error: "Browser not trusted",
    },
    { pattern: "captcha", error: "CAPTCHA required" },
  ];

  for (const check of errorChecks) {
    if (lowerContent.includes(check.pattern)) {
      return check.error;
    }
  }

  return null;
}

function isLoginSuccessful(url: string): boolean {
  const successIndicators = [
    "myaccount.google.com",
    "mail.google.com",
    "drive.google.com",
    "google.com/search",
    "gds.google.com/web/recoveryoptions",
  ];

  const isOnSuccessPage = successIndicators.some((indicator) =>
    url.includes(indicator)
  );

  const isOnChallengePage = url.includes(
    "accounts.google.com/signin/v2/challenge"
  );

  return isOnSuccessPage || (!isOnChallengePage && url.includes("google.com"));
}

// ============================================================
// Main Login Function
// ============================================================

export interface LoginCallbacks {
  onCaptchaRequired?: () => Promise<void>;
}

export async function loginGoogle(
  page: Page,
  account: GoogleAccount,
  callbacks?: LoginCallbacks,
  timeoutMs = TIMEOUTS.DEFAULT
): Promise<LoginResult> {
  try {
    await page.goto(URLS.GOOGLE_SIGNIN, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs,
    });

    await page
      .waitForSelector("#identifierId", { timeout: TIMEOUTS.SHORT })
      .catch(() => null);
    await wait(WAIT.ANIMATION);

    if (checkCaptchaVisible(page)) {
      if (callbacks?.onCaptchaRequired) {
        await callbacks.onCaptchaRequired();
        if (checkCaptchaVisible(page)) {
          return { success: false, error: "CAPTCHA not resolved" };
        }
      } else {
        return {
          success: false,
          requiresHuman: {
            kind: "captcha",
            message: "CAPTCHA required before email entry",
          },
        };
      }
    }

    await enterEmail(page, account.email);

    if (checkCaptchaVisible(page)) {
      if (callbacks?.onCaptchaRequired) {
        await callbacks.onCaptchaRequired();
        if (checkCaptchaVisible(page)) {
          return { success: false, error: "CAPTCHA not resolved after email" };
        }
      } else {
        return {
          success: false,
          requiresHuman: {
            kind: "captcha",
            message: "CAPTCHA required after email entry",
          },
        };
      }
    }

    await enterPassword(page, account.password);

    await wait(WAIT.LONG);

    const currentUrl = page.url();

    if (checkCaptchaVisible(page)) {
      if (callbacks?.onCaptchaRequired) {
        await callbacks.onCaptchaRequired();
        if (checkCaptchaVisible(page)) {
          return {
            success: false,
            error: "CAPTCHA not resolved after password",
          };
        }
      } else {
        return {
          success: false,
          requiresHuman: {
            kind: "captcha",
            message: "CAPTCHA required after password entry",
          },
        };
      }
    }

    const pageContent = await page.content();
    const loginError = checkLoginErrors(pageContent);

    if (loginError === "CAPTCHA required") {
      if (callbacks?.onCaptchaRequired) {
        await callbacks.onCaptchaRequired();
        const stillHasCaptcha = await checkCaptchaInContent(page);
        if (stillHasCaptcha) {
          return { success: false, error: "CAPTCHA still present after waiting" };
        }
      } else {
        return {
          success: false,
          requiresHuman: {
            kind: "captcha",
            message: "CAPTCHA detected in page content",
          },
        };
      }
    } else if (loginError) {
      return { success: false, error: loginError };
    }

    if (isLoginSuccessful(currentUrl)) {
      return { success: true };
    }

    return { success: false, error: "Login status unclear" };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return { success: false, error: errorMsg };
  }
}
