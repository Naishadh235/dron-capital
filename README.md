# Dron Capital Advisors LLP — Investment Dashboard

Family office investment monitoring dashboard with live India + Global market data.

## Live URL

**`https://dron-capital-production.up.railway.app`**

## Architecture

Single Railway deployment with zero authentication needed:
- `/` → `index.html` (dashboard UI)
- `/api/angel?action=...` → Yahoo Finance + CoinGecko proxy

## Files

| File | Purpose |
|------|---------|
| `index.html` | Single-file dashboard frontend |
| `server.js` | Node.js server (frontend + market data proxy) |
| `package.json` | `node server.js` |

## Data Sources (all free, no API keys needed)

- **NSE / BSE** — Yahoo Finance (`.NS` suffix, ~15 min delayed)
- **Indian Indices** — Yahoo Finance (Nifty, Sensex, Bank Nifty)
- **Global Equities** — Yahoo Finance
- **Crypto** — CoinGecko (real-time)
- **Forex** — Yahoo Finance
- **Commodities** — Yahoo Finance (Gold, Silver, Crude, NatGas)

## Why Yahoo Finance instead of Angel One?

Angel One requires fixed IP whitelisting which doesn't work reliably with cloud platforms. Yahoo Finance:
- ✅ No authentication
- ✅ No IP restrictions
- ✅ Works from any server
- ✅ Reliable for monitoring (not trading)

## Local Development

```bash
node server.js
# Open http://localhost:3000
```

## API Endpoints

| Action | Returns |
|--------|---------|
| `?action=nse_all` | All NSE 50 stocks + Indian indices |
| `?action=global&symbols=AAPL,MSFT` | Global equity quotes |
| `?action=crypto&page=1` | Top 100 crypto by market cap |
| `?action=forex` | INR pairs |
| `?action=commodities` | Gold, Silver, Crude, NatGas |
| `?action=debug` | Server health check |
