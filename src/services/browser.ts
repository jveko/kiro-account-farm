/**
 * Browser Service - Encapsulates Roxy+Puppeteer browser lifecycle management
 */
import puppeteer, { type Browser } from "puppeteer-core";
import { getLogger } from "@logtape/logtape";
import {
  RoxyClient,
  type FingerInfo,
  type BrowserDetailData,
  type ProxyInfo,
} from "../api/roxy";

const logger = getLogger(["roxy", "browser"]);
import {
  ROXY_PORT,
  ROXY_API_TOKEN_LAZY,
  WORKSPACE_ID,
  PROJECT_ID,
  CHROME_VERSION,
  DEFAULT_BROWSER_PROFILE,
} from "../config";

// OS options for random selection (Windows/Linux only for consistent GPU fingerprinting)
const OS_OPTIONS: Array<{ os: string; osVersion: string }> = [
  { os: "Windows", osVersion: "11" },
  { os: "Windows", osVersion: "10" },
  { os: "Linux", osVersion: "" },
];

// Chrome versions for random selection (140-143)
const CHROME_VERSIONS = ["140", "141", "142", "143"];

/**
 * Get a random OS configuration
 */
function getRandomOS(): { os: string; osVersion: string } {
  return OS_OPTIONS[Math.floor(Math.random() * OS_OPTIONS.length)]!;
}

/**
 * Get a random Chrome version
 */
function getRandomChromeVersion(): string {
  return CHROME_VERSIONS[Math.floor(Math.random() * CHROME_VERSIONS.length)]!;
}

// Singleton RoxyClient instance
let roxyClientInstance: RoxyClient | null = null;

/**
 * Get or create the RoxyClient singleton
 */
export function getRoxyClient(): RoxyClient {
  if (!roxyClientInstance) {
    roxyClientInstance = new RoxyClient(ROXY_PORT, ROXY_API_TOKEN_LAZY.value);
  }
  return roxyClientInstance;
}

export interface Proxy {
  username: string;
  password: string;
  host: string;
  port: number;
}

export interface BrowserProfileInfo {
  browserId: string;
  currentProxyPort: number | null;
}

export interface BrowserSession {
  browser: Browser;
  browserId: string;
  proxy: Proxy;
  workspaceId: number;
}

/**
 * Convert Proxy to Roxy ProxyInfo format
 */
function toProxyInfo(
  proxy: Proxy,
  category: "HTTP" | "HTTPS" | "SOCKS5" = "HTTP"
): ProxyInfo {
  return {
    proxyMethod: "custom",
    proxyCategory: category,
    host: proxy.host,
    port: String(proxy.port),
    proxyUserName: proxy.username,
    proxyPassword: proxy.password,
  };
}

/**
 * Get or create a browser profile
 */
export async function getOrCreateBrowserProfile(
  profileName: string = DEFAULT_BROWSER_PROFILE,
  workspaceId: number = WORKSPACE_ID,
  projectId: number = PROJECT_ID
): Promise<BrowserProfileInfo> {
  const roxyClient = getRoxyClient();

  const browsersRsp = await roxyClient.browserList(workspaceId, {
    windowName: profileName,
  });

  const existingProfile = browsersRsp.data?.rows?.[0];
  if (browsersRsp.code === 0 && existingProfile) {
    logger.info("Deleting existing browser profile: {dirId}", {
      dirId: existingProfile.dirId,
    });
    await roxyClient.browserDelete(workspaceId, existingProfile.dirId);
  }

  logger.info("Creating new browser profile...");
  const randomOS = getRandomOS();
  const randomChrome = getRandomChromeVersion();
  const createRsp = await roxyClient.browserCreate({
    workspaceId,
    projectId,
    windowName: profileName,
    os: randomOS.os,
    osVersion: randomOS.osVersion,
    coreVersion: randomChrome,
  });

  if (createRsp.code !== 0) {
    throw new Error(`Failed to create browser: ${createRsp.msg}`);
  }

  logger.info("Created browser profile: {dirId} ({os} {osVersion}, Chrome {chrome})", {
    dirId: createRsp.data.dirId,
    os: randomOS.os,
    osVersion: randomOS.osVersion,
    chrome: randomChrome,
  });
  return { browserId: createRsp.data.dirId, currentProxyPort: null };
}

