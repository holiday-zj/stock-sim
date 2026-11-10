// 主引擎：盘中轮询 → LLM决策 → 执行 → 风控 → 收盘记账
import { CFG } from './config.js';
import { bjNow, bjStamp, bjDate, bjHM } from './env.js';
import { loadState, persist, doBuy, doSell, equityOf, posValueOf, logDecision, logEvent } from './store.js';
import { getQuotes, getDailyKline, getMarketRegime } from './market.js';
import { decide, riskCheck, limitUp, limitDown } from './strategy.js';
import { calcShares } from './sizing.js';
import { dailyReflection } from './evolve.js';
import { sleep, appendLog } from './util.js';
import fs from 'node:fs';
import path from 'node:path';

const state = loadState();
let tradeDays = null;          // 交易日历缓存（上证日K日期，30分钟TTL——凌晨缓存可能缺当日）
let lastDecisionTs = 0;
let running = false;
let stopped = false;           // 实验到期后停止交易
let deciding = false;          // 决策回合互斥锁：防止tick重叠导致重复下单
let closing = false;           // 收盘处理互斥锁

function inTradeWindow() {
  const n = bjNow();
  const dow = n.getDay();
  if (dow === 0 || dow === 6) return false;
  const hm = bjHM();
  return (hm >= '09:30' && hm <= '11:30') || (hm >= '13:00' && hm <= '15:00');
}
function inDecisionWindow() {
  const hm = bjHM();
  return hm >= CFG.loop.firstDecision && hm <= CFG.loop.lastDecision;
}

async function ensureTradeDays(force = false) {
  const now = Date.now();
  if (!force && tradeDays && now - tradeDays.fetchedAt < 5 * 60e3) return tradeDays.days;
  const ks = await getDailyKline('000001', 40);
  if (!ks) return tradeDays?.days || [];
  tradeDays = { today: bjDate(), fetchedAt: now, days: ks.map(k => k.date) };
  return tradeDays.days;
}
// 兜底判断：工作日+大盘快照时间是今天 → 今天就是交易日（当日K线开盘初期可能还没生成）
async function looksLikeTradeDay() {
  const n = bjNow();
  const dow = n.getDay();
  if (dow === 0 || dow === 6) return false;
  try {
    const idx = await getIndices();
    return !!(idx && idx.length);
  } catch { return false; }
}
function heldTradeDays(buyDate) {
  const days = tradeDays?.days || [];
  const i = days.indexOf(buyDate);
  if (i < 0) return 99;
  return days.length - 1 - i;
}

// 执行一次决策回合
async function runDecisionRound(force = false) {
  if (deciding) return;                              // 已有回合在跑，跳过（关键：防并发重复下单）
  if (!force && Date.now() - lastDecisionTs < CFG.loop.decisionMinGapMin * 60e3) return;
  deciding = true;
  try {
    await _runDecisionRound(force);
  } finally {
    deciding = false;
  }
}
// 账户级回撤熔断：本金是命根子，净值自高点回撤越大防守越重
function drawdownGuard(quotes) {
  const eq = equityOf(state, quotes);
  if (!state.peakEquity || eq > state.peakEquity) state.peakEquity = eq;
  const dd = eq / (state.peakEquity || CFG.startCash) - 1;
  if (dd <= CFG.risk.ddHalt) return { mode: 'halt', dd, eq, extraMul: 0 };
  if (dd <= CFG.risk.ddDefensive) return { mode: 'defensive', dd, eq, extraMul: 0.5 };
  return { mode: 'normal', dd, eq, extraMul: 1 };
}

