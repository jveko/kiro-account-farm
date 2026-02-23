import type { ProxyConfig } from "../services/proxy";

/**
 * Creates a fetch function that uses a proxy via Bun's native proxy support
 */
export function createProxyFetch(proxy?: ProxyConfig | { host: string; port: number; username?: string; password?: string }) {
  if (!proxy) {
    return fetch;
  }

  const proxyUrl = proxy.username && proxy.password
    ? `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
    : `http://${proxy.host}:${proxy.port}`;

  return (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    return fetch(url, {
      ...init,
      proxy: proxyUrl,
    } as RequestInit);
  };
}
