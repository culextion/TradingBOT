// ===== CulexTrade Configuration =====

function _cv(v, fb) {
  try { return getComputedStyle(document.documentElement).getPropertyValue(v).trim() || fb; } catch(e) { return fb; }
}

export const COLORS = {
  get bull() { return _cv('--grn', '#3fb950'); },
  get bear() { return _cv('--red', '#f85149'); },
  get blue() { return _cv('--blu', '#58a6ff'); },
  get purple() { return _cv('--pur', '#bc8cff'); },
  get yellow() { return _cv('--ylw', '#d29922'); },
  get surface0() { return _cv('--s0', '#0d1117'); },
  get surface1() { return _cv('--s1', '#161b22'); },
  get surface2() { return _cv('--s2', '#1c2333'); },
  get surface3() { return _cv('--s3', '#242d3d'); },
  get border() { return _cv('--bd', '#30363d'); },
  get textPrimary() { return _cv('--t1', '#e6edf3'); },
  get textSecondary() { return _cv('--t2', '#8b949e'); },
};

export const CHART_COLORS = {
  get upColor() { return COLORS.bull; },
  get downColor() { return COLORS.bear; },
  get wickUpColor() { return COLORS.bull; },
  get wickDownColor() { return COLORS.bear; },
  get borderUpColor() { return COLORS.bull; },
  get borderDownColor() { return COLORS.bear; },
};

export const CRYPTO_ASSETS = [
  { symbol: 'BTC', name: 'Bitcoin', price: 67500, volatility: 0.035 },
  { symbol: 'ETH', name: 'Ethereum', price: 3450, volatility: 0.04 },
  { symbol: 'SOL', name: 'Solana', price: 178, volatility: 0.055 },
];

export const STOCK_ASSETS = [
  { symbol: 'SPY', name: 'S&P 500 ETF', price: 520, volatility: 0.012 },
  { symbol: 'IWM', name: 'Russell 2000 ETF', price: 208, volatility: 0.018 },
  { symbol: 'QQQ', name: 'NASDAQ 100 ETF', price: 445, volatility: 0.015 },
];

export const ALL_ASSETS = [...CRYPTO_ASSETS, ...STOCK_ASSETS];

export const TIMEFRAMES = ['1H', '4H', '1D', '1W'];

export const DEFAULT_LAYOUT = [
  { id: 'main-chart',    x: 0, y: 0, w: 8, h: 5, title: 'BTC / USD',          type: 'chart',       asset: 'BTC' },
  { id: 'correlation',   x: 8, y: 0, w: 4, h: 5, title: 'Correlation Matrix',  type: 'correlation' },
  { id: 'chart-eth',     x: 0, y: 5, w: 4, h: 4, title: 'ETH / USD',          type: 'chart',       asset: 'ETH' },
  { id: 'chart-spy',     x: 4, y: 5, w: 4, h: 4, title: 'SPY — S&P 500',      type: 'chart',       asset: 'SPY' },
  { id: 'signals',       x: 8, y: 5, w: 4, h: 4, title: 'Signals & Alerts',    type: 'signals' },
  { id: 'comparison',    x: 0, y: 9, w: 6, h: 4, title: 'IWM vs SPY — Small Cap Spread', type: 'comparison' },
  { id: 'indicators',    x: 6, y: 9, w: 6, h: 4, title: 'Technical Indicators', type: 'indicators', asset: 'BTC' },
];

// Correlation matrix — mock values representing realistic cross-market correlations
export const MOCK_CORRELATIONS = {
  'BTC-ETH': 0.87,  'BTC-SOL': 0.79,  'BTC-SPY': 0.48,  'BTC-IWM': 0.52,  'BTC-QQQ': 0.51,
  'ETH-SOL': 0.82,  'ETH-SPY': 0.41,  'ETH-IWM': 0.45,  'ETH-QQQ': 0.44,
  'SOL-SPY': 0.35,  'SOL-IWM': 0.39,  'SOL-QQQ': 0.37,
  'SPY-IWM': 0.91,  'SPY-QQQ': 0.96,
  'IWM-QQQ': 0.88,
};

export const STORAGE_KEYS = {
  layout: 'culextrade_layout',
  theme: 'culextrade_theme',
  watchlist: 'culextrade_watchlist',
  activeMarket: 'culextrade_active_market',
  chartStyle: 'culextrade_chart_style',
};
