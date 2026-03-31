-- ===== TradingBOT Supabase Schema =====
-- Run this in the Supabase SQL Editor after creating your project

-- Enable Row Level Security on all tables
-- Users table is handled by Supabase Auth automatically

-- User settings & preferences
CREATE TABLE IF NOT EXISTS user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  default_market TEXT DEFAULT 'crypto',
  fee_profile TEXT DEFAULT 'coinbase_adv',
  theme JSONB DEFAULT '{}',
  risk_config JSONB DEFAULT '{"positionSizePct":10,"stopLossPct":5,"takeProfitPct":10,"trailingStopPct":3,"maxDailyLoss":2000,"maxPositions":5}',
  bot_strategy TEXT DEFAULT 'hybrid',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id)
);

-- Watchlists
CREATE TABLE IF NOT EXISTS watchlists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  market TEXT NOT NULL DEFAULT 'crypto',
  position INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Paper trading accounts
CREATE TABLE IF NOT EXISTS paper_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT DEFAULT 'Default',
  starting_balance NUMERIC DEFAULT 100000,
  cash NUMERIC DEFAULT 100000,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, name)
);

-- Positions (open)
CREATE TABLE IF NOT EXISTS positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES paper_accounts(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  avg_price NUMERIC NOT NULL,
  current_price NUMERIC,
  unrealized_pnl NUMERIC,
  entry_time TIMESTAMPTZ DEFAULT now()
);

-- Trade history
CREATE TABLE IF NOT EXISTS trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  account_id UUID REFERENCES paper_accounts(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  symbol TEXT NOT NULL,
  side TEXT NOT NULL, -- 'BUY' or 'SELL'
  quantity NUMERIC NOT NULL,
  price NUMERIC NOT NULL,
  amount NUMERIC NOT NULL,
  fees NUMERIC DEFAULT 0,
  pnl NUMERIC, -- NULL for buys
  fee_profile TEXT,
  strategy TEXT,
  reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Bot activity logs
CREATE TABLE IF NOT EXISTS bot_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  log_type TEXT DEFAULT 'info', -- 'info', 'trade', 'warning', 'error'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Cached OHLC data (to reduce API calls)
CREATE TABLE IF NOT EXISTS price_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_id TEXT NOT NULL,
  timeframe TEXT NOT NULL, -- '7d', '30d', '90d'
  data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(asset_id, timeframe)
);

-- Exchange connections (encrypted API keys - stored server-side only)
CREATE TABLE IF NOT EXISTS exchange_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  exchange TEXT NOT NULL, -- 'alpaca', 'coinbase', etc.
  api_key_encrypted TEXT,
  api_secret_encrypted TEXT,
  is_paper BOOLEAN DEFAULT true,
  is_active BOOLEAN DEFAULT false,
  connected_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(user_id, exchange)
);

-- ===== ROW LEVEL SECURITY =====
ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE paper_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE trades ENABLE ROW LEVEL SECURITY;
ALTER TABLE bot_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE exchange_connections ENABLE ROW LEVEL SECURITY;
-- price_cache is public (shared across users)

-- Users can only access their own data
CREATE POLICY "Users own their settings" ON user_settings FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their watchlists" ON watchlists FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their accounts" ON paper_accounts FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their positions" ON positions FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their trades" ON trades FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their logs" ON bot_logs FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "Users own their connections" ON exchange_connections FOR ALL USING (auth.uid() = user_id);

-- Price cache is readable by all authenticated users, writable by all
CREATE POLICY "Anyone can read cache" ON price_cache FOR SELECT USING (true);
CREATE POLICY "Anyone can write cache" ON price_cache FOR INSERT WITH CHECK (true);
CREATE POLICY "Anyone can update cache" ON price_cache FOR UPDATE USING (true);
ALTER TABLE price_cache ENABLE ROW LEVEL SECURITY;

-- ===== EDGE FUNCTION PROXY (for stock data) =====
-- Create this as a Supabase Edge Function named 'stock-proxy'
-- It will proxy requests to Yahoo Finance / Finnhub to bypass CORS

-- ===== INDEXES =====
CREATE INDEX IF NOT EXISTS idx_trades_user ON trades(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_positions_user ON positions(user_id);
CREATE INDEX IF NOT EXISTS idx_watchlists_user ON watchlists(user_id, market);
CREATE INDEX IF NOT EXISTS idx_bot_logs_user ON bot_logs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_price_cache_asset ON price_cache(asset_id, timeframe);
