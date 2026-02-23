import { FreemailClient } from "../api/freemail";

export interface FreemailAccountCredentials {
  address: string;
  domainIndex: number;
}

/**
 * Create a freemail mailbox via /api/generate endpoint.
 * Returns the client and generated address.
 */
export async function createFreemailMailbox(
  domainIndex = 0
): Promise<{ client: FreemailClient; credentials: FreemailAccountCredentials }> {
  const client = new FreemailClient();
  const mailbox = await client.generateMailbox(domainIndex);

  return {
    client,
    credentials: {
      address: mailbox.email,
      domainIndex,
    },
  };
}

/**
 * Generate a freemail alias (delegates to /api/generate, so this is a no-op placeholder).
 * The actual address is generated server-side; we return a placeholder that gets replaced.
 */
export function generateFreemailAlias(_options: { domain: string; index: number }): string {
  // Freemail generates addresses server-side via /api/generate.
  // Return a placeholder — the orchestrator replaces it with the real address.
  return `pending-freemail-${_options.index}@${_options.domain}`;
}

export function isValidFreemailDomain(domain: string): boolean {
  const domainPattern = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return domainPattern.test(domain);
}
