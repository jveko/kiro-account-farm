#!/usr/bin/env bun

/**
 * AWS Builder ID Batch Registration CLI
 * Creates multiple AWS Builder ID accounts for Kiro IDE
 */

import { join } from "path";
import { batchRegister, exportResults } from "../src/automation/aws-builder-id/orchestrator";
import { isValidEmail } from "../src/utils/email-provider";
import { MailtmClient } from "../src/api/mailtm";
import { FreemailClient } from "../src/api/freemail";
import type { BatchProgress } from "../src/types/aws-builder-id";
import type { EmailProvider } from "../src/types/provider";
import { enableFastMode, enableSkipProxyCheck, FAST_MODE, SKIP_PROXY_CHECK } from "../src/config";

function printUsage() {
  console.log(`
AWS Builder ID Batch Registration

Usage:
  bun bin/register.ts <input> <count> [options]
  bun bin/register.ts <count> --provider mailtm [--parallel N]
  bun bin/register.ts <count> --provider freemail [--parallel N]

Arguments:
  input         Gmail: comma-separated email addresses
                SimpleLogin: comma-separated domains
                Mail.tm: not needed (domain auto-fetched)
                Freemail: not needed (mailbox auto-generated)
  count         Number of accounts to create PER WORKER (1-100)

Options:
  --provider    Email provider: gmail, simplelogin, mailtm, freemail (default: gmail)
  --parallel    Number of parallel workers (mailtm/freemail only, default: 1)
  --fast        Reduce delays and skip mouse simulation for faster execution
  --skip-proxy-check  Skip fraud/residential checks, just rotate proxy ports
  --help, -h    Show this help

Examples:
  bun bin/register.ts myemail@gmail.com 5
  bun bin/register.ts myemail@gmail.com 5 --provider gmail
  bun bin/register.ts mydomain.com 3 --provider simplelogin
  bun bin/register.ts email1@gmail.com,email2@gmail.com 5
  bun bin/register.ts 5 --provider mailtm
  bun bin/register.ts 5 --provider mailtm --parallel 3
  bun bin/register.ts 5 --provider freemail
  bun bin/register.ts 5 --provider freemail --parallel 3
`);
}


