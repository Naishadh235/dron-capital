# Dron Capital Advisors LLP — Investment Dashboard

Family office investment monitoring dashboard with live India + Global market data.

## Live URL

**`https://dron-capital-production.up.railway.app`**

## Architecture

Single Railway deployment that serves both frontend and backend:
- `/` → `index.html` (dashboard UI)
- `/api/angel?action=...` → Angel One / Yahoo / CoinGecko proxy

## Files

| File | Purpose |
|------|---------|
| `index.html` | Single-file dashboard frontend |
| `server.js` | Node.js server (frontend + Angel One proxy) |
| `package.json` | `node server.js` |

## Data Sources

- **NSE / BSE** — Angel One SmartAPI (fixed IP whitelisted)
- **Global Equities** — Yahoo Finance (no auth)
- **Crypto** — CoinGecko (no auth)

## Environment Variables (Railway)

```
ANGEL_API_KEY=fspMdQlz
ANGEL_CLIENT_CODE=T205834
ANGEL_TOTP_SECRET=DRKLJ7YBNN6QCYXXSIQO6SRO5Q
ANGEL_PIN=2582
```

## Local Development

```bash
node server.js
# Open http://localhost:3000
```
