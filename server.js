// Dron Capital - All-in-one server (Yahoo Finance + CoinGecko)
// Serves index.html on / and API on /api/angel

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// ─── HTTP Helpers ──────────────────────────────────────────────
function fetchJSON(reqUrl, options = {}) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(reqUrl);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        ...options.headers,
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve({ raw: data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ─── Symbol Maps ───────────────────────────────────────────────
// NSE/BSE Indian stocks (Yahoo uses .NS suffix for NSE, .BO for BSE)
const NSE_SYMBOLS = [
  'RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','BHARTIARTL','SBIN','WIPRO',
  'HINDUNILVR','ITC','AXISBANK','KOTAKBANK','LT','SUNPHARMA','TATAMOTORS',
  'TATASTEEL','ONGC','POWERGRID','NTPC','BAJFINANCE','ASIANPAINT','HCLTECH',
  'DRREDDY','CIPLA','ADANIENT','JSWSTEEL','BAJAJFINSV','TECHM','EICHERMOT',
  'GRASIM','BPCL','COALINDIA','APOLLOHOSP','TITAN','TATACONSUM','HEROMOTOCO',
  'DIVISLAB','HINDPETRO','NESTLEIND','M&M','ULTRACEMCO','BRITANNIA','SHRIRAMFIN',
  'INDUSINDBK','ADANIPORTS'
];

const INDIAN_INDICES = {
  'NIFTY50':   '^NSEI',
  'BANKNIFTY': '^NSEBANK',
  'SENSEX':    '^BSESN',
  'NIFTYIT':   '^CNXIT',
  'NIFTYNEXT50': '^NSMIDCP',
  'INDIAVIX':  '^INDIAVIX',
};

// ─── Yahoo Finance fetch ───────────────────────────────────────
async function yahooQuotes(symbols) {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols.join(','))}`;
  try {
    const data = await fetchJSON(url);
    return data?.quoteResponse?.result || [];
  } catch (e) {
    return [];
  }
}

// ─── Static File Cache ─────────────────────────────────────────
let indexHtmlCache = null;
function getIndexHtml() {
  if (!indexHtmlCache) {
    try {
      indexHtmlCache = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    } catch (e) {
      indexHtmlCache = '<h1>index.html not found</h1>';
    }
  }
  return indexHtmlCache;
}

// ─── HTTP Server ───────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  // ── Frontend
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getIndexHtml());
    return;
  }

  // ── API
  if (pathname !== '/api/angel') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: false, message: 'Not found' }));
    return;
  }

  const action = parsed.query.action;
  const send = (data, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  try {
    // Always returns success - no auth needed for Yahoo
    if (action === 'token' || action === 'login') {
      return send({ status: true, feedToken: 'yahoo-finance', message: 'Connected to Yahoo Finance' });
    }

    if (action === 'debug') {
      const ip = await fetchJSON('https://api.ipify.org?format=json');
      return send({ status: true, source: 'Yahoo Finance', serverIP: ip.ip || 'unknown', message: 'No auth required' });
    }

    // NSE/BSE Indian stocks via Yahoo
    if (action === 'nse_all') {
      const stockSymbols = NSE_SYMBOLS.map(s => `${s}.NS`);
      const indexSymbols = Object.values(INDIAN_INDICES);
      const allSymbols = [...stockSymbols, ...indexSymbols];

      const quotes = await yahooQuotes(allSymbols);
      const results = {};

      quotes.forEach(q => {
        const symbol = q.symbol;
        // Map back from Yahoo symbol to our symbol
        let key = symbol.replace('.NS', '').replace('.BO', '');

        // Handle indices
        const idxMatch = Object.entries(INDIAN_INDICES).find(([k, v]) => v === symbol);
        if (idxMatch) key = idxMatch[0];

        results[key] = {
          ltp: q.regularMarketPrice || 0,
          change: q.regularMarketChange || 0,
          changePercent: q.regularMarketChangePercent || 0,
          volume: q.regularMarketVolume || 0,
          high: q.regularMarketDayHigh || 0,
          low: q.regularMarketDayLow || 0,
          open: q.regularMarketOpen || 0,
          previousClose: q.regularMarketPreviousClose || 0,
        };
      });

      return send({ status: true, data: results, count: Object.keys(results).length, source: 'Yahoo Finance' });
    }

    // Global equities
    if (action === 'yahoo' || action === 'global') {
      const symbols = (parsed.query.symbols || '').split(',').filter(Boolean);
      if (!symbols.length) return send({ status: false, message: 'No symbols provided' }, 400);
      const quotes = await yahooQuotes(symbols);
      return send({ status: true, data: quotes, count: quotes.length });
    }

    // Crypto via CoinGecko
    if (action === 'crypto') {
      const page = parsed.query.page || '1';
      const coins = await fetchJSON(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=${page}&sparkline=false`);
      return send({ status: true, data: coins, count: Array.isArray(coins) ? coins.length : 0 });
    }

    // Portfolio/funds - placeholder (would need broker integration for real data)
    if (action === 'portfolio') {
      return send({ status: true, data: { holdings: [] }, message: 'Portfolio data unavailable - connect broker for live holdings' });
    }
    if (action === 'funds') {
      return send({ status: true, data: {}, message: 'Fund data unavailable' });
    }

    // Forex
    if (action === 'forex') {
      const pairs = ['INR=X', 'EURINR=X', 'GBPINR=X', 'JPYINR=X'];
      const quotes = await yahooQuotes(pairs);
      return send({ status: true, data: quotes });
    }

    // Commodities
    if (action === 'commodities') {
      const symbols = ['GC=F', 'SI=F', 'CL=F', 'NG=F']; // Gold, Silver, Crude, NatGas
      const quotes = await yahooQuotes(symbols);
      return send({ status: true, data: quotes });
    }

    send({ status: false, message: 'Unknown action: ' + action }, 400);
  } catch (e) {
    send({ status: false, message: e.message }, 500);
  }
});

server.listen(PORT, () => console.log(`Dron Capital running on port ${PORT} (Yahoo Finance backend)`));