/**
 * Configure browser fingerprint and language settings
 */
export async function configureBrowserFingerprint(
  browserId: string,
  profileName: string = DEFAULT_BROWSER_PROFILE,
  workspaceId: number = WORKSPACE_ID
): Promise<void> {
  const roxyClient = getRoxyClient();

  const fingerInfo: FingerInfo = {
    clearCacheFile: true,
    clearCookie: true,
    randomFingerprint: true,
    syncTab: false,
    syncCookie: false,
    isLanguageBaseIp: false,
    language: "en-US",
    isDisplayLanguageBaseIp: false,
    displayLanguage: "en-US",
    isTimeZone: true,
  };

  const randomOS = getRandomOS();
  const randomChrome = getRandomChromeVersion();
  const mdfRsp = await roxyClient.browserModify({
    workspaceId,
    windowName: profileName,
    dirId: browserId,
    os: randomOS.os,
    osVersion: randomOS.osVersion,
    coreVersion: randomChrome,
    fingerInfo,
  });

  if (mdfRsp.code !== 0) {
    throw new Error(`Failed to configure browser: ${mdfRsp.msg}`);
  }
}

/**
 * Reset browser profile - randomize fingerprint, clear cache, update language
 * Used between account registrations to get a fresh environment
 */
export async function resetBrowserProfile(
  browserId: string,
  profileName: string = DEFAULT_BROWSER_PROFILE,
  workspaceId: number = WORKSPACE_ID
): Promise<void> {
  const roxyClient = getRoxyClient();

  logger.info("Resetting browser profile: {dirId}", { dirId: browserId });

  const fingerInfo: FingerInfo = {
    clearCacheFile: true,
    clearCookie: true,
    randomFingerprint: true,
    syncTab: false,
    syncCookie: false,
    isLanguageBaseIp: false,
    language: "en-US",
    isDisplayLanguageBaseIp: false,
    displayLanguage: "en-US",
    isTimeZone: true,
  };

  const randomOS = getRandomOS();
  const randomChrome = getRandomChromeVersion();
  const mdfRsp = await roxyClient.browserModify({
    workspaceId,
    windowName: profileName,
    dirId: browserId,
    os: randomOS.os,
    osVersion: randomOS.osVersion,
    coreVersion: randomChrome,
    fingerInfo,
  });

  if (mdfRsp.code !== 0) {
    throw new Error(`Failed to reset browser profile: ${mdfRsp.msg}`);
  }

  logger.info("Browser profile reset complete ({os} {osVersion}, Chrome {chrome})", {
    os: randomOS.os,
    osVersion: randomOS.osVersion,
    chrome: randomChrome,
  });
}

/**
 * Configure browser with a specific proxy
 */
export async function configureBrowserProxy(
  browserId: string,
  proxy: Proxy,
  profileName: string = DEFAULT_BROWSER_PROFILE,
  workspaceId: number = WORKSPACE_ID
): Promise<void> {
  const roxyClient = getRoxyClient();

  const fingerInfo: FingerInfo = {
    clearCacheFile: true,
    clearCookie: true,
    randomFingerprint: true,
    syncTab: false,
    syncCookie: false,
    isLanguageBaseIp: false,
    language: "en-US",
    isDisplayLanguageBaseIp: false,
    displayLanguage: "en-US",
    isTimeZone: true,
  };

  const proxyInfo = toProxyInfo(proxy, "HTTP");
  const randomOS = getRandomOS();
  const randomChrome = getRandomChromeVersion();

  const mdfRsp = await roxyClient.browserModify({
    workspaceId,
    windowName: profileName,
    dirId: browserId,
    proxyInfo,
    os: randomOS.os,
    osVersion: randomOS.osVersion,
    coreVersion: randomChrome,
    fingerInfo,
  });

  if (mdfRsp.code !== 0) {
    throw new Error(`Failed to modify browser: ${mdfRsp.msg}`);
  }
}

