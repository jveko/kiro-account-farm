import type { EmailProvider } from "./provider";

/**
 * AWS Builder ID Account Types
 */

export interface AWSBuilderIDAccount {
  email: string;
  password: string;
  fullName: string;
}

export interface RegistrationResult {
  success: boolean;
  account?: AWSBuilderIDAccount;
  token?: TokenInfo;
  error?: string;
  timestamp: Date;
}

export interface TokenInfo {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: string;
}

export type TokenStatus = "valid" | "suspended" | "expired" | "invalid" | "error";

export interface SessionState {
  id: string;
  status: 'pending' | 'running' | 'polling_token' | 'completed' | 'error';
  account: AWSBuilderIDAccount;
  browserId?: string;
  tabId?: string;
  oidcClient?: OIDCClientInfo;
  oidcAuth?: OIDCAuthInfo;
  token?: TokenInfo;
  tokenStatus?: TokenStatus;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OIDCClientInfo {
  clientId: string;
  clientSecret: string;
}

export interface OIDCAuthInfo {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}

export interface BatchRegistrationConfig {
  provider: EmailProvider;
  baseInputs: string[];
  countPerEmail: number;
  freemailDomainCount?: number;
  onProgress?: (progress: BatchProgress) => void;
  onSessionUpdate?: (session: SessionState) => void;
}

export interface BatchProgress {
  totalTarget: number;
  totalRegistered: number;
  totalFailed: number;
  status: 'idle' | 'running' | 'completed' | 'error';
  sessions: SessionState[];
}

export type PageType =
  | 'login'
  | 'name'
  | 'verify'
  | 'password'
  | 'device_confirm'
  | 'allow_access'
  | 'complete'
  | 'unknown';
