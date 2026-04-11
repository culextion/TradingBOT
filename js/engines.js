// ===== CulexTrade Multi-Engine Decision System =====
// 5 independent engines vote on every trade decision.
// Only supermajority agreement (60%+) results in execution.

var DecisionBoard = {
  lastVote: null,
  voteHistory: [],

  // Run all 5 engines and aggregate votes
  evaluate: function(assetId, data, prices, positions, regime, news) {
    var results = [];
    var pr = prices[assetId] ? prices[assetId].usd : 0;
    var ch = prices[assetId] ? (prices[assetId].usd_24h_change || 0) : 0;
    if (!pr || !data || data.length < 20) return { decision: 'HOLD', reason: 'Insufficient data', engines: [] };

    // Engine 1: TREND
    results.push(TrendEngine.analyze(data, pr, ch));
    // Engine 2: MOMENTUM
    results.push(MomentumEngine.analyze(data, pr));
    // Engine 3: RISK
    results.push(RiskEngine2.analyze(assetId, pr, positions, regime));
    // Engine 4: SENTIMENT
    results.push(SentimentEngine.analyze(assetId, ch, news, regime));
    // Engine 5: MEMORY (learning from past trades)
    results.push(MemoryEngine.analyze(assetId));

    // Weighted supermajority vote
    return this.vote(results, assetId);
  },

  vote: function(results, assetId) {
    var buyScore = 0, sellScore = 0, holdScore = 0, totalWeight = 0;
    var vetoed = false, vetoReason = '';
    var breakdown = [];

    results.forEach(function(r) {
      var w = r.weight || 1.0;
      totalWeight += w;
      // Check for veto (Trend or Risk engine can block)
      if (r.veto) { vetoed = true; vetoReason = r.engine + ': ' + r.reason; }
      if (r.signal === 'BUY') buyScore += r.confidence * w;
      else if (r.signal === 'SELL') sellScore += r.confidence * w;
      else holdScore += w * 0.5;
      breakdown.push({ engine: r.engine, signal: r.signal, conf: Math.round(r.confidence * 100), reason: r.reason });
    });

    // Vetoed — no trade
    if (vetoed) return { decision: 'HOLD', reason: 'VETOED by ' + vetoReason, engines: breakdown, vetoed: true };

    var totalSignal = buyScore + sellScore + holdScore;
    var buyPct = totalSignal > 0 ? buyScore / totalSignal : 0;
    var sellPct = totalSignal > 0 ? sellScore / totalSignal : 0;
    var agreeing = results.filter(function(r) { return r.signal === 'BUY'; }).length;
    var agreeingSell = results.filter(function(r) { return r.signal === 'SELL'; }).length;

    var decision = 'HOLD';
    var consensus = 'NONE';
    var confidence = 0;

    // Supermajority: 60%+ weighted agreement
    if (buyPct >= 0.60 && agreeing >= 3) {
      decision = 'BUY'; consensus = agreeing + '/5 engines'; confidence = Math.min(90, buyPct * 100);
    } else if (sellPct >= 0.60 && agreeingSell >= 3) {
      decision = 'SELL'; consensus = agreeingSell + '/5 engines'; confidence = Math.min(90, sellPct * 100);
    } else {
      consensus = 'No consensus (buy:' + agreeing + ' sell:' + agreeingSell + ')';
    }

    var result = { decision: decision, consensus: consensus, confidence: confidence, engines: breakdown,
      buyScore: Math.round(buyPct * 100), sellScore: Math.round(sellPct * 100), agreeing: agreeing };

    this.lastVote = result;
    this.voteHistory.unshift(result);
    if (this.voteHistory.length > 50) this.voteHistory.length = 50;
    return result;
  }
};

