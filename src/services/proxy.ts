/**
 * Proxy Manager
 * Handles static proxy config with auto-incrementing port and fraud score filtering
 */

import { existsSync, readFileSync, writeFileSync } from "fs";
import { join } from "path";

const PORT_STATE_FILE = join(import.meta.dir, "../../.proxy-port-state");
const USED_IPS_FILE = join(import.meta.dir, "../../.proxy-used-ips");
const FRAUD_CHECK_URL = "https://my.ippure.com/v1/info";
const FRAUD_SCORE_THRESHOLD = 30;

export interface ProxyConfig {
  host: string;
  username: string;
  password: string;
  port: number;
}

interface FraudCheckResponse {
  ip: string;
  fraudScore: number;
  isResidential: boolean;
  country: string;
  city: string;
}

/**
 * Read used IPs from persistent file
 */
function readUsedIps(): Set<string> {
  try {
    if (existsSync(USED_IPS_FILE)) {
      const content = readFileSync(USED_IPS_FILE, "utf-8").trim();
      if (content) {
        return new Set(content.split("\n").filter(Boolean));
      }
    }
  } catch {
    // Ignore read errors
  }
  return new Set();
}

/**
 * Add IP to used IPs file
 */
function addUsedIp(ip: string): void {
  try {
    const usedIps = readUsedIps();
    usedIps.add(ip);
    writeFileSync(USED_IPS_FILE, Array.from(usedIps).join("\n"));
  } catch {
    // Ignore write errors
  }
}

/**
 * Check if IP has been used before
 */
function isIpUsed(ip: string): boolean {
  const usedIps = readUsedIps();
  return usedIps.has(ip);
}

/**
 * Reset used IPs (clear the file)
 */
export function resetUsedIps(): void {
  try {
    writeFileSync(USED_IPS_FILE, "");
  } catch {
    // Ignore write errors
  }
}

/**
 * Get count of used IPs
 */
export function getUsedIpsCount(): number {
  return readUsedIps().size;
}

/**
 * Get proxy config from environment
 */
function getProxyFromEnv(): Omit<ProxyConfig, "port"> | null {
  const host = Bun.env.PROXY_HOST;
  const username = Bun.env.PROXY_USERNAME;
  const password = Bun.env.PROXY_PASSWORD;

  if (!host) {
    return null;
  }

  return {
    host,
    username: username || "",
    password: password || "",
  };
}

/**
 * Get base port from environment
 */
function getBasePort(): number {
  return Number(Bun.env.PROXY_BASE_PORT) || 10000;
}

/**
 * Read current port from state file
 */
function readPortState(): number {
  try {
    if (existsSync(PORT_STATE_FILE)) {
      const content = readFileSync(PORT_STATE_FILE, "utf-8").trim();
      const port = parseInt(content, 10);
      if (!isNaN(port)) {
        return port;
      }
    }
  } catch {
    // Ignore read errors
  }
  return getBasePort();
}

/**
 * Write current port to state file
 */
function writePortState(port: number): void {
  try {
    writeFileSync(PORT_STATE_FILE, String(port));
  } catch {
    // Ignore write errors
  }
}

/**
 * Get next proxy config with incremented port
 * Returns null if no proxy configured in env
 */
export function getNextProxy(): ProxyConfig | null {
  const baseConfig = getProxyFromEnv();
  if (!baseConfig) {
    return null;
  }

  const currentPort = readPortState();
  const nextPort = currentPort + 1;
  writePortState(nextPort);

  return {
    ...baseConfig,
    port: currentPort,
  };
}

/**
 * Check if proxy is configured
 */
export function isProxyConfigured(): boolean {
  return !!Bun.env.PROXY_HOST;
}

/**
 * Reset port counter to base
 */
export function resetPortCounter(): void {
  writePortState(getBasePort());
}

/**
 * Get current port (without incrementing)
 */
export function getCurrentPort(): number {
  return readPortState();
}

/**
 * Check fraud score for a proxy
 * Returns fraud score or null if check failed
 */
export async function checkProxyFraudScore(proxy: ProxyConfig): Promise<{ fraudScore: number; ip: string; country: string; city: string; isResidential: boolean } | null> {
  const proxyUrl = proxy.username && proxy.password
    ? `http://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`
    : `http://${proxy.host}:${proxy.port}`;

  try {
    const response = await fetch(FRAUD_CHECK_URL, {
      proxy: proxyUrl,
      signal: AbortSignal.timeout(10000),
    } as RequestInit);

    if (!response.ok) {
      return null;
    }

    const data = await response.json() as FraudCheckResponse;
    return {
      fraudScore: data.fraudScore,
      ip: data.ip,
      country: data.country,
      city: data.city,
      isResidential: data.isResidential,
    };
  } catch {
    return null;
  }
}

/**
 * Get next valid proxy with fraud score below threshold and residential
 * Keeps trying until finding a valid proxy or running out of ports
 * Skips IPs that have already been used
 */
export async function getNextValidProxy(maxAttempts = 1000): Promise<ProxyConfig | null> {
  const baseConfig = getProxyFromEnv();
  if (!baseConfig) {
    return null;
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const currentPort = readPortState();
    const nextPort = currentPort + 1;
    writePortState(nextPort);

    const proxy: ProxyConfig = {
      ...baseConfig,
      port: currentPort,
    };

    console.log(`  Checking proxy port ${currentPort}...`);
    const result = await checkProxyFraudScore(proxy);

    if (!result) {
      console.log(`    ✗ Failed to check (connection error)`);
      continue;
    }

    // Check if IP was already used
    if (isIpUsed(result.ip)) {
      console.log(`    ✗ IP: ${result.ip} | Already used (skipped)`);
      continue;
    }

    if (!result.isResidential) {
      console.log(`    ✗ IP: ${result.ip} | Not residential (skipped)`);
      continue;
    }

    if (result.fraudScore > FRAUD_SCORE_THRESHOLD) {
      console.log(`    ✗ IP: ${result.ip} | Score: ${result.fraudScore} > ${FRAUD_SCORE_THRESHOLD} (skipped)`);
      continue;
    }

    // Valid proxy found - mark IP as used
    addUsedIp(result.ip);
    console.log(`    ✓ IP: ${result.ip} | Score: ${result.fraudScore} | Residential | ${result.city}, ${result.country}`);
    return proxy;
  }

  console.log(`  ⚠ No valid proxy found after ${maxAttempts} attempts`);
  return null;
}
