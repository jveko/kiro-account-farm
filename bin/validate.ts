#!/usr/bin/env bun

/**
 * Token Validator CLI
 * Validates access tokens from kiro-accounts JSON files
 */

import { batchValidateTokens, type BatchValidationResult, type TokenStatus } from "../src/api/token-validator";

const STATUS_COLORS: Record<TokenStatus, string> = {
  valid: "\x1b[32m",
  suspended: "\x1b[33m",
  expired: "\x1b[33m",
  invalid: "\x1b[31m",
  error: "\x1b[90m",
};
const RESET = "\x1b[0m";

const STATUS_ICONS: Record<TokenStatus, string> = {
  valid: "✅",
  suspended: "⏸️",
  expired: "⏰",
  invalid: "❌",
  error: "⚠️",
};

function printUsage() {
  console.log(`
Token Validator

Usage:
  bun bin/validate.ts <json-file> [options]

Arguments:
  json-file     Path to kiro-accounts JSON file

Options:
  --proxy       Proxy URL (e.g., http://user:pass@host:port or host:port)
  --concurrency Number of concurrent validations (default: 5)
  --output      Output file for results (optional)
  --help, -h    Show this help

Examples:
  bun bin/validate.ts output/kiro-accounts-2026-02-09.json
  bun bin/validate.ts output/accounts.json --proxy 127.0.0.1:1080
  bun bin/validate.ts output/accounts.json --output validated.json
`);
}

function parseProxyUrl(proxyStr: string): { host: string; port: number; username?: string; password?: string } {
  if (!proxyStr.includes("@") && !proxyStr.startsWith("http")) {
    const [host, portStr] = proxyStr.split(":");
    return { host: host || "", port: parseInt(portStr || "0", 10) };
  }

  try {
    const url = new URL(proxyStr.startsWith("http") ? proxyStr : `http://${proxyStr}`);
    return {
      host: url.hostname,
      port: parseInt(url.port, 10) || 8080,
      username: url.username || undefined,
      password: url.password || undefined,
    };
  } catch {
    throw new Error(`Invalid proxy URL: ${proxyStr}`);
  }
}

interface KiroAccountsFile {
  accounts: Array<{
    email: string;
    token?: {
      accessToken: string;
    };
  }>;
}

async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    printUsage();
    process.exit(0);
  }

  const jsonFile = args.find((a) => !a.startsWith("--")) || "";
  const proxyIdx = args.indexOf("--proxy");
  const proxyStr = proxyIdx !== -1 ? args[proxyIdx + 1] : undefined;
  const concurrencyIdx = args.indexOf("--concurrency");
  const concurrency = concurrencyIdx !== -1 ? parseInt(args[concurrencyIdx + 1] || "5", 10) : 5;
  const outputIdx = args.indexOf("--output");
  const outputFile = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

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

  const accountsWithTokens = data.accounts.filter((a) => a.token?.accessToken);

  console.log(`\n🔍 Validating ${accountsWithTokens.length} tokens from ${jsonFile}`);
  if (proxyStr) {
    console.log(`   Proxy: ${proxyStr.replace(/:[^:@]+@/, ":****@")}`);
  }
  console.log(`   Concurrency: ${concurrency}\n`);

  const proxy = proxyStr ? parseProxyUrl(proxyStr) : undefined;
  const startTime = Date.now();

  const results = await batchValidateTokens({
    accounts: data.accounts,
    proxy,
    concurrency,
    onProgress: (completed, total, result) => {
      const color = STATUS_COLORS[result.status];
      const icon = STATUS_ICONS[result.status];
      console.log(
        `[${completed}/${total}] ${icon} ${color}${result.status.toUpperCase()}${RESET} - ${result.email}`
      );
    },
  });

  const duration = ((Date.now() - startTime) / 1000).toFixed(1);

  const summary: Record<TokenStatus, number> = {
    valid: 0,
    suspended: 0,
    expired: 0,
    invalid: 0,
    error: 0,
  };

  for (const r of results) {
    summary[r.status]++;
  }

  console.log(`\n📊 Completed in ${duration}s\n`);
  console.log(`   ${STATUS_ICONS.valid} Valid:     ${summary.valid}`);
  console.log(`   ${STATUS_ICONS.suspended} Suspended: ${summary.suspended}`);
  console.log(`   ${STATUS_ICONS.expired} Expired:   ${summary.expired}`);
  console.log(`   ${STATUS_ICONS.invalid} Invalid:   ${summary.invalid}`);
  console.log(`   ${STATUS_ICONS.error} Error:     ${summary.error}`);

  if (outputFile) {
    const output = {
      validatedAt: new Date().toISOString(),
      source: jsonFile,
      summary,
      results: results.map((r) => ({
        email: r.email,
        status: r.status,
        error: r.error,
      })),
    };
    await Bun.write(outputFile, JSON.stringify(output, null, 2));
    console.log(`\n📁 Results saved to: ${outputFile}`);
  }

  process.exit(summary.valid < results.length ? 1 : 0);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
