// ===== Connectivity Safeguards =====

var ConnGuard = {
  lastPriceUpdate: 0,
  lastAPISuccess: 0,
  consecutiveFailures: 0,
  maxStaleSeconds: 90,        // 90 seconds = stale (REST refreshes every 15s)
  maxFailuresBeforeHalt: 20,
  isOnline: navigator.onLine,
  isSimulated: false,
  dataQuality: 'fresh',
  staleSec: 0,
  listeners: [],

  // WebSocket health tracking
  wsStockAlive: false,
  wsCryptoAlive: false,
  wsLastStockPing: 0,
  wsLastCryptoPing: 0,
  wsCheckInterval: null,

  // Recovery state
  recoveryMode: false,
  recoveryStartedAt: 0,
  lastRecoveryAttempt: 0,
  recoveryAttempts: 0,
  lastStaleStatus: false,   // Track state changes for smart logging
  lastPrices: {},            // Snapshot of last known prices for recovery mode

  init: function() {
    var self = this;
    window.addEventListener('online', function() { self.isOnline = true; self.notify('online', 'Connection restored'); self.consecutiveFailures = 0; });
    window.addEventListener('offline', function() { self.isOnline = false; self.notify('offline', 'Connection lost'); });
    // Health check every 5 seconds
    setInterval(function() { self.healthCheck(); }, 5000);
    // WebSocket health monitor every 15 seconds (was 30s, more aggressive now)
    this.wsCheckInterval = setInterval(function() { self.checkWebSockets(); }, 15000);
  },

  onPriceUpdate: function() {
    var wasStale = this.staleSec > 60;
    this.lastPriceUpdate = Date.now();
    this.lastAPISuccess = Date.now();
    this.consecutiveFailures = 0;
    this.dataQuality = 'fresh';
    this.staleSec = 0;
    this.recoveryAttempts = 0;
    // Exit recovery mode when fresh data arrives
    if (this.recoveryMode) {
      this.recoveryMode = false;
      this.recoveryStartedAt = 0;
      this.notify('recovery-exit', 'Fresh data received — exiting recovery mode');
    }
    // Notify when transitioning from stale to fresh
    if (wasStale) {
      this.lastStaleStatus = false;
      this.notify('stale-to-fresh', 'Data is fresh again');
    }
    // Snapshot prices for recovery mode
    this._snapshotPrices();
  },

  _snapshotPrices: function() {
    if (typeof prices !== 'undefined') {
      var snap = {};
      for (var k in prices) {
        if (prices[k] && prices[k].usd) {
          snap[k] = { usd: prices[k].usd, usd_24h_change: prices[k].usd_24h_change || 0, snapshotTime: Date.now() };
        }
      }
      this.lastPrices = snap;
    }
  },

  onAPIFailure: function() {
    this.consecutiveFailures++;
  },

  onAPISuccess: function() {
    this.lastAPISuccess = Date.now();
    this.consecutiveFailures = 0;
  },

  onWSMessage: function(type) {
    if (type === 'stock') { this.wsStockAlive = true; this.wsLastStockPing = Date.now(); }
    if (type === 'crypto') { this.wsCryptoAlive = true; this.wsLastCryptoPing = Date.now(); }
    this.onPriceUpdate();
  },

  healthCheck: function() {
    if (this.isSimulated) { this.dataQuality = 'fresh'; this.staleSec = 0; return; }
    var now = Date.now();
    var staleSec = this.lastPriceUpdate > 0 ? (now - this.lastPriceUpdate) / 1000 : 0;
    this.staleSec = Math.round(staleSec);

    if (this.lastPriceUpdate === 0) this.dataQuality = 'no-data';
    else if (staleSec > this.maxStaleSeconds * 3) this.dataQuality = 'critical';
    else if (staleSec > this.maxStaleSeconds) this.dataQuality = 'stale';
    else this.dataQuality = 'fresh';

    // Log state change only (not every tick)
    var isStaleNow = staleSec > 60;
    if (isStaleNow && !this.lastStaleStatus) {
      this.lastStaleStatus = true;
      this.notify('fresh-to-stale', 'Data becoming stale (' + this.staleSec + 's old)');
    }

    // Enter recovery mode if stale for >5 minutes
    if (staleSec > 300 && !this.recoveryMode) {
      this.recoveryMode = true;
      this.recoveryStartedAt = now;
      this.notify('recovery-enter', 'Entering recovery mode — using estimated prices');
    }
  },

  // Check if WebSockets are alive, trigger reconnect if dead
  checkWebSockets: function() {
    var now = Date.now();
    // If stock WS hasn't received data in 30s (was 60s), it's probably dead
    if (this.wsStockAlive && (now - this.wsLastStockPing) > 30000) {
      this.wsStockAlive = false;
      this.notify('ws-dead', 'Stock WebSocket stale — reconnecting');
      if (typeof fhReconnectStock === 'function') fhReconnectStock();
    }
    if (this.wsCryptoAlive && (now - this.wsLastCryptoPing) > 30000) {
      this.wsCryptoAlive = false;
      this.notify('ws-dead', 'Crypto WebSocket stale — reconnecting');
      if (typeof fhReconnectCrypto === 'function') fhReconnectCrypto();
    }
  },

  // Aggressive refresh: try BOTH Finnhub and CoinGecko
  aggressiveRefresh: function() {
    var self = this;
    var now = Date.now();

    // Exponential backoff: 5s, 15s, 30s, 60s
    var backoffs = [5000, 15000, 30000, 60000];
    var delay = backoffs[Math.min(self.recoveryAttempts, backoffs.length - 1)];
    if (now - self.lastRecoveryAttempt < delay) return Promise.resolve(false);

    self.lastRecoveryAttempt = now;
    self.recoveryAttempts++;

    var attempts = [];

    // Try Finnhub REST
    if (typeof fhAllQuotes === 'function' && typeof getWL === 'function') {
      attempts.push(
        fhAllQuotes(getWL()).then(function() {
          self.onPriceUpdate();
          return 'finnhub';
        }).catch(function() { return null; })
      );
    }

    // Try CoinGecko
    if (typeof cgPr === 'function' && typeof mkt !== 'undefined' && mkt === 'crypto') {
      attempts.push(
        cgPr().then(function(p) {
          if (p && typeof prices !== 'undefined') {
            Object.assign(prices, p);
            self.onPriceUpdate();
            return 'coingecko';
          }
          return null;
        }).catch(function() { return null; })
      );
    }

    if (!attempts.length) return Promise.resolve(false);

    return Promise.all(attempts).then(function(results) {
      var success = results.filter(function(r) { return r !== null; });
      if (success.length > 0) {
        self.notify('refresh-success', 'Prices refreshed via ' + success.join(' + '));
        return true;
      }
      self.notify('refresh-fail', 'Refresh attempt #' + self.recoveryAttempts + ' failed — retrying');
      return false;
    });
  },

  canTradeSafely: function() {
    if (this.isSimulated) return { safe: true };
    if (!this.isOnline) return { safe: false, reason: 'Browser is offline' };
    // <300s (5 min): fresh, trade normally
    if (this.staleSec < 300) return { safe: true };
    // 300-600s (5-10 min): warn but still trade (data is slightly old but usable)
    if (this.staleSec <= 600) return { safe: true, warn: true, reason: 'Price data is aging (' + this.staleSec + 's old) — trading with caution' };
    // >600s (10 min): block trading, attempt aggressive refresh
    return { safe: false, reason: 'Price data is stale (' + this.staleSec + 's old) — blocking trades' };
  },

  // Recovery mode: can only execute stop-losses, not new buys
  canBuyInRecovery: function() {
    return !this.recoveryMode;
  },

  getStatusDisplay: function() {
    if (!this.isOnline) return { dot: 'bg-red', text: 'OFFLINE' };
    if (this.recoveryMode) return { dot: 'bg-red pulse', text: 'RECOVERY — ' + this.staleSec + 's stale' };
    if (this.dataQuality === 'critical') return { dot: 'bg-red', text: 'DATA STALE — ' + this.staleSec + 's' };
    if (this.dataQuality === 'stale') return { dot: 'bg-ylw', text: 'Data aging — ' + this.staleSec + 's' };
    if (this.consecutiveFailures > 0) return { dot: 'bg-ylw pulse', text: 'API retrying (' + this.consecutiveFailures + ')' };
    return { dot: 'bg-grn', text: 'Connected — Live' };
  },

  // Connection health dashboard data
  getHealthDashboard: function() {
    var now = Date.now();
    var wsStockStatus = this.wsStockAlive ? 'Connected' : 'Disconnected';
    var wsCryptoStatus = this.wsCryptoAlive ? 'Connected' : 'Disconnected';
    var wsStockAge = this.wsLastStockPing > 0 ? Math.round((now - this.wsLastStockPing) / 1000) : -1;
    var wsCryptoAge = this.wsLastCryptoPing > 0 ? Math.round((now - this.wsLastCryptoPing) / 1000) : -1;
    var lastUpdate = this.lastPriceUpdate > 0 ? Math.round((now - this.lastPriceUpdate) / 1000) : -1;

    var status = 'live';
    var statusColor = 'grn';
    var statusText = 'Live';
    if (!this.isOnline) { status = 'offline'; statusColor = 'red'; statusText = 'Offline'; }
    else if (this.recoveryMode) { status = 'recovery'; statusColor = 'red'; statusText = 'Recovery Mode'; }
    else if (this.staleSec > 120) { status = 'degraded'; statusColor = 'ylw'; statusText = 'Degraded'; }

    return {
      status: status,
      statusColor: statusColor,
      statusText: statusText,
      lastUpdate: lastUpdate,
      wsStock: wsStockStatus,
      wsStockAge: wsStockAge,
      wsCrypto: wsCryptoStatus,
      wsCryptoAge: wsCryptoAge,
      recoveryMode: this.recoveryMode,
      recoveryAttempts: this.recoveryAttempts,
      dataQuality: this.dataQuality,
      staleSec: this.staleSec
    };
  },

  notify: function(type, msg) {
    this.listeners.forEach(function(fn) { fn(type, msg); });
  },

  onEvent: function(fn) { this.listeners.push(fn); },
};
