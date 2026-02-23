import { MailtmClient } from "../api/mailtm";
import { generatePassword } from "./generators";

export interface MailtmAliasOptions {
  domain: string;
  index: number;
}

export interface MailtmAccountCredentials {
  address: string;
  password: string;
}

export function generateMailtmAlias(options: MailtmAliasOptions): string {
  const adjectives = [
    "happy", "lucky", "swift", "calm", "bold", "keen", "warm", "cool",
    "fair", "wise", "wild", "soft", "pure", "real", "tall", "deep",
    "rich", "vast", "rare", "fine", "pale", "dark", "safe", "lean",
  ];
  const nouns = [
    "river", "maple", "cedar", "stone", "frost", "cloud", "bloom",
    "coral", "amber", "pearl", "ivory", "haven", "ridge", "delta",
    "grove", "heron", "linen", "olive", "petal", "quail", "robin",
    "sage", "tulip", "wren", "aspen", "birch", "clover", "dune",
  ];

  const adjIdx = (options.index * 7 + 3) % adjectives.length;
  const nounIdx = (options.index * 13 + 5) % nouns.length;
  const suffix = Math.floor(Math.random() * 900) + 100;

  return `${adjectives[adjIdx]}${nouns[nounIdx]}${suffix}@${options.domain}`;
}

export function generateMailtmCredentials(
  domain: string,
  index: number
): MailtmAccountCredentials {
  const address = generateMailtmAlias({ domain, index });
  const password = generatePassword();
  return { address, password };
}

export async function createMailtmAccount(
  domain?: string
): Promise<{ client: MailtmClient; credentials: MailtmAccountCredentials }> {
  const client = new MailtmClient();

  const activeDomain = domain ?? (await client.getActiveDomain());
  const index = Math.floor(Math.random() * 1000);
  const credentials = generateMailtmCredentials(activeDomain, index);

  await client.createSession(credentials.address, credentials.password);
  return { client, credentials };
}

export function isValidMailtmDomain(domain: string): boolean {
  const domainPattern = /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  return domainPattern.test(domain);
}