/**
 * Open browser and connect with Puppeteer
 */
export async function openBrowser(
  browserId: string,
  workspaceId: number = WORKSPACE_ID
): Promise<Browser> {
  const roxyClient = getRoxyClient();

  let openRsp = await roxyClient.browserOpen(workspaceId, browserId);

  if (openRsp.code !== 0 && openRsp.msg === "窗口已打开") {
    logger.warn("Browser already open, closing and reopening...");
    await roxyClient.browserClose(browserId);
    await Bun.sleep(1000);
    openRsp = await roxyClient.browserOpen(workspaceId, browserId);
  }

  if (openRsp.code !== 0) {
    throw new Error(`Failed to open browser: ${openRsp.msg}`);
  }

  logger.info("Browser opened: {ws}", { ws: openRsp.data.ws });

  const browser = await puppeteer.connect({
    browserWSEndpoint: openRsp.data.ws,
    defaultViewport: null,
  });

  return browser;
}

/**
 * Close browser and cleanup
 */
export async function closeBrowser(
  browser: Browser | null,
  browserId: string
): Promise<void> {
  const roxyClient = getRoxyClient();

  if (browser) {
    try {
      await browser.disconnect();
    } catch {
      // Ignore disconnect errors
    }
  }

  await roxyClient.browserClose(browserId);
}

/**
 * Get browser profile details
 */
export async function getBrowserDetails(
  browserId: string,
  workspaceId: number = WORKSPACE_ID
): Promise<BrowserDetailData | null> {
  const roxyClient = getRoxyClient();

  const detailRsp = await roxyClient.browserDetail(workspaceId, browserId);

  const detailData = detailRsp.data?.rows?.[0];
  if (detailRsp.code === 0 && detailData) {
    return detailData;
  }

  return null;
}

/**
 * Create a complete browser session with proxy
 */
export async function createBrowserSession(
  proxy?: Proxy,
  profileName: string = DEFAULT_BROWSER_PROFILE,
  workspaceId: number = WORKSPACE_ID,
  projectId: number = PROJECT_ID
): Promise<BrowserSession> {
  const { browserId } = await getOrCreateBrowserProfile(
    profileName,
    workspaceId,
    projectId
  );

  // Always configure fingerprint/language (forces en-US)
  if (proxy) {
    await configureBrowserProxy(browserId, proxy, profileName, workspaceId);
  } else {
    await configureBrowserFingerprint(browserId, profileName, workspaceId);
  }

  const browser = await openBrowser(browserId, workspaceId);

  return {
    browser,
    browserId,
    proxy: proxy || { username: "", password: "", host: "", port: 0 },
    workspaceId,
  };
}

/**
 * Check RoxyClient health
 */
export async function checkHealth(): Promise<boolean> {
  const roxyClient = getRoxyClient();
  const healthRsp = await roxyClient.health();
  logger.debug("Health check: {response}", { response: healthRsp });
  return healthRsp.code === 0;
}

/**
 * Close all open browsers (cleanup on error/exit)
 */
export async function closeAllBrowsers(
  workspaceId: number = WORKSPACE_ID
): Promise<number> {
  try {
    const roxyClient = getRoxyClient();
    const closed = await roxyClient.closeAllBrowsers(workspaceId);
    if (closed > 0) {
      console.log(`Closed ${closed} browser(s)`);
    }
    return closed;
  } catch {
    return 0;
  }
}

/**
 * Delete all browser profiles (cleanup before batch registration)
 */
export async function deleteAllBrowserProfiles(
  workspaceId: number = WORKSPACE_ID
): Promise<number> {
  try {
    const roxyClient = getRoxyClient();
    // First close all browsers
    await roxyClient.closeAllBrowsers(workspaceId);
    // Then delete all profiles
    const deleted = await roxyClient.deleteAllBrowserProfiles(workspaceId);
    if (deleted > 0) {
      console.log(`Deleted ${deleted} browser profile(s)`);
    }
    return deleted;
  } catch {
    return 0;
  }
}
