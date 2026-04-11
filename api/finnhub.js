// Vercel Serverless Function — Proxies Finnhub API requests
// API keys stored in Vercel environment variables, never exposed to client

export default async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { endpoint, symbol, type } = req.query;

  // Select the right key based on type (stock vs crypto)
  const key = type === 'crypto'
    ? process.env.FINNHUB_CRYPTO_KEY
    : process.env.FINNHUB_STOCK_KEY;

  if (!key) {
    return res.status(500).json({ error: 'API key not configured. Set FINNHUB_STOCK_KEY and FINNHUB_CRYPTO_KEY in Vercel environment variables.' });
  }

  // Allowed endpoints (whitelist for security)
  const allowed = ['quote', 'search', 'news', 'stock/candle', 'crypto/symbol'];
  if (!endpoint || !allowed.some(a => endpoint.startsWith(a))) {
    return res.status(400).json({ error: 'Invalid endpoint' });
  }

  try {
    const url = `https://finnhub.io/api/v1/${endpoint}?${symbol ? 'symbol=' + symbol + '&' : ''}token=${key}`;
    const response = await fetch(url);
    const data = await response.json();

    // Cache for 10 seconds
    res.setHeader('Cache-Control', 's-maxage=10, stale-while-revalidate');
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'Finnhub request failed' });
  }
}
