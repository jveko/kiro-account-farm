# Provider Abstraction Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `--provider` flag to registration CLI, gating Gmail-specific features (alias generation, OTP fetching) and stubbing SimpleLogin provider.

**Architecture:** Introduce `EmailProvider` type (`gmail` | `simplelogin`). Create provider-aware dispatchers for alias generation and OTP fetching. Thread provider through config → orchestrator → worker. Gate Gmail validation in CLI.

**Tech Stack:** TypeScript, Bun runtime

---

### Task 1: Add EmailProvider type

**Files:**
- Create: `src/types/provider.ts`

**Step 1: Create provider type file**

```typescript
export type EmailProvider = "gmail" | "simplelogin";
```

**Step 2: Verify**
Run: `bun --bun tsc --noEmit`

---

### Task 2: Create SimpleLogin stubs

**Files:**
- Create: `src/utils/simplelogin-alias.ts`
- Create: `src/utils/simplelogin-otp.ts`

**Step 1: Create alias stub**

Stub that throws "not implemented" for now. Same interface shape as gmail-alias.

**Step 2: Create OTP stub**

Stub that throws "not implemented". Same return type as gmail-otp's `fetchAwsOtp`.

**Step 3: Verify**
Run: `bun --bun tsc --noEmit`

---

### Task 3: Create provider-aware dispatchers

**Files:**
- Create: `src/utils/email-provider.ts`

**Step 1: Create dispatcher module**

Functions:
- `generateEmailAlias(provider, options)` — dispatches to gmail or simplelogin
- `fetchOtp(provider, toEmail, ...)` — dispatches to gmail or simplelogin  
- `isValidEmail(provider, email)` — gmail validates `@gmail.com`, simplelogin accepts any valid email

**Step 2: Verify**
Run: `bun --bun tsc --noEmit`

---

### Task 4: Update BatchRegistrationConfig to include provider

**Files:**
- Modify: `src/types/aws-builder-id.ts` — add `provider` to `BatchRegistrationConfig`

**Step 1: Add provider field**

Add `provider: EmailProvider` to `BatchRegistrationConfig`.

**Step 2: Verify**
Run: `bun --bun tsc --noEmit`

---

### Task 5: Update orchestrator to use provider-aware functions

**Files:**
- Modify: `src/automation/aws-builder-id/orchestrator.ts`

**Step 1: Replace direct gmail imports with provider dispatcher**

- Replace `generateGmailAlias` with `generateEmailAlias(provider, ...)`
- Pass `provider` through to `registrationWorker`
- Remove `isValidGmail` usage (moved to CLI)

**Step 2: Verify**
Run: `bun --bun tsc --noEmit`

---

### Task 6: Update worker to use provider-aware OTP

**Files:**
- Modify: `src/automation/aws-builder-id/worker.ts`

**Step 1: Replace direct gmail-otp import with provider dispatcher**

- Accept `provider` parameter
- Use `fetchOtp(provider, ...)` instead of `fetchAwsOtp`

**Step 2: Verify**
Run: `bun --bun tsc --noEmit`

---

### Task 7: Update CLI with --provider flag

**Files:**
- Modify: `bin/register.ts`

**Step 1: Add --provider flag parsing**

- Parse `--provider gmail|simplelogin` (default: `gmail`)
- Gate `isValidGmail` check behind `provider === "gmail"`
- Pass provider to `batchRegister`
- Update usage text

**Step 2: Verify**
Run: `bun --bun tsc --noEmit`

---

### Task 8: Commit

```
feat(cli): add --provider flag for email provider abstraction
```
