// Dron Capital - Twelve Data (real-time) + Yahoo Finance (fallback)
// Smart caching to stay under 800 calls/day Twelve Data free limit

const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const TWELVE_KEY = process.env.TWELVE_DATA_KEY || '3c867a6a5ef945349a63f0975a71d607';
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
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.end();
  });
}

// ─── Twelve Data (real-time) ───────────────────────────────────
// Free: 800 credits/day, 8 req/min. Quote endpoint = 1 credit per symbol.
async function twelveDataQuote(symbols) {
  // Twelve Data accepts comma-separated symbols, returns object keyed by symbol
  if (!symbols.length) return {};
  const symParam = symbols.join(',');
  const u = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symParam)}&apikey=${TWELVE_KEY}`;
  try {
    const data = await fetchJSON(u);
    if (!data) return {};
    const out = {};
    // Single symbol: returns single object. Multiple: object keyed by symbol.
    if (data.symbol) {
      // single response
      if (!data.code) out[data.symbol] = data;
    } else {
      Object.keys(data).forEach(k => {
        if (data[k] && !data[k].code && data[k].symbol) out[k] = data[k];
      });
    }
    return out;
  } catch (e) {
    return {};
  }
}

// ─── Yahoo (fallback / global) ────────────────────────────────
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
    return {
      symbol,
      ltp,
      change,
      changePercent,
      volume: volumes[volumes.length - 1] || 0,
      high: meta.regularMarketDayHigh || 0,
      low: meta.regularMarketDayLow || 0,
      open: meta.regularMarketOpen || 0,
      previousClose: prevClose,
    };
  } catch { return null; }
}

async function yahooBatch(symbols) {
  const results = await Promise.all(symbols.map(s => yahooChart(s)));
  return results.filter(Boolean);
}

// ─── NSE Symbols (real-time via Twelve Data) ──────────────────
// Twelve Data uses "SYMBOL:NSE" format
const NSE_SYMBOLS = [
  'RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','BHARTIARTL','SBIN','WIPRO',
  'HINDUNILVR','ITC','AXISBANK','KOTAKBANK','LT','SUNPHARMA','TATAMOTORS',
  'TATASTEEL','ONGC','POWERGRID','NTPC','BAJFINANCE','ASIANPAINT','HCLTECH',
  'DRREDDY','CIPLA','ADANIENT','JSWSTEEL','BAJAJFINSV','TECHM','EICHERMOT',
  'GRASIM','BPCL','COALINDIA','APOLLOHOSP','TITAN','TATACONSUM','HEROMOTOCO',
  'DIVISLAB','HINDPETRO','NESTLEIND','M&M','ULTRACEMCO','BRITANNIA',
  'INDUSINDBK','ADANIPORTS','HDFCLIFE'
];

// Yahoo symbols for indices (Twelve Data doesn't have free Indian indices)
const INDIAN_INDICES_YAHOO = {
  'NIFTY50':   '^NSEI',
  'BANKNIFTY': '^NSEBANK',
  'SENSEX':    '^BSESN',
  'NIFTYIT':   '^CNXIT',
  'INDIAVIX':  '^INDIAVIX',
};

// ─── Static file ───────────────────────────────────────────────
let indexHtmlCache = null;
function getIndexHtml() {
  if (!indexHtmlCache) {
    try { indexHtmlCache = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8'); }
    catch { indexHtmlCache = '<h1>index.html not found</h1>'; }
  }
  return indexHtmlCache;
}

// ─── Cache (45 sec for NSE to balance freshness vs API budget) ──
const cache = new Map();
function getCached(key, ttl) {
  const v = cache.get(key);
  if (v && Date.now() - v.t < ttl) return v.d;
  return null;
}
function setCached(key, data) { cache.set(key, { t: Date.now(), d: data }); }

// ─── Daily call counter (resets at IST midnight) ──────────────
let dailyCalls = 0;
let lastResetDay = new Date().getDate();
function trackCalls(n) {
  const now = new Date();
  if (now.getDate() !== lastResetDay) { dailyCalls = 0; lastResetDay = now.getDate(); }
  dailyCalls += n;
  return dailyCalls;
}

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
      return send({ status: true, feedToken: 'twelve-data', message: 'Connected (real-time + fallback)' });
    }

    if (action === 'debug') {
      const ip = await fetchJSON('https://api.ipify.org?format=json');
      const test = await twelveDataQuote(['RELIANCE:NSE']);
      const yahooTest = await yahooChart('RELIANCE.NS');
      return send({
        status: true,
        sources: {
          primary: 'Twelve Data (real-time)',
          fallback: 'Yahoo Finance (15-min delayed)',
          indices: 'Yahoo Finance',
        },
        serverIP: ip?.ip || 'unknown',
        twelveDataKey: TWELVE_KEY ? `${TWELVE_KEY.slice(0,8)}...` : 'NOT SET',
        callsToday: dailyCalls,
        callBudget: '800/day',
        twelveTest: test['RELIANCE:NSE'] ? { source: 'twelvedata', price: test['RELIANCE:NSE'].close } : 'no data',
        yahooTest: yahooTest ? { source: 'yahoo', price: yahooTest.ltp } : 'no data',
      });
    }

    if (action === 'nse_all') {
      const cacheKey = 'nse_all';
      const cached = getCached(cacheKey, 45000); // 45 sec cache
      if (cached) return send(cached);

      const results = {};

      // 1. Real-time stocks via Twelve Data (in batches of 8 to respect rate limit)
      const tdSymbols = NSE_SYMBOLS.map(s => `${s}:NSE`);
      const batches = [];
      for (let i = 0; i < tdSymbols.length; i += 8) batches.push(tdSymbols.slice(i, i + 8));

      for (const batch of batches) {
        const data = await twelveDataQuote(batch);
        Object.entries(data).forEach(([sym, q]) => {
          const key = sym.replace(':NSE', '').replace(':BSE', '');
          const ltp = parseFloat(q.close);
          const prevClose = parseFloat(q.previous_close);
          const change = ltp - prevClose;
          const changePercent = parseFloat(q.percent_change) || ((change / prevClose) * 100);
          results[key] = {
            ltp,
            change,
            changePercent,
            volume: parseInt(q.volume) || 0,
            high: parseFloat(q.high) || 0,
            low: parseFloat(q.low) || 0,
            open: parseFloat(q.open) || 0,
            previousClose: prevClose,
            source: 'twelvedata',
          };
        });
        trackCalls(batch.length);
        // Brief pause between batches
        await new Promise(r => setTimeout(r, 100));
      }

      // 2. Indices via Yahoo (Twelve Data needs paid plan for ^NSEI)
      const indexSymbols = Object.values(INDIAN_INDICES_YAHOO);
      const yIndices = await yahooBatch(indexSymbols);
      yIndices.forEach(q => {
        const idxMatch = Object.entries(INDIAN_INDICES_YAHOO).find(([k, v]) => v === q.symbol);
        if (idxMatch) {
          results[idxMatch[0]] = {
            ltp: q.ltp,
            change: q.change,
            changePercent: q.changePercent,
            volume: q.volume,
            high: q.high,
            low: q.low,
            open: q.open,
            previousClose: q.previousClose,
            source: 'yahoo',
          };
        }
      });

      // 3. Yahoo fallback for any missing stocks
      const missing = NSE_SYMBOLS.filter(s => !results[s]);
      if (missing.length) {
        const yMissing = await yahooBatch(missing.map(s => `${s}.NS`));
        yMissing.forEach(q => {
          const key = q.symbol.replace('.NS', '');
          results[key] = {
            ltp: q.ltp,
            change: q.change,
            changePercent: q.changePercent,
            volume: q.volume,
            high: q.high,
            low: q.low,
            open: q.open,
            previousClose: q.previousClose,
            source: 'yahoo-fallback',
          };
        });
      }

      const response = {
        status: true,
        data: results,
        count: Object.keys(results).length,
        callsToday: dailyCalls,
      };
      setCached(cacheKey, response);
      return send(response);
    }

    if (action === 'global' || action === 'yahoo') {
      const symbols = (parsed.query.symbols || '').split(',').filter(Boolean);
      if (!symbols.length) return send({ status: false, message: 'No symbols' }, 400);
      const cacheKey = 'global:' + symbols.join(',');
      const cached = getCached(cacheKey, 30000);
      if (cached) return send(cached);
      const data = await yahooBatch(symbols);
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
      const data = await yahooBatch(pairs);
      return send({ status: true, data });
    }

    if (action === 'commodities') {
      const symbols = ['GC=F', 'SI=F', 'CL=F', 'NG=F'];
      const data = await yahooBatch(symbols);
      return send({ status: true, data });
    }

    if (action === 'portfolio') return send({ status: true, data: { holdings: [] } });
    if (action === 'funds') return send({ status: true, data: {} });

    send({ status: false, message: 'Unknown action: ' + action }, 400);
  } catch (e) {
    send({ status: false, message: e.message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`Dron Capital running on port ${PORT}`);
  console.log(`Twelve Data key: ${TWELVE_KEY ? TWELVE_KEY.slice(0, 8) + '...' : 'NOT SET'}`);
});
