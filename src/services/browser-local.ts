/**
 * Local Browser Service - Launches fingerprint-chromium with CDP proxy auth
 * Alternative to Roxy Browser for local browser management
 */
import puppeteer, { type Browser } from "puppeteer-core";
import { getLogger } from "@logtape/logtape";
import { existsSync } from "fs";
import { rm, mkdir } from "fs/promises";
import { join } from "path";
import type { Proxy } from "./browser";

const logger = getLogger(["local", "browser"]);

const HEADLESS = Bun.env.HEADLESS === "true" || Bun.env.HEADLESS === "1";

// Default path for fingerprint-chromium binary
const DEFAULT_CHROMIUM_PATH = join(
  import.meta.dir,
  "../../.chromium",
  process.platform === "darwin"
    ? "Chromium.app/Contents/MacOS/Chromium"
    : process.platform === "win32"
      ? "chrome.exe"
      : "chrome"
);

function getExecutablePath(): string {
  const envPath = Bun.env.CHROME_EXECUTABLE_PATH;
  if (envPath) {
    if (!existsSync(envPath)) {
      throw new Error(`CHROME_EXECUTABLE_PATH does not exist: ${envPath}`);
    }
    return envPath;
  }
  if (!existsSync(DEFAULT_CHROMIUM_PATH)) {
    throw new Error(
      `fingerprint-chromium not found at ${DEFAULT_CHROMIUM_PATH}. Run: bun bin/download-chromium.ts`
    );
  }
  return DEFAULT_CHROMIUM_PATH;
}

// OS options for fingerprint platform spoofing with realistic version strings
const PLATFORM_CONFIGS = [
  { platform: "windows", versions: ["10.0.0", "10.0.1", "15.0.0"] },
  { platform: "linux", versions: ["6.1.0", "6.5.0", "6.8.0"] },
  { platform: "macos", versions: ["14.5.0", "14.7.0", "15.2.0", "15.3.0"] },
] as const;

// Realistic GPU vendor+renderer pairs (must be consistent)
const GPU_PROFILES = [
  { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.5)" },
  { vendor: "Google Inc. (Intel)", renderer: "ANGLE (Intel, Intel(R) Iris(R) Xe Graphics, OpenGL 4.5)" },
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce GTX 1660 SUPER, OpenGL 4.5)" },
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 3060, OpenGL 4.5)" },
  { vendor: "Google Inc. (NVIDIA)", renderer: "ANGLE (NVIDIA, NVIDIA GeForce RTX 4070, OpenGL 4.5)" },
  { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.5)" },
  { vendor: "Google Inc. (AMD)", renderer: "ANGLE (AMD, AMD Radeon RX 6600, OpenGL 4.5)" },
  { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, Apple M1, OpenGL 4.1)" },
  { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, Apple M2, OpenGL 4.1)" },
  { vendor: "Google Inc. (Apple)", renderer: "ANGLE (Apple, Apple M3, OpenGL 4.1)" },
] as const;

// Chrome brand versions (matching fingerprint-chromium v142 range)
const BRAND_VERSIONS = ["140.0.0.0", "141.0.0.0", "142.0.0.0", "143.0.0.0"] as const;

/**
 * Generate a random fingerprint seed (32-bit integer)
 */
function generateFingerprintSeed(): number {
  return Math.floor(Math.random() * 2_147_483_647) + 1;
}

/**
 * Get a random platform config (platform + version)
 */
function getRandomPlatformConfig(): { platform: string; version: string } {
  const config = PLATFORM_CONFIGS[Math.floor(Math.random() * PLATFORM_CONFIGS.length)]!;
  const version = config.versions[Math.floor(Math.random() * config.versions.length)]!;
  return { platform: config.platform, version };
}

/**
 * Get a random hardware concurrency value
 */
function getRandomHardwareConcurrency(): number {
  const options = [4, 6, 8, 12, 16];
  return options[Math.floor(Math.random() * options.length)]!;
}

/**
 * Get a random GPU profile (vendor + renderer pair)
 */
function getRandomGpuProfile(): { vendor: string; renderer: string } {
  return GPU_PROFILES[Math.floor(Math.random() * GPU_PROFILES.length)]!;
}

/**
 * Get a random Chrome brand version
 */
function getRandomBrandVersion(): string {
  return BRAND_VERSIONS[Math.floor(Math.random() * BRAND_VERSIONS.length)]!;
}

export interface FingerprintOptions {
  proxy?: Proxy;
  timezone?: string;
}

/**
 * Build Chrome launch args for fingerprint-chromium
 */
