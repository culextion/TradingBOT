// ===== Risk Management & Safeguards Engine =====

var RiskEngine = {
  // ---- Configuration ----
  config: {
    maxPositionPct: 10,       // max % of portfolio per position
    stopLossPct: 5,           // hard stop-loss %
    takeProfitPct: 10,        // take-profit %
    trailingStopPct: 3,       // trailing stop distance %
    useTrailingStop: true,
    maxDailyLossUSD: 2000,    // daily loss limit
    maxConcurrentPos: 5,
    maxCorrelatedPos: 2,      // max positions with corr > 0.7
    cooldownAfterLossMs: 300000, // 5 min cooldown after stop-loss
    circuitBreakerPct: 8,     // halt if any asset moves > 8% in 1h
    positionSizing: 'fixed',  // 'fixed' | 'kelly' | 'drawdown'
    drawdownScaling: true,    // reduce size during drawdowns
  },

  // ---- State ----
  trailingStops: {},  // { assetId: highWaterMark }
  lastLossTime: 0,
  halted: false,
  haltReason: '',

  // ---- Load from UI ----
  loadFromUI: function() {
    this.config.maxPositionPct = parseFloat(gv('risk-pos-size')) || 10;
    this.config.stopLossPct = parseFloat(gv('risk-stop-loss')) || 5;
    this.config.takeProfitPct = parseFloat(gv('risk-take-profit')) || 10;
    this.config.trailingStopPct = parseFloat(gv('risk-trailing')) || 3;
    this.config.useTrailingStop = gc('risk-use-trailing');
    this.config.maxDailyLossUSD = parseFloat(gv('risk-daily-loss')) || 2000;
    this.config.maxConcurrentPos = parseInt(gv('risk-max-pos')) || 5;
    this.config.circuitBreakerPct = parseFloat(gv('risk-circuit')) || 8;
    this.config.positionSizing = gv('risk-sizing') || 'fixed';
  },

  // ---- Position Sizing ----
  calcPositionSize: function(portfolioValue, winRate, avgWin, avgLoss, currentDrawdownPct) {
    var base = portfolioValue * (this.config.maxPositionPct / 100);

    if (this.config.positionSizing === 'kelly' && winRate > 0 && avgWin > 0) {
      var kelly = (winRate * avgWin - (1 - winRate) * avgLoss) / avgWin;
      kelly = Math.max(0, Math.min(kelly, 0.25)); // cap at 25% Kelly
      base = portfolioValue * kelly * 0.25; // quarter-Kelly
    }

    // Drawdown scaling: reduce size as drawdown deepens
    if (this.config.drawdownScaling && currentDrawdownPct > 5) {
      var scale = 1;
      if (currentDrawdownPct > 20) scale = 0.25;
      else if (currentDrawdownPct > 15) scale = 0.5;
      else if (currentDrawdownPct > 10) scale = 0.65;
      else if (currentDrawdownPct > 5) scale = 0.8;
      base *= scale;
    }

    return Math.max(10, Math.min(base, portfolioValue * 0.2)); // floor $10, cap 20%
  },

  // ---- Pre-Trade Checks ----
  canTrade: function(account, assetId, correlations, dataFreshness) {
    var reasons = [];

    if (this.halted) reasons.push('HALTED: ' + this.haltReason);
    if (account.positions.length >= this.config.maxConcurrentPos) reasons.push('Max positions reached (' + this.config.maxConcurrentPos + ')');
    if (account.dayPnL <= -this.config.maxDailyLossUSD) reasons.push('Daily loss limit hit ($' + this.config.maxDailyLossUSD + ')');
    if (Date.now() - this.lastLossTime < this.config.cooldownAfterLossMs) reasons.push('Cooldown active after stop-loss');

    // Check correlated positions
    if (correlations && assetId) {
      var corrCount = 0;
      account.positions.forEach(function(p) {
        var key1 = p.sym + '-' + assetId, key2 = assetId + '-' + p.sym;
        var corr = correlations[key1] || correlations[key2] || 0;
        if (corr > 0.7) corrCount++;
      });
      if (corrCount >= this.config.maxCorrelatedPos) reasons.push('Too many correlated positions (>' + this.config.maxCorrelatedPos + ' with r>0.7)');
    }

    // Stale data check
    if (dataFreshness && dataFreshness.isStale) reasons.push('Price data is stale (' + dataFreshness.age + 's old)');

    return { allowed: reasons.length === 0, reasons: reasons };
  },

  // ---- Check Stops on Existing Positions ----
  checkStops: function(positions, priceOfFn) {
    var actions = [];
    var self = this;
    positions.forEach(function(pos) {
      var price = priceOfFn(pos.id);
      if (!price) return;
      var pnlPct = (price - pos.avgPrice) / pos.avgPrice * 100;

      // Hard stop-loss
      if (pnlPct <= -self.config.stopLossPct) {
        actions.push({ action: 'STOP_LOSS', id: pos.id, sym: pos.sym, pnlPct: pnlPct, reason: 'Stop loss at -' + self.config.stopLossPct + '%' });
        self.lastLossTime = Date.now();
        return;
      }

      // Take profit
      if (pnlPct >= self.config.takeProfitPct) {
        actions.push({ action: 'TAKE_PROFIT', id: pos.id, sym: pos.sym, pnlPct: pnlPct, reason: 'Take profit at +' + self.config.takeProfitPct + '%' });
        return;
      }

      // Trailing stop
      if (self.config.useTrailingStop) {
        var hwm = self.trailingStops[pos.id] || pos.avgPrice;
        if (price > hwm) { self.trailingStops[pos.id] = price; hwm = price; }
        var trailStop = hwm * (1 - self.config.trailingStopPct / 100);
        if (price <= trailStop && pnlPct > 0) {
          actions.push({ action: 'TRAILING_STOP', id: pos.id, sym: pos.sym, pnlPct: pnlPct, reason: 'Trailing stop from $' + hwm.toFixed(2) });
        }
      }
    });
    return actions;
  },

  // ---- Circuit Breaker ----
  checkCircuitBreaker: function(assets, changeOfFn) {
    for (var i = 0; i < assets.length; i++) {
      var ch = Math.abs(changeOfFn(assets[i].id));
      if (ch > this.config.circuitBreakerPct) {
        this.halted = true;
        this.haltReason = assets[i].sym + ' moved ' + ch.toFixed(1) + '% — circuit breaker triggered';
        return true;
      }
    }
    if (this.halted && this.haltReason.indexOf('circuit') > -1) {
      this.halted = false; this.haltReason = '';
    }
    return false;
  },

  // ---- Performance Metrics ----
  calcMetrics: function(trades, startingCapital) {
    if (!trades || trades.length === 0) return null;
    var wins = 0, losses = 0, grossProfit = 0, grossLoss = 0, returns = [];
    var equity = startingCapital, peak = startingCapital, maxDD = 0;
    var equityCurve = [startingCapital];

    trades.forEach(function(t) {
      if (t.type !== 'SELL' || t.pnl === undefined) return;
      if (t.pnl > 0) { wins++; grossProfit += t.pnl; }
      else { losses++; grossLoss += Math.abs(t.pnl); }
      equity += t.pnl;
      equityCurve.push(equity);
      if (equity > peak) peak = equity;
      var dd = (peak - equity) / peak * 100;
      if (dd > maxDD) maxDD = dd;
      returns.push(t.pnl / startingCapital);
    });

    var totalTrades = wins + losses;
    if (totalTrades === 0) return null;
    var winRate = wins / totalTrades;
    var avgWin = wins > 0 ? grossProfit / wins : 0;
    var avgLoss = losses > 0 ? grossLoss / losses : 0;
    var profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
    var expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);
    var netProfit = grossProfit - grossLoss;
    var totalReturn = netProfit / startingCapital * 100;

    // Sharpe (annualized, assuming daily returns)
    var avgRet = returns.reduce(function(a, b) { return a + b; }, 0) / returns.length;
    var retVar = returns.reduce(function(a, b) { return a + Math.pow(b - avgRet, 2); }, 0) / returns.length;
    var retStd = Math.sqrt(retVar);
    var sharpe = retStd > 0 ? (avgRet / retStd) * Math.sqrt(252) : 0;

    // Sortino (only downside deviation)
    var downReturns = returns.filter(function(r) { return r < 0; });
    var downVar = downReturns.length > 0 ? downReturns.reduce(function(a, b) { return a + b * b; }, 0) / downReturns.length : 0;
    var downDev = Math.sqrt(downVar);
    var sortino = downDev > 0 ? (avgRet / downDev) * Math.sqrt(252) : 0;

    // VaR 95%
    var sortedReturns = returns.slice().sort(function(a, b) { return a - b; });
    var var95 = sortedReturns.length >= 20 ? sortedReturns[Math.floor(sortedReturns.length * 0.05)] * startingCapital : 0;

    return {
      totalTrades: totalTrades, wins: wins, losses: losses,
      winRate: winRate, avgWin: avgWin, avgLoss: avgLoss,
      grossProfit: grossProfit, grossLoss: grossLoss, netProfit: netProfit,
      profitFactor: profitFactor, expectancy: expectancy,
      maxDrawdown: maxDD, totalReturn: totalReturn,
      sharpe: sharpe, sortino: sortino, var95: var95,
      equityCurve: equityCurve,
    };
  },
};

// Helpers
function gv(id) { var el = document.getElementById(id); return el ? el.value : ''; }
function gc(id) { var el = document.getElementById(id); return el ? el.checked : false; }
