export interface SimpleLoginAliasOptions {
  domain: string;
  index: number;
}

export function generateSimpleLoginAlias(options: SimpleLoginAliasOptions): string {
  throw new Error("SimpleLogin alias generation not implemented yet");
}

export function generateSimpleLoginAliases(domain: string, count: number): string[] {
  throw new Error("SimpleLogin alias generation not implemented yet");
}

export function isValidSimpleLoginEmail(email: string): boolean {
  const emailPattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/i;
  return emailPattern.test(email);
}
