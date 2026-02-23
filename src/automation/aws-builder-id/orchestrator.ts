/**
 * Batch Registration Orchestrator
 * Manages parallel AWS Builder ID registrations with one worker per base email
 */

import { join } from "path";
import { logGlobal, logSession } from "../../utils/logger";
import { checkHealth, closeAllBrowsers, deleteAllBrowserProfiles, getOrCreateBrowserProfile, resetBrowserProfile } from "../../services/browser";
import { closeAllLocalBrowsers, resetInstanceCount } from "../../services/browser-local";
import { getNextValidProxy, getNextProxy, isProxyConfigured, getCurrentPort } from "../../services/proxy";
import { generateEmailAlias } from "../../utils/email-provider";
import { generatePassword, generateName } from "../../utils/generators";
import type { EmailProvider } from "../../types/provider";
import { MailtmClient } from "../../api/mailtm";
import { FreemailClient } from "../../api/freemail";
import { SessionManager } from "./session";
import { registrationWorker, IPBlockedError, type WorkerProxy } from "./worker";
import { BATCH_REGISTRATION, CREDENTIAL_API, DEFAULT_BROWSER_PROFILE, BROWSER_MODE, LOW_BANDWIDTH, FAST_MODE, SKIP_PROXY_CHECK } from "../../config";
import type { BatchRegistrationConfig, BatchProgress, AWSBuilderIDAccount, SessionState } from "../../types/aws-builder-id";

/**
 * Get current progress from session manager
 */