async function _runDecisionRound(force = false) {
  lastDecisionTs = Date.now();
  const codes = Object.keys(state.positions);
  const quotes = codes.length ? await getQuotes(codes) : {};
  const guard = drawdownGuard(quotes);

  // 1) 程序风控优先（吊灯止损/保本线/时间止损，强制卖出，不问LLM）
  const klCache = new Map();
  const getKlines = async (code) => {
    if (!klCache.has(code)) klCache.set(code, await getDailyKline(code, 30));
    return klCache.get(code);
  };
  const riskOrders = await riskCheck(state, quotes, (code) => heldTradeDays(state.positions[code]?.buyDate || ''), getKlines);
  persist(state);  // 保存上抬后的止损线
  for (const ro of riskOrders) {
    const q = quotes[ro.code];
    if (!q) continue;
    if (limitDown(q)) { logEvent(state, `跌停无法卖出 ${ro.code}：${ro.reason}`); continue; }
    const r = doSell(state, { code: ro.code, price: q.price, reason: '[风控]' + ro.reason, quoteTime: q.time });
    if (r.ok) logDecision(state, { type: 'RISK_SELL', code: ro.code, name: r.trade.name, price: r.trade.price, shares: r.trade.shares, profit: r.trade.profit, reason: ro.reason });
  }

  // 熔断halt模式：不再问LLM买入，只做风控卖出，省token也保本金
  if (guard.mode === 'halt') {
    logEvent(state, `回撤熔断：净值自高点回撤${(guard.dd*100).toFixed(1)}%≤-8%，停止新开仓，只执行风控离场`);
    persist(state);
    return;
  }

  // 2) LLM 决策（带大盘趋势体制+回撤状态）
  const regime = await getMarketRegime().catch(() => ({ regime: 'unknown', detail: '获取失败' }));
  const maxPos = (CFG.risk.regimeMaxPos || {})[regime.regime] ?? CFG.risk.maxPositions;
  let decision;
  try {
    const res = await decide(state, { quotes: await getQuotes(Object.keys(state.positions)), nowBJ: bjStamp(), regime, maxPos, guard });
    decision = res.decision;
    // 刷新行情引用
    Object.assign(quotes, res.quotes);
  } catch (e) {
    logEvent(state, 'LLM决策失败: ' + (e.message || e));
    persist(state);
    return;
  }

  const actions = Array.isArray(decision?.actions) ? decision.actions : [];
  for (const a of actions) {
    try {
      if (a.type === 'BUY' && a.code) {
        if (Object.keys(state.positions).length >= maxPos && !state.positions[a.code]) {
          logEvent(state, `仓位已满(${regime.regime}体制上限${maxPos}只)，忽略买入 ${a.code}`); continue;
        }
        const q = (await getQuotes([a.code]))[a.code];
        if (!q || q.price <= 0) { logEvent(state, `行情缺失，忽略买入 ${a.code}`); continue; }
        if (limitUp(q)) { logEvent(state, `涨停买不进 ${a.code} ${q.price}`); continue; }
        // 专业仓位：ATR波动率 + 固定风险比例(1.5%/笔)，而非顶格买
        const klines = await getKlines(a.code).catch(() => null);
        const eq = equityOf(state, quotes);
        const sz = calcShares({ equity: eq, cash: state.cash, price: q.price, klines, regime: regime.regime, extraMul: guard.extraMul });
        if (sz.shares < 100) { logEvent(state, `仓位不足1手跳过 ${a.code}: ${sz.reason}`); continue; }
        const r = doBuy(state, { code: a.code, name: q.name || a.name, price: q.price, reason: a.reason || decision?.summary || '', quoteTime: q.time, quotes, shares: sz.shares, stopPrice: sz.stopPrice, sizingNote: sz.reason });
        if (r.ok) {
          logDecision(state, { type: 'LLM_BUY', code: a.code, name: r.trade.name, price: r.trade.price, shares: r.trade.shares, amount: r.trade.amount, fee: r.trade.fee, reason: a.reason || '', sizing: sz.reason, stopPrice: sz.stopPrice, posPct: (sz.positionPct*100).toFixed(1)+'%' });
        } else logEvent(state, `买入失败 ${a.code}: ${r.err}`);
      } else if (a.type === 'SELL' && a.code && state.positions[a.code]) {
        const p = state.positions[a.code];
        if (p.buyDate === bjDate()) { logEvent(state, `T+1锁定，无法卖 ${a.code}`); continue; }
        const q = (await getQuotes([a.code]))[a.code];
        if (!q) continue;
        if (limitDown(q)) { logEvent(state, `跌停卖不出 ${a.code}`); continue; }
        const r = doSell(state, { code: a.code, price: q.price, reason: a.reason || decision?.summary || '', quoteTime: q.time });
        if (r.ok) logDecision(state, { type: 'LLM_SELL', code: a.code, name: r.trade.name, price: r.trade.price, shares: r.trade.shares, profit: r.trade.profit, reason: a.reason || '' });
      } else if (a.type === 'HOLD' && a.code) {
        logDecision(state, { type: 'HOLD', code: a.code, name: a.name || '', reason: a.reason || '' });
      }
    } catch (e) { logEvent(state, `执行异常 ${a?.code}: ${e.message}`); }
  }
  logDecision(state, { type: 'REGIME', regime: regime.regime, detail: regime.detail, dd: +(guard.dd*100).toFixed(2)+'%', guard: guard.mode });
  if (decision?.summary) logDecision(state, { type: 'SUMMARY', summary: decision.summary });
  if (decision?.__reasoning) logDecision(state, { type: 'THINKING', text: String(decision.__reasoning).slice(0, 1000) });
  persist(state);
}

