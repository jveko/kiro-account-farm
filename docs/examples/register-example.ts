/**
 * Example: AWS Builder ID Registration
 * Demonstrates how to use the batch registration system
 */

import { batchRegister, exportResults } from "../../src/automation/aws-builder-id/orchestrator";
import type { BatchProgress, SessionState } from "../../src/types/aws-builder-id";

async function main() {
  console.log("AWS Builder ID Batch Registration Example\n");

  // Configuration
  const baseEmails = ["your-email@gmail.com"]; // Replace with your Gmail(s)
  const countPerEmail = 3; // Number of accounts per email

  console.log(`Creating ${baseEmails.length * countPerEmail} AWS Builder ID accounts...`);
  console.log(`Base emails: ${baseEmails.join(", ")}`);
  console.log(`Count per email: ${countPerEmail}\n`);

  try {
    const progress = await batchRegister({
      provider: "gmail",
      baseInputs: baseEmails,
      countPerEmail,
      onProgress: (p: BatchProgress) => {
        console.log(
          `[Progress] ${p.totalRegistered}/${p.totalTarget} completed, ${p.totalFailed} failed`
        );
      },
      onSessionUpdate: (session: SessionState) => {
        console.log(`[Session ${session.account.email}] Status: ${session.status}`);
        if (session.error) {
          console.log(`  Error: ${session.error}`);
        }
      },
    });

    // Export results
    const outputFile = "kiro-accounts-example.json";
    exportResults(progress, outputFile);

    console.log("\n✅ Registration completed!");
    console.log(`   Successful: ${progress.totalRegistered}/${progress.totalTarget}`);
    console.log(`   Failed: ${progress.totalFailed}`);
    console.log(`   Results saved to: ${outputFile}`);

    // Display successful accounts
    const successful = progress.sessions.filter((s) => s.status === "completed");
    if (successful.length > 0) {
      console.log("\n📋 Successful Accounts:");
      successful.forEach((s) => {
        console.log(`   - ${s.account.email}`);
        console.log(`     Password: ${s.account.password}`);
        console.log(`     Name: ${s.account.fullName}`);
        if (s.token) {
          console.log(`     Token: ${s.token.accessToken.slice(0, 20)}...`);
        }
      });
    }

    // Display failed accounts
    const failed = progress.sessions.filter((s) => s.status === "error");
    if (failed.length > 0) {
      console.log("\n❌ Failed Accounts:");
      failed.forEach((s) => {
        console.log(`   - ${s.account.email}: ${s.error}`);
      });
    }
  } catch (error) {
    console.error("Registration failed:", error);
    process.exit(1);
  }
}

main();