async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--help") || args.includes("-h")) {
    printUsage();
    process.exit(0);
  }

  // Parse --provider flag first (needed to determine arg parsing)
  const providerIndex = args.indexOf("--provider");
  let provider: EmailProvider = "gmail";
  if (providerIndex !== -1 && args[providerIndex + 1]) {
    const providerArg = args[providerIndex + 1];
    if (providerArg !== "gmail" && providerArg !== "simplelogin" && providerArg !== "mailtm" && providerArg !== "freemail") {
      console.error(`Error: Invalid provider "${providerArg}". Must be "gmail", "simplelogin", "mailtm", or "freemail"`);
      process.exit(1);
    }
    provider = providerArg;
  }

  // Parse positional arguments (exclude values of named flags)
  const namedFlags = ["--provider", "--parallel", "--fast", "--skip-proxy-check"];
  const positional = args.filter((a, i) => !a.startsWith("--") && (i === 0 || !namedFlags.includes(args[i - 1] || "")));

  // Parse --parallel flag
  const parallelIndex = args.indexOf("--parallel");
  const parallelCount = parallelIndex !== -1 ? parseInt(args[parallelIndex + 1] || "1", 10) : 1;

  // Parse --fast flag
  if (args.includes("--fast")) {
    enableFastMode();
  }

  // Parse --skip-proxy-check flag
  if (args.includes("--skip-proxy-check")) {
    enableSkipProxyCheck();
  }

  let baseInputs: string[];
  let countPerEmail: number;
  let freemailDomainCount: number | undefined;

  if (provider === "mailtm") {
    // mailtm: only count is needed, domain is auto-fetched
    if (positional.length < 1) {
      printUsage();
      process.exit(1);
    }
    countPerEmail = parseInt(positional[0] || "0", 10);

    console.log("Fetching Mail.tm domain...");
    const mailtmClient = new MailtmClient();
    const domain = await mailtmClient.getActiveDomain();
    console.log(`Using domain: ${domain}`);
    baseInputs = Array(parallelCount).fill(domain);
  } else if (provider === "freemail") {
    // freemail: only count is needed, mailbox is auto-generated via API
    if (positional.length < 1) {
      printUsage();
      process.exit(1);
    }
    countPerEmail = parseInt(positional[0] || "0", 10);

    console.log("Fetching Freemail domains...");
    const freemailClient = new FreemailClient();
    const domains = await freemailClient.getDomains();
    if (domains.length === 0) {
      console.error("Error: No domains available on Freemail server");
      process.exit(1);
    }
    console.log(`Available domains: ${domains.join(", ")} (round-robin)`);
    freemailDomainCount = domains.length;
    // Distribute domains across workers in round-robin fashion
    baseInputs = Array.from({ length: parallelCount }, (_, i) => domains[i % domains.length]);
  } else {
    // gmail/simplelogin: need input + count
    if (positional.length < 2) {
      printUsage();
      process.exit(1);
    }
    const inputStr = positional[0] || "";
    baseInputs = inputStr.split(",").map((e) => e.trim()).filter(Boolean);
    countPerEmail = parseInt(positional[1] || "0", 10);
  }

  // Validate inputs
  if (baseInputs.length === 0) {
    console.error(`Error: At least one ${provider === "gmail" ? "email" : "domain"} is required`);
    process.exit(1);
  }

  if (provider === "gmail") {
    for (const email of baseInputs) {
      if (!isValidEmail(provider, email)) {
        console.error(`Error: Invalid Gmail address: ${email}`);
        process.exit(1);
      }
    }
  } else if (provider === "simplelogin") {
    const domainPattern = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    for (const domain of baseInputs) {
      if (!domainPattern.test(domain)) {
        console.error(`Error: Invalid domain: ${domain}`);
        process.exit(1);
      }
    }
  }

  if (isNaN(countPerEmail) || countPerEmail < 1 || countPerEmail > 100) {
    console.error(`Error: Count must be between 1 and 100`);
    process.exit(1);
  }

  const totalAccounts = baseInputs.length * countPerEmail;

  // Run batch registration
  console.log(`\n🚀 AWS Builder ID Batch Registration`);
  console.log(`   ${provider === "gmail" ? "Emails" : "Domains"}: ${baseInputs.join(", ")}`);
  console.log(`   Provider: ${provider}`);
  console.log(`   Count per email: ${countPerEmail}`);
  console.log(`   Total accounts: ${totalAccounts}`);
  console.log(`   Parallel workers: ${baseInputs.length}`);
  if (FAST_MODE) console.log(`   ⚡ Fast mode enabled`);
  if (SKIP_PROXY_CHECK) console.log(`   🔄 Proxy check skipped (rotation only)`);
  console.log(`\n⚠️  Manual verification code entry required\n`);

  const startTime = Date.now();

  try {
    const progress = await batchRegister({
      provider,
      baseInputs,
      countPerEmail,
      freemailDomainCount,
      onProgress: (p: BatchProgress) => {
        // Progress logged by batch function
      },
    });

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Export results to output directory
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const outputFile = join("output", `kiro-accounts-${timestamp}.json`);
    exportResults(progress, outputFile);

    console.log(`\n✅ Completed in ${duration}s`);

    // Summary
    const validCount = progress.sessions.filter((s) => s.tokenStatus === "valid").length;
    const suspendedCount = progress.sessions.filter((s) => s.tokenStatus === "suspended").length;

    console.log(`\n📊 Summary:`);
    console.log(`   Total: ${progress.totalTarget}`);
    console.log(`   Valid: ${validCount}`);
    if (suspendedCount > 0) {
      console.log(`   Suspended: ${suspendedCount}`);
    }
    console.log(`   Failed: ${progress.totalFailed}`);

    // Show valid accounts
    const validSessions = progress.sessions.filter((s) => s.tokenStatus === "valid");
    if (validSessions.length > 0) {
      console.log(`\n✅ Valid Accounts:`);
      validSessions.forEach((s, i) => {
        console.log(`   ${i + 1}. ${s.account.email}`);
        console.log(`      Password: ${s.account.password}`);
        if (s.token) {
          console.log(`      Token: ${s.token.accessToken.slice(0, 30)}...`);
        }
      });
    }

    process.exit(progress.totalFailed > 0 || suspendedCount > 0 ? 1 : 0);
  } catch (error) {
    console.error(`\n❌ Registration failed:`, error);
    process.exit(1);
  }
}

main();
