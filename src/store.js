// 账户状态：持仓、现金、交易记录、每日净值 —— 全部落盘 data/state.json
import { loadJson, saveJson, buyFees, sellFees, execBuyPrice, execSellPrice, fmtMoney } from './util.js';
import { CFG } from './config.js';
import { bjStamp } from './env.js';

const F = 'state.json';

export function loadState() {
  let s = loadJson(F, null);
  if (!s) {
    s = {
      startDate: CFG.runStart,
      cash: CFG.startCash,
      positions: {},      // code -> {name, shares, costPrice(含费摊薄), buyTime, high(持仓期最高价), buyReason}
      trades: [],         // 全部交易流水
      daily: [],          // 每日净值 {date, equity, cash, posValue, note}
      decisions: [],      // LLM决策日志 {ts, type, code, name, action, price, reason, raw}
      events: [],         // 系统事件（风控、异常）
    };
    saveJson(F, s);
  }
  return s;
}

export function persist(s) { saveJson(F, s); }

// 市价买入（按快照价+滑点，整百股）
export function doBuy(s, { code, name, price, reason, quoteTime, quotes, shares: wantShares, stopPrice, sizingNote }) {
  if (price <= 0) return { ok: false, err: 'invalid price' };
  const exec = execBuyPrice(price);
  const eq = equityOf(s, quotes || {});
  const reserve = eq * (CFG.risk.minCashReserve || 0);   // 现金底线（程序强制）
  const budget = Math.min(s.cash - reserve, eq * CFG.risk.maxPosPct);
  let shares = wantShares != null ? Math.floor(wantShares / 100) * 100 : Math.floor(budget / (exec * 100)) * 100;
  if (shares < 100) return { ok: false, err: budget < 0 ? '现金低于底线，禁止买入' : (wantShares != null ? '风险预算不足1手' : '资金不足1手') };
  let cost = shares * exec;
  let fee = buyFees(cost);
  // 佣金最低5元可能让总额超预算，回退100股
  while (shares >= 100 && cost + fee > s.cash + 1e-6) {
    shares -= 100; cost = shares * exec; fee = buyFees(cost);
  }
  if (shares < 100) return { ok: false, err: '现金不够含费用' };

  const old = s.positions[code];
  if (old) { // 加仓摊薄
    const totalCost = old.shares * old.costPrice + cost + fee;
    old.shares += shares;
    old.costPrice = +(totalCost / old.shares).toFixed(4);
    old.high = Math.max(old.high, exec);
    if (stopPrice) old.stopPrice = stopPrice;
  } else {
    s.positions[code] = {
      name, shares, costPrice: +((cost + fee) / shares).toFixed(4),
      buyTime: bjStamp(), buyDate: bjStamp().slice(0, 10), high: exec, buyReason: reason,
      stopPrice: stopPrice || null, sizingNote: sizingNote || null,
    };
  }
  s.cash = +(s.cash - cost - fee).toFixed(2);
  const tr = {
    ts: bjStamp(), side: 'BUY', code, name, price: exec, refPrice: price,
    shares, amount: +cost.toFixed(2), fee, quoteTime, reason,
    stopPrice: stopPrice || null, sizing: sizingNote || null,
  };
  s.trades.push(tr);
  return { ok: true, trade: tr };
}

// 卖出：shares=数量（必须是持仓的整倍数内），all=全部
export function doSell(s, { code, price, reason, quoteTime, shares }) {
  const p = s.positions[code];
  if (!p) return { ok: false, err: 'no position' };
  const n = shares || p.shares;
  if (n > p.shares || n <= 0) return { ok: false, err: 'bad shares' };
  const exec = execSellPrice(price);
  const amount = n * exec;
  const fee = sellFees(amount);
  const net = amount - fee;
  const profit = +((exec - p.costPrice) * n - fee).toFixed(2);
  s.cash = +(s.cash + net).toFixed(2);
  p.shares -= n;
  if (p.shares <= 0) delete s.positions[code];
  const tr = {
    ts: bjStamp(), side: 'SELL', code, name: p.name, price: exec, refPrice: price,
    shares: n, amount: +amount.toFixed(2), fee, profit, quoteTime, reason,
  };
  s.trades.push(tr);
  return { ok: true, trade: tr };
}

export function equityOf(s, quotes) {
  let pos = 0;
  for (const [code, p] of Object.entries(s.positions)) {
    const q = quotes[code];
    pos += (q ? q.price : p.costPrice) * p.shares;
  }
  return +(s.cash + pos).toFixed(2);
}
export function posValueOf(s, quotes) {
  let pos = 0;
  for (const [code, p] of Object.entries(s.positions)) {
    const q = quotes[code];
    pos += (q ? q.price : p.costPrice) * p.shares;
  }
  return +pos.toFixed(2);
}
export function logDecision(s, d) {
  d.ts = bjStamp();
  s.decisions.push(d);
  if (s.decisions.length > 2000) s.decisions.splice(0, s.decisions.length - 2000);
}
export function logEvent(s, msg) {
  s.events.push({ ts: bjStamp(), msg });
  if (s.events.length > 500) s.events.splice(0, s.events.length - 500);
}
