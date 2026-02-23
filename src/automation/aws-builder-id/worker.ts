/**
 * Registration Worker
 * Handles single AWS Builder ID account registration
 */

import type { Browser } from "puppeteer-core";
import { AWSDeviceAuthClient } from "../../api/aws-oidc";
import { validateToken } from "../../api/token-validator";
import { configureBrowserProxy, configureBrowserFingerprint, openBrowser, closeBrowser } from "../../services/browser";
import { logSession } from "../../utils/logger";
// import { createRequestLogger, type RequestLogger } from "../../utils/request-logger";
import { fetchOtp } from "../../utils/email-provider";
import type { EmailProvider } from "../../types/provider";
import { MailtmClient } from "../../api/mailtm";
import { FreemailClient } from "../../api/freemail";
import { SessionManager } from "./session";
import { processPage, handleVerifyPage } from "./register";
import { createPageAutomationContext } from "./context";
import { AWS_BUILDER_ID } from "../../config";
import type { AWSBuilderIDAccount, SessionState, BatchProgress } from "../../types/aws-builder-id";

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

    // Step 2: Configure browser with proxy and open it
    logSession(account.email, "Starting browser...");
    
    if (proxy) {
      await configureBrowserProxy(browserId, proxy, profileName);
    } else {
      await configureBrowserFingerprint(browserId, profileName);
    }

    browser = await openBrowser(browserId);

    // Verify browser is connected
    if (!browser.isConnected()) {
      throw new Error("Browser failed to connect");
    }

    // Get or create page
    const pages = await browser.pages();
    const page = pages[0] || (await browser.newPage());

    // Request logging disabled
    // requestLogger = createRequestLogger(page, sessionState.id);
    // requestLogger.start();

    // Wait for browser to stabilize
    await new Promise((resolve) => setTimeout(resolve, 2000));

    sessionManager.updateSession(sessionState.id, {
      browserId,
    });

    // Navigate to verification URL
    await page.goto(auth.verificationUriComplete, {
      waitUntil: "networkidle2",
      timeout: 60000
    });

    logSession(account.email, "Navigated to AWS signup");

    // Step 3: Automate registration flow with faster polling
    let attempts = 0;
    const maxAttempts = 120; // 120 attempts * 500ms = 60 seconds max
    let lastPageType: string = "";
    let verificationMessageShown = false;
    let otpRetryCount = 0;
    const maxOtpRetries = 3;

    while (attempts < maxAttempts) {
      const result = await processPage(page, account, ctx);

      // Only log on page type change (not on every attempt)
      if (result.pageType !== lastPageType && result.pageType !== "unknown") {
        if (result.pageType !== "complete" && result.pageType !== "verify") {
          logSession(account.email, `→ ${result.pageType}`);
        }
        lastPageType = result.pageType;
      }

      // Check for AWS generic error alert (likely IP blocked) — but not on verify page
      // On verify page, this error means OTP submission failed, not IP blocked
      if (result.pageType !== "verify") {
        const hasAwsError = await page.evaluate(() => {
          const text = document.body?.innerText || "";
          return text.includes("there was an error processing your request");
        });
        if (hasAwsError) {
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
          await new Promise((resolve) => setTimeout(resolve, 3000));
        } else {
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
      } else {
        // Poll every 500ms (like reference project)
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
      attempts++;
    }

    if (attempts >= maxAttempts) {
      throw new Error("Registration flow timeout - max attempts reached");
    }

    // Step 4: Poll for token
    sessionManager.updateSession(sessionState.id, { status: "polling_token" });
    if (onProgress && getProgress) onProgress(getProgress());

    const token = await oidcClient.pollToken(AWS_BUILDER_ID.TOKEN_POLL_TIMEOUT);

    // Validate token immediately after acquisition
    const validationResult = await validateToken(token.accessToken);
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
    if (browser && browserId) {
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
    if (browser && browserId) {
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
