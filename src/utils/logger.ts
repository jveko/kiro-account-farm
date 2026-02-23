/**
 * Logging utilities for batch registration
 */

export function logGlobal(message: string, level: "info" | "warn" | "error" = "info") {
  const timestamp = new Date().toISOString().split('T')[1]?.slice(0, 8) ?? "";

  switch (level) {
    case "error":
      console.error(`${timestamp} [GLOBAL] ${message}`);
      break;
    case "warn":
      console.warn(`${timestamp} [GLOBAL] ${message}`);
      break;
    default:
      console.log(`${timestamp} [GLOBAL] ${message}`);
  }
}

export function logSession(email: string, message: string, level: "info" | "warn" | "error" = "info") {
  const prefix = `[${email}]`;
  const timestamp = new Date().toISOString().split('T')[1]?.slice(0, 8) ?? "";

  switch (level) {
    case "error":
      console.error(`${timestamp} ${prefix} ${message}`);
      break;
    case "warn":
      console.warn(`${timestamp} ${prefix} ${message}`);
      break;
    default:
      console.log(`${timestamp} ${prefix} ${message}`);
  }
}

export function logProgress(current: number, total: number, failed: number) {
  const percentage = ((current / total) * 100).toFixed(1);
  console.log(`\n📊 Progress: ${current}/${total} (${percentage}%) completed, ${failed} failed\n`);
}
