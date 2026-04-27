// Dron Capital - Angel One SmartAPI Proxy

const ANGEL_API_KEY     = process.env.ANGEL_API_KEY     || 'fspMdQlz';
const ANGEL_CLIENT      = process.env.ANGEL_CLIENT_CODE || 'T205834';
const ANGEL_TOTP_SECRET = process.env.ANGEL_TOTP_SECRET || 'DRKLJ7YBNN6QCYXXSIQO6SRO5Q';
const ANGEL_PIN         = process.env.ANGEL_PIN         || '2582';
const ANGEL_BASE        = 'https://apiconnect.angelone.in';

function base32Decode(s) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s = s.toUpperCase().replace(/=+$/, '');
  let bits = 0, val = 0;
  const out = [];
  for (const c of s) {
    val = (val << 5) | alpha.indexOf(c);
    bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}

async function generateTOTP(secret) {
  const key = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  let step = Math.floor(epoch / 30);
  const msg = new Uint8Array(8);
  for (let i = 7; i >= 0; i--) { msg[i] = step & 0xff; step = Math.floor(step / 256); }
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', cryptoKey, msg));
  const offset = sig[19] & 0xf;
  const code = ((sig[offset] & 0x7f) << 24 | sig[offset+1] << 16 | sig[offset+2] << 8 | sig[offset+3]) % 1000000;
  return code.toString().padStart(6, '0');
}

let tokenCache = { jwt: null, feed: null, expiry: 0 };

async function getToken() {
  if (tokenCache.jwt && Date.now() < tokenCache.expiry) return tokenCache;
  const totp = await generateTOTP(ANGEL_TOTP_SECRET);
  const res = await fetch(`${ANGEL_BASE}/rest/auth/angelbroking/user/v1/loginByPassword`, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/json',
      'Accept':           'application/json',
      'X-UserType':       'USER',
      'X-SourceID':       'WEB',
      'X-ClientLocalIP':  '192.168.1.1',
      'X-ClientPublicIP': '106.193.147.98',
      'X-MACAddress':     '00:00:00:00:00:00',
      'X-PrivateKey':     ANGEL_API_KEY,
    },
    body: JSON.stringify({ clientcode: ANGEL_CLIENT, password: ANGEL_PIN, totp }),
  });
  const data = await res.json();
  if (!data.status || !data.data?.jwtToken) throw new Error(data.message || 'Login failed');
  tokenCache = { jwt: data.data.jwtToken, feed: data.data.feedToken, expiry: Date.now() + 23 * 3600 * 1000 };
  return tokenCache;
}

async function angelPost(path, body) {
  const { jwt } = await getToken();
  const res = await fetch(`${ANGEL_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'X-UserType':    'USER',
      'X-SourceID':    'WEB',
      'X-ClientLocalIP':  '192.168.1.1',
      'X-ClientPublicIP': '106.193.147.98',
      'X-MACAddress':     '00:00:00:00:00:00',
      'X-PrivateKey':  ANGEL_API_KEY,
    },
    body: JSON.stringify(body),
  });
  return res.json();
}

async function angelGet(path) {
  const { jwt } = await getToken();
  const res = await fetch(`${ANGEL_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type':  'application/json',
      'Accept':        'application/json',
      'X-UserType':    'USER',
      'X-SourceID':    'WEB',
      'X-ClientLocalIP':  '192.168.1.1',
      'X-ClientPublicIP': '106.193.147.98',
      'X-MACAddress':     '00:00:00:00:00:00',
      'X-PrivateKey':  ANGEL_API_KEY,
    },
  });
  return res.json();
}

const NSE_TOKENS = {
  'RELIANCE':'2885','TCS':'11536','HDFCBANK':'1333','INFY':'10999',
  'ICICIBANK':'4963','BHARTIARTL':'10604','SBIN':'3045','WIPRO':'3787',
  'HINDUNILVR':'1394','ITC':'1660','AXISBANK':'5900','KOTAKBANK':'1922',
  'LT':'11483','SUNPHARMA':'3351','TATAMOTORS':'3456','MARUTI':'11483',
  'TATASTEEL':'3499','ONGC':'2475','POWERGRID':'14977','NTPC':'11630',
  'BAJFINANCE':'317','ASIANPAINT':'236','HCLTECH':'7229','NESTLEIND':'17963',
  'DRREDDY':'881','CIPLA':'694','ULTRACEMCO':'2952','ADANIENT':'25',
  'JSWSTEEL':'11723','BAJAJFINSV':'16675','TECHM':'13538','EICHERMOT':'910',
  'GRASIM':'1232','BPCL':'526','DIVISLAB':'10243','HINDPETRO':'1406',
  'COALINDIA':'20374','APOLLOHOSP':'157','TITAN':'3506','MM':'2031',
  'TATACONSUM':'3432','HEROMOTOCO':'1348','BAJAJAUTO':'16669',
  'PIDILITIND':'2664','HAVELLS':'14418','SIEMENS':'3150',
};

