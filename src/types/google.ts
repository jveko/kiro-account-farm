/**
 * Google Account Types
 */

export interface GoogleAccount {
  email: string;
  password: string;
}

export interface LoginResult {
  success: boolean;
  error?: string;
  requiresHuman?: {
    kind: "captcha" | "verification";
    message: string;
  };
}

export interface SessionResult {
  success: boolean;
  error?: string;
}
