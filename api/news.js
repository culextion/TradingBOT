// Vercel Serverless Function — Proxies Finnhub news (bypasses CORS)

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const { category } = req.query;
  const key = process.env.FINNHUB_STOCK_KEY;

  if (!key) return res.status(500).json({ error: 'API key not configured' });

  try {
    const url = `https://finnhub.io/api/v1/news?category=${category || 'general'}&token=${key}`;
    const response = await fetch(url);
    const data = await response.json();

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate');
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: 'News fetch failed' });
  }
}
