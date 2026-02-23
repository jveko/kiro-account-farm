import type { OTPFetchResult } from "./gmail-otp";
import type { MailtmClient } from "../api/mailtm";

export async function fetchMailtmOtp(
  client: MailtmClient,
  maxAttempts = 30,
  pollIntervalMs = 2000,
  onPoll?: (attempt: number, maxAttempts: number) => void
): Promise<OTPFetchResult> {
  if (!client.isAuthenticated()) {
    return {
      success: false,
      error: "Mail.tm client not authenticated. Call createSession() first.",
    };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (onPoll) {
        onPoll(attempt, maxAttempts);
      }

      const result = await tryFetchOtp(client);
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
  client: MailtmClient
): Promise<OTPFetchResult> {
  const messages = await client.getMessages();

  if (messages.length === 0) {
    return {
      success: false,
      error: "No messages found yet",
    };
  }

  for (const msg of messages) {
    const fromAddr = msg.from.address.toLowerCase();
    const subject = msg.subject.toLowerCase();

    const isAwsVerification =
      fromAddr.includes("signin.aws") ||
      fromAddr.includes("amazonaws.com") ||
      fromAddr.includes("aws") ||
      subject.includes("verification code") ||
      subject.includes("verify");

    if (!isAwsVerification) {
      continue;
    }

    const fullMessage = await client.getMessage(msg.id);
    const body = fullMessage.text || fullMessage.intro || "";

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
    error: `No verification code found (${messages.length} messages checked)`,
  };
}
