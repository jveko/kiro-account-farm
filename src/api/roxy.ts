/**
 * Roxy Browser API Client
 * API Documentation: https://faq.roxybrowser.com/api-documentation/api-endpoint.html
 */

interface ApiResponse<T = unknown> {
  code: number;
  msg?: string;
  data: T;
}

interface ProjectDetail {
  projectId: number;
  projectName: string;
}

interface Workspace {
  id: number;
  workspaceName: string;
  project_details: ProjectDetail[];
}

interface WorkspaceListData {
  rows: Workspace[];
  total: number;
}

interface BrowserProfile {
  dirId: string;
  windowSortNum: number;
  windowName: string;
  coreVersion: string;
  os: string;
  osVersion: string;
  windowRemark: string;
  createTime: string;
  updateTime: string;
  userName: string;
  openStatus?: boolean;
}

interface BrowserListData {
  rows: BrowserProfile[];
  total: number;
}

export interface ProxyInfo {
  proxyMethod?: "custom" | "choose" | "api" | string;
  proxyCategory?: "noproxy" | "HTTP" | "HTTPS" | "SOCKS5" | "SSH" | string;
  ipType?: "IPV4" | "IPV6" | string;
  host?: string;
  port?: string;
  proxyUserName?: string;
  proxyPassword?: string;
  refreshUrl?: string;
  checkChannel?: string;
  lastIp?: string;
  lastCountry?: string;
}

export interface FingerInfo {
  clearCacheFile?: boolean;
  clearCookie?: boolean;
  randomFingerprint?: boolean;
  syncTab?: boolean;
  syncCookie?: boolean;
  isLanguageBaseIp?: boolean;
  language?: string;
  isDisplayLanguageBaseIp?: boolean;
  displayLanguage?: string;
  isTimeZone?: boolean;
  timeZone?: string;
}

interface BrowserDetailData {
  dirId: string;
  windowSortNum: number;
  windowName: string;
  coreVersion: string;
  os: string;
  osVersion: string;
  userAgent: string;
  windowRemark: string;
  projectId: number;
  projectName: string;
  openStatus: boolean;
  createTime: string;
  updateTime: string;
  userName: string;
  proxyInfo?: ProxyInfo;
}

interface BrowserOpenData {
  ws: string;
  http: string;
  coreVersion: string;
  driver: string;
  sortNum: number;
  windowName: string;
  windowRemark: string;
  pid: number;
}

interface CreateBrowserParams {
  workspaceId: number;
  windowName?: string;
  coreVersion?: string;
  os?: "Windows" | "macOS" | "IOS" | "Android" | string;
  osVersion?: string;
  windowRemark?: string;
  projectId?: number;
  proxyInfo?: ProxyInfo;
  fingerInfo?: FingerInfo;
  [key: string]: unknown;
}

interface ModifyBrowserParams {
  workspaceId: number;
  dirId: string;
  windowName?: string;
  coreVersion?: string;
  os?: "Windows" | "macOS" | "IOS" | "Android" | string;
  osVersion?: string;
  windowRemark?: string;
  projectId?: number;
  proxyInfo?: ProxyInfo;
  fingerInfo?: FingerInfo;
  [key: string]: unknown;
}

interface CreateBrowserResponse {
  windowId: number;
  dirId: string;
}

export class RoxyClient {
  private port: number;
  private token: string;
  private host: string;
  private url: string;
  private timeout: number;

  constructor(port: number, token: string, timeout = 30000) {
    this.port = port;
    this.token = token;
    this.host = "127.0.0.1";
    this.url = `http://${this.host}:${this.port}`;
    this.timeout = timeout;
  }