// =====================================================================
// ENGINE 1: TREND ENGINE — Determines market direction
// Uses: SMA, EMA, Ichimoku, Heikin-Ashi, linear regression
// Has VETO power — can block buys in downtrends
// =====================================================================
var TrendEngine = {
  analyze: function(data, price, ch) {
    var s20 = _sma(data, 20), s50 = data.length >= 50 ? _sma(data, 50) : s20;
    var s200 = data.length >= 200 ? _sma(data, 200) : s50;

    // Heikin-Ashi trend detection
    var ha = _heikinAshi(data);
    var haBullish = ha.length >= 3 && ha[ha.length-1].close > ha[ha.length-1].open && ha[ha.length-2].close > ha[ha.length-2].open;
    var haBearish = ha.length >= 3 && ha[ha.length-1].close < ha[ha.length-1].open && ha[ha.length-2].close < ha[ha.length-2].open;

    // Linear regression slope (trend direction + strength)
    var regSlope = _linRegSlope(data, 20);
    var trendUp = regSlope > 0 && price > s20;
    var trendDown = regSlope < 0 && price < s20;
    var trendStrength = Math.min(1, Math.abs(regSlope) / (price * 0.001)); // Normalize

    // SMA alignment
    var bullishAlignment = price > s20 && s20 > s50;
    var bearishAlignment = price < s20 && s20 < s50;
    var goldenCross200 = s50 > s200 && price > s200;

    // Score
    var score = 0;
    if (bullishAlignment) score += 0.3;
    if (goldenCross200) score += 0.15;
    if (haBullish) score += 0.25;
    if (trendUp) score += 0.2;
    if (ch > 1) score += 0.1;

    if (bearishAlignment) score -= 0.3;
    if (haBearish) score -= 0.25;
    if (trendDown) score -= 0.2;
    if (ch < -1) score -= 0.1;

    var signal = score > 0.2 ? 'BUY' : score < -0.2 ? 'SELL' : 'HOLD';
    var conf = Math.min(1, Math.abs(score));

    // VETO: Block buys in downtrends — ANY two bearish signals = veto
    var bearishSignals = 0;
    if (bearishAlignment) bearishSignals++;
    if (haBearish) bearishSignals++;
    if (ch < -1) bearishSignals++;
    if (trendDown) bearishSignals++;
    var veto = bearishSignals >= 2; // ANY 2 of 4 bearish indicators = veto

    return { engine: 'TREND', signal: signal, confidence: conf, weight: 1.2,
      reason: (trendUp ? 'Uptrend' : trendDown ? 'Downtrend' : 'Sideways') +
        ' (HA:' + (haBullish ? '↑' : haBearish ? '↓' : '—') + ', SMA:' + (bullishAlignment ? '↑' : bearishAlignment ? '↓' : '—') + ')',
      veto: veto, data: { slope: regSlope, strength: trendStrength } };
  }
};

// =====================================================================
// ENGINE 2: MOMENTUM ENGINE — Identifies entry/exit timing
// Uses: RSI, StochRSI, MACD histogram, Elder Ray, Williams %R, CMF
// =====================================================================
var MomentumEngine = {
  analyze: function(data, price) {
    var rsi = _cRSI(data);
    var stochRSI = _stochRSI(data);
    var elderRay = _elderRay(data);
    var cmf = _cmf(data);
    var willR = _williamsR(data);

    var signals = 0, totalIndicators = 5;

    // RSI
    if (rsi < 30) signals++;
    else if (rsi > 70) signals--;

    // StochRSI
    if (stochRSI < 0.2) signals++;
    else if (stochRSI > 0.8) signals--;

    // Elder Ray
    if (elderRay.bullPower > 0 && elderRay.bearPower > elderRay.prevBearPower) signals++; // Bullish divergence
    else if (elderRay.bullPower < elderRay.prevBullPower && elderRay.bearPower < 0) signals--; // Bearish

    // CMF
    if (cmf > 0.15) signals++;
    else if (cmf < -0.15) signals--;

    // Williams %R
    if (willR < -80) signals++;
    else if (willR > -20) signals--;

    var normalized = signals / totalIndicators; // -1 to +1
    var signal = normalized > 0.3 ? 'BUY' : normalized < -0.3 ? 'SELL' : 'HOLD';
    var conf = Math.min(1, Math.abs(normalized));

    // Require bounce confirmation for buy
    var prevRsi = data.length >= 16 ? _cRSIat(data, data.length - 3) : rsi;
    var bouncing = rsi > prevRsi + 2;
    if (signal === 'BUY' && !bouncing) conf *= 0.7; // Reduce confidence without bounce

    return { engine: 'MOMENTUM', signal: signal, confidence: conf, weight: 1.0,
      reason: 'RSI=' + rsi.toFixed(0) + ' StochRSI=' + stochRSI.toFixed(2) + ' CMF=' + cmf.toFixed(2) +
        ' W%R=' + willR.toFixed(0) + (bouncing ? ' ✓bounce' : ''),
      data: { rsi: rsi, stochRSI: stochRSI, cmf: cmf, willR: willR, elderRay: elderRay } };
  }
};

