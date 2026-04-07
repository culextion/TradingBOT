// ===== Scenario Simulator & Backtester =====

var Simulator = {
  // Run a strategy backtest on historical data with fee profile
  backtest: function(strategy, data, feeProfile, riskConfig, startingCapital, assetVolatility) {
    startingCapital = startingCapital || 100000;
    assetVolatility = assetVolatility || 0.03; // default 3% daily volatility
    var cash = startingCapital, positions = [], trades = [], equity = [startingCapital];
    var peak = startingCapital, maxDD = 0, dayPnL = 0;
    var posSize = riskConfig.maxPositionPct / 100;
    var stopLoss = riskConfig.stopLossPct / 100;
    var takeProfit = riskConfig.takeProfitPct / 100;

    for (var i = 50; i < data.length; i++) {
      var window = data.slice(Math.max(0, i - 200), i + 1);
      var bar = data[i];
      var portfolioValue = cash;
      positions.forEach(function(p) { portfolioValue += p.qty * bar.close; });

      // Check stops on existing positions
      positions.slice().forEach(function(pos) {
        var pnlPct = (bar.close - pos.avgPrice) / pos.avgPrice;
        if (pnlPct <= -stopLoss || pnlPct >= takeProfit) {
          var proceeds = pos.qty * bar.close;
          var cost = calculateTradeCost(proceeds, feeProfile, 'sell', assetVolatility || 0.03);
          proceeds -= cost.total;
          var pnl = proceeds - (pos.qty * pos.avgPrice);
          cash += proceeds;
          trades.push({ type: 'SELL', price: bar.close, qty: pos.qty, pnl: pnl, time: bar.time, fees: cost.total, reason: pnlPct <= -stopLoss ? 'STOP_LOSS' : 'TAKE_PROFIT' });
          positions = positions.filter(function(p) { return p !== pos; });
        }
      });

      // Strategy signal
      var signal = strategy.analyze(window, positions);
      if (signal === 'BUY' && positions.length < riskConfig.maxConcurrentPos) {
        var buyAmount = portfolioValue * posSize;
        if (buyAmount > cash) buyAmount = cash;
        if (buyAmount > 10) {
          var cost = calculateTradeCost(buyAmount, feeProfile, 'buy', assetVolatility || 0.03);
          var effectiveAmount = buyAmount - cost.total;
          var qty = effectiveAmount / bar.close;
          cash -= buyAmount;
          positions.push({ qty: qty, avgPrice: bar.close });
          trades.push({ type: 'BUY', price: bar.close, qty: qty, amount: buyAmount, time: bar.time, fees: cost.total });
        }
      } else if (signal === 'SELL') {
        positions.slice().forEach(function(pos) {
          var proceeds = pos.qty * bar.close;
          var cost = calculateTradeCost(proceeds, feeProfile, 'sell', assetVolatility || 0.03);
          proceeds -= cost.total;
          var pnl = proceeds - (pos.qty * pos.avgPrice);
          cash += proceeds;
          trades.push({ type: 'SELL', price: bar.close, qty: pos.qty, pnl: pnl, time: bar.time, fees: cost.total, reason: 'SIGNAL' });
          positions = positions.filter(function(p) { return p !== pos; });
        });
      }

      // Track equity
      var currentEquity = cash;
      positions.forEach(function(p) { currentEquity += p.qty * bar.close; });
      equity.push(currentEquity);
      if (currentEquity > peak) peak = currentEquity;
      var dd = (peak - currentEquity) / peak * 100;
      if (dd > maxDD) maxDD = dd;
    }

    // Close remaining positions at final price
    var finalPrice = data[data.length - 1].close;
    positions.forEach(function(pos) {
      var proceeds = pos.qty * finalPrice;
      var cost = calculateTradeCost(proceeds, feeProfile, 'sell', assetVolatility || 0.03);
      proceeds -= cost.total;
      var pnl = proceeds - (pos.qty * pos.avgPrice);
      cash += proceeds;
      trades.push({ type: 'SELL', price: finalPrice, qty: pos.qty, pnl: pnl, time: data[data.length - 1].time, fees: cost.total, reason: 'END' });
    });

    var finalEquity = cash;
    var totalFees = trades.reduce(function(s, t) { return s + (t.fees || 0); }, 0);
    var metrics = RiskEngine.calcMetrics(trades, startingCapital);
    if (metrics) { metrics.totalFees = totalFees; metrics.equityCurve = equity; metrics.finalEquity = finalEquity; }
    return { trades: trades, metrics: metrics, equity: equity, totalFees: totalFees };
  },

  // Monte Carlo: reshuffle trades N times
  monteCarlo: function(trades, startingCapital, iterations) {
    iterations = iterations || 500;
    startingCapital = startingCapital || 100000;
    var sellTrades = trades.filter(function(t) { return t.type === 'SELL' && t.pnl !== undefined; });
    if (sellTrades.length < 5) return null;

    var results = [];
    for (var iter = 0; iter < iterations; iter++) {
      var shuffled = sellTrades.slice().sort(function() { return Math.random() - 0.5; });
      var equity = startingCapital, peak = startingCapital, maxDD = 0;
      shuffled.forEach(function(t) {
        equity += t.pnl;
        if (equity > peak) peak = equity;
        var dd = (peak - equity) / peak * 100;
        if (dd > maxDD) maxDD = dd;
      });
      results.push({ finalEquity: equity, maxDrawdown: maxDD, totalReturn: (equity - startingCapital) / startingCapital * 100 });
    }

    results.sort(function(a, b) { return a.finalEquity - b.finalEquity; });
    return {
      p5:   results[Math.floor(iterations * 0.05)],
      p25:  results[Math.floor(iterations * 0.25)],
      p50:  results[Math.floor(iterations * 0.50)],
      p75:  results[Math.floor(iterations * 0.75)],
      p95:  results[Math.floor(iterations * 0.95)],
      worst: results[0],
      best:  results[results.length - 1],
      beatBacktest: results.filter(function(r) { return r.finalEquity > results[Math.floor(iterations * 0.50)].finalEquity; }).length / iterations * 100,
    };
  },

  // Compare fee profiles
  compareFees: function(data, strategy, feeProfiles, riskConfig, startingCapital) {
    var results = {};
    feeProfiles.forEach(function(profileKey) {
      results[profileKey] = Simulator.backtest(strategy, data, profileKey, riskConfig, startingCapital);
    });
    return results;
  },
};

