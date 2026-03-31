// ===== TradingBOT Main Application =====

import {
  CRYPTO_ASSETS, STOCK_ASSETS, ALL_ASSETS,
  STORAGE_KEYS, MOCK_CORRELATIONS,
} from './config.js';
import {
  generateAllAssetData, getLatestPrice, get24hChange, generateMockSignals,
} from './mock-data.js';
import { createAssetChart, createComparisonChart, resizeAllCharts } from './charts.js';
import { initGrid, resetLayout } from './panels.js';
import { renderCorrelationMatrix } from './correlation-display.js';
import { renderIndicatorPanel } from './indicators.js';

// ===== State =====
let allData = {};
let activeMarket = localStorage.getItem(STORAGE_KEYS.activeMarket) || 'crypto';

// ===== Initialization =====
document.addEventListener('DOMContentLoaded', () => {
  // Generate mock data
  allData = generateAllAssetData(720, 60);

  // Init dashboard grid
  initGrid(onPanelReady);

  // Populate sidebar
  renderWatchlist();
  renderMarketPulse();
  renderTopCorrelations();

  // Wire up UI controls
  wireTabSwitching();
  wireThemeDrawer();
  wireStatusBar();

  // Resize charts after everything is rendered
  setTimeout(resizeAllCharts, 500);
  setTimeout(resizeAllCharts, 1500);
});

// ===== Panel Ready Callback =====
function onPanelReady(config, chartEl, bodyEl) {
  switch (config.type) {
    case 'chart':
      if (allData[config.asset]) {
        createAssetChart(chartEl, allData[config.asset], {
          showVolume: true,
          showSMA: true,
          smaLengths: [20, 50],
        });
      }
      break;

    case 'correlation':
      renderCorrelationMatrix(chartEl);
      break;

    case 'comparison':
      if (allData['IWM'] && allData['SPY']) {
        createComparisonChart(chartEl, allData['IWM'], allData['SPY'], 'IWM (Russell 2000)', 'SPY (S&P 500)');
      }
      break;

    case 'indicators':
      if (allData[config.asset || 'BTC']) {
        renderIndicatorPanel(bodyEl || chartEl, allData[config.asset || 'BTC'], config.asset || 'BTC');
      }
      break;

    case 'signals':
      renderSignals(bodyEl || chartEl);
      break;
  }
}

// ===== Watchlist =====
function renderWatchlist() {
  const container = document.getElementById('watchlist');
  if (!container) return;

  const assets = activeMarket === 'crypto' ? CRYPTO_ASSETS : STOCK_ASSETS;

  container.innerHTML = assets.map(asset => {
    const data = allData[asset.symbol];
    const price = data ? getLatestPrice(data) : asset.price;
    const change = data ? get24hChange(data) : { percent: 0, value: 0 };
    const isUp = change.percent >= 0;
    const decimals = price > 100 ? 2 : price > 1 ? 4 : 6;

    return `
      <div class="watchlist-item" data-symbol="${asset.symbol}">
        <div>
          <div class="symbol">${asset.symbol}</div>
          <div class="text-text-secondary" style="font-size:0.65rem">${asset.name}</div>
        </div>
        <div class="text-right">
          <div class="price">$${price.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}</div>
          <div class="change ${isUp ? 'up' : 'down'}">${isUp ? '+' : ''}${change.percent.toFixed(2)}%</div>
        </div>
      </div>
    `;
  }).join('');
}

// ===== Market Pulse =====
function renderMarketPulse() {
  const container = document.getElementById('market-pulse');
  if (!container) return;

  const spyData = allData['SPY'];
  const btcData = allData['BTC'];
  const iwmData = allData['IWM'];

  const spyChange = spyData ? get24hChange(spyData) : { percent: 0 };
  const btcChange = btcData ? get24hChange(btcData) : { percent: 0 };
  const iwmChange = iwmData ? get24hChange(iwmData) : { percent: 0 };

  const btcSpyCorr = MOCK_CORRELATIONS['BTC-SPY'] || 0.48;

  container.innerHTML = `
    <div class="pulse-item">
      <span class="pulse-label">S&P 500</span>
      <span class="pulse-value ${spyChange.percent >= 0 ? 'text-accent-green' : 'text-accent-red'}">${spyChange.percent >= 0 ? '+' : ''}${spyChange.percent.toFixed(2)}%</span>
    </div>
    <div class="pulse-item">
      <span class="pulse-label">BTC 24h</span>
      <span class="pulse-value ${btcChange.percent >= 0 ? 'text-accent-green' : 'text-accent-red'}">${btcChange.percent >= 0 ? '+' : ''}${btcChange.percent.toFixed(2)}%</span>
    </div>
    <div class="pulse-item">
      <span class="pulse-label">Russell 2000</span>
      <span class="pulse-value ${iwmChange.percent >= 0 ? 'text-accent-green' : 'text-accent-red'}">${iwmChange.percent >= 0 ? '+' : ''}${iwmChange.percent.toFixed(2)}%</span>
    </div>
    <div class="pulse-item mt-1 pt-1" style="border-top: 1px solid var(--border-dim)">
      <span class="pulse-label">BTC/SPY Corr</span>
      <span class="pulse-value text-accent-blue">${btcSpyCorr.toFixed(2)}</span>
    </div>
    <div class="pulse-item">
      <span class="pulse-label">Regime</span>
      <span class="pulse-value text-accent-green">Risk-On</span>
    </div>
  `;
}

