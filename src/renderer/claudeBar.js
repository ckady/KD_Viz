'use strict';

// Persistent Claude token-usage bar, rendered across every mode from the
// `claude` block attached to each signal frame. Shows three things at once:
//   - context window % of the active session (the fill bar, heat-colored)
//   - cumulative cost + fresh tokens (machine-wide, today)
//   - live throughput (fresh tokens/min)

import { signalBus } from './signalBus.js';

function heat(x) {
  // green (calm) -> amber -> red as the context window fills.
  x = Math.max(0, Math.min(1, x));
  if (x < 0.6) return 'rgb(90,210,120)';
  if (x < 0.85) return 'rgb(240,200,60)';
  return 'rgb(255,80,80)';
}
function fmtTok(n) {
  if (n == null) return '--';
  if (n < 1000) return Math.round(n) + '';
  if (n < 1e6) return (n / 1e3).toFixed(0) + 'k';
  return (n / 1e6).toFixed(2) + 'M';
}
function fmtCost(c) {
  if (c == null) return '$--';
  return '$' + (c >= 100 ? c.toFixed(0) : c.toFixed(2));
}

export function createClaudeBar(el, config) {
  const fill = el.querySelector('.cb-fill');
  const ctxEl = el.querySelector('.cb-ctx');
  const costEl = el.querySelector('.cb-cost');
  const rateEl = el.querySelector('.cb-rate');
  const bfill  = el.querySelector('.cb-bfill');
  const blabel = el.querySelector('.cb-blabel');
  let userHidden = false;
  let budgetView = '5h';

  const cfg = (config && config.claude) || {};
  const limit5h   = cfg.fiveHourLimitUSD ?? 5.0;
  const limitWeek = cfg.weeklyLimitUSD   ?? 40.0;

  return {
    toggle() { userHidden = !userHidden; },
    toggleBudget() { budgetView = budgetView === '5h' ? 'week' : '5h'; },
    render() {
      const c = signalBus.claude();
      if (userHidden || !c || !c.available) {
        el.classList.add('hidden');
        return;
      }
      el.classList.remove('hidden');

      if (c.context) {
        const pct = c.context.pct;
        fill.style.width = (pct * 100).toFixed(1) + '%';
        fill.style.background = heat(pct);
        ctxEl.innerHTML =
          `<span class="cb-strong">${Math.round(pct * 100)}%</span> ` +
          `<span class="cb-dim">ctx ${fmtTok(c.context.tokens)}/${fmtTok(c.context.window)}</span>`;
      } else {
        fill.style.width = '0%';
        ctxEl.innerHTML = '<span class="cb-dim">no active session</span>';
      }

      const today = c.today || { cost: 0, tokens: 0 };
      costEl.innerHTML =
        `<span class="cb-strong">${fmtCost(today.cost)}</span> ` +
        `<span class="cb-dim">today · ${fmtTok(today.tokens)} tok</span>`;

      const rate = Math.round(c.throughputPerMin || 0);
      rateEl.innerHTML = `<span class="cb-strong">${fmtTok(rate)}</span> <span class="cb-dim">tok/min</span>`;

      if (bfill && blabel) {
        const spent = budgetView === '5h'
          ? ((c.fiveHour || {}).cost || 0)
          : ((c.week     || {}).cost || 0);
        const limit = budgetView === '5h' ? limit5h : limitWeek;
        const pct = limit > 0 ? Math.min(1, spent / limit) : 0;
        bfill.style.width = (pct * 100).toFixed(1) + '%';
        bfill.style.background = heat(pct);
        blabel.innerHTML =
          `<span class="cb-strong">${fmtCost(spent)}</span>` +
          `<span class="cb-dim">/${fmtCost(limit)} ${budgetView}</span>`;
      }
    }
  };
}
