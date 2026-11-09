// 决策核心：把真实市场数据交给 LLM，输出买卖决策（JSON）
import { CFG } from './config.js';
import { llmChat } from './llm.js';
import { getIndices, getSectorRank, getQuotes, getDailyKline, getNews, getAnnouncements } from './market.js';
import { buildCandidates } from './picker.js';
import { sma, rsi } from './util.js';

const SYS = `你是一名A股超短线交易员，管理一个真实模拟盘账户（本金1万元人民币），交易周期为一个月，目标是月末净值为正且尽量最大化。
你必须遵守的现实约束：
- T+1：当天买入的股票当天不能卖，最早次日卖出。
- 涨跌停：主板±10%、创业板±20%；涨停买不进、跌停卖不出。
- 交易费用：佣金万2.5(最低5元)+卖出印花税0.05%+滑点0.1%单边。频繁进出会被费用吃掉利润，每天最多做1-2次决策级操作。
- 资金只有1万，单票最多2个持仓，仓位≤48%，不能满仓单吊。
- 你拿到的是真实行情快照（盘中约3分钟延迟）、真实日K技术面、真实新闻/公告、真实财务数据。

交易风格要求：
- 短线为主：持仓1~5天，吃趋势/动量/题材发酵段，不谈恋爱。
- 买入偏好：上升趋势回踩不破MA5/MA10、放量突破平台、强势板块内补涨、有新闻/业绩催化的活跃股。
- 卖出偏好：逻辑破坏（跌破MA10放量、利好兑现高开滞涨、板块退潮）、达到目标位、时间止损（3天不涨就走）。
- 宁可错过，不可做错。没有把握就空仓等待，空仓也是一种决策。
- 严禁追高：当日涨幅>6%的股票原则上不买（除非刚启动一字板打开等特殊逻辑，需说明）。

输出严格JSON：
{"actions":[{"type":"BUY","code":"600000","name":"浦发银行","reason":"50字内"},{"type":"SELL","code":"...","name":"...","reason":"..."},{"type":"HOLD","code":"...","name":"...","reason":"..."}],"summary":"100字内总体思路"}`;

function heldSnapshot(s, quotes) {
  return Object.entries(s.positions).map(([code, p]) => {
    const q = quotes[code] || {};
    const price = q.price || p.costPrice;
    const pl = (price - p.costPrice) / p.costPrice;
    return {
      code, name: p.name, shares: p.shares,
      costPrice: +p.costPrice.toFixed(2), price: +price.toFixed(2),
      pnlPct: +(pl * 100).toFixed(2),
      dayPct: q.pct != null ? +(q.pct * 100).toFixed(2) : null,
      highSinceBuy: +p.high.toFixed(2),
      drawdownFromHigh: +((price / p.high - 1) * 100).toFixed(2),
      buyTime: p.buyTime,
      buyReason: (p.buyReason || '').slice(0, 60),
      canSellToday: p.buyDate !== todayBJ(),  // T+1
    };
  });
}

function todayBJ() {
  const d = new Date(Date.now() + 8 * 3600e3);
  return d.toISOString().slice(0, 10);
}

async function enrichHeld(s, quotes) {
  // 持仓票补充：K线技术面 + 最新新闻
  const out = [];
  for (const code of Object.keys(s.positions)) {
    const kl = await getDailyKline(code, 40).catch(() => null);
    const closes = (kl || []).map(k => k.close);
    const news = await getNews(s.positions[code].name, code, 3).catch(() => []);
    out.push({
      code,
      tech: closes.length >= 20 ? {
        ma5: +sma(closes, 5).toFixed(2), ma10: +sma(closes, 10).toFixed(2), ma20: +sma(closes, 20).toFixed(2),
        rsi14: rsi(closes, 14)?.toFixed(1),
        chg5d: +((closes.at(-1) / closes.at(-6) - 1) * 100).toFixed(1),
      } : null,
      news: news.slice(0, 2).map(n => `${n.date} ${n.title}`),
    });
  }
  return out;
}

