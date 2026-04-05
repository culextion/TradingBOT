// ===== Technical Indicators =====

/**
 * Calculate Simple Moving Average.
 */
export function calcSMA(data, period) {
  const result = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j].close;
    }
    result.push({ time: data[i].time, value: sum / period });
  }
  return result;
}

/**
 * Calculate Exponential Moving Average.
 */
export function calcEMA(data, period) {
  const result = [];
  const multiplier = 2 / (period + 1);

  // Start with SMA for first value
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += data[i].close;
  }
  let ema = sum / period;
  result.push({ time: data[period - 1].time, value: ema });

  for (let i = period; i < data.length; i++) {
    ema = (data[i].close - ema) * multiplier + ema;
    result.push({ time: data[i].time, value: ema });
  }
  return result;
}

/**
 * Calculate RSI (Relative Strength Index).
 */
export function calcRSI(data, period = 14) {
  const result = [];
  const gains = [];
  const losses = [];

  for (let i = 1; i < data.length; i++) {
    const change = data[i].close - data[i - 1].close;
    gains.push(change > 0 ? change : 0);
    losses.push(change < 0 ? -change : 0);

    if (i >= period) {
      const avgGain = gains.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const avgLoss = losses.slice(i - period, i).reduce((a, b) => a + b, 0) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      const rsi = 100 - (100 / (1 + rs));
      result.push({ time: data[i].time, value: rsi });
    }
  }
  return result;
}

/**
 * Calculate MACD.
 */
export function calcMACD(data, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  const fastEMA = calcEMAValues(data.map(d => d.close), fastPeriod);
  const slowEMA = calcEMAValues(data.map(d => d.close), slowPeriod);

  const macdLine = [];
  const startIdx = slowPeriod - 1;
  for (let i = startIdx; i < data.length; i++) {
    const fi = i - (fastPeriod - 1);
    const si = i - (slowPeriod - 1);
    if (fi >= 0 && si >= 0 && fi < fastEMA.length && si < slowEMA.length) {
      macdLine.push({
        time: data[i].time,
        value: fastEMA[fi] - slowEMA[si],
      });
    }
  }

  const signalLine = calcEMAFromValues(macdLine.map(d => d.value), signalPeriod);
  const histogram = [];
  const signalStart = signalPeriod - 1;

  for (let i = signalStart; i < macdLine.length; i++) {
    const si = i - signalStart;
    if (si < signalLine.length) {
      histogram.push({
        time: macdLine[i].time,
        value: macdLine[i].value - signalLine[si],
      });
    }
  }

  return { macdLine, signalLine: signalLine.map((v, i) => ({ time: macdLine[i + signalStart].time, value: v })), histogram };
}

/**
 * Calculate Bollinger Bands.
 */
export function calcBollingerBands(data, period = 20, stdDev = 2) {
  const result = { upper: [], middle: [], lower: [] };
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < period; j++) sum += data[i - j].close;
    const mean = sum / period;

    let variance = 0;
    for (let j = 0; j < period; j++) variance += Math.pow(data[i - j].close - mean, 2);
    const std = Math.sqrt(variance / period);

    result.upper.push({ time: data[i].time, value: mean + stdDev * std });
    result.middle.push({ time: data[i].time, value: mean });
    result.lower.push({ time: data[i].time, value: mean - stdDev * std });
  }
  return result;
}

/**
 * Render indicator summary panel.
 * @param {HTMLElement} container
 * @param {Array} ohlcvData
 * @param {string} symbol
 */
