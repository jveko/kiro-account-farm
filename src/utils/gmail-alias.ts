/**
 * Gmail Infinite Alias Email Generator
 * Leverages Gmail features to generate unlimited email variants:
 * 1. + alias: user+alias@gmail.com
 * 2. Dot insertion: u.ser@gmail.com (Gmail ignores dots)
 * 3. Case variants: User@gmail.com (Gmail is case-insensitive)
 * 4. Combined variants: U.ser+alias@gmail.com
 * 
 * Based on AWS-BuildID-Auto-For-Ext project patterns
 */

export interface GmailAliasOptions {
  baseEmail: string;
  index: number;
  mode?: 'plus' | 'dot' | 'case' | 'mixed' | 'auto';
}

/**
 * Generate random alphanumeric string
 */
function randomString(length: number): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars[Math.floor(Math.random() * chars.length)];
  }
  return result;
}

/**
 * Generate timestamp string (YYMMDDHHMM format)
 */
function generateTimestamp(): string {
  const now = new Date();
  return [
    now.getFullYear().toString().slice(-2),
    (now.getMonth() + 1).toString().padStart(2, '0'),
    now.getDate().toString().padStart(2, '0'),
  ].join('');
}

/**
 * Insert dots at random positions in string
 */
function insertRandomDots(str: string, count: number = 1): string {
  if (str.length <= 1) return str;
  
  // Collect all valid positions (between characters, 1..length-1)
  const validPositions: number[] = [];
  for (let i = 1; i < str.length; i++) {
    validPositions.push(i);
  }
  
  // Shuffle and pick `count` positions
  for (let i = validPositions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [validPositions[i], validPositions[j]] = [validPositions[j]!, validPositions[i]!];
  }
  
  // Sort selected positions descending so splice doesn't shift earlier indices
  const selected = validPositions.slice(0, count).sort((a, b) => b - a);
  
  const chars = str.split('');
  for (const pos of selected) {
    chars.splice(pos, 0, '.');
  }
  
  return chars.join('');
}

/**
 * Random case transformation
 */
function randomizeCase(str: string): string {
  return str.split('').map(char => {
    if (Math.random() > 0.5) {
      return char.toUpperCase();
    }
    return char.toLowerCase();
  }).join('');
}

// Track used variants to avoid duplicates
const usedVariants = new Set<string>();
let counter = 0;

/**
 * Generate a Gmail alias from a base email
 * Uses multiple strategies: plus suffix, dots, case variations, or mixed
 */
export function generateGmailAlias(options: GmailAliasOptions): string {
  const { baseEmail, index, mode = 'auto' } = options;

  // Parse base email
  const [localPart, domain] = baseEmail.split("@");
  if (!localPart || !domain) {
    throw new Error(`Invalid email format: ${baseEmail}`);
  }

  // Remove existing dots and plus suffixes from local part to get pure username
  const pureUsername = localPart.replace(/\./g, "").split("+")[0]?.toLowerCase();

  if (!pureUsername) {
    throw new Error(`Invalid email format: ${baseEmail}`);
  }

  // Normalize base email and add to used variants to prevent generating aliases identical to base
  const normalizedBase = `${pureUsername}@${domain.toLowerCase()}`;
  usedVariants.add(normalizedBase);

  let email = '';
  let attempts = 0;
  const maxAttempts = 100;

  // Ensure unique email generation
  while (attempts < maxAttempts) {
    switch (mode) {
      case 'plus':
        email = generatePlusVariant(pureUsername, domain);
        break;
      case 'dot':
        email = generateDotVariant(pureUsername, domain);
        break;
      case 'case':
        email = generateCaseVariant(pureUsername, domain);
        break;
      case 'mixed':
        email = generateMixedVariant(pureUsername, domain);
        break;
      case 'auto':
      default:
        email = generateAutoVariant(pureUsername, domain, counter);
        break;
    }

    if (!usedVariants.has(email.toLowerCase())) {
      usedVariants.add(email.toLowerCase());
      break;
    }
    attempts++;
  }

  counter++;
  return email;
}

/**
 * Generate + alias: user+suffix@gmail.com
 */
function generatePlusVariant(username: string, domain: string): string {
  const suffix = `${generateTimestamp()}${randomString(6)}`;
  return `${username}+${suffix}@${domain}`;
}

/**
 * Generate dot variant: u.s.er@gmail.com
 */
function generateDotVariant(username: string, domain: string): string {
  const dotCount = Math.floor(Math.random() * Math.min(3, username.length - 1)) + 1;
  const dottedUsername = insertRandomDots(username, dotCount);
  return `${dottedUsername}@${domain}`;
}

/**
 * Generate case variant: UsEr@gmail.com
 */
function generateCaseVariant(username: string, domain: string): string {
  const casedUsername = randomizeCase(username);
  return `${casedUsername}@${domain}`;
}

/**
 * Generate mixed variant: U.sEr+suffix@gmail.com
 * Always applies at least one modification to avoid returning base email
 */
function generateMixedVariant(username: string, domain: string): string {
  let modifiedUsername = username;
  let hasModification = false;
  
  // Randomly add dots
  if (username.length > 2 && Math.random() > 0.3) {
    const dotCount = Math.floor(Math.random() * 2) + 1;
    modifiedUsername = insertRandomDots(modifiedUsername, dotCount);
    hasModification = true;
  }
  
  // Random case
  if (Math.random() > 0.5) {
    modifiedUsername = randomizeCase(modifiedUsername);
    hasModification = true;
  }
  
  // Add + suffix (always add if no other modification was made)
  if (!hasModification || Math.random() > 0.5) {
    const suffix = randomString(6);
    return `${modifiedUsername}+${suffix}@${domain}`;
  }
  
  return `${modifiedUsername}@${domain}`;
}

/**
 * Generate dot + plus combination variant: u.ser+suffix@gmail.com
 */
function generateDotPlusVariant(username: string, domain: string): string {
  let modifiedUsername = username;
  
  // Add dots
  if (username.length > 2) {
    const dotCount = Math.floor(Math.random() * 2) + 1;
    modifiedUsername = insertRandomDots(modifiedUsername, dotCount);
  }
  
  // Add + suffix
  const suffix = `${generateTimestamp().slice(-6)}${randomString(3)}`;
  return `${modifiedUsername}+${suffix}@${domain}`;
}

/**
 * Auto-select variant method (rotate between different methods)
 */
function generateAutoVariant(username: string, domain: string, count: number): string {
  const methods = [
    () => generateDotPlusVariant(username, domain),        // Dot + plus
    () => generateDotVariant(username, domain),            // Dot only
    () => generateMixedVariant(username, domain),          // Mixed
    () => generateDotVariant(username, domain),            // Dot only
    () => generateDotPlusVariant(username, domain),        // Dot + plus
  ];
  
  const methodIndex = count % methods.length;
  return methods[methodIndex]!();
}

/**
 * Generate multiple Gmail aliases
 */
export function generateGmailAliases(baseEmail: string, count: number): string[] {
  const aliases: string[] = [];
  for (let i = 1; i <= count; i++) {
    aliases.push(
      generateGmailAlias({
        baseEmail,
        index: i,
        mode: 'auto',
      })
    );
  }
  return aliases;
}

/**
 * Validate Gmail address format
 */
export function isValidGmail(email: string): boolean {
  const gmailPattern = /^[a-zA-Z0-9._%+-]+@gmail\.com$/i;
  return gmailPattern.test(email);
}

/**
 * Reset variant tracking (call when starting fresh)
 */
export function resetVariantTracking(): void {
  usedVariants.clear();
  counter = 0;
}
