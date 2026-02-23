/**
 * AWS Token Validation API
 * Validates access tokens against AWS Q API
 */

import { generateUUID } from "../utils/generators";
import { createProxyFetch } from "../utils/fetch";
import type { ProxyConfig } from "../services/proxy";

const Q_BASE_URL = "https://q.us-east-1.amazonaws.com";

export type TokenStatus = "valid" | "suspended" | "expired" | "invalid" | "error";

export interface ValidationResult {
  status: TokenStatus;
  error?: string;
  usage?: Record<string, unknown>;
}

/**
 * Validate if a token is valid (detect suspension status)
 */
export async function validateToken(
  accessToken: string,
  proxy?: ProxyConfig | { host: string; port: number; username?: string; password?: string }
): Promise<ValidationResult> {
  const proxyFetch = createProxyFetch(proxy);

  try {
    const response = await proxyFetch(
      `${Q_BASE_URL}/getUsageLimits?origin=AI_EDITOR&resourceType=AGENTIC_REQUEST`,
      {
        method: "GET",
        headers: {
          "content-type": "application/x-amz-json-1.0",
          "x-amz-target": "AmazonCodeWhispererStreamingService.GenerateAssistantResponse",
          "user-agent": "aws-sdk-rust/1.3.9 ua/2.1 api/codewhispererstreaming/0.1.11582 os/windows lang/rust/1.87.0 md/appVersion-1.19.4 app/AmazonQ-For-CLI",
          "x-amz-user-agent": "aws-sdk-rust/1.3.9 ua/2.1 api/codewhispererstreaming/0.1.11582 os/windows lang/rust/1.87.0 m/F app/AmazonQ-For-CLI",
          "x-amzn-codewhisperer-optout": "false",
          authorization: `Bearer ${accessToken}`,
          "amz-sdk-request": "attempt=1; max=3",
          "amz-sdk-invocation-id": generateUUID(),
        }
      }
    );

    const text = await response.text();

    if (text.includes("TEMPORARILY_SUSPENDED")) {
      return { status: "suspended", error: "Account temporarily suspended" };
    }

    if (
      response.status === 401 ||
      text.includes("ExpiredToken") ||
      text.includes("expired") ||
      text.includes("UnauthorizedException")
    ) {
      return { status: "expired", error: "Token expired or unauthorized" };
    }

    if (
      text.includes("AccessDeniedException") ||
      text.includes("ValidationException") ||
      text.includes("ResourceNotFoundException")
    ) {
      return { status: "invalid", error: `Account error: ${text.substring(0, 100)}` };
    }

    if (response.ok) {
      try {
        const data = JSON.parse(text);
        return { status: "valid", usage: data };
      } catch {
        return { status: "valid" };
      }
    }

    if (response.status === 403) {
      return { status: "invalid", error: "Access forbidden" };
    }

    if (response.status >= 500) {
      return { status: "error", error: `Server error: ${response.status}` };
    }

    return { status: "invalid", error: `HTTP ${response.status}: ${text.substring(0, 100)}` };
  } catch (error) {
    return { status: "error", error: `Network error: ${(error as Error).message}` };
  }
}

export interface BatchValidationResult {
  email: string;
  status: TokenStatus;
  error?: string;
  usage?: Record<string, unknown>;
}

export interface BatchValidationConfig {
  accounts: Array<{
    email: string;
    token?: {
      accessToken: string;
    };
  }>;
  proxy?: ProxyConfig | { host: string; port: number; username?: string; password?: string };
  concurrency?: number;
  onProgress?: (completed: number, total: number, result: BatchValidationResult) => void;
}

/**
 * Validate multiple tokens in batch
 */
export async function batchValidateTokens(
  config: BatchValidationConfig
): Promise<BatchValidationResult[]> {
  const { accounts, proxy, concurrency = 5, onProgress } = config;
  const results: BatchValidationResult[] = [];
  let completed = 0;

  const accountsWithTokens = accounts.filter((a) => a.token?.accessToken);

  const processAccount = async (account: (typeof accountsWithTokens)[0]) => {
    const result = await validateToken(account.token!.accessToken, proxy);
    const batchResult: BatchValidationResult = {
      email: account.email,
      ...result,
    };

    completed++;
    onProgress?.(completed, accountsWithTokens.length, batchResult);

    return batchResult;
  };

  // Process in batches for concurrency control
  for (let i = 0; i < accountsWithTokens.length; i += concurrency) {
    const batch = accountsWithTokens.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(processAccount));
    results.push(...batchResults);
  }

  // Add accounts without tokens as invalid
  for (const account of accounts) {
    if (!account.token?.accessToken) {
      results.push({
        email: account.email,
        status: "invalid",
        error: "No access token",
      });
    }
  }

  return results;
}
