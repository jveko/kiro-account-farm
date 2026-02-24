/**
 * Registration Worker
 * Handles single AWS Builder ID account registration
 */

import type { Browser } from "puppeteer-core";
import { AWSDeviceAuthClient } from "../../api/aws-oidc";
import { validateToken } from "../../api/token-validator";
import { configureBrowserProxy, configureBrowserFingerprint, openBrowser, closeBrowser } from "../../services/browser";
import { launchLocalBrowser, closeLocalBrowser, authenticateProxy, type LocalBrowserSession } from "../../services/browser-local";
import { logSession } from "../../utils/logger";
// import { createRequestLogger, type RequestLogger } from "../../utils/request-logger";
import { fetchOtp } from "../../utils/email-provider";
import type { EmailProvider } from "../../types/provider";
import { MailtmClient } from "../../api/mailtm";
import { FreemailClient } from "../../api/freemail";
import { SessionManager } from "./session";
import { processPage, handleVerifyPage } from "./register";
import { createPageAutomationContext } from "./context";
import { AWS_BUILDER_ID, BROWSER_MODE, LOW_BANDWIDTH, FAST_MODE, TIMEOUTS } from "../../config";
import type { AWSBuilderIDAccount, SessionState, BatchProgress } from "../../types/aws-builder-id";
import { enableResourceBlocking } from "../../utils/resource-blocker";

export interface WorkerProxy {
  username: string;
  password: string;
  host: string;
  port: number;
}

/**
 * Error thrown when AWS returns a generic server error (likely IP-related)
 * Signals the orchestrator to retry with a different proxy/IP
 */
export class IPBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IPBlockedError";
  }
}

/**
 * Single registration worker
 * Uses existing browser profile (created by orchestrator)
 */