  private _buildHeaders(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      token: this.token,
    };
  }

  private async _post<T = unknown>(
    path: string,
    data: Record<string, unknown>
  ): Promise<ApiResponse<T>> {
    const response = await fetch(`${this.url}${path}`, {
      method: "POST",
      body: JSON.stringify(data),
      headers: this._buildHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(
        `Roxy API POST ${path} failed: ${response.status} ${response.statusText}`
      );
    }

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      const text = await response.text();
      throw new Error(
        `Roxy API POST ${path} returned non-JSON response: ${text.substring(0, 200)}`
      );
    }

    return response.json() as Promise<ApiResponse<T>>;
  }

  private async _get<T = unknown>(
    path: string,
    data?: Record<string, unknown>
  ): Promise<ApiResponse<T>> {
    let params = "";
    if (data) {
      const searchParams = new URLSearchParams();
      for (const [key, value] of Object.entries(data)) {
        if (value !== undefined && value !== null && value !== "") {
          searchParams.append(key, String(value));
        }
      }
      params = searchParams.toString();
    }

    const url = params ? `${this.url}${path}?${params}` : `${this.url}${path}`;
    const response = await fetch(url, {
      headers: this._buildHeaders(),
      signal: AbortSignal.timeout(this.timeout),
    });

    if (!response.ok) {
      throw new Error(
        `Roxy API GET ${path} failed: ${response.status} ${response.statusText}`
      );
    }

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      const text = await response.text();
      throw new Error(
        `Roxy API GET ${path} returned non-JSON response: ${text.substring(0, 200)}`
      );
    }

    return response.json() as Promise<ApiResponse<T>>;
  }

  health(): Promise<ApiResponse<string>> {
    return this._get("/health");
  }

  workspaceProject(
    pageIndex = 1,
    pageSize = 15
  ): Promise<ApiResponse<WorkspaceListData>> {
    return this._get("/browser/workspace", {
      page_index: pageIndex,
      page_size: pageSize,
    });
  }

  browserList(
    workspaceId: number,
    options?: {
      windowName?: string;
      pageIndex?: number;
      pageSize?: number;
    }
  ): Promise<ApiResponse<BrowserListData>> {
    return this._get("/browser/list_v3", {
      workspaceId,
      windowName: options?.windowName,
      page_index: options?.pageIndex ?? 1,
      page_size: options?.pageSize ?? 15,
    });
  }

  browserDetail(
    workspaceId: number,
    dirId: string
  ): Promise<ApiResponse<{ rows: BrowserDetailData[]; total: number }>> {
    return this._get("/browser/detail", { workspaceId, dirId });
  }

  browserCreate(
    data: CreateBrowserParams
  ): Promise<ApiResponse<CreateBrowserResponse>> {
    return this._post(
      "/browser/create",
      data as unknown as Record<string, unknown>
    );
  }

  browserModify(
    data: ModifyBrowserParams
  ): Promise<ApiResponse<CreateBrowserResponse>> {
    return this._post(
      "/browser/mdf",
      data as unknown as Record<string, unknown>
    );
  }

  browserDelete(
    workspaceId: number,
    dirIds: string | string[]
  ): Promise<ApiResponse<null>> {
    const ids = Array.isArray(dirIds) ? dirIds : [dirIds];
    return this._post("/browser/delete", { workspaceId, dirIds: ids });
  }

  browserOpen(
    workspaceId: number,
    dirId: string,
    args: string[] = []
  ): Promise<ApiResponse<BrowserOpenData>> {
    return this._post("/browser/open", { workspaceId, dirId, args });
  }

  browserClose(dirId: string): Promise<ApiResponse<null>> {
    return this._post("/browser/close", { dirId });
  }

  /**
   * Close all open browsers in a workspace
   */
  async closeAllBrowsers(workspaceId: number): Promise<number> {
    const listRsp = await this.browserList(workspaceId, { pageSize: 100 });
    if (listRsp.code !== 0 || !listRsp.data?.rows) {
      return 0;
    }

    let closed = 0;
    for (const profile of listRsp.data.rows) {
      try {
        await this.browserClose(profile.dirId);
        closed++;
      } catch {
        // Ignore individual close errors
      }
    }
    return closed;
  }

  /**
   * Delete all browser profiles in a workspace
   */
  async deleteAllBrowserProfiles(workspaceId: number): Promise<number> {
    const listRsp = await this.browserList(workspaceId, { pageSize: 100 });
    if (listRsp.code !== 0 || !listRsp.data?.rows) {
      return 0;
    }

    const dirIds = listRsp.data.rows.map((p) => p.dirId);
    if (dirIds.length === 0) {
      return 0;
    }

    await this.browserDelete(workspaceId, dirIds);
    return dirIds.length;
  }
}

export type { ApiResponse, BrowserDetailData, BrowserOpenData };