// Built-in strategies for backtesting
var Strategies = {
  meanReversion: {
    name: 'Mean Reversion (RSI)',
    analyze: function(data) {
      if (data.length < 20) return 'HOLD';
      var rsi = calcRSIFromData(data, 14);
      if (rsi < 30) return 'BUY';
      if (rsi > 70) return 'SELL';
      return 'HOLD';
    }
  },
  momentum: {
    name: 'Momentum (SMA Cross)',
    analyze: function(data, positions) {
      if (data.length < 52) return 'HOLD';
      var fast = avgCloseN(data, 20), slow = avgCloseN(data, 50);
      var prevFast = avgCloseNAt(data, 20, data.length - 2), prevSlow = avgCloseNAt(data, 50, data.length - 2);
      if (prevFast <= prevSlow && fast > slow) return 'BUY';
      if (prevFast >= prevSlow && fast < slow && positions && positions.length > 0) return 'SELL';
      return 'HOLD';
    }
  },
  bollingerBounce: {
    name: 'Bollinger Bounce',
    analyze: function(data) {
      if (data.length < 22) return 'HOLD';
      var closes = data.slice(-20).map(function(d) { return d.close; });
      var mean = closes.reduce(function(a, b) { return a + b; }, 0) / 20;
      var variance = closes.reduce(function(a, b) { return a + Math.pow(b - mean, 2); }, 0) / 20;
      var std = Math.sqrt(variance);
      var price = data[data.length - 1].close;
      if (price < mean - 2 * std) return 'BUY';
      if (price > mean + 2 * std) return 'SELL';
      return 'HOLD';
    }
  },
};

function calcRSIFromData(data, period) {
  period = period || 14;
  var gains = [], losses = [];
  for (var i = 1; i < data.length; i++) {
    var ch = data[i].close - data[i - 1].close;
    gains.push(ch > 0 ? ch : 0);
    losses.push(ch < 0 ? -ch : 0);
  }
  if (gains.length < period) return 50;
  var ag = 0, al = 0;
  for (var i = gains.length - period; i < gains.length; i++) { ag += gains[i]; al += losses[i]; }
  ag /= period; al /= period;
  return 100 - 100 / (1 + (al === 0 ? 100 : ag / al));
}

function avgCloseN(data, p) { var s = 0; for (var i = data.length - p; i < data.length; i++) s += data[i].close; return s / p; }
function avgCloseNAt(data, p, endIdx) { var s = 0; for (var i = endIdx - p; i < endIdx; i++) s += (data[i] || data[data.length - 1]).close; return s / p; }