// ===== Top Correlations =====
function renderTopCorrelations() {
  const container = document.getElementById('top-correlations');
  if (!container) return;

  const sorted = Object.entries(MOCK_CORRELATIONS)
    .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
    .slice(0, 5);

  container.innerHTML = sorted.map(([pair, value]) => {
    const color = value > 0.7 ? 'text-accent-green' : value > 0.4 ? 'text-accent-yellow' : 'text-text-secondary';
    return `
      <div class="flex justify-between items-center py-1">
        <span class="text-text-secondary">${pair}</span>
        <span class="${color} font-semibold">${value.toFixed(2)}</span>
      </div>
    `;
  }).join('');
}

// ===== Signals Panel =====
function renderSignals(container) {
  const signals = generateMockSignals();
  container.innerHTML = `
    <div class="space-y-2 p-1">
      ${signals.map(s => `
        <div class="signal-item ${s.type}">
          <div class="flex-1">
            <div class="flex items-center justify-between mb-1">
              <span class="font-semibold text-text-primary">${s.title}</span>
              <span class="signal-time">${s.time}</span>
            </div>
            <p class="text-text-secondary leading-relaxed">${s.message}</p>
            <div class="mt-1 flex items-center gap-2">
              <span class="text-text-secondary">Confidence:</span>
              <div class="flex-1 bg-surface-3 rounded-full h-1.5">
                <div class="h-1.5 rounded-full ${s.confidence > 70 ? 'bg-accent-green' : 'bg-accent-yellow'}" style="width:${s.confidence}%"></div>
              </div>
              <span class="font-semibold ${s.confidence > 70 ? 'text-accent-green' : 'text-accent-yellow'}">${s.confidence}%</span>
            </div>
          </div>
        </div>
      `).join('')}
    </div>
  `;
}

// ===== Tab Switching =====
function wireTabSwitching() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tab-btn').forEach(b => {
        b.classList.remove('text-accent-blue', 'border-accent-blue');
        b.classList.add('text-text-secondary', 'border-transparent');
      });
      btn.classList.remove('text-text-secondary', 'border-transparent');
      btn.classList.add('text-accent-blue', 'border-accent-blue');

      activeMarket = btn.dataset.market;
      localStorage.setItem(STORAGE_KEYS.activeMarket, activeMarket);
      renderWatchlist();
    });
  });

  // Set initial active tab
  const activeBtn = document.querySelector(`.tab-btn[data-market="${activeMarket}"]`);
  if (activeBtn) {
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.remove('text-accent-blue', 'border-accent-blue');
      b.classList.add('text-text-secondary', 'border-transparent');
    });
    activeBtn.classList.remove('text-text-secondary', 'border-transparent');
    activeBtn.classList.add('text-accent-blue', 'border-accent-blue');
  }
}

// ===== Theme Drawer =====
function wireThemeDrawer() {
  const drawer = document.getElementById('theme-drawer');
  const openBtn = document.getElementById('btn-theme-toggle');
  const closeBtn = document.getElementById('btn-close-theme');

  if (openBtn && drawer) {
    openBtn.addEventListener('click', () => drawer.classList.toggle('translate-x-full'));
  }
  if (closeBtn && drawer) {
    closeBtn.addEventListener('click', () => drawer.classList.add('translate-x-full'));
  }

  // Accent color swatches
  document.querySelectorAll('.accent-swatch').forEach(swatch => {
    swatch.addEventListener('click', () => {
      document.querySelectorAll('.accent-swatch').forEach(s => {
        s.classList.remove('ring-2', 'ring-accent-blue', 'ring-offset-2', 'ring-offset-surface-1');
      });
      swatch.classList.add('ring-2', 'ring-accent-blue', 'ring-offset-2', 'ring-offset-surface-1');
    });
  });

  // Panel opacity
  const opacitySlider = document.getElementById('panel-opacity');
  if (opacitySlider) {
    opacitySlider.addEventListener('input', (e) => {
      document.documentElement.style.setProperty('--panel-opacity', e.target.value / 100);
    });
  }

  // Reset layout
  const resetBtn = document.getElementById('btn-reset-layout');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      resetLayout(onPanelReady);
    });
  }

  // Fullscreen
  const fsBtn = document.getElementById('btn-fullscreen');
  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
      } else {
        document.exitFullscreen();
      }
    });
  }
}

// ===== Status Bar =====
function wireStatusBar() {
  const clockEl = document.getElementById('status-clock');
  const updateEl = document.getElementById('status-last-update');
  const marketHoursEl = document.getElementById('status-market-hours');

  function updateClock() {
    const now = new Date();
    if (clockEl) clockEl.textContent = now.toLocaleTimeString();

    // US market hours check (9:30 AM - 4:00 PM ET, Mon-Fri)
    if (marketHoursEl) {
      const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const hour = et.getHours();
      const min = et.getMinutes();
      const day = et.getDay();
      const marketTime = hour + min / 60;
      const isOpen = day >= 1 && day <= 5 && marketTime >= 9.5 && marketTime < 16;
      marketHoursEl.textContent = `Market: ${isOpen ? 'Open' : 'Closed'}`;
      marketHoursEl.className = isOpen ? 'text-accent-green' : 'text-text-secondary';
    }
  }

  updateClock();
  setInterval(updateClock, 1000);

  if (updateEl) {
    updateEl.textContent = `Last update: ${new Date().toLocaleTimeString()}`;
  }
}
