// ===== Connectivity Safeguards =====

var ConnGuard = {
  lastPriceUpdate: 0,
  lastAPISuccess: 0,
  consecutiveFailures: 0,
  maxStaleSeconds: 300,      // 5 minutes = stale (was 2min, too aggressive)
  maxFailuresBeforeHalt: 10,
  isOnline: navigator.onLine,
  isSimulated: false,        // true for stock mode (no API needed)
  listeners: [],

  init: function() {
    var self = this;
    window.addEventListener('online', function() { self.isOnline = true; self.notify('online', 'Connection restored'); self.consecutiveFailures = 0; });
    window.addEventListener('offline', function() { self.isOnline = false; self.notify('offline', 'Connection lost — bot paused'); });
    // Periodic health check
    setInterval(function() { self.healthCheck(); }, 10000);
  },

  onPriceUpdate: function() {
    this.lastPriceUpdate = Date.now();
    this.lastAPISuccess = Date.now();
    this.consecutiveFailures = 0;
  },

  onAPIFailure: function() {
    this.consecutiveFailures++;
    if (this.consecutiveFailures >= this.maxFailuresBeforeHalt) {
      this.notify('critical', 'API failed ' + this.consecutiveFailures + ' times — trading halted');
      RiskEngine.halted = true;
      RiskEngine.haltReason = 'API connectivity failure (' + this.consecutiveFailures + ' consecutive errors)';
    }
  },

  onAPISuccess: function() {
    this.lastAPISuccess = Date.now();
    this.consecutiveFailures = 0;
    if (RiskEngine.halted && RiskEngine.haltReason.indexOf('connectivity') > -1) {
      RiskEngine.halted = false;
      RiskEngine.haltReason = '';
      this.notify('recovered', 'API recovered — trading resumed');
    }
  },

  healthCheck: function() {
    // Simulated data (stocks) is always fresh
    if (this.isSimulated) { this.dataQuality = 'fresh'; this.staleSec = 0; return; }
    var now = Date.now();
    var staleSec = (now - this.lastPriceUpdate) / 1000;
    var quality = 'fresh';
    if (this.lastPriceUpdate === 0) quality = 'no-data';
    else if (staleSec > this.maxStaleSeconds * 2) quality = 'critical';
    else if (staleSec > this.maxStaleSeconds) quality = 'stale';
    else if (staleSec > this.maxStaleSeconds * 0.5) quality = 'degraded';

    this.dataQuality = quality;
    this.staleSec = Math.round(staleSec);
  },

  canTradeSafely: function() {
    // Simulated mode always safe
    if (this.isSimulated) return { safe: true };
    if (!this.isOnline) return { safe: false, reason: 'Browser is offline' };
    if (this.dataQuality === 'critical' || this.dataQuality === 'stale') return { safe: false, reason: 'Price data is stale (' + this.staleSec + 's old)' };
    if (this.consecutiveFailures >= 3) return { safe: false, reason: 'API unstable (' + this.consecutiveFailures + ' failures)' };
    return { safe: true };
  },

  getStatusDisplay: function() {
    if (!this.isOnline) return { dot: 'bg-accent-red', text: 'OFFLINE — no connection' };
    if (this.dataQuality === 'critical') return { dot: 'bg-accent-red', text: 'DATA STALE — ' + this.staleSec + 's since last update' };
    if (this.dataQuality === 'stale') return { dot: 'bg-accent-yellow', text: 'Data aging — ' + this.staleSec + 's since update' };
    if (this.consecutiveFailures > 0) return { dot: 'bg-accent-yellow pulse-anim', text: 'API errors (' + this.consecutiveFailures + ') — retrying' };
    return { dot: 'bg-accent-green', text: 'Connected — Live Data' };
  },

  notify: function(type, msg) {
    this.listeners.forEach(function(fn) { fn(type, msg); });
  },

  onEvent: function(fn) { this.listeners.push(fn); },
};