// =====================================================================
// ENGINE 3: RISK ENGINE — Position sizing and risk assessment
// Checks: portfolio heat, correlation, volatility, drawdown
// Has VETO power — can block if risk too high
// =====================================================================
var RiskEngine2 = {
  analyze: function(assetId, price, positions, regime) {
    var posCount = positions ? positions.length : 0;
    var hasPosition = positions && positions.find(function(p) { return p.id === assetId; });
    var maxPos = 5;

    // Portfolio heat check
    var totalExposure = 0;
    if (positions) positions.forEach(function(p) { totalExposure += p.qty * (typeof prOf === 'function' ? prOf(p.id) : p.avgPrice); });
    var pv = typeof portVal === 'function' ? portVal() : 100000;
    var heatPct = pv > 0 ? totalExposure / pv : 0;

    var score = 0;
    var reasons = [];

    // Available capacity
    if (posCount < maxPos && !hasPosition) { score += 0.3; reasons.push('Capacity OK (' + posCount + '/' + maxPos + ')'); }
    else if (hasPosition) { score -= 0.1; reasons.push('Already holding'); }
    else { score -= 0.5; reasons.push('Max positions reached'); }

    // Portfolio heat
    if (heatPct < 0.5) { score += 0.2; reasons.push('Heat OK (' + (heatPct * 100).toFixed(0) + '%)'); }
    else if (heatPct < 0.8) { score += 0.05; reasons.push('Heat moderate'); }
    else { score -= 0.3; reasons.push('Heat HIGH (' + (heatPct * 100).toFixed(0) + '%)'); }

    // Regime
    if (regime && regime.strongBear) { score -= 0.4; reasons.push('Strong bear market'); }
    else if (regime && regime.bearish) { score -= 0.2; reasons.push('Bear market'); }
    else if (regime && regime.bullish) { score += 0.15; reasons.push('Bull market'); }

    var signal = score > 0.2 ? 'BUY' : score < -0.2 ? 'SELL' : 'HOLD';
    var conf = Math.min(1, Math.abs(score));
    var veto = posCount >= maxPos || (regime && regime.strongBear) || heatPct > 0.9;

    return { engine: 'RISK', signal: signal, confidence: conf, weight: 1.3,
      reason: reasons.join(', '), veto: veto,
      data: { heat: heatPct, posCount: posCount } };
  }
};

// =====================================================================
// ENGINE 4: SENTIMENT ENGINE — News, trending, market breadth
// =====================================================================
var SentimentEngine = {
  analyze: function(assetId, change24h, news, regime) {
    var score = 0;
    var reasons = [];

    // 24h momentum
    if (change24h > 3) { score += 0.3; reasons.push('+' + change24h.toFixed(1) + '% momentum'); }
    else if (change24h > 1) { score += 0.15; reasons.push('Mild positive'); }
    else if (change24h < -3) { score -= 0.3; reasons.push('Strong decline'); }
    else if (change24h < -1) { score -= 0.15; reasons.push('Mild negative'); }

    // News sentiment
    if (news && news.length) {
      var assetNews = news.filter(function(n) {
        var t = (n.title || '').toLowerCase();
        var sym = (typeof findA === 'function' && findA(assetId)) ? findA(assetId).sym.toLowerCase() : '';
        return t.indexOf(sym) > -1;
      });
      assetNews.forEach(function(n) {
        if (n.sentiment > 0) { score += 0.1; reasons.push('Positive news'); }
        if (n.sentiment < 0) { score -= 0.1; reasons.push('Negative news'); }
      });
    }

    // Trending boost
    if (typeof trendingCoins !== 'undefined' && trendingCoins.find(function(t) { return t.id === assetId; })) {
      score += 0.15; reasons.push('Trending on CoinGecko');
    }

    // Market breadth
    if (regime) {
      if (regime.upCount > regime.downCount) { score += 0.1; reasons.push('Broad market up'); }
      else if (regime.downCount > regime.upCount) { score -= 0.1; reasons.push('Broad market down'); }
    }

    var signal = score > 0.2 ? 'BUY' : score < -0.2 ? 'SELL' : 'HOLD';
    var conf = Math.min(1, Math.abs(score));

    return { engine: 'SENTIMENT', signal: signal, confidence: conf, weight: 0.8,
      reason: reasons.join(', ') || 'Neutral sentiment' };
  }
};

