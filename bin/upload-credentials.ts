#!/usr/bin/env bun

/**
 * Credential Upload CLI
 * Uploads valid accounts from kiro-accounts JSON files to admin API
 * Supports batch concurrent uploads for faster processing
 */

import { CREDENTIAL_API } from "../src/config";

interface KiroAccount {
  email: string;
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  token?: {
    accessToken: string;
    refreshToken: string;
  };
}

interface KiroAccountsFile {
  accounts: KiroAccount[];
}

interface UploadPayload {
  refreshToken: string;
  authMethod: string;
  clientId: string;
  clientSecret: string;
  priority: number;
}

interface UploadResult {
  email: string;
  success: boolean;
  error?: string;
}

function printUsage() {
  console.log(`
Credential Upload

Usage:
  bun bin/upload-credentials.ts <json-file> [options]

Arguments:
  json-file     Path to kiro-accounts JSON file

Options:
  --priority    Priority value (default: ${CREDENTIAL_API.PRIORITY})
  --dry-run     Show what would be uploaded without sending
  --help, -h    Show this help

Examples:
  bun bin/upload-credentials.ts output/kiro-accounts-2026-02-09.json
  bun bin/upload-credentials.ts output/accounts.json --priority 1
  bun bin/upload-credentials.ts output/accounts.json --dry-run
`);
}

async function uploadCredential(email: string, payload: UploadPayload): Promise<UploadResult> {
  try {
    const response = await fetch(CREDENTIAL_API.URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": CREDENTIAL_API.API_KEY,
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const text = await response.text();
      return { email, success: false, error: `HTTP ${response.status}: ${text}` };
    }

    return { email, success: true };
  } catch (error) {
    return { email, success: false, error: (error as Error).message };
  }
}

function parseIntArg(args: string[], flag: string, defaultValue: number): number {
  const idx = args.indexOf(flag);
  return idx !== -1 ? parseInt(args[idx + 1] || String(defaultValue), 10) : defaultValue;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const jsonFile = args.find((a) => !a.startsWith("--")) || "";
  const priority = parseIntArg(args, "--priority", CREDENTIAL_API.PRIORITY);
  const dryRun = args.includes("--dry-run");

  if (!jsonFile) {
    console.error("Error: JSON file path required");
    process.exit(1);
  }

  let data: KiroAccountsFile;
  try {
    const file = Bun.file(jsonFile);
    data = await file.json();
  } catch (error) {
    console.error(`Error: Failed to read ${jsonFile}: ${(error as Error).message}`);
    process.exit(1);
  }

  const validAccounts = data.accounts.filter((a) => a.token?.refreshToken && a.clientId && a.clientSecret);

  console.log(`\n📤 Uploading ${validAccounts.length} credentials from ${jsonFile}`);
  console.log(`   Priority: ${priority}`);
  if (dryRun) {
    console.log("   Mode: DRY RUN\n");
  } else {
    console.log("");
  }

  if (dryRun) {
    for (let i = 0; i < validAccounts.length; i++) {
      const account = validAccounts[i]!;
      console.log(`[${i + 1}/${validAccounts.length}] 🔍 ${account.email}`);
      console.log(`   clientId: ${account.clientId}`);
    }
    console.log(`\n📊 Summary`);
    console.log(`   Total: ${validAccounts.length} (dry run)`);
    process.exit(0);
  }

  let successCount = 0;
  let failCount = 0;
  const total = validAccounts.length;

  const results = await Promise.allSettled(
    validAccounts.map((account) => {
      const payload: UploadPayload = {
        refreshToken: account.token!.refreshToken,
        authMethod: CREDENTIAL_API.AUTH_METHOD,
        clientId: account.clientId,
        clientSecret: account.clientSecret,
        priority,
      };
      return uploadCredential(account.email, payload);
    }),
  );

  for (let i = 0; i < results.length; i++) {
    const result = results[i]!;
    const idx = i + 1;
    if (result.status === "fulfilled") {
      if (result.value.success) {
        console.log(`[${idx}/${total}] ✅ ${result.value.email}`);
        successCount++;
      } else {
        console.log(`[${idx}/${total}] ❌ ${result.value.email}: ${result.value.error}`);
        failCount++;
      }
    } else {
      console.log(`[${idx}/${total}] ❌ Unexpected error: ${result.reason}`);
      failCount++;
    }
  }

  console.log(`\n📊 Summary`);
  console.log(`   ✅ Success: ${successCount}`);
  console.log(`   ❌ Failed:  ${failCount}`);

  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
