/**
 * Gmail OAuth2 Client
 * Authenticates via localhost redirect flow, manages per-account tokens,
 * and provides Gmail API access for reading messages.
 *
 * Config: gmail.json (manual) — single client_id + client_secret
 * State: gmail-tokens.json (auto) — tokens keyed by Gmail address
 */

import { resolve } from "path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const GMAIL_CONFIG_PATH = resolve(PROJECT_ROOT, "gmail.json");
const GMAIL_TOKENS_PATH = resolve(PROJECT_ROOT, "gmail-tokens.json");
const OAUTH_REDIRECT_PORT = 41592;
const OAUTH_REDIRECT_URI = `http://localhost:${OAUTH_REDIRECT_PORT}/callback`;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"];

export interface GmailConfig {
  client_id: string;
  client_secret: string;
}

export interface AccountToken {
  client_id: string;
  client_secret: string;
  access_token: string;
  refresh_token: string;
  token_expiry: number;
}

export type GmailTokenStore = Record<string, AccountToken>;

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

interface GmailMessageListResponse {
  messages?: Array<{ id: string; threadId: string }>;
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

interface GmailMessageHeader {
  name: string;
  value: string;
}

interface GmailMessagePart {
  mimeType: string;
  body?: { data?: string; size?: number };
  parts?: GmailMessagePart[];
  headers?: GmailMessageHeader[];
}

interface GmailMessage {
  id: string;
  threadId: string;
  snippet: string;
  payload: GmailMessagePart;
  internalDate: string;
}

// ─── Config & Token Store ───────────────────────────────────────────

/**
 * Load OAuth client config from gmail.json
 */
export async function loadConfig(): Promise<GmailConfig> {
  const file = Bun.file(GMAIL_CONFIG_PATH);
  if (!(await file.exists())) {
    throw new Error(
      `gmail.json not found at ${GMAIL_CONFIG_PATH}. Create it with: { "client_id": "...", "client_secret": "..." }`
    );
  }
  return file.json();
}

/**
 * Load all account tokens from gmail-tokens.json
 */
export async function loadTokenStore(): Promise<GmailTokenStore> {
  const file = Bun.file(GMAIL_TOKENS_PATH);
  if (!(await file.exists())) {
    return {};
  }
  return file.json();
}

/**
 * Save token store to gmail-tokens.json
 */
async function saveTokenStore(store: GmailTokenStore): Promise<void> {
  await Bun.write(GMAIL_TOKENS_PATH, JSON.stringify(store, null, 2) + "\n");
}

/**
 * Save a single account's tokens into the store
 */
async function saveAccountToken(
  email: string,
  token: AccountToken
): Promise<void> {
  const store = await loadTokenStore();
  store[email] = token;
  await saveTokenStore(store);
}

// ─── OAuth2 Flow ────────────────────────────────────────────────────

/**
 * Run the OAuth2 localhost redirect flow.
 * Opens browser for consent, catches callback, exchanges code for tokens.
 * Auto-detects the email address and saves tokens under that key.
 * Returns the authorized email address.
 */
export async function authenticate(config: GmailConfig): Promise<string> {
  const authUrl = new URL(GOOGLE_AUTH_URL);
  authUrl.searchParams.set("client_id", config.client_id);
  authUrl.searchParams.set("redirect_uri", OAUTH_REDIRECT_URI);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPES.join(" "));
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.log("\n🔐 Open this URL in your browser to authorize Gmail access:\n");
  console.log(authUrl.toString());
  console.log("\n⏳ Waiting for authorization callback...\n");

  // Wait for the OAuth callback
  const code = await waitForCallback();

  // Exchange code for tokens
  const tokenResponse = await exchangeCode(config, code);

  const accountToken: AccountToken = {
    client_id: config.client_id,
    client_secret: config.client_secret,
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token ?? "",
    token_expiry: Date.now() + tokenResponse.expires_in * 1000,
  };

  // Detect which email was authorized
  const email = await fetchEmailAddress(accountToken.access_token);
  await saveAccountToken(email, accountToken);

  return email;
}

/**
 * Spin up a temporary HTTP server to catch the OAuth callback
 */
function waitForCallback(): Promise<string> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      server.stop();
      reject(new Error("OAuth callback timeout (120s)"));
    }, 120_000);

    const server = Bun.serve({
      port: OAUTH_REDIRECT_PORT,
      fetch(req) {
        const url = new URL(req.url);

        if (url.pathname !== "/callback") {
          return new Response("Not found", { status: 404 });
        }

        const code = url.searchParams.get("code");
        const error = url.searchParams.get("error");

        if (error) {
          clearTimeout(timeout);
          server.stop();
          reject(new Error(`OAuth error: ${error}`));
          return new Response(
            "<html><body><h1>❌ Authorization failed</h1><p>You can close this tab.</p></body></html>",
            { headers: { "Content-Type": "text/html" } }
          );
        }

        if (!code) {
          return new Response("Missing code parameter", { status: 400 });
        }

        clearTimeout(timeout);
        setTimeout(() => server.stop(), 500);
        resolve(code);

        return new Response(
          "<html><body><h1>✅ Gmail authorized!</h1><p>You can close this tab and return to the terminal.</p></body></html>",
          { headers: { "Content-Type": "text/html" } }
        );
      },
    });
  });
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCode(
  config: GmailConfig,
  code: string
): Promise<TokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.client_id,
      client_secret: config.client_secret,
      redirect_uri: OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

