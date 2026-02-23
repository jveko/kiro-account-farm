/**
 * Gmail OTP Fetcher via Gmail API
 * Fetches AWS Builder ID verification codes from Gmail
 */

import {
  getValidToken,
  searchMessages,
  getMessage,
  extractBody,
} from "../api/gmail";

export interface OTPFetchResult {
  success: boolean;
  code?: string;
  error?: string;
}

/**
 * Resolve a Gmail alias to the base email for token lookup.
 * Strips +suffix and removes dots from local part.
 * e.g. "e.dsaxeaf+abc@gmail.com" → "edsaxeaf@gmail.com"
 */
function resolveBaseEmail(alias: string): string {
  const [localPart, domain] = alias.split("@");
  if (!localPart || !domain) {
    throw new Error(`Invalid email: ${alias}`);
  }
  const base = localPart.split("+")[0]!.replace(/\./g, "").toLowerCase();
  return `${base}@${domain.toLowerCase()}`;
}

/**
 * Fetch AWS verification OTP code from Gmail for a specific email alias
 * @param toEmail - The email alias the verification was sent to
 * @param maxAttempts - Maximum number of polling attempts
 * @param pollIntervalMs - Interval between polling attempts in ms
 * @param onPoll - Optional callback for each poll attempt
 */
export async function fetchAwsOtp(
  toEmail: string,
  maxAttempts = 30,
  pollIntervalMs = 2000,
  onPoll?: (attempt: number, maxAttempts: number) => void
): Promise<OTPFetchResult> {
  // Resolve alias to base email for token lookup
  const baseEmail = resolveBaseEmail(toEmail);

  let accessToken: string;
  try {
    const token = await getValidToken(baseEmail);
    accessToken = token.access_token;
  } catch (error) {
    return {
      success: false,
      error: `Gmail auth failed for ${baseEmail}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      if (onPoll) {
        onPoll(attempt, maxAttempts);
      }

      const result = await tryFetchOtp(accessToken, toEmail);
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

/**
 * Single attempt to fetch OTP from Gmail API
 */
async function tryFetchOtp(accessToken: string, toEmail: string): Promise<OTPFetchResult> {
  const query = `from:no-reply@signin.aws to:${toEmail} newer_than:5m is:unread`;

  const searchResult = await searchMessages(accessToken, query, 1);

  if (!searchResult.messages || searchResult.messages.length === 0) {
    return {
      success: false,
      error: "No verification email found yet",
    };
  }

  const message = await getMessage(accessToken, searchResult.messages[0]!.id);
  const body = extractBody(message);

  // Extract 6-digit verification code from body (handles "code:: 228276" and "code: 228276")
  const codeMatch = body.match(/verification\s*code:+\s*(\d{6})/i);

  if (!codeMatch || !codeMatch[1]) {
    return {
      success: false,
      error: "Found email but could not extract verification code",
    };
  }

  return {
    success: true,
    code: codeMatch[1],
  };
}
