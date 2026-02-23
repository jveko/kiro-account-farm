/**
 * Freemail API Client
 * Stateful client using admin token auth for mailbox creation and email fetching.
 * API base: configured via FREEMAIL_BASE_URL env var.
 */

import { FREEMAIL } from "../config";

const DEFAULT_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
};

export interface FreemailGeneratedMailbox {
  email: string;
  expires: number;
}

export interface FreemailEmail {
  id: number;
  sender: string;
  subject: string;
  received_at: string;
  is_read: number;
  preview: string;
  verification_code: string | null;
}

export interface FreemailEmailDetail {
  id: number;
  sender: string;
  to_addrs: string;
  subject: string;
  verification_code: string | null;
  content: string;
  html_content: string;
  received_at: string;
  is_read: number;
}

export class FreemailClient {
  private baseUrl: string;
  private token: string;
  private timeout: number;
  private address: string | null = null;

  constructor(timeout = 30000) {
    this.baseUrl = FREEMAIL.BASE_URL;
    this.token = FREEMAIL.API_TOKEN;
    this.timeout = timeout;
  }

  private _buildHeaders(): Record<string, string> {
    return {
      ...DEFAULT_HEADERS,
      Authorization: `Bearer ${this.token}`,
    };
  }

  private async _get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await fetch(url.toString(), {
      headers: this._buildHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Freemail GET ${path} failed: ${response.status} ${response.statusText} - ${text.substring(0, 200)}`
      );
    }

    return response.json() as Promise<T>;
  }

  getAddress(): string | null {
    return this.address;
  }

  async getDomains(): Promise<string[]> {
    return this._get<string[]>("/api/domains");
  }

  async generateMailbox(domainIndex = 0): Promise<FreemailGeneratedMailbox> {
    const result = await this._get<FreemailGeneratedMailbox>("/api/generate", {
      domainIndex: String(domainIndex),
    });
    this.address = result.email;
    return result;
  }

  async getEmails(mailbox: string, limit = 20): Promise<FreemailEmail[]> {
    return this._get<FreemailEmail[]>("/api/emails", {
      mailbox,
      limit: String(limit),
    });
  }

  async getEmail(id: number): Promise<FreemailEmailDetail> {
    return this._get<FreemailEmailDetail>(`/api/email/${id}`);
  }
}