function getProgress(sessionManager: SessionManager, totalTarget: number): BatchProgress {
  const sessions = sessionManager.getAllSessions();
  const completed = sessionManager.getCompletedCount();
  const failed = sessionManager.getFailedCount();
  const running = sessionManager.getRunningCount();

  let status: BatchProgress["status"] = "idle";
  if (running > 0) {
    status = "running";
  } else if (completed + failed === totalTarget && totalTarget > 0) {
    status = "completed";
  }

  return {
    totalTarget,
    totalRegistered: completed,
    totalFailed: failed,
    status,
    sessions,
  };
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Process accounts for a single base email sequentially
 * Creates one browser profile per email worker, reuses it for all accounts
 */
async function processEmailWorker(
  baseInput: string,
  provider: EmailProvider,
  countPerEmail: number,
  startIndex: number,
  sessionManager: SessionManager,
  progressCallback: (progress: BatchProgress) => void,
  sessionCallback: (session: SessionState) => void,
  boundGetProgress: () => BatchProgress,
  workerIndex: number,
  freemailDomainCount?: number
): Promise<SessionState[]> {
  const results: SessionState[] = [];
  const useEnvProxy = isProxyConfigured();

  // Extract label for profile naming and logging
  const inputLabel = baseInput.includes("@") ? baseInput.split("@")[0] || baseInput : baseInput;
  const workerLabel = `${inputLabel}-w${workerIndex}`;
  const profileName = `${DEFAULT_BROWSER_PROFILE}-${workerLabel}`;

  // Create one browser profile for this worker (Roxy only — local mode creates per-launch)
  let browserId: string = "";
  if (BROWSER_MODE === "roxy") {
    try {
      logSession(workerLabel, `Creating browser profile...`);
      const result = await getOrCreateBrowserProfile(profileName);
      browserId = result.browserId;
      logSession(workerLabel, `Browser profile ready: ${browserId}`);
    } catch (error) {
      logSession(workerLabel, `Failed to create browser profile:: ${error}`, "error");
      return results;
    }
  }

  // Create one FreemailClient per worker (reused across accounts)
  const freemailClient: FreemailClient | undefined = provider === "freemail" ? new FreemailClient() : undefined;

  for (let i = 1; i <= countPerEmail; i++) {
    const globalIndex = startIndex + i;
    const email = generateEmailAlias(provider, { baseInput, index: i });
    const password = generatePassword();
    const name = generateName();

    const account: AWSBuilderIDAccount = {
      email,
      password,
      fullName: name.fullName,
    };

    let accountProxy: WorkerProxy | undefined;
    if (useEnvProxy) {
      if (SKIP_PROXY_CHECK) {
        logSession(workerLabel, `Rotating proxy for account ${i}/${countPerEmail}...`);
        const envProxy = getNextProxy();
        if (envProxy) {
          accountProxy = envProxy;
        } else {
          logSession(workerLabel, `No proxy configured, skipping account ${i}`);
          continue;
        }
      } else {
        logSession(workerLabel, `Finding valid proxy for account ${i}/${countPerEmail}...`);
        const envProxy = await getNextValidProxy();
        if (envProxy) {
          accountProxy = envProxy;
        } else {
          logSession(workerLabel, `No valid proxy found, skipping account ${i}`);
          continue;
        }
      }
    }

    // Reset browser profile before each account (Roxy only — local mode creates fresh per launch)
    if (i > 1 && BROWSER_MODE === "roxy") {
      logSession(workerLabel, `Resetting browser profile for account ${i}...`);
      await resetBrowserProfile(browserId, profileName);
    }

    // For mailtm: create a Mail.tm account and authenticate before browser automation
    let mailtmClient: MailtmClient | undefined;
    if (provider === "mailtm") {
      try {
        mailtmClient = new MailtmClient();
        await mailtmClient.createSession(email, password);
        logSession(workerLabel, `Mail.tm account ready: ${email}`);
      } catch (error) {
        logSession(workerLabel, `Failed to create Mail.tm account for ${email}:: ${error}`, "error");
        continue;
      }
    }

    // For freemail: generate mailbox via API and override email/account
    if (provider === "freemail") {
      try {
        const domainIndex = freemailDomainCount ? (workerIndex + i - 1) % freemailDomainCount : 0;
        const mailbox = await freemailClient!.generateMailbox(domainIndex);
        // Override email with the server-generated address
        account.email = mailbox.email;
        logSession(workerLabel, `Freemail mailbox ready: ${mailbox.email}`);
      } catch (error) {
        logSession(workerLabel, `Failed to create Freemail mailbox:: ${error}`, "error");
        continue;
      }
    }

    const maxRetries = 3;
    let retryCount = 0;
    let success = false;

    while (retryCount <= maxRetries && !success) {
      // Get a new proxy on retries
      if (retryCount > 0 && useEnvProxy) {
        logSession(workerLabel, `🔄 Retry ${retryCount}/${maxRetries} - getting new proxy...`);
        const newProxy = SKIP_PROXY_CHECK ? getNextProxy() : await getNextValidProxy();
        if (newProxy) {
          accountProxy = newProxy;
        } else {
          logSession(workerLabel, `No valid proxy found for retry, skipping account ${i}`);
          break;
        }
        if (BROWSER_MODE === "roxy") {
          await resetBrowserProfile(browserId, profileName);
        }

        // Recreate email provider client for retry (new mailbox for freemail)
        if (provider === "freemail") {
          try {
            const retryDomainIndex = freemailDomainCount ? (workerIndex + i - 1) % freemailDomainCount : 0;
            const mailbox = await freemailClient!.generateMailbox(retryDomainIndex);
            account.email = mailbox.email;
            logSession(workerLabel, `Freemail mailbox ready: ${mailbox.email}`);
          } catch (error) {
            logSession(workerLabel, `Failed to create Freemail mailbox for retry:: ${error}`, "error");
            break;
          }
        }
      }

      try {
        const session = await registrationWorker(account, provider, sessionManager, accountProxy, progressCallback, boundGetProgress, browserId, profileName, mailtmClient, freemailClient);
        sessionCallback(session);
        results.push(session);
        success = true;
      } catch (error) {
        if (error instanceof IPBlockedError && retryCount < maxRetries) {
          logSession(account.email, `⚠ IP blocked, will retry with new proxy...`, "warn");
          retryCount++;
          continue;
        }
        logSession(account.email, `Worker failed: ${error}`, "error");
        break;
      }
    }

    // Small delay between accounts within same worker
    if (i < countPerEmail) {
      await sleep(FAST_MODE ? 200 : 1000);
    }
  }

  return results;
}

/**
 * Batch registration with parallel email workers
 * Each base email runs as one parallel worker, processing its accounts sequentially
 */
export async function batchRegister(config: BatchRegistrationConfig): Promise<BatchProgress> {
  const { baseInputs, countPerEmail, onProgress, onSessionUpdate, provider, freemailDomainCount } = config;

  const totalAccounts = baseInputs.length * countPerEmail;
  const sessionManager = new SessionManager();

  // Generate output file path upfront for cleanup
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
  const outputFile = join("output", `kiro-accounts-${timestamp}.json`);

  // Register cleanup handlers for crashes/interrupts
  const cleanup = async (reason: string) => {
    logGlobal(`⚠️ ${reason} - saving current progress...`);
    
    // Export current results before cleanup
    const currentProgress = getProgress(sessionManager, totalAccounts);
    if (currentProgress.sessions.length > 0) {
      exportResults(currentProgress, outputFile);
    }
    
    logGlobal("Cleaning up browsers...");
    if (BROWSER_MODE === "roxy") {
      await closeAllBrowsers();
    } else {
      const closed = await closeAllLocalBrowsers();
      if (closed > 0) logGlobal(`Closed ${closed} local browser(s)`);
    }
  };

  let isCleaningUp = false;
  const handleSignal = async (signal: string) => {
    if (isCleaningUp) return;
    isCleaningUp = true;
    await cleanup(`Received ${signal}`);
    process.exit(1);
  };

  process.on("SIGINT", () => handleSignal("SIGINT"));
  process.on("SIGTERM", () => handleSignal("SIGTERM"));
  process.on("uncaughtException", async (err) => {
    if (isCleaningUp) return;
    isCleaningUp = true;
    logGlobal(`Uncaught exception: ${err}`, "error");
    await cleanup("Uncaught exception");
    process.exit(1);
  });
  process.on("unhandledRejection", async (err) => {
    if (isCleaningUp) return;
    isCleaningUp = true;
    logGlobal(`Unhandled rejection: ${err}`, "error");
    await cleanup("Unhandled rejection");
    process.exit(1);
  });

  // Health check and cleanup (mode-dependent)
  if (BROWSER_MODE === "roxy") {
    logGlobal("Checking Roxy Browser connection...");
    const isHealthy = await checkHealth();
    if (!isHealthy) {
      throw new Error("Roxy Browser is not running or not responding. Please start Roxy Browser first.");
    }
    logGlobal("✓ Roxy Browser is connected\n");

    logGlobal("Cleaning up existing browser profiles...");
    await deleteAllBrowserProfiles();
    logGlobal("✓ Browser profiles cleaned\n");
  } else {
    logGlobal("Using fingerprint-chromium (local mode)\n");
    resetInstanceCount();
  }

  const useEnvProxy = isProxyConfigured();
  logGlobal(`Batch: ${totalAccounts} accounts (${baseInputs.length} inputs × ${countPerEmail} each)${useEnvProxy ? " (env proxy)" : ""}${LOW_BANDWIDTH ? " (low bandwidth)" : ""}`);

  // Progress callback wrapper - only log on completion changes
  let lastLogged = { completed: 0, failed: 0 };
  const progressCallback = (progress: BatchProgress) => {
    onProgress?.(progress);
    if (progress.totalRegistered !== lastLogged.completed || progress.totalFailed !== lastLogged.failed) {
      logGlobal(`Progress: ${progress.totalRegistered}/${progress.totalTarget} done, ${progress.totalFailed} failed`);
      lastLogged = { completed: progress.totalRegistered, failed: progress.totalFailed };
    }
  };

  // Session update callback wrapper
  const sessionCallback = (session: SessionState) => {
    onSessionUpdate?.(session);
  };

  // Create bound getProgress function for workers
  const boundGetProgress = () => getProgress(sessionManager, totalAccounts);

  // Start one worker per base input, all running in parallel
  const workers = baseInputs.map((baseInput, inputIndex) => {
    const startIndex = inputIndex * countPerEmail;
    // Stagger start times
    const staggerDelay = FAST_MODE ? 100 : BATCH_REGISTRATION.STAGGER_DELAY;
    return sleep(inputIndex * staggerDelay).then(() =>
      processEmailWorker(
        baseInput,
        provider,
        countPerEmail,
        startIndex,
        sessionManager,
        progressCallback,
        sessionCallback,
        boundGetProgress,
        inputIndex,
        freemailDomainCount
      )
    );
  });

  // Wait for all workers to complete
  await Promise.allSettled(workers);

  const finalProgress = getProgress(sessionManager, totalAccounts);

  logGlobal(`✓ Done: ${finalProgress.totalRegistered}/${finalProgress.totalTarget} success, ${finalProgress.totalFailed} failed`);

  return finalProgress;
}

/**
 * Upload credential to admin API (fire and forget, errors are silent)
 */
function uploadCredentialBackground(session: SessionState): void {
  if (!session.token?.refreshToken || !session.oidcClient?.clientId || !session.oidcClient?.clientSecret) {
    return;
  }

  fetch(CREDENTIAL_API.URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": CREDENTIAL_API.API_KEY,
    },
    body: JSON.stringify({
      refreshToken: session.token.refreshToken,
      authMethod: CREDENTIAL_API.AUTH_METHOD,
      clientId: session.oidcClient.clientId,
      clientSecret: session.oidcClient.clientSecret,
      priority: CREDENTIAL_API.PRIORITY,
    }),
  }).then(response => {
    if (response.ok) {
      logSession(session.account.email, `📤 Uploaded credential`);
    }
  }).catch(() => {
    // Silently ignore errors
  });
}

