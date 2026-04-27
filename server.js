// Dron Capital - Angel One Proxy Server (Railway / Render / VPS)
// Run: node server.js

const http = require('http');
const https = require('https');
const url = require('url');

const ANGEL_API_KEY     = process.env.ANGEL_API_KEY     || 'fspMdQlz';
const ANGEL_CLIENT      = process.env.ANGEL_CLIENT_CODE || 'T205834';
const ANGEL_TOTP_SECRET = process.env.ANGEL_TOTP_SECRET || 'DRKLJ7YBNN6QCYXXSIQO6SRO5Q';
const ANGEL_PIN         = process.env.ANGEL_PIN         || '2582';
const ANGEL_BASE        = 'https://apiconnect.angelone.in';
const PORT              = process.env.PORT || 3000;

// TOTP
function base32Decode(s) {
  const alpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s = s.toUpperCase().replace(/=+$/, '');
  let bits = 0, val = 0; const out = [];
  for (const c of s) { val = (val << 5) | alpha.indexOf(c); bits += 5; if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}

function hmacSHA1(key, data) {
  const crypto = require('crypto');
  return crypto.createHmac('sha1', key).update(data).digest();
}

function generateTOTP(secret) {
  const key = base32Decode(secret);
  const epoch = Math.floor(Date.now() / 1000);
  let step = Math.floor(epoch / 30);
  const msg = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) { msg[i] = step & 0xff; step = Math.floor(step / 256); }
  const sig = hmacSHA1(key, msg);
  const off = sig[19] & 0xf;
  const code = ((sig[off] & 0x7f) << 24 | sig[off+1] << 16 | sig[off+2] << 8 | sig[off+3]) % 1000000;
  return code.toString().padStart(6, '0');
}

// Token cache
let tokenCache = { jwt: null, feed: null, expiry: 0 };

