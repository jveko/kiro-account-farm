import type { OTPFetchResult } from "./gmail-otp";
import type { FreemailClient } from "../api/freemail";

export async function fetchFreemailOtp(
  client: FreemailClient,
  mailboxAddress: string,
  maxAttempts = 30,
  pollIntervalMs = 2000,
  onPoll?: (attempt: number, maxAttempts: number) => void
): Promise<OTPFetchResult> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (onPoll) {
        onPoll(attempt, maxAttempts);
      }

      const result = await tryFetchOtp(client, mailboxAddress);
      if (result.success && result.code) {
        return result;
      }

      if (attempt < maxAttempts) {
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      }
    } catch (error) {
      if (attempt === maxAttempts) {
        return {
          success: false,
          error: error instanceof Error ? error.message : String(error),
        };
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
  }

  return {
    success: false,
    error: `No verification email found after ${maxAttempts} attempts`,
  };
}

async function tryFetchOtp(
  client: FreemailClient,
  mailboxAddress: string
): Promise<OTPFetchResult> {
  const emails = await client.getEmails(mailboxAddress);

  if (emails.length === 0) {
    return {
      success: false,
      error: "No messages found yet",
    };
  }

  for (const email of emails) {
    // Check if the API already extracted a verification code
    if (email.verification_code) {
      return {
        success: true,
        code: email.verification_code,
      };
    }

    const sender = email.sender.toLowerCase();
    const subject = email.subject.toLowerCase();

    const isAwsVerification =
      sender.includes("signin.aws") ||
      sender.includes("amazonaws.com") ||
      sender.includes("aws") ||
      subject.includes("verification code") ||
      subject.includes("verify");

    if (!isAwsVerification) {
      continue;
    }

    // Fetch full email for body content
    const fullEmail = await client.getEmail(email.id);
    const body = fullEmail.content || fullEmail.html_content || "";

    const codePatterns = [
      /verification\s*code\s*:?\s*(\d{6})/i,
      /code\s*:?\s*(\d{6})/i,
      /(\d{6})/,
    ];

    for (const pattern of codePatterns) {
      const match = body.match(pattern);
      if (match?.[1]) {
        return {
          success: true,
          code: match[1],
        };
      }
    }
  }

  return {
    success: false,
    error: `No verification code found (${emails.length} emails checked)`,
  };
}
