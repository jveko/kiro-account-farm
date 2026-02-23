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
  const text = await page.evaluate(() => document.body?.innerText || "");

  // Device confirm page - check FIRST (before complete, as URL overlaps)
  if (url.includes("awsapps.com") && url.includes("#/device?user_code=")) {
    return "device_confirm";
  }
  const confirmBtn = await page.$('#cli_verification_btn');
  if (confirmBtn) {
    return "device_confirm";
  }
  if (text.includes("Confirm and continue") || text.includes("confirm this code")) {
    return "device_confirm";
  }

  // Complete page - check text
  if (
    text.includes("Request approved") ||
    text.includes("You can close this window")
  ) {
    return "complete";
  }

  // Allow access page
  const allowBtn = await page.$(
    'button#cli_login_button, button[data-testid="allow-access-button"], input[type="submit"][value*="Allow"]'
  );
  if (allowBtn) {
    return "allow_access";
  }
  if ((text.includes("Allow access") || text.includes("allow access")) && url.includes("awsapps.com")) {
    return "allow_access";
  }

  // Verification page - check URL first (most reliable)
  if (url.includes("verify-otp") || url.includes("/verification") || url.includes("verifyEmail")) {
    return "verify";
  }
  // Also check for verification-specific elements
  if (text.includes("Verify your email") || text.includes("verification code")) {
    return "verify";
  }

  // Password page - check URL and text content
  if (url.includes("/signup?registrationCode=") || text.includes("Create your password")) {
    return "password";
  }
  // Also check for both password inputs
  const pwdInput = await page.$('input[placeholder="Enter password"], input[type="password"][autocomplete="off"]');
  const confirmPwdInput = await page.$('input[placeholder="Re-enter password"], input[data-testid="test-retype-input"]');
  if (pwdInput && confirmPwdInput) {
    return "password";
  }

  // Name page - check URL and text content
  if (url.includes("#/signup/start") || text.includes("Enter your name")) {
    return "name";
  }
  // Also check for name input with data-testid
  const nameInput = await page.$('input[data-testid="signup-full-name-input"], input[placeholder="Maria José Silva"]');
  if (nameInput) {
    return "name";
  }

  // Login page - check URL and text content
  if (url.includes("/login?workflowStateHandle=") || text.includes("Get started")) {
    const emailInput = await page.$('input[placeholder="username@example.com"], input[type="text"][autocomplete="on"]');
    if (emailInput) {
      return "login";
    }
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

      // Dismiss any cookie banner before typing (can appear mid-page-load and steal focus)
      await page.evaluate(() => {
        const banner = document.querySelector('#awsccc-cb-content, #cookie-banner, [id*="awsccc"]') as HTMLElement | null;
        if (banner && banner.offsetParent !== null) {
          const acceptBtn = banner.querySelector('#awsccc-cb-btn-accept, button') as HTMLElement | null;
          if (acceptBtn) acceptBtn.click();
          banner.style.display = 'none';
        }
      });
      await new Promise((resolve) => setTimeout(resolve, 300));

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
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Select all existing text, then clear
      await page.click(selector, { clickCount: 3 });
      await page.keyboard.press('Backspace');
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Ensure field is fully cleared via evaluate
      await page.evaluate((sel) => {
        const input = document.querySelector(sel) as HTMLInputElement | null;
        if (input) {
          input.value = '';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }, selector);
      await new Promise((resolve) => setTimeout(resolve, 100));
      
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
      await new Promise((resolve) => setTimeout(resolve, 300));
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
    // Input is nested inside the wrapper div
    const codeInputSelector = '[data-testid="email-verification-form-code-input"] input';
    await page.waitForSelector(codeInputSelector, { timeout: 5000 });
    
    // Clear any existing value (prevents stale text from previous page transitions)
    await page.click(codeInputSelector, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Force-clear via DOM to ensure no leftover text (e.g. name from previous step)
    await page.evaluate((sel) => {
      const input = document.querySelector(sel) as HTMLInputElement | null;
      if (input) {
        input.value = '';
        input.dispatchEvent(new Event('input', { bubbles: true }));
      }
    }, codeInputSelector);
    await new Promise((resolve) => setTimeout(resolve, 100));
    
    // Type with delay to simulate real user (helps with validation)
    await page.type(codeInputSelector, verificationCode, { delay: AUTOMATION_DELAYS.TYPING_DELAY });
    
    await new Promise((resolve) => setTimeout(resolve, AUTOMATION_DELAYS.AFTER_FILL));

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
    await page.waitForSelector(pwdSelector, { timeout: 5000 });
    await page.click(pwdSelector, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(pwdSelector, account.password, { delay: AUTOMATION_DELAYS.TYPING_DELAY });
    
    await new Promise((resolve) => setTimeout(resolve, AUTOMATION_DELAYS.AFTER_FILL));
    
    await page.waitForSelector(confirmSelector, { timeout: 5000 });
    await page.click(confirmSelector, { clickCount: 3 });
    await page.keyboard.press('Backspace');
    await page.type(confirmSelector, account.password, { delay: AUTOMATION_DELAYS.TYPING_DELAY });
    
    await new Promise((resolve) => setTimeout(resolve, AUTOMATION_DELAYS.AFTER_FILL));
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
    // AWS uses multiple cookie consent variants — try all known selectors
    const cookieSelectors = [
      'button[data-id="awsccc-cb-btn-accept"]',
      '#awsccc-cb-btn-accept',
      'button.awsccc-cs-btn-content-accept',
    ];

    for (const sel of cookieSelectors) {
      const isVisible = await page.evaluate((s) => {
        const btn = document.querySelector(s) as HTMLElement | null;
        if (!btn) return false;
        const style = window.getComputedStyle(btn);
        return style.display !== 'none' && style.visibility !== 'hidden' && btn.offsetParent !== null;
      }, sel);
      
      if (isVisible) {
        await page.click(sel);
        await new Promise((resolve) => setTimeout(resolve, 500));
        ctx.cookiePopupHandled = true;
        return;
      }
    }

    // Fallback: find any "Accept" button inside a cookie banner container
    const dismissed = await page.evaluate(() => {
      const containers = Array.from(document.querySelectorAll('#cookie-banner, #awsccc-cb-content, .awsccc-cs-container, [id*="awsccc"], [class*="awsccc"]'));
      for (const container of containers) {
        const buttons = Array.from(container.querySelectorAll('button'));
        for (const btn of buttons) {
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
      await new Promise((resolve) => setTimeout(resolve, 500));
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