function buildFingerprintArgs(seed: number, options: FingerprintOptions = {}): string[] {
  const { proxy, timezone } = options;
  const platformConfig = getRandomPlatformConfig();
  const hwConcurrency = getRandomHardwareConcurrency();
  const gpuProfile = getRandomGpuProfile();
  const brandVersion = getRandomBrandVersion();

  const args = [
    `--fingerprint=${seed}`,
    `--fingerprint-platform=${platformConfig.platform}`,
    `--fingerprint-platform-version=${platformConfig.version}`,
    `--fingerprint-brand=Chrome`,
    `--fingerprint-brand-version=${brandVersion}`,
    `--fingerprint-hardware-concurrency=${hwConcurrency}`,
    `--fingerprint-gpu-vendor=${gpuProfile.vendor}`,
    `--fingerprint-gpu-renderer=${gpuProfile.renderer}`,
    "--lang=en-US",
    "--accept-lang=en-US,en",
    "--disable-non-proxied-udp",
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-blink-features=AutomationControlled",
    "--disable-session-crashed-bubble",
    "--disable-infobars",
    "--hide-crash-restore-bubble",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--noerrdialogs",
  ];

  if (timezone) {
    args.push(`--timezone=${timezone}`);
  }

  if (proxy) {
    args.push(`--proxy-server=http://${proxy.host}:${proxy.port}`);
  }

  return args;
}

export interface LocalBrowserSession {
  browser: Browser;
  fingerprintSeed: number;
  proxy: Proxy | null;
  userDataDir: string;
}

// Track active browser instances for window positioning and cleanup
const usedSlots: Set<number> = new Set();
const activeSessions: Map<LocalBrowserSession, number> = new Map();

/**
 * Get the lowest available window slot index
 */
function acquireSlot(): number {
  let slot = 0;
  while (usedSlots.has(slot)) slot++;
  usedSlots.add(slot);
  return slot;
}

/**
 * Release a window slot for reuse
 */
function releaseSlot(slot: number): void {
  usedSlots.delete(slot);
}

/**
 * Launch fingerprint-chromium with a unique fingerprint profile
 * Proxy auth is handled via CDP page.authenticate() on each new page
 */
export async function launchLocalBrowser(
  proxy?: Proxy,
  profileId?: string,
  timezone?: string
): Promise<LocalBrowserSession> {
  const executablePath = getExecutablePath();
  const seed = generateFingerprintSeed();
  const userDataDir = join(
    import.meta.dir,
    "../../.chromium-profiles",
    profileId || `profile-${seed}`
  );

  const args = buildFingerprintArgs(seed, { proxy, timezone });
  args.push(`--user-data-dir=${userDataDir}`);

  // Wipe profile directory to prevent cache/cookie leakage between accounts
  try {
    await rm(userDataDir, { recursive: true, force: true }).catch(() => {});
    await mkdir(userDataDir, { recursive: true });
  } catch {
    // Ignore — directory may be locked or not exist
  }

  // Position window using slot pool (reuses positions from closed browsers)
  const slot = acquireSlot();
  if (!HEADLESS) {
    const col = slot % 3;
    const row = Math.floor(slot / 3);
    const windowWidth = 640;
    const windowHeight = 480;
    args.push(`--window-size=${windowWidth},${windowHeight}`);
    args.push(`--window-position=${col * windowWidth},${row * windowHeight}`);
  }

  const platform = args.find((a) => a.startsWith("--fingerprint-platform="))?.split("=")[1];
  const tz = args.find((a) => a.startsWith("--timezone="))?.split("=")[1];
  logger.info("Launching fingerprint-chromium (seed={seed}, platform={platform}, tz={tz})", {
    seed,
    platform,
    tz: tz || "system",
  });

  const browser = await puppeteer.launch({
    executablePath,
    headless: HEADLESS,
    args,
    defaultViewport: null,
  });

  const session = { browser, fingerprintSeed: seed, proxy: proxy || null, userDataDir };
  activeSessions.set(session, slot);
  return session;
}

/**
 * Authenticate proxy on a page via CDP
 * Must be called before navigation on each new page
 */
export async function authenticateProxy(
  session: LocalBrowserSession,
  page: import("puppeteer-core").Page
): Promise<void> {
  if (session.proxy?.username && session.proxy?.password) {
    await page.authenticate({
      username: session.proxy.username,
      password: session.proxy.password,
    });
  }
}

/**
 * Close a local browser session
 */
export async function closeLocalBrowser(
  session: LocalBrowserSession
): Promise<void> {
  try {
    if (session.browser.isConnected()) {
      await session.browser.close();
    }
  } catch {
    // Ignore browser close errors
  }
  const slot = activeSessions.get(session);
  if (slot !== undefined) releaseSlot(slot);
  activeSessions.delete(session);
}

/**
 * Close all active local browser sessions (cleanup on exit/interrupt)
 */
export async function closeAllLocalBrowsers(): Promise<number> {
  const count = activeSessions.size;
  const sessions = Array.from(activeSessions.keys());
  await Promise.allSettled(sessions.map((session) => closeLocalBrowser(session)));
  usedSlots.clear();
  return count;
}

/**
 * Reset the slot pool (call at start of batch)
 */
export function resetInstanceCount(): void {
  usedSlots.clear();
}

/**
 * Check if fingerprint-chromium is available
 */
export function isLocalBrowserAvailable(): boolean {
  try {
    getExecutablePath();
    return true;
  } catch {
    return false;
  }
}
