import type { OTPFetchResult } from "./gmail-otp";

export async function fetchSimpleLoginOtp(
  toEmail: string,
  maxAttempts?: number,
  pollIntervalMs?: number,
  onPoll?: (attempt: number, maxAttempts: number) => void
): Promise<OTPFetchResult> {
  throw new Error("SimpleLogin OTP fetching not implemented yet");
}