// =====================================================================
// ENGINE 5: MEMORY ENGINE — Learns from past trades
// Tracks win/loss patterns per asset and strategy
// =====================================================================
var MemoryEngine = {
  assetHistory: {}, // {assetId: {wins, losses, avgHold, lastResult, blacklisted}}

  recordResult: function(assetId, profitable, holdTime, strategy) {
    if (!this.assetHistory[assetId]) this.assetHistory[assetId] = { wins: 0, losses: 0, totalTrades: 0, streak: 0, lastResult: null, blacklisted: false, strategies: {} };
    var h = this.assetHistory[assetId];
    h.totalTrades++;
    if (profitable) { h.wins++; h.streak = Math.max(0, h.streak) + 1; h.lastResult = 'WIN'; }
    else { h.losses++; h.streak = Math.min(0, h.streak) - 1; h.lastResult = 'LOSS'; }
    // Blacklist after 3 consecutive losses — escalating duration
    if (h.streak <= -3) {
      var hours = Math.min(24, Math.abs(h.streak) * 2); // 6h, 8h, 10h... up to 24h
      h.blacklisted = true;
      h.blacklistUntil = Date.now() + hours * 3600000;
    }
    // Track per-strategy performance
    if (strategy) {
      if (!h.strategies[strategy]) h.strategies[strategy] = { wins: 0, losses: 0 };
      if (profitable) h.strategies[strategy].wins++; else h.strategies[strategy].losses++;
    }
    // Persist
    try { localStorage.setItem('ct_memory_engine', JSON.stringify(this.assetHistory)); } catch (e) {}
  },

  analyze: function(assetId) {
    var h = this.assetHistory[assetId];
    if (!h || h.totalTrades < 3) return { engine: 'MEMORY', signal: 'HOLD', confidence: 0.5, weight: 0.7, reason: 'Not enough history (need 3+ trades)' };

    // Check blacklist
    if (h.blacklisted) {
      if (h.blacklistUntil && Date.now() > h.blacklistUntil) { h.blacklisted = false; }
      else return { engine: 'MEMORY', signal: 'HOLD', confidence: 0.9, weight: 1.0, reason: 'BLACKLISTED — 3+ consecutive losses', veto: true };
    }

    var winRate = h.wins / h.totalTrades;
    var score = (winRate - 0.5) * 2; // -1 to +1, 0.5 = neutral
    if (h.streak >= 2) score += 0.2; // Winning streak
    if (h.streak <= -2) score -= 0.3; // Losing streak (penalize harder)

    var signal = score > 0.15 ? 'BUY' : score < -0.15 ? 'SELL' : 'HOLD';
    var conf = Math.min(1, Math.abs(score));

    return { engine: 'MEMORY', signal: signal, confidence: conf, weight: 0.7,
      reason: 'WR: ' + (winRate * 100).toFixed(0) + '% (' + h.wins + 'W/' + h.losses + 'L)' +
        (h.streak > 0 ? ' streak:+' + h.streak : h.streak < 0 ? ' streak:' + h.streak : ''),
      data: { winRate: winRate, streak: h.streak, totalTrades: h.totalTrades } };
  },

  load: function() {
    try { var s = localStorage.getItem('ct_memory_engine'); if (s) this.assetHistory = JSON.parse(s); } catch (e) {}
  }
};

// Load memory on script load
MemoryEngine.load();

// =====================================================================
// INDICATOR HELPERS (used by engines)
// =====================================================================
function _sma(data, p) { var s = 0; for (var i = data.length - p; i < data.length; i++) s += data[i].close; return s / p; }