// 一次完整的 LLM 决策回合
export async function decide(s, opts = {}) {
  const heldCodes = new Set(Object.keys(s.positions));
  const quotes = opts.quotes || await getQuotes([...heldCodes]);
  const [indices, sectors, candidates, heldSnap, heldExtra] = await Promise.all([
    getIndices(), getSectorRank(4),
    opts.skipCandidates ? Promise.resolve([]) : buildCandidates(heldCodes),
    Promise.resolve(heldSnapshot(s, quotes)),
    enrichHeld(s, quotes),
  ]);

  const cashPct = (s.cash / (s.cash + 1) * 100);
  const user = `【账户】现金 ${s.cash.toFixed(0)}元；持仓市值约 ${(heldSnap.reduce((a, h) => a + h.price * h.shares, 0)).toFixed(0)}元。当前时间 ${opts.nowBJ}。
【大盘】${(indices || []).map(i => `${i.name} ${i.price}(${(i.pct*100).toFixed(2)}%)`).join('；') || '数据缺失'}
【板块】领涨: ${(sectors?.top || []).join('、')}；领跌: ${(sectors?.bottom || []).join('、')}
【持仓明细】${JSON.stringify(heldSnap)}
【持仓技术面/新闻】${JSON.stringify(heldExtra)}
【候选股(按流动性筛出的活跃股,含真实技术面/新闻/公告/财务)】${JSON.stringify(candidates)}
注：所有 pct/turnover/profitYoy/grossMargin 等比率为小数（0.1277=12.77%）；amountYi/floatMcapYi 单位为亿元；mainNet 为主力净流入(元)。

请给出本轮操作。注意：候选股"price"为最新价，买入将按该价+0.1%滑点成交；持仓 canSellToday=false 表示T+1锁定不能卖。若无需操作，actions 输出 HOLD 或空数组。`;

  const decision = await llmChat(SYS, user, { timeout: 90000 });
  return { decision, candidates, quotes, indices, sectors, heldSnap };
}

// 风控卖出提示（止损/移动止盈/超期）——由程序强制执行，返回原因供记录
export function riskCheck(s, quotes, heldDays) {
  const R = CFG.risk;
  const orders = [];
  for (const [code, p] of Object.entries(s.positions)) {
    const q = quotes[code];
    if (!q || !q.price) continue;
    if (p.high < q.price) p.high = q.price;   // 更新持仓期最高价
    const pl = q.price / p.costPrice - 1;
    const dd = q.price / p.high - 1;
    const held = heldDays(code);
    if (p.buyDate === todayBJ()) continue;    // T+1 当天买的不能卖
    if (pl <= R.stopLoss) {
      orders.push({ code, reason: `硬止损：亏损${(pl*100).toFixed(1)}%≤-6%` });
    } else if (pl >= R.trailTrigger && dd <= -R.trailGiveback) {
      orders.push({ code, reason: `移动止盈：盈利${(pl*100).toFixed(1)}%后自高点${p.high}回撤${(dd*100).toFixed(1)}%` });
    } else if (held >= R.maxHoldTradeDays) {
      orders.push({ code, reason: `时间止损：持有${held}个交易日未达预期` });
    }
  }
  return orders;
}

// 涨停判断（买不进）/跌停（卖不出）
export function limitUp(q) {
  if (!q || !q.preClose || !q.price) return false;
  const lim = /^30/.test(q.code) ? 0.2 : 0.1;
  return q.price >= +(q.preClose * (1 + lim)).toFixed(2) - 0.005;
}
export function limitDown(q) {
  if (!q || !q.preClose || !q.price) return false;
  const lim = /^30/.test(q.code) ? 0.2 : 0.1;
  return q.price <= +(q.preClose * (1 - lim)).toFixed(2) + 0.005;
}
