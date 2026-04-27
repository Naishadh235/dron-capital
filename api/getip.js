export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  // Get the actual outgoing IP by calling an external service
  try {
    const r = await fetch('https://api.ipify.org?format=json');
    const data = await r.json();
    res.status(200).json({ 
      vercel_outgoing_ip: data.ip,
      request_headers: {
        forwarded: req.headers['x-forwarded-for'],
        real_ip: req.headers['x-real-ip'],
      }
    });
  } catch(e) {
    res.status(200).json({ error: e.message });
  }
}