export function renderIndicatorPanel(container, ohlcvData, symbol) {
  const rsi = calcRSI(ohlcvData);
  const macd = calcMACD(ohlcvData);
  const sma20 = calcSMA(ohlcvData, 20);
  const sma50 = calcSMA(ohlcvData, 50);
  const bb = calcBollingerBands(ohlcvData);

  const latestRSI = rsi.length ? rsi[rsi.length - 1].value : 0;
  const latestMACD = macd.macdLine.length ? macd.macdLine[macd.macdLine.length - 1].value : 0;
  const latestSignal = macd.signalLine.length ? macd.signalLine[macd.signalLine.length - 1].value : 0;
  const latestSMA20 = sma20.length ? sma20[sma20.length - 1].value : 0;
  const latestSMA50 = sma50.length ? sma50[sma50.length - 1].value : 0;
  const latestPrice = ohlcvData[ohlcvData.length - 1].close;
  const latestBBUpper = bb.upper.length ? bb.upper[bb.upper.length - 1].value : 0;
  const latestBBLower = bb.lower.length ? bb.lower[bb.lower.length - 1].value : 0;

  const rsiSignal = latestRSI > 70 ? 'Overbought' : latestRSI < 30 ? 'Oversold' : 'Neutral';
  const rsiColor = latestRSI > 70 ? 'text-accent-red' : latestRSI < 30 ? 'text-accent-green' : 'text-text-secondary';
  const macdSignal = latestMACD > latestSignal ? 'Bullish' : 'Bearish';
  const macdColor = latestMACD > latestSignal ? 'text-accent-green' : 'text-accent-red';
  const trendSignal = latestPrice > latestSMA20 && latestSMA20 > latestSMA50 ? 'Uptrend' :
                      latestPrice < latestSMA20 && latestSMA20 < latestSMA50 ? 'Downtrend' : 'Sideways';
  const trendColor = trendSignal === 'Uptrend' ? 'text-accent-green' : trendSignal === 'Downtrend' ? 'text-accent-red' : 'text-accent-yellow';

  const bbPosition = ((latestPrice - latestBBLower) / (latestBBUpper - latestBBLower) * 100).toFixed(0);

  container.innerHTML = `
    <div class="space-y-3 text-xs p-2">
      <div class="text-text-secondary font-semibold uppercase tracking-wider mb-2">${symbol} Indicators</div>

      <div class="flex items-center justify-between p-2 bg-surface-2 rounded">
        <span class="text-text-secondary">RSI (14)</span>
        <div class="text-right">
          <span class="font-semibold">${latestRSI.toFixed(1)}</span>
          <span class="${rsiColor} ml-2 font-semibold">${rsiSignal}</span>
        </div>
      </div>

      <div class="flex items-center justify-between p-2 bg-surface-2 rounded">
        <span class="text-text-secondary">MACD</span>
        <div class="text-right">
          <span class="font-semibold">${latestMACD.toFixed(4)}</span>
          <span class="${macdColor} ml-2 font-semibold">${macdSignal}</span>
        </div>
      </div>

      <div class="flex items-center justify-between p-2 bg-surface-2 rounded">
        <span class="text-text-secondary">Trend (SMA 20/50)</span>
        <span class="${trendColor} font-semibold">${trendSignal}</span>
      </div>

      <div class="flex items-center justify-between p-2 bg-surface-2 rounded">
        <span class="text-text-secondary">Bollinger %B</span>
        <span class="font-semibold">${bbPosition}%</span>
      </div>

      <div class="p-2 bg-surface-2 rounded">
        <div class="text-text-secondary mb-1">Moving Averages</div>
        <div class="flex justify-between"><span class="text-accent-blue">SMA 20</span><span>${latestSMA20.toFixed(2)}</span></div>
        <div class="flex justify-between"><span class="text-accent-yellow">SMA 50</span><span>${latestSMA50.toFixed(2)}</span></div>
      </div>

      <div class="p-2 bg-surface-2 rounded">
        <div class="text-text-secondary mb-1">Bollinger Bands</div>
        <div class="flex justify-between"><span>Upper</span><span>${latestBBUpper.toFixed(2)}</span></div>
        <div class="flex justify-between"><span>Lower</span><span>${latestBBLower.toFixed(2)}</span></div>
        <div class="w-full bg-surface-3 rounded-full h-2 mt-2">
          <div class="bg-accent-blue h-2 rounded-full" style="width: ${Math.min(100, Math.max(0, parseInt(bbPosition)))}%"></div>
        </div>
      </div>

      <div class="mt-3 flex flex-wrap gap-1">
        <span class="indicator-badge active">RSI</span>
        <span class="indicator-badge active">MACD</span>
        <span class="indicator-badge active">SMA</span>
        <span class="indicator-badge active">BB</span>
        <span class="indicator-badge active">ADX</span>
        <span class="indicator-badge">EMA</span>
        <span class="indicator-badge">VWAP</span>
        <span class="indicator-badge">OBV</span>
      </div>
    </div>
  `;
}

/**
 * Calculate ADX (Average Directional Index) — Batch 8.
 */
export function calcADX(data, period = 14) {
  if (!data || data.length < period * 3) return { adx: 0, pdi: 0, mdi: 0 };
  const tr = [], pdm = [], mdm = [];
  for (let i = 1; i < data.length; i++) {
    const hi = data[i].high || data[i].close;
    const lo = data[i].low || data[i].close;
    const phi = data[i - 1].high || data[i - 1].close;
    const plo = data[i - 1].low || data[i - 1].close;
    const pc = data[i - 1].close;
    tr.push(Math.max(hi - lo, Math.abs(hi - pc), Math.abs(lo - pc)));
    const up = hi - phi, dn = plo - lo;
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
  }
  if (tr.length < period) return { adx: 0, pdi: 0, mdi: 0 };
  let atr = 0, apdm = 0, amdm = 0;
  for (let i = 0; i < period; i++) { atr += tr[i]; apdm += pdm[i]; amdm += mdm[i]; }
  const dx = [];
  for (let i = period; i < tr.length; i++) {
    atr = atr - atr / period + tr[i];
    apdm = apdm - apdm / period + pdm[i];
    amdm = amdm - amdm / period + mdm[i];
    const pdi = atr > 0 ? (apdm / atr) * 100 : 0;
    const mdi = atr > 0 ? (amdm / atr) * 100 : 0;
    const sum = pdi + mdi;
    dx.push(sum > 0 ? Math.abs(pdi - mdi) / sum * 100 : 0);
  }
  if (dx.length < period) return { adx: 0, pdi: atr > 0 ? (apdm / atr) * 100 : 0, mdi: atr > 0 ? (amdm / atr) * 100 : 0 };
  let adx = 0;
  for (let i = 0; i < period; i++) adx += dx[i];
  adx /= period;
  for (let i = period; i < dx.length; i++) adx = (adx * (period - 1) + dx[i]) / period;
  return { adx, pdi: atr > 0 ? (apdm / atr) * 100 : 0, mdi: atr > 0 ? (amdm / atr) * 100 : 0 };
}

// --- Internal helpers ---
function calcEMAValues(values, period) {
  const result = [];
  const multiplier = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let ema = sum / period;
  result.push(ema);
  for (let i = period; i < values.length; i++) {
    ema = (values[i] - ema) * multiplier + ema;
    result.push(ema);
  }
  return result;
}

function calcEMAFromValues(values, period) {
  return calcEMAValues(values, period);
}
