// Dron Capital - All-in-one server (Yahoo Finance v8 chart API)
// Uses /v8/finance/chart which doesn't require crumb/cookie auth

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// ─── HTTP helper ───────────────────────────────────────────────
function fetchJSON(reqUrl) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(reqUrl);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: 'GET',
      headers: {
        'User-Agent': UA,
        'Accept': 'application/json,text/plain,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ─── Yahoo chart endpoint (no auth needed) ─────────────────────
// Returns latest price + previous close + change %
async function yahooChart(symbol) {
  try {
    const u = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=2d`;
    const data = await fetchJSON(u);
    const result = data?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const ltp = meta.regularMarketPrice;
    const prevClose = meta.chartPreviousClose || meta.previousClose;
    const change = ltp - prevClose;
    const changePercent = (change / prevClose) * 100;
    const quotes = result.indicators?.quote?.[0] || {};
    const volumes = quotes.volume || [];
    const volume = volumes[volumes.length - 1] || 0;
    return {
      symbol,
      ltp,
      change,
      changePercent,
      volume,
      high: meta.regularMarketDayHigh || 0,
      low: meta.regularMarketDayLow || 0,
      open: meta.regularMarketOpen || 0,
      previousClose: prevClose,
      currency: meta.currency,
    };
  } catch {
    return null;
  }
}

async function yahooChartBatch(symbols) {
  // Yahoo chart endpoint is one symbol per call - parallelize
  const results = await Promise.all(symbols.map(s => yahooChart(s)));
  return results.filter(Boolean);
}

// ─── Symbol Maps ───────────────────────────────────────────────
const NSE_SYMBOLS = [
  'RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','BHARTIARTL','SBIN','WIPRO',
  'HINDUNILVR','ITC','AXISBANK','KOTAKBANK','LT','SUNPHARMA','TATAMOTORS',
  'TATASTEEL','ONGC','POWERGRID','NTPC','BAJFINANCE','ASIANPAINT','HCLTECH',
  'DRREDDY','CIPLA','ADANIENT','JSWSTEEL','BAJAJFINSV','TECHM','EICHERMOT',
  'GRASIM','BPCL','COALINDIA','APOLLOHOSP','TITAN','TATACONSUM','HEROMOTOCO',
  'DIVISLAB','HINDPETRO','NESTLEIND','M&M','ULTRACEMCO','BRITANNIA',
  'INDUSINDBK','ADANIPORTS','HDFCLIFE'
];

const INDIAN_INDICES = {
  'NIFTY50':   '^NSEI',
  'BANKNIFTY': '^NSEBANK',
  'SENSEX':    '^BSESN',
  'NIFTYIT':   '^CNXIT',
  'INDIAVIX':  '^INDIAVIX',
};

// ─── Static file cache ─────────────────────────────────────────
let indexHtmlCache = null;
function getIndexHtml() {
  if (!indexHtmlCache) {
    try { indexHtmlCache = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'); }
    catch { indexHtmlCache = '<h1>index.html not found</h1>'; }
  }
  return indexHtmlCache;
}

// ─── Cache for batch responses (15 sec) ───────────────────────
const cache = new Map();
function getCached(key, ttl = 15000) {
  const v = cache.get(key);
  if (v && Date.now() - v.t < ttl) return v.d;
  return null;
}
function setCached(key, data) { cache.set(key, { t: Date.now(), d: data }); }

// ─── HTTP Server ───────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const parsed = url.parse(req.url, true);
  const pathname = parsed.pathname;

  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(getIndexHtml());
    return;
  }

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
    if (action === 'token' || action === 'login') {
      return send({ status: true, feedToken: 'yahoo-finance', message: 'Connected to Yahoo Finance' });
    }

    if (action === 'debug') {
      const ip = await fetchJSON('https://api.ipify.org?format=json');
      // Test one symbol
      const test = await yahooChart('RELIANCE.NS');
      return send({
        status: true,
        source: 'Yahoo Finance v8 chart API',
        serverIP: ip?.ip || 'unknown',
        testQuery: test ? { symbol: 'RELIANCE.NS', ltp: test.ltp, change: test.change } : 'failed'
      });
    }

    if (action === 'nse_all') {
      const cacheKey = 'nse_all';
      const cached = getCached(cacheKey);
      if (cached) return send(cached);

      const stockSymbols = NSE_SYMBOLS.map(s => `${s}.NS`);
      const indexSymbols = Object.values(INDIAN_INDICES);
      const allSymbols = [...stockSymbols, ...indexSymbols];

      // Fetch in batches of 10 to avoid overwhelming
      const results = {};
      for (let i = 0; i < allSymbols.length; i += 10) {
        const batch = allSymbols.slice(i, i + 10);
        const data = await yahooChartBatch(batch);
        data.forEach(q => {
          let key = q.symbol.replace('.NS', '').replace('.BO', '');
          const idxMatch = Object.entries(INDIAN_INDICES).find(([k, v]) => v === q.symbol);
          if (idxMatch) key = idxMatch[0];
          results[key] = {
            ltp: q.ltp,
            change: q.change,
            changePercent: q.changePercent,
            volume: q.volume,
            high: q.high,
            low: q.low,
            open: q.open,
            previousClose: q.previousClose,
          };
        });
      }

      const response = { status: true, data: results, count: Object.keys(results).length, source: 'Yahoo Finance' };
      setCached(cacheKey, response);
      return send(response);
    }

    if (action === 'global' || action === 'yahoo') {
      const symbols = (parsed.query.symbols || '').split(',').filter(Boolean);
      if (!symbols.length) return send({ status: false, message: 'No symbols' }, 400);
      const cacheKey = 'global:' + symbols.join(',');
      const cached = getCached(cacheKey);
      if (cached) return send(cached);
      const data = await yahooChartBatch(symbols);
      const response = { status: true, data, count: data.length };
      setCached(cacheKey, response);
      return send(response);
    }

    if (action === 'crypto') {
      const page = parsed.query.page || '1';
      const cacheKey = 'crypto:' + page;
      const cached = getCached(cacheKey, 60000);
      if (cached) return send(cached);
      const coins = await fetchJSON(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=${page}&sparkline=false`);
      const response = { status: true, data: coins, count: Array.isArray(coins) ? coins.length : 0 };
      setCached(cacheKey, response);
      return send(response);
    }

    if (action === 'forex') {
      const pairs = ['INR=X', 'EURINR=X', 'GBPINR=X', 'JPYINR=X'];
      const data = await yahooChartBatch(pairs);
      return send({ status: true, data });
    }

    if (action === 'commodities') {
      const symbols = ['GC=F', 'SI=F', 'CL=F', 'NG=F'];
      const data = await yahooChartBatch(symbols);
      return send({ status: true, data });
    }

    if (action === 'portfolio') {
      return send({ status: true, data: { holdings: [] } });
    }
    if (action === 'funds') {
      return send({ status: true, data: {} });
    }

    send({ status: false, message: 'Unknown action: ' + action }, 400);
  } catch (e) {
    send({ status: false, message: e.message }, 500);
  }
});

server.listen(PORT, () => console.log(`Dron Capital running on port ${PORT} (Yahoo Finance v8)`));
