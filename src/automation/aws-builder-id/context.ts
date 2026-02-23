/**
 * Per-session automation context
 * Holds state that was previously in module globals, now isolated per worker
 */

export interface PageAutomationContext {
  processedPages: Set<string>;
  cookiePopupHandled: boolean;
}

/**
 * Create a fresh context for each registration session
 */
export function createPageAutomationContext(): PageAutomationContext {
  return {
    processedPages: new Set<string>(),
    cookiePopupHandled: false,
  };
}