/**
 * Export results to JSON file (only valid tokens)
 */
export function exportResults(progress: BatchProgress, filePath: string): void {
  const validAccounts = progress.sessions.filter(
    (s) => s.status === "completed" && s.token && s.tokenStatus === "valid"
  );
  const suspendedAccounts = progress.sessions.filter(
    (s) => s.status === "completed" && s.tokenStatus === "suspended"
  );
  const expiredAccounts = progress.sessions.filter(
    (s) => s.status === "completed" && s.tokenStatus === "expired"
  );
  const invalidAccounts = progress.sessions.filter(
    (s) => s.status === "completed" && (s.tokenStatus === "invalid" || s.tokenStatus === "error")
  );
  const failedAccounts = progress.sessions.filter((s) => s.status === "error");

  // Upload valid credentials to admin API (fire and forget)
  for (const session of validAccounts) {
    uploadCredentialBackground(session);
  }

  const results = {
    summary: {
      total: progress.totalTarget,
      valid: validAccounts.length,
      suspended: suspendedAccounts.length,
      expired: expiredAccounts.length,
      invalid: invalidAccounts.length,
      failed: failedAccounts.length,
      timestamp: new Date().toISOString(),
    },
    accounts: validAccounts.map((s) => ({
      email: s.account.email,
      password: s.account.password,
      fullName: s.account.fullName,
      refreshToken: s.token?.refreshToken || "",
      clientId: s.oidcClient?.clientId || "",
      clientSecret: s.oidcClient?.clientSecret || "",
      region: "us-east-1",
      provider: "BuilderId",
      machineId: s.browserId || "",
      token: s.token,
      createdAt: s.createdAt,
    })),
    filtered: {
      suspended: suspendedAccounts.map((s) => ({
        email: s.account.email,
        password: s.account.password,
        fullName: s.account.fullName,
      })),
      expired: expiredAccounts.map((s) => ({
        email: s.account.email,
        password: s.account.password,
        fullName: s.account.fullName,
      })),
      invalid: invalidAccounts.map((s) => ({
        email: s.account.email,
        password: s.account.password,
        fullName: s.account.fullName,
      })),
    },
    failures: failedAccounts.map((s) => ({
      email: s.account.email,
      error: s.error,
      createdAt: s.createdAt,
    })),
  };

  Bun.write(filePath, JSON.stringify(results, null, 2));

  const parts = [`✅ ${validAccounts.length} valid`];
  if (suspendedAccounts.length > 0) parts.push(`⏸️ ${suspendedAccounts.length} suspended`);
  if (expiredAccounts.length > 0) parts.push(`⏰ ${expiredAccounts.length} expired`);
  if (invalidAccounts.length > 0) parts.push(`❌ ${invalidAccounts.length} invalid`);
  if (failedAccounts.length > 0) parts.push(`⚠️ ${failedAccounts.length} failed`);
  
  logGlobal(`Saved: ${filePath} (${parts.join(", ")})`);
}
