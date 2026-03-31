// ===== TradingView Lightweight Charts Wrapper =====

import { COLORS, CHART_COLORS } from './config.js';

const chartInstances = new Map();

/**
 * Create a candlestick chart in a container element.
 * @param {HTMLElement} container - DOM element to render chart into
 * @param {Array} ohlcvData - Array of { time, open, high, low, close, volume }
 * @param {Object} options - { showVolume, showSMA, smaLengths, chartStyle }
 * @returns {Object} { chart, candleSeries, volumeSeries, smaSeriesList }
 */
export function createAssetChart(container, ohlcvData, options = {}) {
  const {
    showVolume = true,
    showSMA = true,
    smaLengths = [20, 50],
    chartStyle = 'candlestick',
  } = options;

  // LightweightCharts is loaded globally from CDN
  const chart = LightweightCharts.createChart(container, {
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: COLORS.textSecondary,
      fontSize: 11,
    },
    grid: {
      vertLines: { color: 'rgba(48, 54, 61, 0.4)' },
      horzLines: { color: 'rgba(48, 54, 61, 0.4)' },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
      vertLine: { color: 'rgba(88, 166, 255, 0.4)', labelBackgroundColor: COLORS.surface3 },
      horzLine: { color: 'rgba(88, 166, 255, 0.4)', labelBackgroundColor: COLORS.surface3 },
    },
    rightPriceScale: {
      borderColor: COLORS.border,
      scaleMargins: { top: 0.1, bottom: showVolume ? 0.25 : 0.1 },
    },
    timeScale: {
      borderColor: COLORS.border,
      timeVisible: true,
      secondsVisible: false,
    },
    handleScroll: { vertTouchDrag: false },
  });

  let mainSeries;

  if (chartStyle === 'line') {
    mainSeries = chart.addSeries(LightweightCharts.LineSeries, {
      color: COLORS.blue,
      lineWidth: 2,
    });
    mainSeries.setData(ohlcvData.map(d => ({ time: d.time, value: d.close })));
  } else if (chartStyle === 'area') {
    mainSeries = chart.addSeries(LightweightCharts.AreaSeries, {
      topColor: 'rgba(88, 166, 255, 0.4)',
      bottomColor: 'rgba(88, 166, 255, 0.02)',
      lineColor: COLORS.blue,
      lineWidth: 2,
    });
    mainSeries.setData(ohlcvData.map(d => ({ time: d.time, value: d.close })));
  } else {
    mainSeries = chart.addSeries(LightweightCharts.CandlestickSeries, {
      upColor: CHART_COLORS.upColor,
      downColor: CHART_COLORS.downColor,
      wickUpColor: CHART_COLORS.wickUpColor,
      wickDownColor: CHART_COLORS.wickDownColor,
      borderUpColor: CHART_COLORS.borderUpColor,
      borderDownColor: CHART_COLORS.borderDownColor,
    });
    mainSeries.setData(ohlcvData);
  }

  // Volume histogram
  let volumeSeries = null;
  if (showVolume) {
    volumeSeries = chart.addSeries(LightweightCharts.HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
    });
    volumeSeries.setData(ohlcvData.map(d => ({
      time: d.time,
      value: d.volume,
      color: d.close >= d.open
        ? 'rgba(63, 185, 80, 0.3)'
        : 'rgba(248, 81, 73, 0.3)',
    })));
  }

  // SMA overlays
  const smaSeriesList = [];
  if (showSMA && chartStyle === 'candlestick') {
    const smaColors = [COLORS.blue, COLORS.yellow, COLORS.purple];
    smaLengths.forEach((len, idx) => {
      const smaData = calcSMA(ohlcvData, len);
      const smaSeries = chart.addSeries(LightweightCharts.LineSeries, {
        color: smaColors[idx % smaColors.length],
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      });
      smaSeries.setData(smaData);
      smaSeriesList.push({ length: len, series: smaSeries });
    });
  }

  chart.timeScale().fitContent();

  const instance = { chart, mainSeries, volumeSeries, smaSeriesList };
  chartInstances.set(container.id || container, instance);
  return instance;
}

/**
 * Create a dual-line comparison chart (e.g., IWM vs SPY).
 */
export function createComparisonChart(container, data1, data2, label1, label2) {
  const chart = LightweightCharts.createChart(container, {
    layout: {
      background: { type: 'solid', color: 'transparent' },
      textColor: COLORS.textSecondary,
      fontSize: 11,
    },
    grid: {
      vertLines: { color: 'rgba(48, 54, 61, 0.4)' },
      horzLines: { color: 'rgba(48, 54, 61, 0.4)' },
    },
    crosshair: {
      mode: LightweightCharts.CrosshairMode.Normal,
    },
    rightPriceScale: { borderColor: COLORS.border, visible: false },
    timeScale: { borderColor: COLORS.border, timeVisible: true },
  });

  // Normalize both series to percentage change from start
  const normalize = (data) => {
    if (!data.length) return [];
    const base = data[0].close;
    return data.map(d => ({
      time: d.time,
      value: ((d.close - base) / base) * 100,
    }));
  };

  const series1 = chart.addSeries(LightweightCharts.LineSeries, {
    color: COLORS.blue,
    lineWidth: 2,
    title: label1,
    priceScaleId: 'left',
  });
  series1.setData(normalize(data1));

  const series2 = chart.addSeries(LightweightCharts.LineSeries, {
    color: COLORS.yellow,
    lineWidth: 2,
    title: label2,
    priceScaleId: 'left',
  });
  series2.setData(normalize(data2));

  chart.priceScale('left').applyOptions({
    visible: true,
    borderColor: COLORS.border,
  });

  // Spread line (difference)
  const spreadData = normalize(data1).map((d, i) => {
    const d2 = normalize(data2)[i];
    return d2 ? { time: d.time, value: d.value - d2.value } : null;
  }).filter(Boolean);

  const spreadSeries = chart.addSeries(LightweightCharts.AreaSeries, {
    topColor: 'rgba(188, 140, 255, 0.2)',
    bottomColor: 'rgba(188, 140, 255, 0.02)',
    lineColor: COLORS.purple,
    lineWidth: 1,
    title: 'Spread',
    priceScaleId: 'right',
  });
  spreadSeries.setData(spreadData);

  chart.priceScale('right').applyOptions({
    visible: true,
    borderColor: COLORS.border,
  });

  chart.timeScale().fitContent();
  return { chart, series1, series2, spreadSeries };
}

/**
 * Resize a chart to fit its container.
 */
export function resizeChart(container) {
  const instance = chartInstances.get(container.id || container);
  if (instance) {
    const rect = container.getBoundingClientRect();
    instance.chart.resize(rect.width, rect.height);
  }
}

/**
 * Resize all tracked charts.
 */
export function resizeAllCharts() {
  chartInstances.forEach((instance, key) => {
    const el = typeof key === 'string' ? document.getElementById(key) : key;
    if (el) {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        instance.chart.resize(rect.width, rect.height);
      }
    }
  });
}

// --- SMA calculation ---
function calcSMA(data, length) {
  const result = [];
  for (let i = length - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = 0; j < length; j++) {
      sum += data[i - j].close;
    }
    result.push({ time: data[i].time, value: sum / length });
  }
  return result;
}
