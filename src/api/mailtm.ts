/**
 * Mail.tm API Client
 * Stateful client - one instance per account.
 * For multiple accounts, create multiple instances.
 * API: https://api.mail.tm
 */

const MAILTM_BASE_URL = "https://api.mail.tm";

const DEFAULT_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  Accept: "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:147.0) Gecko/20100101 Firefox/147.0",
  Origin: "https://mail.tm",
  Referer: "https://mail.tm/",
};

type ApiList<T> = T[] | HydraCollection<T>;

interface HydraCollection<T> {
  "@context": string;
  "@id": string;
  "@type": string;
  "hydra:totalItems": number;
  "hydra:member": T[];
}

function unwrapList<T>(data: ApiList<T>): T[] {
  if (Array.isArray(data)) {
    return data;
  }
  return data["hydra:member"];
}

export interface MailtmDomain {
  id: string;
  domain: string;
  isActive: boolean;
  isPrivate: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MailtmAccount {
  id: string;
  address: string;
  quota: number;
  used: number;
  isDisabled: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MailtmTokenResponse {
  token: string;
  id: string;
}

export interface MailtmAddress {
  address: string;
  name: string;
}

export interface MailtmMessage {
  id: string;
  msgid: string;
  from: MailtmAddress;
  to: MailtmAddress[];
  subject: string;
  intro: string;
  seen: boolean;
  isDeleted: boolean;
  hasAttachments: boolean;
  size: number;
  downloadUrl: string;
  sourceUrl: string;
  createdAt: string;
  updatedAt: string;
  accountId: string;
}

export interface MailtmMessageFull extends MailtmMessage {
  text: string;
  html: string[];
  cc: MailtmAddress[];
  bcc: MailtmAddress[];
  flagged: boolean;
  verifications: Record<string, unknown>;
  retention: boolean;
  retentionDate: string;
}

export class MailtmClient {
  private baseUrl: string;
  private timeout: number;
  private token: string | null = null;
  private accountId: string | null = null;
  private address: string | null = null;

  constructor(timeout = 30000) {
    this.baseUrl = MAILTM_BASE_URL;
    this.timeout = timeout;
  }

  private _buildHeaders(): Record<string, string> {
    const headers = { ...DEFAULT_HEADERS };
    if (this.token) {
      headers["Authorization"] = `Bearer ${this.token}`;
    }
    return headers;
  }

  private _requireAuth(): void {
    if (!this.token) {
      throw new Error("Not authenticated. Call authenticate() or createSession() first.");
    }
  }

  private async _get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: this._buildHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Mail.tm GET ${path} failed: ${response.status} ${response.statusText} - ${text.substring(0, 200)}`
      );
    }

    return response.json() as Promise<T>;
  }

  private async _post<T>(
    path: string,
    data: Record<string, unknown>
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      body: JSON.stringify(data),
      headers: this._buildHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Mail.tm POST ${path} failed: ${response.status} ${response.statusText} - ${text.substring(0, 200)}`
      );
    }

    return response.json() as Promise<T>;
  }

  private async _delete(path: string): Promise<void> {
    this._requireAuth();
    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "DELETE",
      headers: this._buildHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Mail.tm DELETE ${path} failed: ${response.status} ${response.statusText} - ${text.substring(0, 200)}`
      );
    }
  }

  getAddress(): string | null {
    return this.address;
  }

  getAccountId(): string | null {
    return this.accountId;
  }

  isAuthenticated(): boolean {
    return this.token !== null;
  }

  async getDomains(): Promise<MailtmDomain[]> {
    const data = await this._get<ApiList<MailtmDomain>>("/domains");
    return unwrapList(data);
  }

  async getActiveDomain(): Promise<string> {
    const domains = await this.getDomains();
    const active = domains.find((d) => d.isActive && !d.isPrivate);
    if (!active) {
      throw new Error("No active public Mail.tm domain available");
    }
    return active.domain;
  }

  async createAccount(
    address: string,
    password: string
  ): Promise<MailtmAccount> {
    return this._post<MailtmAccount>("/accounts", { address, password });
  }

  async authenticate(
    address: string,
    password: string
  ): Promise<MailtmTokenResponse> {
    const data = await this._post<MailtmTokenResponse>("/token", {
      address,
      password,
    });
    this.token = data.token;
    this.accountId = data.id;
    this.address = address;
    return data;
  }

  /**
   * Create account + authenticate in one call.
   */
  async createSession(
    address: string,
    password: string
  ): Promise<MailtmAccount> {
    const account = await this.createAccount(address, password);
    await this.authenticate(address, password);
    return account;
  }

  async getMessages(page = 1): Promise<MailtmMessage[]> {
    this._requireAuth();
    const data = await this._get<ApiList<MailtmMessage>>(
      `/messages?page=${page}`
    );
    return unwrapList(data);
  }

  async getMessage(id: string): Promise<MailtmMessageFull> {
    this._requireAuth();
    return this._get<MailtmMessageFull>(`/messages/${id}`);
  }

  async deleteMessage(id: string): Promise<void> {
    return this._delete(`/messages/${id}`);
  }

  async markMessageRead(id: string): Promise<void> {
    this._requireAuth();
    await fetch(`${this.baseUrl}/messages/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ seen: true }),
      headers: {
        ...this._buildHeaders(),
        "Content-Type": "application/merge-patch+json",
      },
      signal: AbortSignal.timeout(this.timeout),
    });
  }

  async deleteAccount(): Promise<void> {
    this._requireAuth();
    if (!this.accountId) {
      throw new Error("No account ID. Call createSession() or authenticate() first.");
    }
    return this._delete(`/accounts/${this.accountId}`);
  }
}