/**
 * Fetch the authenticated user's email address via Gmail API
 */
async function fetchEmailAddress(accessToken: string): Promise<string> {
  const response = await fetch(`${GMAIL_API_BASE}/profile`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error("Failed to fetch Gmail profile after authorization");
  }

  const profile = (await response.json()) as { emailAddress: string };
  return profile.emailAddress;
}

// ─── Token Management ───────────────────────────────────────────────

/**
 * Refresh an expired access token for a specific account
 */
async function refreshAccessToken(
  email: string,
  token: AccountToken
): Promise<AccountToken> {
  if (!token.refresh_token) {
    throw new Error(
      `No refresh_token for ${email}. Run \`bun bin/gmail-auth.ts\` to re-authorize.`
    );
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: token.client_id,
      client_secret: token.client_secret,
      refresh_token: token.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed for ${email}: ${error}`);
  }

  const data: TokenResponse = await response.json();

  const updated: AccountToken = {
    ...token,
    access_token: data.access_token,
    token_expiry: Date.now() + data.expires_in * 1000,
  };

  await saveAccountToken(email, updated);
  return updated;
}

/**
 * Normalize a Gmail address: lowercase, strip dots and +suffix from local part.
 */
function normalizeGmail(email: string): string {
  const parts = email.toLowerCase().split("@");
  let local = parts[0] ?? "";
  const domain = parts[1] ?? "";
  if (domain === "gmail.com") {
    local = local.split("+")[0] ?? local;
    return `${local.replace(/\./g, "")}@${domain}`;
  }
  return `${local}@${domain}`;
}

/**
 * Get a valid access token for a specific account, refreshing if needed.
 */
export async function getValidToken(email: string): Promise<AccountToken> {
  const store = await loadTokenStore();
  const normalized = normalizeGmail(email);
  let token = store[email] || store[email.toLowerCase()] ||
    Object.entries(store).find(([key]) => normalizeGmail(key) === normalized)?.[1];

  if (!token) {
    throw new Error(
      `No tokens for ${email}. Run \`bun bin/gmail-auth.ts\` to authorize this account.`
    );
  }

  // Refresh if expired (with 60s buffer)
  if (Date.now() > token.token_expiry - 60_000) {
    token = await refreshAccessToken(email, token);
  }

  return token;
}

// ─── Gmail API Methods ──────────────────────────────────────────────

/**
 * Search Gmail messages for a specific account
 */
export async function searchMessages(
  accessToken: string,
  query: string,
  maxResults = 5
): Promise<GmailMessageListResponse> {
  const url = `${GMAIL_API_BASE}/messages?q=${encodeURIComponent(query)}&maxResults=${maxResults}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gmail search failed (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Get a single message by ID
 */
export async function getMessage(
  accessToken: string,
  messageId: string
): Promise<GmailMessage> {
  const url = `${GMAIL_API_BASE}/messages/${messageId}?format=full`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Gmail get message failed (${response.status}): ${error}`);
  }

  return response.json();
}

/**
 * Decode base64url-encoded message body
 */
function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const decoded = atob(base64);
  try {
    return decodeURIComponent(
      decoded
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
  } catch {
    return decoded;
  }
}

/**
 * Extract plain text body from a Gmail message payload
 */
export function extractBody(message: GmailMessage): string {
  const payload = message.payload;

  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }

  if (payload.parts) {
    for (const mimeType of ["text/plain", "text/html"]) {
      const body = findBodyInParts(payload.parts, mimeType);
      if (body) return body;
    }
  }

  return "";
}

/**
 * Recursively search message parts for a body with a given MIME type
 */
function findBodyInParts(
  parts: GmailMessagePart[],
  targetMimeType: string
): string | null {
  for (const part of parts) {
    if (part.mimeType === targetMimeType && part.body?.data) {
      return decodeBase64Url(part.body.data);
    }
    if (part.parts) {
      const found = findBodyInParts(part.parts, targetMimeType);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Get a header value from a Gmail message
 */
export function getHeader(message: GmailMessage, name: string): string | null {
  const header = message.payload.headers?.find(
    (h) => h.name.toLowerCase() === name.toLowerCase()
  );
  return header?.value ?? null;
}
