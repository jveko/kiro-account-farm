# AGENTS.md

## Commands
- **Run CLI**: `bun bin/register.ts <email> <count>` or `bun bin/validate.ts <file>`
- **Type check**: `bun --bun tsc --noEmit` (no test suite configured)

## Architecture
- **bin/**: CLI entry points (register.ts, validate.ts, roxy/)
- **src/api/**: AWS OIDC auth, token validation, Roxy Browser API
- **src/automation/**: Puppeteer page automation for AWS Builder ID registration
- **src/services/**: Browser lifecycle management via Roxy Browser
- **output/**: Generated JSON files (gitignored)
- **reference/**: Chrome extension reference code

## Code Style
- TypeScript with Bun runtime, ES modules
- Imports: relative paths from src/, types via `import type`
- Naming: camelCase functions/variables, PascalCase types/classes
- Error handling: try/catch with typed errors, log via `logSession()`
- Config: centralized in `src/config.ts`, env vars in `.env`
- No semicolons optional (codebase uses semicolons)
- Async/await preferred over Promise chains
