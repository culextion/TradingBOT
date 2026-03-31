// ===== Supabase Integration Layer =====
// Loaded after the Supabase CDN script

var SB = {
  client: null,
  user: null,
  accountId: null,

  // Initialize with project credentials
  init: function(url, anonKey) {
    if (!url || !anonKey) { console.warn('Supabase credentials not set'); return; }
    this.client = supabase.createClient(url, anonKey);
    this.checkSession();
  },

  // ---- AUTH ----
  checkSession: async function() {
    var { data } = await this.client.auth.getSession();
    if (data.session) {
      this.user = data.session.user;
      this.onLogin();
    }
    // Listen for auth changes
    var self = this;
    this.client.auth.onAuthStateChange(function(event, session) {
      if (event === 'SIGNED_IN' && session) { self.user = session.user; self.onLogin(); }
      else if (event === 'SIGNED_OUT') { self.user = null; self.onLogout(); }
    });
  },

  signUp: async function(email, password) {
    var { data, error } = await this.client.auth.signUp({ email: email, password: password });
    if (error) return { error: error.message };
    return { data: data };
  },

  signIn: async function(email, password) {
    var { data, error } = await this.client.auth.signInWithPassword({ email: email, password: password });
    if (error) return { error: error.message };
    this.user = data.user;
    this.onLogin();
    return { data: data };
  },

  signInWithGoogle: async function() {
    var { data, error } = await this.client.auth.signInWithOAuth({ provider: 'google' });
    if (error) return { error: error.message };
    return { data: data };
  },

  signInWithGithub: async function() {
    var { data, error } = await this.client.auth.signInWithOAuth({ provider: 'github' });
    if (error) return { error: error.message };
    return { data: data };
  },

  signOut: async function() {
    await this.client.auth.signOut();
    this.user = null;
    this.onLogout();
  },

  onLogin: async function() {
    console.log('Logged in as', this.user.email);
    // Ensure paper account exists
    await this.ensurePaperAccount();
    // Load user data
    await this.loadSettings();
    await this.loadWatchlist();
    await this.loadPositions();
    await this.loadTrades();
    // Update UI
    if (typeof updateAuthUI === 'function') updateAuthUI(true);
  },

  onLogout: function() {
    console.log('Logged out');
    if (typeof updateAuthUI === 'function') updateAuthUI(false);
  },

  // ---- PAPER ACCOUNT ----
  ensurePaperAccount: async function() {
    var { data } = await this.client.from('paper_accounts')
      .select('id,cash,starting_balance')
      .eq('user_id', this.user.id)
      .eq('is_active', true)
      .single();
    if (data) {
      this.accountId = data.id;
      account.cash = parseFloat(data.cash);
      account.start = parseFloat(data.starting_balance);
    } else {
      var { data: newAcc } = await this.client.from('paper_accounts')
        .insert({ user_id: this.user.id, name: 'Default', starting_balance: 100000, cash: 100000 })
        .select().single();
      if (newAcc) this.accountId = newAcc.id;
    }
  },

  updateCash: async function(newCash) {
    if (!this.accountId) return;
    await this.client.from('paper_accounts').update({ cash: newCash }).eq('id', this.accountId);
  },

  // ---- SETTINGS ----
  loadSettings: async function() {
    var { data } = await this.client.from('user_settings')
      .select('*').eq('user_id', this.user.id).single();
    if (data) {
      if (data.default_market) mkt = data.default_market;
      if (data.fee_profile) { var el = document.getElementById('fee-sel'); if (el) el.value = data.fee_profile; }
      if (data.bot_strategy) { var el = document.getElementById('strat-sel'); if (el) el.value = data.bot_strategy; }
      if (data.risk_config) {
        var rc = data.risk_config;
        if (rc.positionSizePct) setVal('r-size', rc.positionSizePct);
        if (rc.stopLossPct) setVal('r-sl', rc.stopLossPct);
        if (rc.takeProfitPct) setVal('r-tp', rc.takeProfitPct);
        if (rc.maxDailyLoss) setVal('r-dll', rc.maxDailyLoss);
        if (rc.maxPositions) setVal('r-max', rc.maxPositions);
        if (rc.trailingStopPct) setVal('r-trail', rc.trailingStopPct);
      }
    }
  },

  saveSettings: async function() {
    if (!this.user) return;
    var settings = {
      user_id: this.user.id,
      default_market: mkt,
      fee_profile: gv('fee-sel'),
      bot_strategy: gv('strat-sel'),
      risk_config: {
        positionSizePct: parseFloat(gv('r-size')) || 10,
        stopLossPct: parseFloat(gv('r-sl')) || 5,
        takeProfitPct: parseFloat(gv('r-tp')) || 10,
        trailingStopPct: parseFloat(gv('r-trail')) || 3,
        maxDailyLoss: parseFloat(gv('r-dll')) || 2000,
        maxPositions: parseInt(gv('r-max')) || 5,
      },
      updated_at: new Date().toISOString(),
    };
    await this.client.from('user_settings').upsert(settings, { onConflict: 'user_id' });
  },

  // ---- WATCHLIST ----
  loadWatchlist: async function() {
    var { data } = await this.client.from('watchlists')
      .select('*').eq('user_id', this.user.id).order('position');
    if (data && data.length) {
      wl = data.map(function(w) { return { id: w.asset_id, sym: w.symbol, name: w.name, mkt: w.market }; });
      if (typeof updateWL === 'function') updateWL();
    }
  },

  saveWatchlist: async function(watchlistItems) {
    if (!this.user) return;
    // Delete existing and re-insert
    await this.client.from('watchlists').delete().eq('user_id', this.user.id);
    if (watchlistItems.length) {
      var rows = watchlistItems.map(function(w, i) {
        return { user_id: SB.user.id, asset_id: w.id, symbol: w.sym, name: w.name, market: w.mkt, position: i };
      });
      await this.client.from('watchlists').insert(rows);
    }
  },

  // ---- TRADES ----
  saveTrade: async function(trade) {
    if (!this.user || !this.accountId) return;
    await this.client.from('trades').insert({
      user_id: this.user.id,
      account_id: this.accountId,
      asset_id: trade.id,
      symbol: trade.sym,
      side: trade.type,
      quantity: trade.qty,
      price: trade.price,
      amount: trade.amount,
      fees: trade.fees || 0,
      pnl: trade.pnl || null,
      fee_profile: gv('fee-sel'),
      strategy: bot.strat,
      reason: trade.reason || '',
    });
  },

  loadTrades: async function() {
    var { data } = await this.client.from('trades')
      .select('*').eq('user_id', this.user.id)
      .order('created_at', { ascending: false }).limit(100);
    if (data && data.length) {
      account.trades = data.map(function(t) {
        return {
          type: t.side, id: t.asset_id, sym: t.symbol,
          qty: parseFloat(t.quantity), price: parseFloat(t.price),
          amount: parseFloat(t.amount), fees: parseFloat(t.fees),
          pnl: t.pnl !== null ? parseFloat(t.pnl) : undefined,
          time: new Date(t.created_at).toLocaleTimeString(),
        };
      });
      if (typeof updateTradeLog === 'function') updateTradeLog();
    }
  },

  // ---- POSITIONS ----
  savePositions: async function(positions) {
    if (!this.user || !this.accountId) return;
    await this.client.from('positions').delete().eq('user_id', this.user.id);
    if (positions.length) {
      var rows = positions.map(function(p) {
        return { user_id: SB.user.id, account_id: SB.accountId, asset_id: p.id, symbol: p.sym, quantity: p.qty, avg_price: p.avgPrice };
      });
      await this.client.from('positions').insert(rows);
    }
  },

  loadPositions: async function() {
    var { data } = await this.client.from('positions')
      .select('*').eq('user_id', this.user.id);
    if (data && data.length) {
      account.positions = data.map(function(p) {
        return { id: p.asset_id, sym: p.symbol, qty: parseFloat(p.quantity), avgPrice: parseFloat(p.avg_price) };
      });
      if (typeof updatePos === 'function') updatePos();
    }
  },

  // ---- BOT LOGS ----
  saveLog: async function(message, type) {
    if (!this.user) return;
    await this.client.from('bot_logs').insert({ user_id: this.user.id, message: message, log_type: type || 'info' });
  },

  // ---- PRICE CACHE ----
  getCachedPrice: async function(assetId, timeframe) {
    var { data } = await this.client.from('price_cache')
      .select('data,fetched_at')
      .eq('asset_id', assetId).eq('timeframe', timeframe).single();
    if (!data) return null;
    // Check if cache is fresh (< 1 hour old)
    var age = (Date.now() - new Date(data.fetched_at).getTime()) / 1000;
    if (age > 3600) return null; // stale
    return data.data;
  },

  setCachedPrice: async function(assetId, timeframe, ohlcData) {
    await this.client.from('price_cache').upsert({
      asset_id: assetId, timeframe: timeframe, data: ohlcData, fetched_at: new Date().toISOString(),
    }, { onConflict: 'asset_id,timeframe' });
  },
};

// Helper
function setVal(id, val) { var el = document.getElementById(id); if (el) el.value = val; }
