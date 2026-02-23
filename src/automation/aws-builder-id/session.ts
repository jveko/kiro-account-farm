/**
 * Session Management for AWS Builder ID Registration
 * Tracks individual registration sessions with state and metadata
 */

import { generateUUID } from "../../utils/generators";
import type { SessionState, AWSBuilderIDAccount, OIDCClientInfo, OIDCAuthInfo, TokenInfo } from "../../types/aws-builder-id";

/**
 * Create a new registration session
 */
export function createSession(account: AWSBuilderIDAccount): SessionState {
  return {
    id: generateUUID(),
    status: "pending",
    account,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Update session status
 */
export function updateSessionStatus(
  session: SessionState,
  status: SessionState["status"],
  error?: string
): SessionState {
  return {
    ...session,
    status,
    error,
    updatedAt: new Date(),
  };
}

/**
 * Update session with OIDC client info
 */
export function updateSessionOIDCClient(session: SessionState, oidcClient: OIDCClientInfo): SessionState {
  return {
    ...session,
    oidcClient,
    updatedAt: new Date(),
  };
}

/**
 * Update session with OIDC auth info
 */
export function updateSessionOIDCAuth(session: SessionState, oidcAuth: OIDCAuthInfo): SessionState {
  return {
    ...session,
    oidcAuth,
    updatedAt: new Date(),
  };
}

/**
 * Update session with browser/tab IDs
 */
export function updateSessionBrowser(session: SessionState, browserId: string, tabId?: string): SessionState {
  return {
    ...session,
    browserId,
    tabId,
    updatedAt: new Date(),
  };
}

/**
 * Update session with token
 */
export function updateSessionToken(session: SessionState, token: TokenInfo): SessionState {
  return {
    ...session,
    token,
    status: "completed",
    updatedAt: new Date(),
  };
}

/**
 * Mark session as failed
 */
export function markSessionFailed(session: SessionState, error: string): SessionState {
  return {
    ...session,
    status: "error",
    error,
    updatedAt: new Date(),
  };
}

/**
 * Session Manager - manages multiple sessions
 */
export class SessionManager {
  private sessions: Map<string, SessionState> = new Map();

  /**
   * Create and track a new session
   */
  createSession(account: AWSBuilderIDAccount): SessionState {
    const session = createSession(account);
    this.sessions.set(session.id, session);
    return session;
  }

  /**
   * Get session by ID
   */
  getSession(id: string): SessionState | undefined {
    return this.sessions.get(id);
  }

  /**
   * Update session
   */
  updateSession(id: string, updates: Partial<SessionState>): SessionState | undefined {
    const session = this.sessions.get(id);
    if (!session) {
      return undefined;
    }

    const updated = {
      ...session,
      ...updates,
      updatedAt: new Date(),
    };

    this.sessions.set(id, updated);
    return updated;
  }

  /**
   * Get all sessions
   */
  getAllSessions(): SessionState[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Get sessions by status
   */
  getSessionsByStatus(status: SessionState["status"]): SessionState[] {
    return this.getAllSessions().filter((s) => s.status === status);
  }

  /**
   * Get completed sessions count
   */
  getCompletedCount(): number {
    return this.getSessionsByStatus("completed").length;
  }

  /**
   * Get failed sessions count
   */
  getFailedCount(): number {
    return this.getSessionsByStatus("error").length;
  }

  /**
   * Get pending sessions count
   */
  getPendingCount(): number {
    return this.getSessionsByStatus("pending").length;
  }

  /**
   * Get running sessions count
   */
  getRunningCount(): number {
    return this.getSessionsByStatus("running").length + this.getSessionsByStatus("polling_token").length;
  }

  /**
   * Clear all sessions
   */
  clear(): void {
    this.sessions.clear();
  }

  /**
   * Export sessions to JSON
   */
  exportToJSON(): string {
    return JSON.stringify(this.getAllSessions(), null, 2);
  }

  /**
   * Export successful sessions with tokens
   */
  exportSuccessfulSessions(): Array<{
    email: string;
    password: string;
    fullName: string;
    token: TokenInfo;
    createdAt: Date;
  }> {
    return this.getSessionsByStatus("completed")
      .filter((s) => s.token)
      .map((s) => ({
        email: s.account.email,
        password: s.account.password,
        fullName: s.account.fullName,
        token: s.token!,
        createdAt: s.createdAt,
      }));
  }
}