// 收盘记账：写当日净值（实验最后一天先尝试清仓，按收盘估值）
async function closeOfDay() {
  if (closing) return;
  closing = true;
  try { await _closeOfDay(); } finally { closing = false; }
}
async function _closeOfDay() {
  const today = bjDate();
  if (state.daily.find(d => d.date === today)) return;
  // 实验终点：尽力清仓（T+1锁定的留仓按收盘价计入净值）
  if (today === CFG.runEnd) {
    const codes = Object.keys(state.positions);
    if (codes.length) {
      const qs = await getQuotes(codes);
      for (const code of codes) {
        const p = state.positions[code];
        const q = qs[code];
        if (!p || !q || p.buyDate === today || limitDown(q)) continue;
        const r = doSell(state, { code, price: q.price, reason: '[到期清仓]实验结束', quoteTime: q.time });
        if (r.ok) logDecision(state, { type: 'FINAL_SELL', code, name: r.trade.name, price: r.trade.price, shares: r.trade.shares, profit: r.trade.profit, reason: '实验期结束清仓' });
      }
      persist(state);
    }
  }
  const codes = Object.keys(state.positions);
  const quotes = codes.length ? await getQuotes(codes) : {};
  const equity = equityOf(state, quotes);
  const base = CFG.startCash;
  state.daily.push({
    date: today, equity, cash: state.cash,
    posValue: posValueOf(state, quotes),
    totalPct: +((equity / base - 1) * 100).toFixed(2),
    positions: Object.entries(state.positions).map(([c, p]) => `${p.name}(${c}) ${p.shares}股@${p.costPrice.toFixed(2)}`).join('；') || '空仓',
  });
  logEvent(state, `收盘净值 ${equity.toFixed(2)} (${((equity/base-1)*100).toFixed(2)}%)`);
  persist(state);

  // 每日复盘进化：LLM总结当天涨跌经验 → lessons.json → 注入次日决策
  try {
    const r = await dailyReflection(state, { quotes });
    if (r.lessons.length) logEvent(state, `复盘新增${r.lessons.length}条经验: ${r.lessons.join('；').slice(0, 150)}`);
    else logEvent(state, '复盘完成，无新增经验');
    persist(state);
  } catch (e) {
    logEvent(state, '复盘失败: ' + e.message);
    persist(state);
  }
}

// 实验期检查
function experimentOver() {
  return bjDate() > CFG.runEnd;
}

let closedToday = false;
async function tick() {
  try {
    if (experimentOver()) {
      if (!stopped) { stopped = true; logEvent(state, `实验期结束(${CFG.runEnd})，引擎停止交易`); persist(state); }
      return;
    }
    stopped = false;
    await ensureTradeDays();
    const days = tradeDays?.days || [];
    const today = bjDate();
    let isTradeDay = days.includes(today);
    // 开盘初期当日K线可能还没生成 → 交易时段内强刷日历；仍缺则按工作日兜底
    // （实验期2026-11-10~12-10内中国无法定假日，工作日=交易日成立）
    if (!isTradeDay && inTradeWindow()) {
      await ensureTradeDays(true);
      isTradeDay = (tradeDays?.days || []).includes(today);
      if (!isTradeDay) {
        const dow = bjNow().getDay();
        isTradeDay = dow !== 0 && dow !== 6;
        if (isTradeDay) logEvent(state, `交易日历缺当日K线，按工作日兜底判定为交易日 ${today}`);
      }
    }

    if (isTradeDay) {
      if (inDecisionWindow()) await runDecisionRound();
      // 收盘后记净值（15:00~23:59 之间第一次tick）
      if (bjHM() >= '15:05' && !closedToday) { closedToday = true; await closeOfDay(); }
    } else {
      // 非交易日：如果昨天是交易日且还没记账（比如引擎刚启动），补记
      if (!closedToday && state.daily.length && state.daily.at(-1).date !== today) {
        // 不补记非交易日
      }
    }
    if (bjHM() < '09:00') closedToday = false;  // 新的一天重置
  } catch (e) {
    appendLog('TICK_ERR', { err: e.message });
    logEvent(state, 'tick异常: ' + e.message);
    try { persist(state); } catch {}
  }
}

export function startEngine() {
  if (running) return;
  running = true;
  appendLog('ENGINE', { msg: 'start', cash: state.cash });
  (async () => {
    await tick();                     // 启动立即跑一轮
    setInterval(tick, CFG.loop.pollSec * 1000);
  })();
}
export function manualDecision() { return runDecisionRound(true); }
export function manualClose() { closedToday = false; return closeOfDay(); }
export function getState() { return state; }
export function status() {
  const eq = equityOf(state, {});
  const peak = state.peakEquity || CFG.startCash;
  return {
    running, stopped, bjNow: bjStamp(),
    tradeDay: (tradeDays?.days || []).includes(bjDate()),
    inWindow: inTradeWindow(),
    equity: eq,
    peakEquity: peak,
    drawdownPct: +((eq / peak - 1) * 100).toFixed(2),
    cash: state.cash,
    positions: Object.keys(state.positions).length,
    trades: state.trades.length,
    lastDecision: state.decisions.at(-1)?.ts || null,
    experimentOver: experimentOver(),
  };
}
