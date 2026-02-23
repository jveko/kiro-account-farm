# Farm Kiro Account - AWS Builder ID Automation

Automated AWS Builder ID account creation for Kiro IDE with automatic token validation.

## Features

- ✅ AWS Builder ID batch registration
- ✅ **Automatic token validation** (filters invalid/suspended accounts)
- ✅ Gmail alias generation (unlimited accounts from one Gmail)
- ✅ Concurrent registration with configurable workers
- ✅ Proxy support
- ✅ Roxy Browser integration for fingerprinting
- ✅ Results export to JSON (only valid tokens)

## Prerequisites

1. **Roxy Browser** - Download from [roxybrowser.com](https://roxybrowser.com)
2. **Roxy API Token** - Get from Roxy Browser settings
3. **Gmail Account** - One Gmail generates unlimited aliases
4. **Proxy** (optional) - HTTP/HTTPS/SOCKS5 proxy

## Setup

```bash
# Install dependencies
bun install

# Copy environment config
cp .env.example .env

# Add your Roxy API token to .env
# ROXY_API_TOKEN=your_token_here

# Extract workspace/project IDs
bun bin/roxy/extract-workspace.ts
```

## Usage

### Register Accounts

```bash
bun bin/register.ts <email> <count> [options]

# Examples
bun bin/register.ts myemail@gmail.com 5
bun bin/register.ts myemail@gmail.com 10 --concurrency 2
bun bin/register.ts myemail@gmail.com 5 --proxy user:pass@proxy.com:8080
```

**Flow:**
1. Creates accounts with Gmail aliases
2. Opens browser for manual verification code entry
3. **Automatically validates tokens** after acquisition
4. **Exports only valid accounts** to `output/`

### Validate Existing Tokens

```bash
bun bin/validate.ts <json-file> [options]

# Examples
bun bin/validate.ts output/kiro-accounts-2026-02-09.json
bun bin/validate.ts output/accounts.json --proxy 127.0.0.1:1080
```

## Project Structure

```
farm-kiro-account/
├── bin/                          # CLI entry points
│   ├── register.ts               # Main registration CLI
│   ├── validate.ts               # Token validation CLI
│   └── roxy/                     # Roxy browser utilities
│       ├── list-profiles.ts
│       ├── profile-details.ts
│       └── extract-workspace.ts
├── src/                          # Core library
│   ├── api/
│   │   ├── aws-oidc.ts           # AWS OIDC Device Auth
│   │   ├── token-validator.ts    # Token validation API
│   │   └── roxy.ts               # Roxy Browser API
│   ├── automation/
│   │   └── aws-builder-id/
│   │       ├── batch.ts          # Batch orchestrator
│   │       ├── register.ts       # Page automation
│   │       └── session.ts        # Session management
│   ├── services/
│   │   └── browser.ts            # Browser lifecycle
│   ├── types/
│   ├── utils/
│   └── config.ts
├── output/                       # Generated JSON files (gitignored)
├── reference/                    # Reference code
│   └── aws-builder-id-ext/       # Chrome extension reference
└── docs/examples/
```

## Output Format

```json
{
  "summary": {
    "total": 5,
    "valid": 4,
    "suspended": 1,
    "expired": 0,
    "invalid": 0,
    "failed": 0,
    "timestamp": "2026-02-09T12:30:45.123Z"
  },
  "accounts": [
    {
      "email": "myemail+1@gmail.com",
      "password": "Xy9#mK2pL@4q",
      "fullName": "John Smith",
      "token": {
        "accessToken": "eyJraWQiOiJ...",
        "refreshToken": "eyJjdHkiOiJ...",
        "expiresIn": 28800,
        "tokenType": "Bearer"
      }
    }
  ],
  "filtered": {
    "suspended": [...],
    "expired": [...],
    "invalid": [...]
  },
  "failures": []
}
```

## Programmatic Usage

```typescript
import { batchRegister, exportResults } from "./src/automation/aws-builder-id/batch";

const progress = await batchRegister({
  baseEmail: "your-email@gmail.com",
  count: 5,
  concurrency: 1,
  proxy: { username: "user", password: "pass", host: "proxy.com", port: 8080 },
});

// Only valid tokens are exported
exportResults(progress, "output/results.json");
```

## Notes

- **Manual Verification**: Enter verification codes from Gmail during registration
- **Concurrency**: Recommended: 1 for stability
- **Token Validation**: Automatically runs after each registration
- **Filtered Output**: Only valid tokens saved to `accounts[]`, invalid ones in `filtered{}`

## License

MIT
