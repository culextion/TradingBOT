// ===== Gridstack Panel Management =====

import { STORAGE_KEYS, DEFAULT_LAYOUT } from './config.js';
import { resizeAllCharts } from './charts.js';

let grid = null;

/**
 * Initialize the Gridstack grid and load saved or default layout.
 * @param {Function} onPanelReady - Called with (panelConfig, bodyElement) for each panel
 * @returns {Object} The GridStack instance
 */
export function initGrid(onPanelReady) {
  grid = GridStack.init({
    column: 12,
    cellHeight: 60,
    margin: 6,
    float: true,
    animate: true,
    draggable: { handle: '.panel-header' },
    resizable: { handles: 'se, sw' },
  }, '#dashboard-grid');

  const layout = loadLayout();
  layout.forEach(panel => {
    addPanel(panel, onPanelReady);
  });

  // Save layout on change
  grid.on('change', () => saveLayout());

  // Resize charts when panels resize
  grid.on('resizestop', () => {
    setTimeout(resizeAllCharts, 100);
  });

  // Handle window resize
  window.addEventListener('resize', () => {
    setTimeout(resizeAllCharts, 150);
  });

  return grid;
}

/**
 * Add a panel to the grid.
 */
function addPanel(config, onPanelReady) {
  const contentEl = document.createElement('div');
  contentEl.innerHTML = `
    <div class="grid-stack-item-content">
      <div class="panel-header">
        <span class="panel-title">${config.title}</span>
        <div class="panel-actions">
          ${config.type === 'chart' ? `
            <div class="flex gap-1 mr-2">
              <button class="tf-btn active" data-tf="1H">1H</button>
              <button class="tf-btn" data-tf="4H">4H</button>
              <button class="tf-btn" data-tf="1D">1D</button>
              <button class="tf-btn" data-tf="1W">1W</button>
            </div>
          ` : ''}
          <button class="btn-minimize" title="Minimize">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14"/></svg>
          </button>
          <button class="btn-maximize" title="Maximize">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>
          </button>
        </div>
      </div>
      <div class="panel-body ${config.type === 'chart' || config.type === 'comparison' ? 'no-pad' : ''}" id="panel-body-${config.id}">
        <div class="chart-container" id="chart-${config.id}"></div>
      </div>
    </div>
  `;

  const widget = grid.addWidget({
    x: config.x,
    y: config.y,
    w: config.w,
    h: config.h,
    id: config.id,
    content: contentEl.innerHTML,
  });

  // Wire up panel actions
  const panelEl = widget;
  const bodyEl = panelEl.querySelector('.panel-body');
  const chartEl = panelEl.querySelector('.chart-container');

  // Timeframe buttons
  panelEl.querySelectorAll('.tf-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      panelEl.querySelectorAll('.tf-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });

  // Maximize
  const maxBtn = panelEl.querySelector('.btn-maximize');
  if (maxBtn) {
    maxBtn.addEventListener('click', () => {
      const isMax = panelEl.dataset.maximized === 'true';
      if (isMax) {
        // Restore
        grid.update(panelEl, {
          x: parseInt(panelEl.dataset.origX),
          y: parseInt(panelEl.dataset.origY),
          w: parseInt(panelEl.dataset.origW),
          h: parseInt(panelEl.dataset.origH),
        });
        panelEl.dataset.maximized = 'false';
      } else {
        // Save original
        const node = panelEl.gridstackNode;
        panelEl.dataset.origX = node.x;
        panelEl.dataset.origY = node.y;
        panelEl.dataset.origW = node.w;
        panelEl.dataset.origH = node.h;
        grid.update(panelEl, { x: 0, y: 0, w: 12, h: 8 });
        panelEl.dataset.maximized = 'true';
      }
      setTimeout(resizeAllCharts, 200);
    });
  }

  if (onPanelReady) {
    // Small delay so DOM is rendered
    requestAnimationFrame(() => {
      onPanelReady(config, chartEl, bodyEl);
    });
  }
}

/**
 * Save current layout to localStorage.
 */
function saveLayout() {
  if (!grid) return;
  const items = grid.getGridItems();
  const layout = items.map(el => {
    const node = el.gridstackNode;
    return {
      id: node.id,
      x: node.x,
      y: node.y,
      w: node.w,
      h: node.h,
    };
  });
  localStorage.setItem(STORAGE_KEYS.layout, JSON.stringify(layout));
}

/**
 * Load layout from localStorage or return default.
 */
function loadLayout() {
  const saved = localStorage.getItem(STORAGE_KEYS.layout);
  if (saved) {
    try {
      const positions = JSON.parse(saved);
      // Merge saved positions with default config (to keep type, title, asset info)
      return DEFAULT_LAYOUT.map(def => {
        const pos = positions.find(p => p.id === def.id);
        return pos ? { ...def, ...pos } : def;
      });
    } catch {
      return DEFAULT_LAYOUT;
    }
  }
  return DEFAULT_LAYOUT;
}

/**
 * Reset layout to default.
 */
export function resetLayout(onPanelReady) {
  localStorage.removeItem(STORAGE_KEYS.layout);
  if (grid) {
    grid.removeAll();
    DEFAULT_LAYOUT.forEach(panel => addPanel(panel, onPanelReady));
    setTimeout(resizeAllCharts, 200);
  }
}

export { grid };
