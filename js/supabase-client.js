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
    if (typeof showSyncStatus === 'function') showSyncStatus('Syncing...');
    try {
      // Ensure paper account exists
      await this.ensurePaperAccount();
      // Load ALL user data
      await this.loadSettings();
      await this.loadWatchlist();
      await this.loadPositions();
      await this.loadTrades();
      // Load pending orders from Supabase
      await this.loadPendingOrders();
      // Load price alerts from Supabase
      await this.loadPriceAlerts();
      // Load strategy performance to initialize adaptive weights (Batch 5 Task 1c)
      if (typeof loadStrategyPerformance === 'function') await loadStrategyPerformance();
      // Load server bot state
      if (typeof loadServerBotState === 'function') await loadServerBotState();
      // Batch 6: Load all paper accounts for switcher
      if (typeof loadPaperAccounts === 'function') await loadPaperAccounts();
      // Refresh UI
      if (typeof updateUI === 'function') updateUI();
      if (typeof updatePos === 'function') updatePos();
      if (typeof updateTradeLog === 'function') updateTradeLog();
      if (typeof renderAlerts === 'function') renderAlerts();
      if (typeof renderPendingOrders === 'function') renderPendingOrders();
      // Fetch live prices for ALL held positions (cross-market)
      if (typeof fetchHeldPositionPrices === 'function') setTimeout(fetchHeldPositionPrices, 1000);
      // Load equity curve history from Supabase
      if (typeof loadEquityFromSupabase === 'function') setTimeout(loadEquityFromSupabase, 2000);
      // Sync cloud state back to localStorage so offline/refresh works correctly
      if (typeof saveState === 'function') saveState();
      console.log('Cloud sync complete — account: $' + (typeof account !== 'undefined' ? account.cash : '?') + ', positions: ' + (typeof account !== 'undefined' ? account.positions.length : '?'));
    } catch(e) { console.error('Sync error on login:', e); }
    // Update UI
    if (typeof updateAuthUI === 'function') updateAuthUI(true);
    if (typeof showSyncStatus === 'function') showSyncStatus('Synced');
    setTimeout(function() { if (typeof showSyncStatus === 'function') showSyncStatus(''); }, 2000);
  },

  onLogout: async function() {
    console.log('Logged out');
    // Save everything before clearing
    try {
      if (this.client) {
        await this.saveSettings();
        if (typeof wl !== 'undefined' && wl.length) await this.saveWatchlist(wl);
        if (typeof account !== 'undefined') {
          await this.savePositions(account.positions || []);
          await this.updateCash(account.cash);
        }
        await this.savePendingOrders();
        await this.savePriceAlerts();
      }
    } catch(e) { console.error('Save error on logout:', e); }
    this.accountId = null;
    if (typeof updateAuthUI === 'function') updateAuthUI(false);
  },

  // ---- PAPER ACCOUNT ----
  ensurePaperAccount: async function() {
    // Try active account first
    var { data } = await this.client.from('paper_accounts')
      .select('id,cash,starting_balance,name')
      .eq('user_id', this.user.id)
      .eq('is_active', true)
      .single();
    if (!data) {
      // Fallback: any account
      var { data: anyAcc } = await this.client.from('paper_accounts')
        .select('id,cash,starting_balance,name')
        .eq('user_id', this.user.id)
        .order('created_at')
        .limit(1)
        .single();
      data = anyAcc;
    }
    if (data) {
      this.accountId = data.id;
      account.cash = parseFloat(data.cash);
      account.start = parseFloat(data.starting_balance);
      // Mark as active
      await this.client.from('paper_accounts').update({ is_active: true }).eq('id', data.id);
    } else {
      var { data: newAcc } = await this.client.from('paper_accounts')
        .insert({ user_id: this.user.id, name: 'Default', starting_balance: 100000, cash: 100000, is_active: true })
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
      // Restore strategy weights if saved
      if (data.strat_weights_json && typeof bot !== 'undefined') {
        try { var sw = JSON.parse(data.strat_weights_json); if (sw) Object.assign(bot.stratWeights, sw); } catch(e) {}
      }
      // Restore bot running state from Supabase (cross-device sync)
      if (data.bot_state_json && typeof bot !== 'undefined') {
        try {
          var bs = JSON.parse(data.bot_state_json);
          if (bs) {
            bot.strat = bs.strat || bot.strat;
            bot.pnl = bs.pnl || 0;
            bot.trades = bs.trades || 0;
            bot.consecutiveLosses = bs.consecutiveLosses || 0;
            if (bs.cooldowns) bot.cooldowns = bs.cooldowns;
            // Set fee profiles per market
            if (bs.fee_profile_crypto) { var fc = document.getElementById('fee-sel-crypto'); if (fc) fc.value = bs.fee_profile_crypto; }
            if (bs.fee_profile_stocks) { var fs = document.getElementById('fee-sel-stocks'); if (fs) fs.value = bs.fee_profile_stocks; }
            // Update strategy selector
            var stratSel = document.getElementById('strat-sel'); if (stratSel && bs.strat) stratSel.value = bs.strat;
            // Auto-restart bot if it was running on another device
            if (bs.on && !bot.on) {
              console.log('Bot was running on another device — restarting...');
              setTimeout(function() { if (typeof startBot === 'function') startBot(); }, 3000);
            }
          }
        } catch(e) { console.error('Error restoring bot state:', e); }
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
      strat_weights_json: typeof bot !== 'undefined' ? JSON.stringify(bot.stratWeights) : null,
      bot_state_json: typeof bot !== 'undefined' ? JSON.stringify({
        on: bot.on, strat: bot.strat, pnl: bot.pnl, trades: bot.trades,
        consecutiveLosses: bot.consecutiveLosses, cooldowns: bot.cooldowns,
        fee_profile_crypto: typeof gv === 'function' ? gv('fee-sel-crypto') || gv('fee-sel') : 'coinbase_adv',
        fee_profile_stocks: typeof gv === 'function' ? gv('fee-sel-stocks') || gv('fee-sel') : 'alpaca',
      }) : null,
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
    var query = this.client.from('trades')
      .select('*').eq('user_id', this.user.id)
      .order('created_at', { ascending: false }).limit(100);
    if (this.accountId) query = query.eq('account_id', this.accountId);
    var { data } = await query;
    if (data && data.length) {
      account.trades = data.map(function(t) {
        return {
          type: t.side, id: t.asset_id, sym: t.symbol,
          qty: parseFloat(t.quantity), price: parseFloat(t.price),
          amount: parseFloat(t.amount), fees: parseFloat(t.fees),
          pnl: t.pnl !== null ? parseFloat(t.pnl) : undefined,
          time: new Date(t.created_at).toLocaleTimeString(),
          reason: t.reason || '',
          strategy: t.strategy || '',
          serverBot: !!(t.reason && t.reason.indexOf('SERVER BOT') === 0),
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
    var query = this.client.from('positions')
      .select('*').eq('user_id', this.user.id);
    if (this.accountId) query = query.eq('account_id', this.accountId);
    var { data } = await query;
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

  // ---- PENDING ORDERS ----
  savePendingOrders: async function() {
    if (!this.user) return;
    var orders = typeof pendingOrders !== 'undefined' ? pendingOrders : [];
    await this.client.from('user_settings').upsert({
      user_id: this.user.id,
      pending_orders_json: JSON.stringify(orders),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
  },

  loadPendingOrders: async function() {
    if (!this.user) return;
    var { data } = await this.client.from('user_settings')
      .select('pending_orders_json').eq('user_id', this.user.id).single();
    if (data && data.pending_orders_json) {
      try {
        var loaded = JSON.parse(data.pending_orders_json);
        if (Array.isArray(loaded) && typeof pendingOrders !== 'undefined') {
          pendingOrders.length = 0;
          loaded.forEach(function(o) { pendingOrders.push(o); });
        }
      } catch(e) {}
    }
  },

  // ---- PRICE ALERTS ----
  savePriceAlerts: async function() {
    if (!this.user) return;
    var alerts = typeof priceAlerts !== 'undefined' ? priceAlerts : [];
    await this.client.from('user_settings').upsert({
      user_id: this.user.id,
      price_alerts_json: JSON.stringify(alerts),
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
  },

  loadPriceAlerts: async function() {
    if (!this.user) return;
    var { data } = await this.client.from('user_settings')
      .select('price_alerts_json').eq('user_id', this.user.id).single();
    if (data && data.price_alerts_json) {
      try {
        var loaded = JSON.parse(data.price_alerts_json);
        if (Array.isArray(loaded) && typeof priceAlerts !== 'undefined') {
          priceAlerts.length = 0;
          loaded.forEach(function(a) { priceAlerts.push(a); });
        }
      } catch(e) {}
    }
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

  // ---- PRICE HISTORY (accumulates over time) ----
  savePriceHistory: async function(assetId, candles, timeframe) {
    if (!this.client || !candles || !candles.length) return;
    timeframe = timeframe || 'hourly';
    var rows = candles.map(function(c) {
      return {
        asset_id: assetId,
        timeframe: timeframe,
        timestamp: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume || 0,
        source: 'coingecko'
      };
    });
    // Upsert in batches of 100
    for (var i = 0; i < rows.length; i += 100) {
      var batch = rows.slice(i, i + 100);
      await this.client.from('price_history').upsert(batch, { onConflict: 'asset_id,timeframe,timestamp', ignoreDuplicates: true });
    }
  },

  // Load accumulated price history — returns merged candles (cached + new)
  loadPriceHistory: async function(assetId, timeframe, limit) {
    if (!this.client) return [];
    timeframe = timeframe || 'hourly';
    limit = limit || 2000;
    var { data } = await this.client.from('price_history')
      .select('timestamp,open,high,low,close,volume')
      .eq('asset_id', assetId)
      .eq('timeframe', timeframe)
      .order('timestamp', { ascending: true })
      .limit(limit);
    if (!data || !data.length) return [];
    return data.map(function(r) {
      return { time: parseInt(r.timestamp), open: parseFloat(r.open), high: parseFloat(r.high), low: parseFloat(r.low), close: parseFloat(r.close), volume: parseFloat(r.volume || 0) };
    });
  },

  // Merge new candles with existing history (append new, update latest)
  mergePriceData: function(existing, fresh) {
    if (!existing || !existing.length) return fresh || [];
    if (!fresh || !fresh.length) return existing;
    var byTime = {};
    existing.forEach(function(c) { byTime[c.time] = c; });
    fresh.forEach(function(c) { byTime[c.time] = c; }); // newer overwrites
    var merged = Object.keys(byTime).map(function(k) { return byTime[k]; });
    merged.sort(function(a, b) { return a.time - b.time; });
    return merged;
  },
};

// Helper
function setVal(id, val) { var el = document.getElementById(id); if (el) el.value = val; }