export async function registrationWorker(
  account: AWSBuilderIDAccount,
  provider: EmailProvider,
  sessionManager: SessionManager,
  proxy?: WorkerProxy,
  onProgress?: (progress: BatchProgress) => void,
  getProgress?: () => BatchProgress,
  existingBrowserId?: string,
  existingProfileName?: string,
  mailtmClient?: MailtmClient,
  freemailClient?: FreemailClient
): Promise<SessionState> {
  const sessionState = sessionManager.createSession(account);
  let browser: Browser | null = null;
  let localSession: LocalBrowserSession | null = null;
  // let requestLogger: RequestLogger | null = null;
  const browserId = existingBrowserId || "";
  const profileName = existingProfileName || "default";

  try {
    // Update status to running
    sessionManager.updateSession(sessionState.id, { status: "running" });
    if (onProgress && getProgress) onProgress(getProgress());

    // Create fresh context for this worker (isolated state)
    const ctx = createPageAutomationContext();

    // Step 1: Initialize OIDC client and get device authorization (use same proxy as browser)
    const oidcClient = new AWSDeviceAuthClient(proxy);
    const { client, auth } = await oidcClient.quickAuth();

    sessionManager.updateSession(sessionState.id, {
      oidcClient: client,
      oidcAuth: auth,
    });

    // Step 2: Launch browser (Roxy or local fingerprint-chromium)
    logSession(account.email, `Starting browser (${BROWSER_MODE})...`);

    if (BROWSER_MODE === "local") {
      // Use unique profile per account to ensure clean state
      const uniqueProfile = `${profileName}-${sessionState.id}`;
      localSession = await launchLocalBrowser(proxy, uniqueProfile);
      browser = localSession.browser;
    } else {
      if (proxy) {
        await configureBrowserProxy(browserId, proxy, profileName);
      } else {
        await configureBrowserFingerprint(browserId, profileName);
      }
      browser = await openBrowser(browserId);
    }

    // Verify browser is connected
    if (!browser.isConnected()) {
      throw new Error("Browser failed to connect");
    }

    // Get or create page
    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());

    // Authenticate proxy via CDP (local mode only)
    if (BROWSER_MODE === "local" && localSession) {
      await authenticateProxy(localSession, page);
    }

    // Block unnecessary resources in low bandwidth or fast mode
    if (LOW_BANDWIDTH || FAST_MODE) {
      await enableResourceBlocking(page);
      if (!FAST_MODE) logSession(account.email, "Low bandwidth mode: blocking images/fonts/css");
    }

    // Request logging disabled
    // requestLogger = createRequestLogger(page, sessionState.id);
    // requestLogger.start();

    // Wait for browser to stabilize
    await new Promise((resolve) => setTimeout(resolve, FAST_MODE ? 200 : 1000));

    sessionManager.updateSession(sessionState.id, {
      browserId,
    });

    // Navigate to verification URL
    await page.goto(auth.verificationUriComplete, {
      waitUntil: (LOW_BANDWIDTH || FAST_MODE || BROWSER_MODE === "local") ? "domcontentloaded" : "networkidle2",
      timeout: TIMEOUTS.LONG,
    });

    // Detect stuck page — if body is empty or only has a spinner after initial load,
    // reload until content appears (common on slow proxies)
    const maxReloads = FAST_MODE ? 1 : 3;
    for (let reload = 0; reload < maxReloads; reload++) {
      await new Promise((resolve) => setTimeout(resolve, FAST_MODE ? 1000 : 3000));
      const hasContent = await page.evaluate(() => {
        const body = document.body;
        if (!body) return false;
        const text = body.innerText?.trim() || "";
        // Check if any meaningful form elements or text are present
        const hasInputs = document.querySelectorAll("input, button, form").length > 0;
        return text.length > 50 || hasInputs;
      }).catch(() => false);

      if (hasContent) break;

      logSession(account.email, `Page appears stuck, reloading... (${reload + 1}/${maxReloads})`);
      await page.reload({
        waitUntil: (LOW_BANDWIDTH || FAST_MODE || BROWSER_MODE === "local") ? "domcontentloaded" : "networkidle2",
        timeout: TIMEOUTS.LONG,
      }).catch(() => {});
    }

    logSession(account.email, "Navigated to AWS signup");

    // Step 3: Automate registration flow with faster polling
    let attempts = 0;
    const maxAttempts = LOW_BANDWIDTH ? 240 : 120; // 240 attempts * 500ms = 120s for low bandwidth
    let lastPageType: string = "";
    let verificationMessageShown = false;
    let otpRetryCount = 0;
    const maxOtpRetries = 5;
    let stuckPageCount = 0; // Track consecutive stuck iterations for reload

    while (attempts < maxAttempts) {
      // Wrap the entire iteration in try/catch to handle context destruction
      // during page transitions (common on slow connections)
      try {
        const result = await processPage(page, account, ctx);

        // Detect stuck page — same page type for too many iterations means page didn't load
        if (result.pageType === lastPageType || result.pageType === "unknown") {
          stuckPageCount++;
        } else {
          stuckPageCount = 0;
        }

        // If stuck for 20+ iterations (~10s), try reloading the page
        if (stuckPageCount > 0 && stuckPageCount % 20 === 0) {
          logSession(account.email, `Page stuck on "${result.pageType}" for ${stuckPageCount} iterations, reloading...`);
          await page.reload({
            waitUntil: (LOW_BANDWIDTH || FAST_MODE || BROWSER_MODE === "local") ? "domcontentloaded" : "networkidle2",
            timeout: TIMEOUTS.LONG,
          }).catch(() => {});
          await new Promise((resolve) => setTimeout(resolve, 2000));
          ctx.processedPages.clear(); // Allow re-processing after reload
        }

        // Only log on page type change (not on every attempt)
        if (result.pageType !== lastPageType && result.pageType !== "unknown") {
          if (result.pageType !== "complete" && result.pageType !== "verify") {
            logSession(account.email, `→ ${result.pageType}`);
          }
          lastPageType = result.pageType;
        }

        // Detect blank signup page (registrationCode URL but nothing rendered)
        const currentUrl = page.url();
        if (currentUrl.includes("/signup?registrationCode=") && result.pageType !== "password") {
          logSession(account.email, `⚠ Blank signup page detected, skipping account`, "warn");
          throw new Error("Blank signup page - skipping");
        }

        // Check for fatal page errors in one round-trip, retry up to 5 times
        const pageErrors = await page.evaluate(() => {
          const text = document.body?.innerText || "";
          return {
            awsError: text.includes("there was an error processing your request"),
            sessionExpired: text.includes("Something doesn't compute") ||
              text.includes("couldn't verify your sign up session"),
          };
        });
        if (pageErrors.sessionExpired || (result.pageType !== "verify" && pageErrors.awsError)) {
          const maxPageErrorRetries = 5;
          let pageErrorResolved = false;
          for (let per = 1; per <= maxPageErrorRetries; per++) {
            logSession(account.email, `⚠ AWS error detected, clicking submit again... (${per}/${maxPageErrorRetries})`, "warn");
            await new Promise((resolve) => setTimeout(resolve, 2000));
            const btnSelectors = [
              'button[data-testid="signup-next-button"]',
              'button[data-testid="test-primary-button"]',
              'button[type="submit"]'
            ];
            for (const btn of btnSelectors) {
              const exists = await page.$(btn);
              if (exists) {
                await page.click(btn).catch(() => {});
                break;
              }
            }
            await new Promise((resolve) => setTimeout(resolve, 3000));
            const retryErrors = await page.evaluate(() => {
              const text = document.body?.innerText || "";
              return {
                awsError: text.includes("there was an error processing your request"),
                sessionExpired: text.includes("Something doesn't compute") ||
                  text.includes("couldn't verify your sign up session"),
              };
            });
            if (!retryErrors.sessionExpired && !retryErrors.awsError) {
              logSession(account.email, `✓ AWS error resolved after retry`);
              pageErrorResolved = true;
              break;
            }
          }
          if (!pageErrorResolved) {
            if (pageErrors.sessionExpired) {
              throw new IPBlockedError("AWS error: signup session expired");
            }
            throw new IPBlockedError("AWS error: likely IP blocked");
          }
        }

        // Handle verify page — check on every iteration to catch OTP errors
        if (result.pageType === "verify") {
          const hasOtpError = await page.evaluate(() => {
            const text = document.body?.innerText || "";
            return text.includes("that code didn't work") ||
              text.includes("try again") ||
              text.includes("there was an error processing your request");
          });

          if (!verificationMessageShown || hasOtpError) {
            if (hasOtpError) {
              otpRetryCount++;
              if (otpRetryCount > maxOtpRetries) {
                throw new Error(`OTP verification failed after ${maxOtpRetries} retries`);
              }
              logSession(account.email, `⚠ OTP rejected, retrying... (${otpRetryCount}/${maxOtpRetries})`, "warn");
              await new Promise((resolve) => setTimeout(resolve, 1000));
              // Click "Resend code" if available
              try {
                const resendBtn = await page.$('button[data-testid="email-verification-resend-button"], button:has-text("Resend")');
                if (resendBtn) {
                  await resendBtn.click();
                  await new Promise((resolve) => setTimeout(resolve, 3000));
                  logSession(account.email, "📧 Resend code clicked");
                }
              } catch {
                // Resend button not found - continue with polling anyway
              }
            } else {
              logSession(account.email, `📧 Polling ${provider === "mailtm" ? "Mail.tm" : provider === "freemail" ? "Freemail" : "Gmail"} for OTP...`);
            }
            verificationMessageShown = true;
            
            // Fetch OTP with polling and auto-fill
            const otpResult = await fetchOtp(
              provider,
              account.email,
              45,  // 45 attempts
              2000, // 2 second intervals = 90 seconds max
              (attempt, max) => {
                if (attempt % 5 === 0) {
                  logSession(account.email, `📧 Polling... (${attempt}/${max})`);
                }
              },
              mailtmClient,
              freemailClient
            );
            
            if (otpResult.success && otpResult.code) {
              logSession(account.email, `✓ OTP received: ${otpResult.code}`);
              await handleVerifyPage(page, otpResult.code);
            } else {
              logSession(account.email, `⚠ OTP fetch failed: ${otpResult.error}`, "warn");
            }
          }
        }

        if (result.pageType === "complete") {
          logSession(account.email, "✓ Registration done");
          break;
        }

        if (!result.success && result.error && result.error !== "Already processed") {
          // Navigation errors are expected during page transitions - continue polling
          if (result.error.includes("navigation") || result.error.includes("context was destroyed")) {
            await new Promise((resolve) => setTimeout(resolve, 500));
            attempts++;
            continue;
          }
          logSession(account.email, `Error: ${result.error}`, "error");
          throw new Error(`Page processing failed: ${result.error}`);
        }

        if (result.pageType === "unknown") {
          // Like reference project: continue polling, don't fail immediately
          // Page may still be loading
          await new Promise((resolve) => setTimeout(resolve, 500));
          attempts++;
          continue;
        }

        // If page was successfully processed, wait for navigation
        if (result.success && result.pageType !== "verify") {
          // Password page has longer redirect - wait more
          if (result.pageType === "password") {
            await new Promise((resolve) => setTimeout(resolve, FAST_MODE ? 1000 : 3000));
          } else {
            await new Promise((resolve) => setTimeout(resolve, FAST_MODE ? 300 : 1000));
          }
        } else {
          // Poll every 500ms (like reference project)
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        attempts++;
      } catch (error) {
        // Re-throw fatal errors
        if (error instanceof IPBlockedError) throw error;

        const msg = error instanceof Error ? error.message : String(error);
        // Context destruction during navigation is expected — just retry
        if (msg.includes("context was destroyed") || msg.includes("Execution context") || msg.includes("navigation")) {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          attempts++;
          continue;
        }
        throw error;
      }
    }

    if (attempts >= maxAttempts) {
      throw new Error("Registration flow timeout - max attempts reached");
    }

    // Step 4: Poll for token
    sessionManager.updateSession(sessionState.id, { status: "polling_token" });
    if (onProgress && getProgress) onProgress(getProgress());

    const token = await oidcClient.pollToken(AWS_BUILDER_ID.TOKEN_POLL_TIMEOUT);

    // Validate token immediately after acquisition
    const validationResult = await validateToken(token.accessToken, proxy);
    const tokenStatus = validationResult.status;

    if (tokenStatus === "valid") {
      logSession(account.email, "✓ Token valid");
    } else {
      logSession(account.email, `⚠ Token: ${tokenStatus}`, "warn");
    }

    sessionManager.updateSession(sessionState.id, {
      token,
      tokenStatus,
      status: "completed",
    });

    // Request logging disabled
    // if (requestLogger) {
    //   requestLogger.stop();
    //   const logPath = await requestLogger.save();
    //   logSession(account.email, `📝 Request log: ${logPath}`);
    // }

    // Close browser
    if (BROWSER_MODE === "local" && localSession) {
      await closeLocalBrowser(localSession);
    } else if (browser && browserId) {
      await closeBrowser(browser, browserId);
    }

    if (onProgress && getProgress) onProgress(getProgress());
    const finalSession = sessionManager.getSession(sessionState.id);
    if (!finalSession) {
      throw new Error("Session not found after completion");
    }
    return finalSession;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    sessionManager.updateSession(sessionState.id, {
      status: "error",
      error: errorMessage,
    });

    // Close browser on error
    if (BROWSER_MODE === "local" && localSession) {
      try {
        await closeLocalBrowser(localSession);
      } catch {
        // Ignore cleanup errors
      }
    } else if (browser && browserId) {
      try {
        await closeBrowser(browser, browserId);
      } catch {
        // Ignore cleanup errors
      }
    }

    if (onProgress && getProgress) onProgress(getProgress());

    // Re-throw IPBlockedError so the orchestrator can retry with a new proxy
    if (error instanceof IPBlockedError) {
      throw error;
    }

    const finalSession = sessionManager.getSession(sessionState.id);
    if (!finalSession) {
      throw new Error("Session not found after error");
    }
    return finalSession;
  }
}
