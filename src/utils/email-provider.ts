import type { EmailProvider } from "../types/provider";
import { generateGmailAlias, isValidGmail } from "./gmail-alias";
import { generateSimpleLoginAlias, isValidSimpleLoginEmail } from "./simplelogin-alias";
import { generateMailtmAlias, isValidMailtmDomain } from "./mailtm-alias";
import { generateFreemailAlias, isValidFreemailDomain } from "./freemail-alias";
import { fetchAwsOtp, type OTPFetchResult } from "./gmail-otp";
import { fetchSimpleLoginOtp } from "./simplelogin-otp";
import { fetchMailtmOtp } from "./mailtm-otp";
import { fetchFreemailOtp } from "./freemail-otp";
import type { MailtmClient } from "../api/mailtm";
import type { FreemailClient } from "../api/freemail";

export interface AliasOptions {
  baseInput: string;
  index: number;
}

export function generateEmailAlias(provider: EmailProvider, options: AliasOptions): string {
  switch (provider) {
    case "gmail":
      return generateGmailAlias({ baseEmail: options.baseInput, index: options.index, mode: "auto" });
    case "simplelogin":
      return generateSimpleLoginAlias({ domain: options.baseInput, index: options.index });
    case "mailtm":
      return generateMailtmAlias({ domain: options.baseInput, index: options.index });
    case "freemail":
      return generateFreemailAlias({ domain: options.baseInput, index: options.index });
  }
}

export function isValidEmail(provider: EmailProvider, email: string): boolean {
  switch (provider) {
    case "gmail":
      return isValidGmail(email);
    case "simplelogin":
      return isValidSimpleLoginEmail(email);
    case "mailtm":
      return isValidMailtmDomain(email);
    case "freemail":
      return isValidFreemailDomain(email);
  }
}

export async function fetchOtp(
  provider: EmailProvider,
  toEmail: string,
  maxAttempts?: number,
  pollIntervalMs?: number,
  onPoll?: (attempt: number, maxAttempts: number) => void,
  mailtmClient?: MailtmClient,
  freemailClient?: FreemailClient
): Promise<OTPFetchResult> {
  switch (provider) {
    case "gmail":
      return fetchAwsOtp(toEmail, maxAttempts, pollIntervalMs, onPoll);
    case "simplelogin":
      return fetchSimpleLoginOtp(toEmail, maxAttempts, pollIntervalMs, onPoll);
    case "mailtm": {
      if (!mailtmClient) {
        throw new Error(
          "Mail.tm requires an authenticated MailtmClient instance."
        );
      }
      return fetchMailtmOtp(mailtmClient, maxAttempts, pollIntervalMs, onPoll);
    }
    case "freemail": {
      if (!freemailClient) {
        throw new Error(
          "Freemail requires a FreemailClient instance."
        );
      }
      return fetchFreemailOtp(freemailClient, toEmail, maxAttempts, pollIntervalMs, onPoll);
    }
  }
}