async function fetchJSON(reqUrl, options = {}, body = null) {
  return new Promise((resolve, reject) => {
    const parsed = new url.URL(reqUrl);
    const opts = {
      hostname: parsed.hostname,
      path: parsed.pathname + parsed.search,
      method: options.method || 'GET',
      headers: options.headers || {},
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch { resolve({}); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function getToken() {
  if (tokenCache.jwt && Date.now() < tokenCache.expiry) return tokenCache;
  const totp = generateTOTP(ANGEL_TOTP_SECRET);
  const data = await fetchJSON(`${ANGEL_BASE}/rest/auth/angelbroking/user/v1/loginByPassword`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json', 'Accept': 'application/json',
      'X-UserType': 'USER', 'X-SourceID': 'WEB',
      'X-ClientLocalIP': '192.168.1.1', 'X-ClientPublicIP': '106.193.147.98',
      'X-MACAddress': '00:00:00:00:00:00', 'X-PrivateKey': ANGEL_API_KEY,
    }
  }, { clientcode: ANGEL_CLIENT, password: ANGEL_PIN, totp });
  if (!data.status || !data.data?.jwtToken) throw new Error(data.message || 'Login failed');
  tokenCache = { jwt: data.data.jwtToken, feed: data.data.feedToken, expiry: Date.now() + 23 * 3600 * 1000 };
  return tokenCache;
}

async function angelPost(path, body) {
  const { jwt } = await getToken();
  return fetchJSON(`${ANGEL_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json', 'Accept': 'application/json',
      'X-UserType': 'USER', 'X-SourceID': 'WEB',
      'X-ClientLocalIP': '192.168.1.1', 'X-ClientPublicIP': '106.193.147.98',
      'X-MACAddress': '00:00:00:00:00:00', 'X-PrivateKey': ANGEL_API_KEY,
    }
  }, body);
}

async function angelGet(path) {
  const { jwt } = await getToken();
  return fetchJSON(`${ANGEL_BASE}${path}`, {
    headers: {
      'Authorization': `Bearer ${jwt}`, 'Content-Type': 'application/json', 'Accept': 'application/json',
      'X-UserType': 'USER', 'X-SourceID': 'WEB',
      'X-ClientLocalIP': '192.168.1.1', 'X-ClientPublicIP': '106.193.147.98',
      'X-MACAddress': '00:00:00:00:00:00', 'X-PrivateKey': ANGEL_API_KEY,
    }
  });
}

const NSE_TOKENS = {
  'RELIANCE':'2885','TCS':'11536','HDFCBANK':'1333','INFY':'10999','ICICIBANK':'4963',
  'BHARTIARTL':'10604','SBIN':'3045','WIPRO':'3787','HINDUNILVR':'1394','ITC':'1660',
  'AXISBANK':'5900','KOTAKBANK':'1922','LT':'11483','SUNPHARMA':'3351','TATAMOTORS':'3456',
  'TATASTEEL':'3499','ONGC':'2475','POWERGRID':'14977','NTPC':'11630','BAJFINANCE':'317',
  'ASIANPAINT':'236','HCLTECH':'7229','DRREDDY':'881','CIPLA':'694','ADANIENT':'25',
  'JSWSTEEL':'11723','BAJAJFINSV':'16675','TECHM':'13538','EICHERMOT':'910','GRASIM':'1232',
  'BPCL':'526','COALINDIA':'20374','APOLLOHOSP':'157','TITAN':'3506','TATACONSUM':'3432',
  'HEROMOTOCO':'1348','DIVISLAB':'10243','HINDPETRO':'1406','NESTLEIND':'17963','MM':'2031',
};

// HTTP Server
const server = http.createServer(async (req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const parsed = url.parse(req.url, true);
  const action = parsed.query.action;

  const send = (data, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  };

  try {
    if (action === 'token') {
      const t = await getToken();
      return send({ status: true, feedToken: t.feed, message: 'Login successful' });
    }

    if (action === 'debug') {
      const totp = generateTOTP(ANGEL_TOTP_SECRET);
      const ip = await fetchJSON('https://api.ipify.org?format=json');
      return send({ status: true, client: ANGEL_CLIENT, apiKey: ANGEL_API_KEY, totp, pin: '****', serverIP: ip.ip });
    }

    if (action === 'nse_all') {
      const syms = Object.keys(NSE_TOKENS);
      const results = {};
      for (let i = 0; i < syms.length; i += 10) {
        const batch = syms.slice(i, i + 10);
        try {
          const d = await angelPost('/rest/secure/angelbroking/market/v1/quote/', {
            mode: 'LTP', exchangeTokens: { NSE: batch.map(s => NSE_TOKENS[s]) }
          });
          if (d?.status && d.data?.fetched) {
            d.data.fetched.forEach(item => {
              const sym = Object.keys(NSE_TOKENS).find(k => NSE_TOKENS[k] === item.symboltoken);
              if (sym) results[sym] = { ltp: item.ltp, change: item.ltp - item.close, changePercent: item.percentchange, volume: item.tradedQty || 0 };
            });
          }
        } catch {}
      }
      const idx = await angelPost('/rest/secure/angelbroking/market/v1/quote/', { mode: 'LTP', exchangeTokens: { NSE: ['26000', '26009'] } });
      if (idx?.status && idx.data?.fetched) {
        const m = { '26000': 'NIFTY50', '26009': 'BANKNIFTY' };
        idx.data.fetched.forEach(item => { const s = m[item.symboltoken]; if (s) results[s] = { ltp: item.ltp, changePercent: item.percentchange }; });
      }
      return send({ status: true, data: results, count: Object.keys(results).length });
    }

    if (action === 'portfolio') return send(await angelGet('/rest/secure/angelbroking/portfolio/v1/getHolding'));
    if (action === 'funds')     return send(await angelGet('/rest/secure/angelbroking/user/v1/getRMS'));

    if (action === 'crypto') {
      const page = parsed.query.page || '1';
      const coins = await fetchJSON(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=100&page=${page}&sparkline=false`);
      return send({ status: true, data: coins, count: coins.length });
    }

    send({ status: false, message: 'Unknown action' }, 400);
  } catch (e) {
    send({ status: false, message: e.message }, 500);
  }
});

server.listen(PORT, () => console.log(`Dron Capital API running on port ${PORT}`));