function _cRSI(data) { var p = 14, g = [], lo = []; for (var i = 1; i < data.length; i++) { var c = data[i].close - data[i - 1].close; g.push(c > 0 ? c : 0); lo.push(c < 0 ? -c : 0); } if (g.length < p) return 50; var ag = 0, al = 0; for (var i = g.length - p; i < g.length; i++) { ag += g[i]; al += lo[i]; } ag /= p; al /= p; return 100 - 100 / (1 + (al === 0 ? 100 : ag / al)); }

function _cRSIat(data, idx) { var p = 14; if (idx < p) return 50; var ag = 0, al = 0; for (var i = idx - p + 1; i <= idx; i++) { var c = data[i].close - data[i - 1].close; if (c > 0) ag += c; else al -= c; } ag /= p; al /= p; return 100 - 100 / (1 + (al === 0 ? 100 : ag / al)); }

function _stochRSI(data) {
  var rsiVals = []; for (var i = 14; i < data.length; i++) rsiVals.push(_cRSIat(data, i));
  if (rsiVals.length < 14) return 0.5;
  var recent = rsiVals.slice(-14);
  var mn = Math.min.apply(null, recent), mx = Math.max.apply(null, recent);
  return mx - mn > 0 ? (rsiVals[rsiVals.length - 1] - mn) / (mx - mn) : 0.5;
}

function _elderRay(data) {
  if (data.length < 14) return { bullPower: 0, bearPower: 0, prevBullPower: 0, prevBearPower: 0 };
  // EMA 13
  var closes = data.map(function(d) { return d.close; });
  var mult = 2 / 14; var ema = closes[0];
  for (var i = 1; i < closes.length; i++) ema = (closes[i] - ema) * mult + ema;
  var prevEma = closes[0]; for (var i = 1; i < closes.length - 1; i++) prevEma = (closes[i] - prevEma) * mult + prevEma;
  return {
    bullPower: (data[data.length - 1].high || data[data.length - 1].close) - ema,
    bearPower: (data[data.length - 1].low || data[data.length - 1].close) - ema,
    prevBullPower: (data[data.length - 2].high || data[data.length - 2].close) - prevEma,
    prevBearPower: (data[data.length - 2].low || data[data.length - 2].close) - prevEma
  };
}

function _cmf(data) {
  if (data.length < 21) return 0;
  var mfvSum = 0, volSum = 0;
  for (var i = data.length - 21; i < data.length; i++) {
    var h = data[i].high || data[i].close, l = data[i].low || data[i].close, c = data[i].close;
    var v = data[i].volume || 1;
    var mfm = h === l ? 0 : ((c - l) - (h - c)) / (h - l);
    mfvSum += mfm * v; volSum += v;
  }
  return volSum > 0 ? mfvSum / volSum : 0;
}

function _williamsR(data) {
  if (data.length < 14) return -50;
  var hi = -Infinity, lo = Infinity;
  for (var i = data.length - 14; i < data.length; i++) {
    var h = data[i].high || data[i].close, l = data[i].low || data[i].close;
    if (h > hi) hi = h; if (l < lo) lo = l;
  }
  return hi === lo ? 0 : ((hi - data[data.length - 1].close) / (hi - lo)) * -100;
}

function _heikinAshi(data) {
  var ha = [];
  for (var i = 0; i < data.length; i++) {
    var c = data[i];
    var haClose = (c.open + (c.high || c.close) + (c.low || c.close) + c.close) / 4;
    var haOpen = i === 0 ? (c.open + c.close) / 2 : (ha[i - 1].open + ha[i - 1].close) / 2;
    ha.push({ time: c.time, open: haOpen, close: haClose,
      high: Math.max(c.high || c.close, haOpen, haClose),
      low: Math.min(c.low || c.close, haOpen, haClose) });
  }
  return ha;
}

function _linRegSlope(data, period) {
  if (data.length < period) return 0;
  var n = period, sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
  for (var i = 0; i < n; i++) {
    var idx = data.length - n + i;
    sumX += i; sumY += data[idx].close; sumXY += i * data[idx].close; sumXX += i * i;
  }
  return (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
}
