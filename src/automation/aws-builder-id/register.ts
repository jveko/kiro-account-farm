/**
 * AWS Builder ID Registration Automation
 * Automates the account creation flow using Puppeteer
 */

import type { Page } from "puppeteer-core";
import { TIMEOUTS, WAIT, AUTOMATION_DELAYS, FAST_MODE } from "../../config";
import type { AWSBuilderIDAccount, PageType } from "../../types/aws-builder-id";
import type { PageAutomationContext } from "./context";
import { randomMouseMovement, moveToElementAndClick } from "../../utils/human-mouse";

/**
 * Get unique page identifier (type + URL)
 */
function getPageId(page: Page, pageType: PageType): string {
  const url = page.url();
  // Keep hash for SPA routing, remove query params
  const urlParts = url.split('?');
  const baseUrl = urlParts[0];
  const hash = url.includes('#') ? url.split('#')[1] : '';
  const cleanUrl = hash ? `${baseUrl}#${hash}` : baseUrl;
  return `${pageType}:${cleanUrl}`;
}

/**
 * Detect current page type based on URL and DOM elements
 */
export async function detectPageType(page: Page): Promise<PageType> {
  const url = page.url();

  // URL-only checks first (no IPC needed)
  if (url.includes("awsapps.com") && url.includes("#/device?user_code=")) {
    return "device_confirm";
  }
  if (url.includes("verify-otp") || url.includes("/verification") || url.includes("verifyEmail")) {
    return "verify";
  }
  if (url.includes("/signup?registrationCode=")) {
    return "password";
  }
  if (url.includes("#/signup/start")) {
    return "name";
  }

  // Single IPC round-trip for all DOM checks
  const domState = await page.evaluate(() => {
    const text = document.body?.innerText || "";
    const qs = (sel: string) => !!document.querySelector(sel);
    return {
      text,
      hasConfirmBtn: qs('#cli_verification_btn'),
      hasAllowBtn: qs('button#cli_login_button, button[data-testid="allow-access-button"], input[type="submit"][value*="Allow"]'),
      hasPwdInputs: qs('input[placeholder="Enter password"], input[type="password"][autocomplete="off"]') &&
        qs('input[placeholder="Re-enter password"], input[data-testid="test-retype-input"]'),
      hasNameInput: qs('input[data-testid="signup-full-name-input"], input[placeholder="Maria José Silva"]'),
      hasEmailInput: qs('input[placeholder="username@example.com"]'),
    };
  });

  // Device confirm
  if (domState.hasConfirmBtn) return "device_confirm";
  if (domState.text.includes("Confirm and continue") || domState.text.includes("confirm this code")) {
    return "device_confirm";
  }

  // Complete
  if (domState.text.includes("Request approved") || domState.text.includes("You can close this window")) {
    return "complete";
  }

  // Allow access
  if (domState.hasAllowBtn) return "allow_access";
  if ((domState.text.includes("Allow access") || domState.text.includes("allow access")) && url.includes("awsapps.com")) {
    return "allow_access";
  }

  // Verify
  if (domState.text.includes("Verify your email") || domState.text.includes("verification code")) {
    return "verify";
  }

  // Password
  if (domState.text.includes("Create your password")) return "password";
  if (domState.hasPwdInputs) return "password";

  // Signup (combined email + name page)
  if (domState.hasNameInput && domState.hasEmailInput) return "signup";
  if (url.includes("#/signup/enter-email") && domState.hasNameInput) return "signup";

  // Name (name-only page, no email field)
  if (domState.hasNameInput && !domState.hasEmailInput) return "name";

  // Login
  if ((url.includes("/login?workflowStateHandle=") || domState.text.includes("Get started")) && domState.hasEmailInput) {
    return "login";
  }

  return "unknown";
}

/**
 * Fast fill input field using keyboard typing
 * Uses page.type() which triggers React state updates properly
 */
