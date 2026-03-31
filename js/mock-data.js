// ===== Mock OHLCV Data Generator =====
// Uses geometric Brownian motion for realistic price paths

import { ALL_ASSETS, MOCK_CORRELATIONS } from './config.js';

/**
 * Generate realistic OHLCV data using geometric Brownian motion.
 * @param {Object} asset - Asset config { symbol, price, volatility }
 * @param {number} bars - Number of bars to generate
 * @param {number} intervalMinutes - Bar interval in minutes (60 = 1H)
 * @returns {Array} Array of { time, open, high, low, close, volume }
 */
export function generateOHLCV(asset, bars = 720, intervalMinutes = 60) {
  const data = [];
  let price = asset.price;
  const dt = intervalMinutes / (24 * 60); // fraction of a day
  const mu = 0.0002; // slight upward drift
  const sigma = asset.volatility;

  // Start 30 days ago
  const startTime = Math.floor(Date.now() / 1000) - bars * intervalMinutes * 60;

  // Seed random for reproducible results per symbol
  let seed = hashCode(asset.symbol);
  const rand = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return seed / 2147483647;
  };

  // Box-Muller for normal distribution
  const randn = () => {
    const u1 = rand();
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1 + 0.0001)) * Math.cos(2 * Math.PI * u2);
  };

  for (let i = 0; i < bars; i++) {
    const time = startTime + i * intervalMinutes * 60;

    // GBM step
    const drift = (mu - 0.5 * sigma * sigma) * dt;
    const diffusion = sigma * Math.sqrt(dt) * randn();
    const returnPct = drift + diffusion;

    const open = price;
    price = price * Math.exp(returnPct);
    const close = price;

    // Generate realistic high/low within the bar
    const range = Math.abs(close - open) + price * sigma * Math.sqrt(dt) * Math.abs(randn()) * 0.5;
    const high = Math.max(open, close) + range * rand() * 0.6;
    const low = Math.min(open, close) - range * rand() * 0.6;

    // Volume with realistic intraday pattern (higher at open/close)
    const hourOfDay = (Math.floor(time / 3600) % 24);
    const volumeMultiplier = (hourOfDay >= 9 && hourOfDay <= 10) || (hourOfDay >= 15 && hourOfDay <= 16)
      ? 1.5 + rand() * 0.8
      : 0.6 + rand() * 0.6;
    const baseVolume = price * (500 + rand() * 2000);
    const volume = Math.round(baseVolume * volumeMultiplier);

    data.push({
      time,
      open:  round(open, asset.price > 100 ? 2 : asset.price > 1 ? 4 : 6),
      high:  round(high, asset.price > 100 ? 2 : asset.price > 1 ? 4 : 6),
      low:   round(low,  asset.price > 100 ? 2 : asset.price > 1 ? 4 : 6),
      close: round(close, asset.price > 100 ? 2 : asset.price > 1 ? 4 : 6),
      volume,
    });
  }

  return data;
}

/**
 * Generate all asset data at once for consistent cross-asset timing.
 */
export function generateAllAssetData(bars = 720, intervalMinutes = 60) {
  const allData = {};
  for (const asset of ALL_ASSETS) {
    allData[asset.symbol] = generateOHLCV(asset, bars, intervalMinutes);
  }
  return allData;
}

/**
 * Get the latest price for an asset from generated data.
 */
export function getLatestPrice(data) {
  if (!data || data.length === 0) return 0;
  return data[data.length - 1].close;
}

/**
 * Calculate percentage change between first and last bar.
 */
export function getPriceChange(data) {
  if (!data || data.length < 2) return { value: 0, percent: 0 };
  const first = data[0].open;
  const last = data[data.length - 1].close;
  return {
    value: last - first,
    percent: ((last - first) / first) * 100,
  };
}

/**
 * Get the 24h change from data.
 */
export function get24hChange(data) {
  if (!data || data.length < 24) return { value: 0, percent: 0 };
  const prev = data[data.length - 24].close;
  const curr = data[data.length - 1].close;
  return {
    value: curr - prev,
    percent: ((curr - prev) / prev) * 100,
  };
}

/**
 * Generate mock signal/alert data.
 */
export function generateMockSignals() {
  return [
    {
      type: 'bullish',
      time: '2m ago',
      title: 'Correlation Signal',
      message: 'BTC up 2.1% in 3h — ETH historically follows with +1.6% (r=0.87, lag=2h)',
      confidence: 82,
    },
    {
      type: 'bearish',
      time: '15m ago',
      title: 'Divergence Alert',
      message: 'SPY/IWM spread widening — small caps lagging. Risk-off signal for crypto.',
      confidence: 71,
    },
    {
      type: 'bullish',
      time: '1h ago',
      title: 'Pattern Match',
      message: 'IWM breaking above 50-day MA while SPY consolidates — historically precedes crypto rally within 1-3 days.',
      confidence: 68,
    },
    {
      type: 'bullish',
      time: '3h ago',
      title: 'Regime Change',
      message: 'Market regime shifted from sideways to risk-on. Russell 2000 leading S&P 500 by 0.8%.',
      confidence: 74,
    },
    {
      type: 'bearish',
      time: '5h ago',
      title: 'Cross-Market Lag',
      message: 'QQQ dropped 1.2% — BTC typically follows within 4-8h with 0.7x magnitude (r=0.51).',
      confidence: 63,
    },
  ];
}

// --- Utility functions ---

function hashCode(str) {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) & 0x7fffffff;
  }
  return hash || 1;
}

function round(num, decimals) {
  const f = Math.pow(10, decimals);
  return Math.round(num * f) / f;
}
