// ===== Correlation Heatmap Display =====

import { ALL_ASSETS, MOCK_CORRELATIONS } from './config.js';

/**
 * Render an NxN correlation heatmap into a container.
 * @param {HTMLElement} container
 */
export function renderCorrelationMatrix(container) {
  const symbols = ALL_ASSETS.map(a => a.symbol);
  const n = symbols.length;

  container.innerHTML = '';
  container.style.display = 'grid';
  container.style.gridTemplateColumns = `48px repeat(${n}, 1fr)`;
  container.style.gridTemplateRows = `28px repeat(${n}, 1fr)`;
  container.style.gap = '2px';
  container.style.padding = '8px';
  container.style.height = '100%';
  container.style.alignContent = 'stretch';

  // Top-left empty cell
  const corner = document.createElement('div');
  container.appendChild(corner);

  // Column headers
  symbols.forEach(sym => {
    const header = document.createElement('div');
    header.textContent = sym;
    header.style.cssText = 'font-size:0.65rem;font-weight:700;text-align:center;color:var(--text-secondary);display:flex;align-items:center;justify-content:center;';
    container.appendChild(header);
  });

  // Rows
  symbols.forEach((rowSym, ri) => {
    // Row header
    const rowHeader = document.createElement('div');
    rowHeader.textContent = rowSym;
    rowHeader.style.cssText = 'font-size:0.65rem;font-weight:700;color:var(--text-secondary);display:flex;align-items:center;justify-content:flex-end;padding-right:6px;';
    container.appendChild(rowHeader);

    // Cells
    symbols.forEach((colSym, ci) => {
      const cell = document.createElement('div');
      cell.classList.add('corr-cell');

      let value;
      if (ri === ci) {
        value = 1.0;
      } else {
        const key1 = `${rowSym}-${colSym}`;
        const key2 = `${colSym}-${rowSym}`;
        value = MOCK_CORRELATIONS[key1] ?? MOCK_CORRELATIONS[key2] ?? 0;
      }

      cell.textContent = value.toFixed(2);
      cell.style.backgroundColor = correlationColor(value);
      cell.style.color = Math.abs(value) > 0.5 ? '#fff' : 'var(--text-secondary)';
      cell.title = `${rowSym} / ${colSym}: ${value.toFixed(3)}`;

      cell.addEventListener('click', () => {
        highlightCorrelation(cell, rowSym, colSym, value);
      });

      container.appendChild(cell);
    });
  });
}

/**
 * Map a correlation value (-1 to 1) to a color.
 */
function correlationColor(value) {
  if (value >= 0) {
    // Green scale: 0 = transparent, 1 = bright green
    const intensity = value;
    return `rgba(63, 185, 80, ${0.15 + intensity * 0.65})`;
  } else {
    // Red scale: 0 = transparent, -1 = bright red
    const intensity = Math.abs(value);
    return `rgba(248, 81, 73, ${0.15 + intensity * 0.65})`;
  }
}

/**
 * Briefly highlight a clicked correlation cell.
 */
function highlightCorrelation(cell, sym1, sym2, value) {
  cell.style.outline = '2px solid var(--accent-blue)';
  cell.style.outlineOffset = '-1px';
  setTimeout(() => {
    cell.style.outline = 'none';
  }, 1500);
}
