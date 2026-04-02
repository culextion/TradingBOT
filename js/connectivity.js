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

  init: function() {
    var self = this;
    window.addEventListener('online', function() { self.isOnline = true; self.notify('online', 'Connection restored'); self.consecutiveFailures = 0; });
    window.addEventListener('offline', function() { self.isOnline = false; self.notify('offline', 'Connection lost'); });
    // Health check every 5 seconds
    setInterval(function() { self.healthCheck(); }, 5000);
    // WebSocket health monitor every 30 seconds
    this.wsCheckInterval = setInterval(function() { self.checkWebSockets(); }, 30000);
  },

  onPriceUpdate: function() {
    this.lastPriceUpdate = Date.now();
    this.lastAPISuccess = Date.now();
    this.consecutiveFailures = 0;
    this.dataQuality = 'fresh';
    this.staleSec = 0;
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
  },

  // Check if WebSockets are alive, trigger reconnect if dead
  checkWebSockets: function() {
    var now = Date.now();
    // If stock WS hasn't received data in 60s, it's probably dead
    if (this.wsStockAlive && (now - this.wsLastStockPing) > 60000) {
      this.wsStockAlive = false;
      this.notify('ws-dead', 'Stock WebSocket stale — reconnecting');
      if (typeof fhReconnectStock === 'function') fhReconnectStock();
    }
    if (this.wsCryptoAlive && (now - this.wsLastCryptoPing) > 60000) {
      this.wsCryptoAlive = false;
      this.notify('ws-dead', 'Crypto WebSocket stale — reconnecting');
      if (typeof fhReconnectCrypto === 'function') fhReconnectCrypto();
    }
  },

  canTradeSafely: function() {
    if (this.isSimulated) return { safe: true };
    if (!this.isOnline) return { safe: false, reason: 'Browser is offline' };
    // Only block if data is REALLY old (>3 minutes) — REST refreshes every 15s
    if (this.staleSec > 180) return { safe: false, reason: 'Price data is stale (' + this.staleSec + 's old)' };
    return { safe: true };
  },

  getStatusDisplay: function() {
    if (!this.isOnline) return { dot: 'bg-red', text: 'OFFLINE' };
    if (this.dataQuality === 'critical') return { dot: 'bg-red', text: 'DATA STALE — ' + this.staleSec + 's' };
    if (this.dataQuality === 'stale') return { dot: 'bg-ylw', text: 'Data aging — ' + this.staleSec + 's' };
    if (this.consecutiveFailures > 0) return { dot: 'bg-ylw pulse', text: 'API retrying (' + this.consecutiveFailures + ')' };
    return { dot: 'bg-grn', text: 'Connected — Live' };
  },

  notify: function(type, msg) {
    this.listeners.forEach(function(fn) { fn(type, msg); });
  },

  onEvent: function(fn) { this.listeners.push(fn); },
};
