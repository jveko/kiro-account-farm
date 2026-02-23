/**
 * Centralized configuration for Google login automation
 *
 * Environment variables can override defaults.
 * Create a .env file or export these before running.
 */

// Roxy Browser API
export const ROXY_PORT = Number(Bun.env.ROXY_PORT) || 50000;

function getRoxyApiToken(): string {
  const token = Bun.env.ROXY_API_TOKEN;
  if (!token) {
    throw new Error("Missing required environment variable: ROXY_API_TOKEN");
  }
  return token;
}

export const ROXY_API_TOKEN_LAZY = {
  get value() {
    return getRoxyApiToken();
  },
};

// Workspace and Project
export const WORKSPACE_ID = Number(Bun.env.WORKSPACE_ID) || 56444;
export const PROJECT_ID = Number(Bun.env.PROJECT_ID) || 62185;

// Proxy settings
export const BASE_PROXY_PORT = Number(Bun.env.BASE_PROXY_PORT) || 10000;
export const FRAUD_SCORE_THRESHOLD = Number(Bun.env.FRAUD_SCORE_THRESHOLD) || 5;
export const MAX_PROXY_RETRIES = Number(Bun.env.MAX_PROXY_RETRIES) || 10;

// Browser settings
export const CHROME_VERSION = "143";
export const DEFAULT_BROWSER_PROFILE =
  Bun.env.DEFAULT_BROWSER_PROFILE || "google-automation";

// Timeouts (in milliseconds)
export const TIMEOUTS = {
  DEFAULT: 30000,
  SHORT: 5000,
  MEDIUM: 15000,
  LONG: 60000,
  CAPTCHA: 120000,
} as const;

// Wait durations for animations and transitions (in milliseconds)
export const WAIT = {
  SHORT: 500,
  MEDIUM: 1500,
  LONG: 3000,
  ANIMATION: 2000,
  NAVIGATION: 5000,
} as const;

// Human-like automation delays (in milliseconds)
export const AUTOMATION_DELAYS = {
  TYPING_DELAY: 80, // delay between keystrokes
  AFTER_FILL: 800, // wait after filling an input
  BEFORE_CLICK: 500, // wait before clicking a button
  AFTER_CLICK: 1000, // wait after clicking a button
  AFTER_NAVIGATION: 2000, // wait after page navigation
  BETWEEN_STEPS: 1500, // wait between major steps
} as const;

// URLs
export const URLS = {
  GOOGLE_SIGNIN: "https://accounts.google.com/signin",
  GOOGLE_MYACCOUNT: "https://myaccount.google.com",
  GOOGLE_LOGOUT: "https://accounts.google.com/Logout",
  AWS_OIDC_BASE: "https://oidc.us-east-1.amazonaws.com",
  AWS_BUILDER_ID_START: "https://view.awsapps.com/start",
} as const;

// Logging
export const LOG_LEVEL = Bun.env.LOG_LEVEL || "info";
export const VERBOSE = LOG_LEVEL === "debug";

// AWS Builder ID settings
export const AWS_BUILDER_ID = {
  CLIENT_NAME: "Amazon Q Developer for command line",
  CLIENT_TYPE: "public",
  SCOPES: [
    "codewhisperer:completions",
    "codewhisperer:analysis",
    "codewhisperer:conversations",
  ],
  GRANT_TYPES: [
    "urn:ietf:params:oauth:grant-type:device_code",
    "refresh_token",
  ],
  ISSUER_URL: "https://identitycenter.amazonaws.com/ssoins-722374e5d5e7e3e0",
  TOKEN_POLL_INTERVAL: 1000, // 1 second
  TOKEN_POLL_TIMEOUT: 600000, // 10 minutes
} as const;

// Batch registration settings
export const BATCH_REGISTRATION = {
  DEFAULT_PARALLEL_ACCOUNTS: 1,
  MAX_PARALLEL_ACCOUNTS: 5,
  STAGGER_DELAY: 3000, // 3 seconds between starting workers
} as const;

// Credential upload API settings
export const CREDENTIAL_API = {
  URL:
    Bun.env.CREDENTIAL_API_URL || "http://localhost:8990/api/admin/credentials",
  API_KEY: Bun.env.CREDENTIAL_API_KEY || "sk-admin",
  AUTH_METHOD: "idc",
  PRIORITY: 0,
} as const;

// Freemail settings
export const FREEMAIL = {
  BASE_URL: Bun.env.FREEMAIL_BASE_URL || "https://mailfree.cloudflare-5e0.workers.dev",
  API_TOKEN: Bun.env.FREEMAIL_API_TOKEN || "zxc123",
} as const;

// Grouped config object for convenience
export const CONFIG = {
  roxy: {
    port: ROXY_PORT,
    get token() {
      return ROXY_API_TOKEN_LAZY.value;
    },
  },
  workspace: {
    id: WORKSPACE_ID,
    projectId: PROJECT_ID,
  },
  proxy: {
    basePort: BASE_PROXY_PORT,
    fraudThreshold: FRAUD_SCORE_THRESHOLD,
    maxRetries: MAX_PROXY_RETRIES,
  },
  browser: {
    defaultProfile: DEFAULT_BROWSER_PROFILE,
  },
  timeouts: TIMEOUTS,
  wait: WAIT,
  urls: URLS,
  logging: {
    level: LOG_LEVEL,
    verbose: VERBOSE,
  },
  awsBuilderID: AWS_BUILDER_ID,
  batchRegistration: BATCH_REGISTRATION,
} as const;