async function yahooQuote(symbol) {
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!r.ok) return null;
    const d = await r.json();
    const m = d?.chart?.result?.[0]?.meta;
    if (!m?.regularMarketPrice) return null;
    const prev = m.previousClose || m.chartPreviousClose || m.regularMarketPrice;
    return { price: m.regularMarketPrice, change: m.regularMarketPrice - prev, changePercent: ((m.regularMarketPrice - prev) / prev) * 100, volume: m.regularMarketVolume || 0, high52w: m.fiftyTwoWeekHigh || 0, low52w: m.fiftyTwoWeekLow || 0, pe: m.trailingPE || 0 };
  } catch { return null; }
}

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
}
function ok(res, data) { cors(res); res.status(200).json(data); }
function err(res, msg, code = 500) { cors(res); res.status(code).json({ status: false, message: msg }); }

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(200).end();
  const { action } = req.query;

  try {
    // Debug - shows credentials and TOTP without logging in
    if (action === 'debug') {
      const totp = await generateTOTP(ANGEL_TOTP_SECRET);
      return ok(res, { status: true, client: ANGEL_CLIENT, apiKey: ANGEL_API_KEY, totp, pin: ANGEL_PIN ? '****' : 'NOT SET', time: new Date().toISOString() });
    }

    // Login and get JWT token
    if (action === 'token') {
      const t = await getToken();
      return ok(res, { status: true, feedToken: t.feed, message: 'Login successful' });
    }

    // Fetch all NSE stocks LTP
    if (action === 'nse_all') {
      const syms = Object.keys(NSE_TOKENS);
      const results = {};
      for (let i = 0; i < syms.length; i += 10) {
        const batch = syms.slice(i, i + 10);
        try {
          const d = await angelPost('/rest/secure/angelbroking/market/v1/quote/', {
            mode: 'LTP',
            exchangeTokens: { NSE: batch.map(s => NSE_TOKENS[s]) },
          });
          if (d.status && d.data?.fetched) {
            d.data.fetched.forEach(item => {
              const sym = Object.keys(NSE_TOKENS).find(k => NSE_TOKENS[k] === item.symboltoken);
              if (sym) results[sym] = { ltp: item.ltp, change: item.ltp - item.close, changePercent: item.percentchange, volume: item.tradedQty || 0, high: item.high, low: item.low, open: item.open, close: item.close };
            });
          }
        } catch {}
      }
      // Indices
      try {
        const idx = await angelPost('/rest/secure/angelbroking/market/v1/quote/', { mode: 'LTP', exchangeTokens: { NSE: ['26000', '26009', '26037'] } });
        if (idx.status && idx.data?.fetched) {
          const map = { '26000': 'NIFTY50', '26009': 'BANKNIFTY', '26037': 'FINNIFTY' };
          idx.data.fetched.forEach(item => { const s = map[item.symboltoken]; if (s) results[s] = { ltp: item.ltp, changePercent: item.percentchange }; });
        }
      } catch {}
      return ok(res, { status: true, data: results, count: Object.keys(results).length });
    }

    // Portfolio holdings
    if (action === 'portfolio') {
      const d = await angelGet('/rest/secure/angelbroking/portfolio/v1/getHolding');
      return ok(res, d);
    }

    // Available funds
    if (action === 'funds') {
      const d = await angelGet('/rest/secure/angelbroking/user/v1/getRMS');
      return ok(res, d);
    }

    // Crypto via CoinGecko
    if (action === 'crypto') {
      const page = parseInt(req.query.page || '1');
      const r = await fetch(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=${page}&sparkline=false&price_change_percentage=24h`);
      const coins = r.ok ? await r.json() : [];
      return ok(res, { status: true, data: coins, count: coins.length });
    }

    // Yahoo Finance single quote
    if (action === 'yahoo') {
      const q = await yahooQuote(req.query.symbol);
      if (!q) return err(res, 'Not found', 404);
      return ok(res, { status: true, data: q });
    }

    // Yahoo Finance batch quotes
    if (action === 'yahoo_batch') {
      const symbols = (req.query.symbols || '').split(',').filter(Boolean);
      const results = {};
      await Promise.allSettled(symbols.map(async s => { const q = await yahooQuote(s); if (q) results[s] = q; }));
      return ok(res, { status: true, data: results, count: Object.keys(results).length });
    }

    return err(res, 'Unknown action', 400);

  } catch (e) {
    return err(res, e.message);
  }
}
