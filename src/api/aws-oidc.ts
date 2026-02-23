/**
 * AWS OIDC Device Authentication API Client
 * Direct AWS API calls for device authorization flow
 */

import { AWS_BUILDER_ID, URLS } from "../config";
import { generateUUID } from "../utils/generators";
import { createProxyFetch } from "../utils/fetch";
import type { ProxyConfig } from "../services/proxy";
import type { OIDCClientInfo, OIDCAuthInfo, TokenInfo } from "../types/aws-builder-id";

interface RegisterClientResponse {
  clientId: string;
  clientSecret: string;
}

interface DeviceAuthorizeResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn?: number;
  interval?: number;
}

interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType?: string;
}

/**
 * Get OIDC request headers (simulating AWS SDK)
 */
function getOidcHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "User-Agent": "aws-sdk-rust/1.3.9 os/windows lang/rust/1.87.0",
    "x-amz-user-agent":
      "aws-sdk-rust/1.3.9 ua/2.1 api/ssooidc/1.88.0 os/windows lang/rust/1.87.0 m/E app/AmazonQ-For-CLI",
    "amz-sdk-request": "attempt=1; max=3",
    "amz-sdk-invocation-id": generateUUID(),
  };
}

/**
 * AWS OIDC Device Authentication Client
 */
export class AWSDeviceAuthClient {
  private clientInfo?: OIDCClientInfo;
  private authInfo?: OIDCAuthInfo;
  private proxyFetch: (url: string | URL | Request, init?: RequestInit) => Promise<Response>;

  constructor(proxy?: ProxyConfig | { host: string; port: number; username?: string; password?: string }) {
    this.proxyFetch = createProxyFetch(proxy);
  }

  /**
   * Step 1: Register OIDC client
   */
  async registerClient(): Promise<OIDCClientInfo> {
    const payload = {
      clientName: AWS_BUILDER_ID.CLIENT_NAME,
      clientType: AWS_BUILDER_ID.CLIENT_TYPE,
      scopes: AWS_BUILDER_ID.SCOPES,
      grantTypes: AWS_BUILDER_ID.GRANT_TYPES,
      issuerUrl: AWS_BUILDER_ID.ISSUER_URL,
    };

    const response = await this.proxyFetch(`${URLS.AWS_OIDC_BASE}/client/register`, {
      method: "POST",
      headers: getOidcHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Client registration failed: ${error}`);
    }

    const data = (await response.json()) as RegisterClientResponse;
    this.clientInfo = {
      clientId: data.clientId,
      clientSecret: data.clientSecret,
    };

    return this.clientInfo;
  }

  /**
   * Step 2: Device authorization
   */
  async deviceAuthorize(): Promise<OIDCAuthInfo> {
    if (!this.clientInfo) {
      throw new Error("Please call registerClient() first");
    }

    const payload = {
      clientId: this.clientInfo.clientId,
      clientSecret: this.clientInfo.clientSecret,
      startUrl: URLS.AWS_BUILDER_ID_START,
    };

    const response = await this.proxyFetch(`${URLS.AWS_OIDC_BASE}/device_authorization`, {
      method: "POST",
      headers: getOidcHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Device authorization failed: ${error}`);
    }

    const data = (await response.json()) as DeviceAuthorizeResponse;
    this.authInfo = {
      deviceCode: data.deviceCode,
      userCode: data.userCode,
      verificationUri: data.verificationUri,
      verificationUriComplete: data.verificationUriComplete,
      expiresIn: data.expiresIn || 600,
      interval: data.interval || 1,
    };

    return this.authInfo;
  }

  /**
   * Quick auth: Register client + Device authorization
   */
  async quickAuth(): Promise<{ client: OIDCClientInfo; auth: OIDCAuthInfo }> {
    const client = await this.registerClient();
    const auth = await this.deviceAuthorize();
    return { client, auth };
  }

  /**
   * Step 3: Get Token (single attempt)
   * Returns null if authorization is still pending
   */
  async getToken(): Promise<TokenInfo | null> {
    if (!this.clientInfo || !this.authInfo) {
      throw new Error("Please call quickAuth() first");
    }

    const payload = {
      clientId: this.clientInfo.clientId,
      clientSecret: this.clientInfo.clientSecret,
      deviceCode: this.authInfo.deviceCode,
      grantType: "urn:ietf:params:oauth:grant-type:device_code",
    };

    const response = await this.proxyFetch(`${URLS.AWS_OIDC_BASE}/token`, {
      method: "POST",
      headers: getOidcHeaders(),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();

      // authorization_pending is expected while user completes auth
      if (errorText.includes("authorization_pending") || errorText.includes("AuthorizationPendingException")) {
        return null;
      }

      throw new Error(`Token request failed: ${errorText}`);
    }

    const data = (await response.json()) as TokenResponse;
    return {
      accessToken: data.accessToken,
      refreshToken: data.refreshToken,
      expiresIn: data.expiresIn,
      tokenType: data.tokenType || "Bearer",
    };
  }

  /**
   * Poll for token until authorization completes
   */
  async pollToken(timeoutMs: number = AWS_BUILDER_ID.TOKEN_POLL_TIMEOUT): Promise<TokenInfo> {
    const startTime = Date.now();
    const interval = AWS_BUILDER_ID.TOKEN_POLL_INTERVAL;

    while (Date.now() - startTime < timeoutMs) {
      const token = await this.getToken();
      if (token) {
        return token;
      }

      // Wait before next poll
      await new Promise((resolve) => setTimeout(resolve, interval));
    }

    throw new Error("Token polling timeout - authorization not completed");
  }

  /**
   * Get current client info
   */
  getClientInfo(): OIDCClientInfo | undefined {
    return this.clientInfo;
  }

  /**
   * Get current auth info
   */
  getAuthInfo(): OIDCAuthInfo | undefined {
    return this.authInfo;
  }
}
