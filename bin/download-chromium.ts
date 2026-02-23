#!/usr/bin/env bun

/**
 * Download fingerprint-chromium binary for the current platform
 * Usage: bun bin/download-chromium.ts [version]
 */

import { existsSync, mkdirSync, chmodSync, rmSync, cpSync, readdirSync } from "fs";
import { join, basename } from "path";

const DEFAULT_VERSION = "142.0.7444.175";
const BASE_URL = "https://github.com/adryfish/fingerprint-chromium/releases/download";
const INSTALL_DIR = join(import.meta.dir, "../.chromium");

type Platform = "darwin" | "linux" | "win32";

function getDownloadUrl(version: string, platform: Platform): { url: string; filename: string } {
  const major = parseInt(version.split(".")[0] || "0", 10);

  switch (platform) {
    case "win32": {
      const filename = `ungoogled-chromium_${version}-1.1_windows_x64.zip`;
      return { url: `${BASE_URL}/${version}/${filename}`, filename };
    }
    case "linux": {
      const filename = major >= 139
        ? `ungoogled-chromium-${version}-1-x86_64_linux.tar.xz`
        : `ungoogled-chromium_${version}-1_linux.tar.xz`;
      return { url: `${BASE_URL}/${version}/${filename}`, filename };
    }
    case "darwin": {
      const filename = `ungoogled-chromium_${version}-1.1_macos.dmg`;
      return { url: `${BASE_URL}/${version}/${filename}`, filename };
    }
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

function getExecutablePath(platform: Platform): string {
  switch (platform) {
    case "darwin":
      return join(INSTALL_DIR, "Chromium.app/Contents/MacOS/Chromium");
    case "linux":
      return join(INSTALL_DIR, "chrome");
    case "win32":
      return join(INSTALL_DIR, "chrome.exe");
    default:
      throw new Error(`Unsupported platform: ${platform}`);
  }
}

async function downloadFile(url: string, destPath: string): Promise<void> {
  console.log(`Downloading: ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`Download failed: ${response.status} ${response.statusText}`);
  }

  const contentLength = response.headers.get("content-length");
  const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

  const reader = response.body?.getReader();
  if (!reader) throw new Error("No response body");

  const chunks: Uint8Array[] = [];
  let downloaded = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    downloaded += value.length;
    if (totalBytes > 0) {
      const pct = ((downloaded / totalBytes) * 100).toFixed(1);
      const mb = (downloaded / 1024 / 1024).toFixed(1);
      const totalMb = (totalBytes / 1024 / 1024).toFixed(1);
      process.stdout.write(`\r  ${mb}/${totalMb} MB (${pct}%)`);
    }
  }
  console.log();

  const buffer = Buffer.concat(chunks);
  await Bun.write(destPath, buffer);
}

async function extractArchive(archivePath: string, platform: Platform): Promise<void> {
  console.log("Extracting...");

  if (platform === "darwin") {
    // Mount DMG, copy app, unmount
    const mountPoint = join(INSTALL_DIR, "_dmg_mount");
    mkdirSync(mountPoint, { recursive: true });

    const mount = Bun.spawnSync(["hdiutil", "attach", archivePath, "-mountpoint", mountPoint, "-nobrowse", "-quiet"]);
    if (mount.exitCode !== 0) {
      throw new Error(`Failed to mount DMG: ${mount.stderr.toString()}`);
    }

    try {
      // Find the .app in the mounted DMG
      const appName = "Chromium.app";
      const srcApp = join(mountPoint, appName);
      const destApp = join(INSTALL_DIR, appName);

      // Remove existing app if present
      if (existsSync(destApp)) {
        rmSync(destApp, { recursive: true, force: true });
      }

      cpSync(srcApp, destApp, { recursive: true });
    } finally {
      Bun.spawnSync(["hdiutil", "detach", mountPoint, "-quiet"]);
      rmSync(mountPoint, { recursive: true, force: true });
    }
  } else if (platform === "linux") {
    const tar = Bun.spawnSync(["tar", "-xJf", archivePath, "-C", INSTALL_DIR, "--strip-components=1"]);
    if (tar.exitCode !== 0) {
      throw new Error(`Failed to extract tar.xz: ${tar.stderr.toString()}`);
    }
  } else if (platform === "win32") {
    const unzip = Bun.spawnSync(["powershell", "-Command", `Expand-Archive -Path '${archivePath}' -DestinationPath '${INSTALL_DIR}' -Force`]);
    if (unzip.exitCode !== 0) {
      throw new Error(`Failed to extract zip: ${unzip.stderr.toString()}`);
    }

    // Flatten nested subdirectory (zip contains a single top-level folder)
    const archiveName = basename(archivePath);
    const entries = readdirSync(INSTALL_DIR).filter(e => e !== archiveName);
    if (entries.length === 1) {
      const nested = join(INSTALL_DIR, entries[0]!);
      if (existsSync(join(nested, "chrome.exe"))) {
        for (const item of readdirSync(nested)) {
          const src = join(nested, item);
          const dest = join(INSTALL_DIR, item);
          cpSync(src, dest, { recursive: true });
        }
        rmSync(nested, { recursive: true, force: true });
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const version = args[0] || DEFAULT_VERSION;
  const platform = process.platform as Platform;

  console.log(`\n📦 fingerprint-chromium downloader`);
  console.log(`   Version: ${version}`);
  console.log(`   Platform: ${platform}`);
  console.log(`   Install dir: ${INSTALL_DIR}\n`);

  // Check if already installed
  const execPath = getExecutablePath(platform);
  if (existsSync(execPath)) {
    console.log(`✓ Already installed at: ${execPath}`);
    console.log(`  Delete ${INSTALL_DIR} to re-download.\n`);
    return;
  }

  mkdirSync(INSTALL_DIR, { recursive: true });

  const { url, filename } = getDownloadUrl(version, platform);
  const archivePath = join(INSTALL_DIR, filename);

  try {
    await downloadFile(url, archivePath);
    await extractArchive(archivePath, platform);

    // Cleanup archive
    rmSync(archivePath, { force: true });

    // Make executable on unix
    if (platform !== "win32" && existsSync(execPath)) {
      chmodSync(execPath, 0o755);
    }

    if (existsSync(execPath)) {
      console.log(`\n✅ Installed: ${execPath}`);

      // macOS: remove quarantine attribute
      if (platform === "darwin") {
        Bun.spawnSync(["xattr", "-cr", join(INSTALL_DIR, "Chromium.app")]);
        console.log("   Quarantine attribute removed.");
      }

      console.log(`\n   Set in .env:\n   CHROME_EXECUTABLE_PATH=${execPath}\n`);
    } else {
      console.error(`\n❌ Executable not found after extraction at: ${execPath}`);
      process.exit(1);
    }
  } catch (error) {
    console.error(`\n❌ Failed: ${error}`);
    // Cleanup on failure
    rmSync(INSTALL_DIR, { recursive: true, force: true });
    process.exit(1);
  }
}

main();
