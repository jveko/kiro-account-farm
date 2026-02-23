#!/usr/bin/env bun
/**
 * Gmail OAuth2 Authorization CLI
 * Authorize Gmail accounts one at a time. Tokens saved per-account in gmail-tokens.json.
 *
 * Usage: bun bin/gmail-auth.ts
 *
 * Prerequisites: Create gmail.json with your Google Cloud OAuth2 credentials:
 *   { "client_id": "xxx.apps.googleusercontent.com", "client_secret": "xxx" }
 */

import {
  loadConfig,
  loadTokenStore,
  authenticate,
  getValidToken,
} from "../src/api/gmail";

async function main() {
  console.log("📧 Gmail OAuth2 Setup\n");

  let config;
  try {
    config = await loadConfig();
  } catch (error) {
    console.error("❌", error instanceof Error ? error.message : error);
    console.log(
      '\n📝 Create gmail.json in the project root with:\n{\n  "client_id": "YOUR_CLIENT_ID.apps.googleusercontent.com",\n  "client_secret": "YOUR_CLIENT_SECRET"\n}'
    );
    process.exit(1);
  }

  // Show existing accounts and auto-refresh expired ones
  const store = await loadTokenStore();
  const accounts = Object.keys(store);
  if (accounts.length > 0) {
    console.log(`📋 Existing authorized accounts (${accounts.length}):`);
    for (const email of accounts) {
      const token = store[email]!;
      const expired = Date.now() > token.token_expiry;
      if (expired) {
        try {
          const refreshed = await getValidToken(email);
          console.log(`   ${email} — 🔄 refreshed (expires ${new Date(refreshed.token_expiry).toLocaleString()})`);
        } catch {
          console.log(`   ${email} — ❌ refresh failed (re-authorize needed)`);
        }
      } else {
        console.log(`   ${email} — ✅ valid (expires ${new Date(token.token_expiry).toLocaleString()})`);
      }
    }
    console.log();
  }

  try {
    const email = await authenticate(config);
    console.log(`\n✅ Authorized: ${email}`);

    const token = await getValidToken(email);
    console.log(
      `   Token expires: ${new Date(token.token_expiry).toLocaleString()}`
    );

    const updatedStore = await loadTokenStore();
    console.log(
      `   Total accounts: ${Object.keys(updatedStore).length}`
    );
  } catch (error) {
    console.error(
      "\n❌ Authorization failed:",
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

main();