async function fastFill(page: Page, selector: string, text: string, maxRetries = 3): Promise<boolean> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await page.waitForSelector(selector, { timeout: TIMEOUTS.SHORT });

      // Random mouse movement before filling (human-like behavior)
      if (!FAST_MODE) {
        await randomMouseMovement(page);
      }

      // Focus the input via JS first (bypasses any overlay that might intercept click)
      await page.evaluate((sel) => {
        const input = document.querySelector(sel) as HTMLInputElement | null;
        if (input) {
          input.scrollIntoView({ block: 'center' });
          input.focus();
          input.click();
        }
      }, selector);
      await new Promise((resolve) => setTimeout(resolve, FAST_MODE ? 50 : 200));

      // Select all existing text, then clear
      await page.click(selector, { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await new Promise((resolve) => setTimeout(resolve, FAST_MODE ? 30 : 100));

      // Ensure field is fully cleared via evaluate
      await page.evaluate((sel) => {
        const input = document.querySelector(sel) as HTMLInputElement | null;
        if (input) {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, selector);
      await new Promise((resolve) => setTimeout(resolve, FAST_MODE ? 30 : 100));
      
      // Set value via JS in one atomic operation (immune to focus-stealing overlays)
      await page.evaluate((sel, val) => {
        const input = document.querySelector(sel) as HTMLInputElement | null;
        if (!input) return;
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value'
        )?.set;
        if (nativeInputValueSetter) {
          nativeInputValueSetter.call(input, val);
        } else {
          input.value = val;
        }
        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));
      }, selector, text);

      // Wait for validation to process
      await new Promise((resolve) => setTimeout(resolve, AUTOMATION_DELAYS.AFTER_FILL));

      // Verify the typed value matches what we intended
      const actualValue = await page.evaluate((sel) => {
        const input = document.querySelector(sel) as HTMLInputElement | null;
        return input?.value || '';
      }, selector);

      if (actualValue === text) {
        return true;
      }

      // Value mismatch — clear and retry
      console.log(`[Fill] Value mismatch (attempt ${attempt}/${maxRetries}): got "${actualValue}", expected "${text}"`);
      await page.evaluate((sel) => {
        const input = document.querySelector(sel) as HTMLInputElement | null;
        if (input) {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, selector);
      await new Promise((resolve) => setTimeout(resolve, FAST_MODE ? 50 : 300));
    } catch (error) {
      console.log(`[Fill] Error (attempt ${attempt}/${maxRetries}): ${error instanceof Error ? error.message : String(error)}`);
      if (attempt === maxRetries) return false;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  return false;
}

/**
 * Click button using natural mouse movement
 * Waits for button to become enabled before clicking
 */
async function clickButton(page: Page, selector: string, maxWaitMs: number = 5000): Promise<boolean> {
  try {
    await page.waitForSelector(selector, { timeout: maxWaitMs });
    
    const startTime = Date.now();
    let canClick = false;

    while (Date.now() - startTime < maxWaitMs) {
      const state = await page.evaluate((sel) => {
        const btn = document.querySelector(sel) as HTMLButtonElement | null;
        if (!btn) return { exists: false, disabled: true, display: 'none', visibility: 'hidden', opacity: '0' };
        const style = window.getComputedStyle(btn);
        return {
          exists: true,
          disabled: btn.disabled,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity
        };
      }, selector);
      
      if (!state.exists) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      
      canClick = !state.disabled && state.display !== 'none' && state.visibility !== 'hidden' && state.opacity !== '0';
      if (canClick) break;

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (!canClick) return false;

    await page.evaluate((sel) => {
      const btn = document.querySelector(sel) as HTMLButtonElement;
      if (btn) btn.scrollIntoView({ block: 'center', behavior: 'instant' });
    }, selector);

    if (FAST_MODE) {
      // Direct JS click in fast mode — skip mouse simulation
      await new Promise((resolve) => setTimeout(resolve, AUTOMATION_DELAYS.BEFORE_CLICK));
      await page.click(selector);
    } else {
      // Random mouse movement before clicking (human-like behavior)
      await randomMouseMovement(page);

      // Use natural mouse movement to click
      const clicked = await moveToElementAndClick(page, selector);
      if (!clicked) {
        // Fallback to direct click
        await new Promise((resolve) => setTimeout(resolve, AUTOMATION_DELAYS.BEFORE_CLICK));
        await page.click(selector);
      }
    }
    
    await new Promise((resolve) => setTimeout(resolve, AUTOMATION_DELAYS.AFTER_CLICK));

    return true;
  } catch {
    return false;
  }
}

/**
 * Handle login page (email entry)
 */
export async function handleLoginPage(page: Page, account: AWSBuilderIDAccount): Promise<boolean> {
  const emailSelector =
    'input[placeholder="username@example.com"], input[name="email"], input[type="email"], input[autocomplete="username"]';

  // Wait for the email input to appear (slow proxies may delay rendering)
  try {
    await page.waitForSelector(emailSelector, { timeout: TIMEOUTS.MEDIUM });
  } catch {
    return false;
  }

  const filled = await fastFill(page, emailSelector, account.email);
  if (!filled) return false;

  const btnSelector = 'button[data-testid="test-primary-button"]';
  return await clickButton(page, btnSelector);
}

/**
 * Handle signup page (combined email + name fields)
 */
export async function handleSignupPage(page: Page, account: AWSBuilderIDAccount): Promise<boolean> {
  const emailSelector =
    'input[placeholder="username@example.com"], input[name="email"], input[type="email"], input[autocomplete="username"]';
  const nameSelector = 'input[placeholder="Maria José Silva"], input[placeholder*="name" i], input[name="name"], input[name="fullName"], input[data-testid="signup-full-name-input"]';

  try {
    await page.waitForSelector(emailSelector, { timeout: TIMEOUTS.MEDIUM });
    await page.waitForSelector(nameSelector, { timeout: TIMEOUTS.MEDIUM });
  } catch {
    return false;
  }

  const emailFilled = await fastFill(page, emailSelector, account.email);
  if (!emailFilled) return false;

  const nameFilled = await fastFill(page, nameSelector, account.fullName);
  if (!nameFilled) return false;

  const btnSelectors = [
    'button[data-testid="signup-next-button"]',
    'button[data-testid="test-primary-button"]',
    'button[type="submit"]'
  ];

  for (const btnSelector of btnSelectors) {
    const exists = await page.$(btnSelector);
    if (exists) {
      const clicked = await clickButton(page, btnSelector);
      if (clicked) return true;
    }
  }

  return false;
}

/**
 * Handle name page
 */
export async function handleNamePage(page: Page, account: AWSBuilderIDAccount): Promise<boolean> {
  const nameSelector = 'input[placeholder="Maria José Silva"], input[placeholder*="name" i], input[name="name"], input[name="fullName"], input[data-testid="signup-full-name-input"]';

  // Wait for the name input to appear (slow proxies need more time after login→name transition)
  try {
    await page.waitForSelector(nameSelector, { timeout: TIMEOUTS.MEDIUM });
  } catch {
    return false;
  }

  const filled = await fastFill(page, nameSelector, account.fullName);
  if (!filled) return false;

  // Try multiple button selectors
  const btnSelectors = [
    'button[data-testid="signup-next-button"]',
    'button[data-testid="test-primary-button"]',
    'button[type="submit"]'
  ];
  
  for (const btnSelector of btnSelectors) {
    const exists = await page.$(btnSelector);
    if (exists) {
      const clicked = await clickButton(page, btnSelector);
      if (clicked) return true;
    }
  }
  
  return false;
}

/**
 * Handle verification page
 * Fills OTP code and clicks Continue button
 */
export async function handleVerifyPage(page: Page, verificationCode?: string): Promise<boolean> {
  if (!verificationCode) {
    return true;
  }

  try {
    const codeInputSelector = '[data-testid="email-verification-form-code-input"] input';
    await page.waitForSelector(codeInputSelector, { timeout: 5000 });
    
    const filled = await fastFill(page, codeInputSelector, verificationCode);
    if (!filled) return false;

    // Click Continue button
    const continueBtn = 'button[data-testid="email-verification-verify-button"]';
    await page.waitForSelector(continueBtn, { timeout: 5000 });
    
    // Wait for button to be enabled
    await page.waitForFunction(
      (sel) => {
        const btn = document.querySelector(sel) as HTMLButtonElement;
        return btn && !btn.disabled;
      },
      { timeout: 5000 },
      continueBtn
    );

    await new Promise((resolve) => setTimeout(resolve, AUTOMATION_DELAYS.BEFORE_CLICK));
    await page.click(continueBtn);
    await new Promise((resolve) => setTimeout(resolve, AUTOMATION_DELAYS.AFTER_CLICK));
    
    return true;
  } catch {
    return false;
  }
}

/**
 * Handle password page
 */
export async function handlePasswordPage(page: Page, account: AWSBuilderIDAccount): Promise<boolean> {
  const pwdSelector = 'input[placeholder="Enter password"]';
  const confirmSelector = 'input[data-testid="test-retype-input"], input[placeholder="Re-enter password"]';

  try {
    const filled1 = await fastFill(page, pwdSelector, account.password);
    if (!filled1) return false;
    
    const filled2 = await fastFill(page, confirmSelector, account.password);
    if (!filled2) return false;
  } catch {
    return false;
  }

  const btnSelector = 'button[data-testid="test-primary-button"]';
  return await clickButton(page, btnSelector);
}

/**
 * Handle device confirm page
 */
export async function handleDeviceConfirmPage(page: Page): Promise<boolean> {
  if (!FAST_MODE) await new Promise((resolve) => setTimeout(resolve, WAIT.SHORT));

  try {
    await page.waitForSelector('#cli_verification_btn', { timeout: TIMEOUTS.MEDIUM });

    // Dismiss any overlay that might block the button (cookie banner, password manager)
    await page.evaluate(() => {
      // Remove known overlay elements
      const overlays = Array.from(document.querySelectorAll(
        '#cookie-banner, [id*="awsccc"], [class*="awsccc"], [class*="cookie"], [id*="credential"]'
      ));
      for (const el of overlays) {
        (el as HTMLElement).style.display = 'none';
      }
    });
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Use JS click to bypass any remaining overlays
    const clicked = await page.evaluate(() => {
      const btn = document.querySelector('#cli_verification_btn') as HTMLButtonElement | null;
      if (btn && !btn.disabled) {
        btn.scrollIntoView({ block: 'center' });
        btn.click();
        return true;
      }
      return false;
    });

    if (clicked) {
      await new Promise((resolve) => setTimeout(resolve, AUTOMATION_DELAYS.AFTER_CLICK));
    }
    return clicked;
  } catch {
    return false;
  }
}

/**
 * Handle allow access page
 */
export async function handleAllowAccessPage(page: Page): Promise<boolean> {
  if (!FAST_MODE) await new Promise((resolve) => setTimeout(resolve, WAIT.SHORT));

  const btnSelector = 'button#cli_login_button, button[data-testid="allow-access-button"], input[type="submit"][value*="Allow"]';
  return await clickButton(page, btnSelector);
}

/**
 * Handle cookie popup - only once per session
 */
export async function handleCookiePopup(page: Page, ctx: PageAutomationContext): Promise<void> {
  if (ctx.cookiePopupHandled) return;
  
  try {
    // Single IPC round-trip: check all cookie selectors and click if found
    const dismissed = await page.evaluate(() => {
      const selectors = [
        'button[data-id="awsccc-cb-btn-accept"]',
        '#awsccc-cb-btn-accept',
        'button.awsccc-cs-btn-content-accept',
      ];

      for (const sel of selectors) {
        const btn = document.querySelector(sel) as HTMLElement | null;
        if (!btn) continue;
        const style = window.getComputedStyle(btn);
        if (style.display !== 'none' && style.visibility !== 'hidden' && btn.offsetParent !== null) {
          (btn as HTMLButtonElement).click();
          return true;
        }
      }

      // Fallback: find any "Accept" button inside a cookie banner container
      const containers = Array.from(document.querySelectorAll('#cookie-banner, #awsccc-cb-content, .awsccc-cs-container, [id*="awsccc"], [class*="awsccc"]'));
      for (const container of containers) {
        for (const btn of Array.from(container.querySelectorAll('button'))) {
          const text = btn.textContent?.trim().toLowerCase() || '';
          if (text === 'accept' || text.includes('accept')) {
            btn.click();
            return true;
          }
        }
      }
      return false;
    });

    if (dismissed) {
      await new Promise((resolve) => setTimeout(resolve, FAST_MODE ? 100 : 500));
      ctx.cookiePopupHandled = true;
    }
  } catch {
    // Ignore
  }
}

/**
 * Process current page based on detected type
 */
export async function processPage(
  page: Page,
  account: AWSBuilderIDAccount,
  ctx: PageAutomationContext,
  verificationCode?: string
): Promise<{ success: boolean; pageType: PageType; error?: string }> {
  try {
    // Handle cookie popup first
    await handleCookiePopup(page, ctx);

    const pageType = await detectPageType(page);

    // Check if we've already processed this page
    // Skip dedup for pages that need clicking (device_confirm, allow_access)
    // — if the click failed (e.g. blocked by overlay), we need to retry
    const pageId = getPageId(page, pageType);
    const skipDedup = pageType === "device_confirm" || pageType === "allow_access";
    if (!skipDedup && ctx.processedPages.has(pageId)) {
      // Already processed, wait for page to change
      return { success: true, pageType, error: "Already processed" };
    }

    let success = false;

    switch (pageType) {
      case "login":
        success = await handleLoginPage(page, account);
        break;
      case "signup":
        success = await handleSignupPage(page, account);
        break;
      case "name":
        success = await handleNamePage(page, account);
        break;
      case "verify":
        success = await handleVerifyPage(page, verificationCode);
        break;
      case "password":
        success = await handlePasswordPage(page, account);
        break;
      case "device_confirm":
        success = await handleDeviceConfirmPage(page);
        break;
      case "allow_access":
        success = await handleAllowAccessPage(page);
        break;
      case "complete":
        success = true;
        break;
      default:
        // Unknown page - return success to continue polling (like reference project)
        return { success: true, pageType };
    }

    // Mark page as processed if successful
    if (success) {
      ctx.processedPages.add(pageId);
    }

    return { success, pageType };
  } catch (error) {
    return {
      success: false,
      pageType: "unknown",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
