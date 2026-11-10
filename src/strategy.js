// 决策核心：把真实市场数据交给 LLM，输出买卖决策（JSON）
import { CFG } from './config.js';
import { llmChat } from './llm.js';
import { lessonsForDecision } from './evolve.js';
import { chandelierStop, atrPct } from './sizing.js';
import { getIndices, getSectorRank, getQuotes, getDailyKline, getNews, getAnnouncements, getIntradayTrend, getConcepts, getMargin, getBillboard, getBillboardSeats } from './market.js';
import { buildCandidates } from './picker.js';
import { sma, rsi } from './util.js';

const SYS = `你是一名顶尖A股短线交易大师，融合利弗莫尔的趋势嗅觉、欧奈尔(CANSLIM)的龙头选股、巴菲特式的本金纪律，管理10万元真实模拟盘，交易周期一个月。目标函数：在尽可能保住本金的前提下最大化盈利——本金是命根子，回撤控制永远优先于收益追逐；保住本金，才有复利。
你的核心信条（按优先级）：
1. Rule1保住本金，Rule2记住Rule1——每笔交易的最大亏损已由系统锁定(1.5%风险预算+ATR止损价)，你要做的是让每笔"可能赚的"远大于"可能亏的"(盈亏比≥2:1才值得出手)，且绝不在亏损时加仓摊平。
2. 砍亏损要快，让利润奔跑——绝不为亏损单找理由，绝不因"赚了一点"就卖出强势趋势股；持仓的止损线由系统按吊灯法则自动上抬，趋势没走完不轻易卖。
3. 20次击球卡——一个月只有少数几个"肥球"(主线题材爆发+龙头启动+大盘配合)。没有肥球就空仓等待，空仓不丢人，乱出手才丢人。宁可错过十次，不可做错一次。
4. 只买龙头——板块爆发时买最强的那只(涨幅居前、量能最大、逻辑最正宗)，不买跟风杂毛。真瓶颈环节(有订单/扩产公告佐证)>蹭热点。
5. 顺势而为——大盘risk_off体制下收缩防守(持仓上限降为1只)，risk_on下才放手进攻。逆势做多等于推石头上山。
你必须遵守的现实约束：
- T+1：当天买入的股票当天不能卖，最早次日卖出。
- 涨跌停：主板±10%、创业板±20%；涨停买不进、跌停卖不出。
- 交易费用：佣金万2.5(最低5元)+卖出印花税0.05%+滑点0.1%单边。频繁进出会被费用吃掉利润，每天最多做1-2次决策级操作。
- 资金10万，最多同时3个持仓，单票仓位≤35%，不能满仓单吊。
- 现金底线：买入后现金必须≥总资产15%（程序强制，违反会被拒单）。T+1制度下现金是次日调仓换股的唯一弹药。
- 仓位大小不用你操心：系统按"固定风险比例法+ATR波动率仓位"自动计算买入股数（每笔最大亏损=总资产1.5%，止损距离=max(6%, 2×ATR14%)，波动越大自动买越少），并给每只持仓设置独立止损价。你只负责判断方向、标的和时机，reason里不要写股数/金额。
- 你拿到的是真实行情快照（盘中约3分钟延迟）、真实日K技术面、真实新闻/公告、真实财务数据。

交易风格要求：
- 短线为主：持仓1~5天，吃趋势/动量/题材发酵段，不谈恋爱。
- 买入偏好(满足越多越好)：上升趋势回踩不破MA5/MA10、放量突破平台、当日最强板块内的领涨龙头、有新闻/公告/业绩催化、龙虎榜机构或知名游资净买入、融资净买入为正。
- 卖出偏好：逻辑破坏（跌破MA10放量、利好兑现高开滞涨、板块退潮）、时间止损（3天不涨就走，资金效率优先）。止损线系统自动管理，你判断"逻辑是否还在"。
- 仓位大小由系统按2%风险预算+ATR自动计算，你只决定买不买、买哪只。
- 没有肥球就空仓等待，空仓也是一种决策。
- 严禁追高：当日涨幅>6%的股票原则上不买（除非刚启动一字板打开等特殊逻辑，需说明）。
- 题材真实性鉴别：区分"真瓶颈"与"蹭热点"——真瓶颈环节(供应商少/扩产难/客户认证壁垒/有订单或扩产公告佐证)的行情持续性更强；主营与题材关联弱、无订单证据的蹭热点股，冲高次日易兑现出货，即使技术面好看也要降权或回避。
- 买入数量必须是100股整数倍，且不超过可用现金。

输出严格JSON：
{"actions":[{"type":"BUY","code":"600000","name":"浦发银行","reason":"50字内","usedLessons":["L20261110-1"]},{"type":"SELL","code":"...","name":"...","reason":"...","usedLessons":[]},{"type":"HOLD","code":"...","name":"...","reason":"..."}],"summary":"100字内总体思路"}
usedLessons：本次动作实际应用到的历史经验id数组（从【历史经验教训】的id里选，只填真正影响了本决策的，没有则空数组）。系统会按交易结果给这些经验记战绩，虚报引用会污染经验库评估。`;

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
    const [kl, news, trend, concepts, margin, billboard] = await Promise.all([
      getDailyKline(code, 40).catch(() => null),
      getNews(s.positions[code].name, code, 3).catch(() => []),
      getIntradayTrend(code, 20).catch(() => null),
      getConcepts(code, 5).catch(() => []),
      getMargin(code).catch(() => null),
      getBillboard(code, { days: 10, limit: 2 }).catch(() => []),
    ]);
    const closes = (kl || []).map(k => k.close);
    out.push({
      code,
      tech: closes.length >= 20 ? {
        ma5: +sma(closes, 5).toFixed(2), ma10: +sma(closes, 10).toFixed(2), ma20: +sma(closes, 20).toFixed(2),
        rsi14: rsi(closes, 14)?.toFixed(1),
        chg5d: +((closes.at(-1) / closes.at(-6) - 1) * 100).toFixed(1),
      } : null,
      news: news.slice(0, 2).map(n => `${n.date} ${n.title}`),
      intraday: trend ? { lastPrice: trend.lastPrice, lastTime: trend.lastTime, preClose: trend.preClose, tail: trend.tail.slice(-10) } : null,
      concepts,
      margin: margin ? { rzjmeWan: +(margin.rzjme / 1e4).toFixed(0), rzyezb: +(margin.rzyezb || 0).toFixed(2) } : null,
      billboard: billboard.length ? await getBillboardSeats(code, { date: billboard[0].date, limit: 6 }).catch(() => billboard) : [],
    });
  }
  return out;
}

// 一次完整的 LLM 决策回合
export async function decide(s, opts = {}) {
  const heldCodes = new Set(Object.keys(s.positions));
  const regime = opts.regime || { regime: 'unknown', detail: '获取失败' };
  const maxPos = opts.maxPos || CFG.risk.maxPositions;
  const guard = opts.guard || { mode: 'normal', dd: 0 };
  const quotes = opts.quotes || await getQuotes([...heldCodes]);
  const [indices, sectors, candidates, heldSnap, heldExtra] = await Promise.all([
    getIndices(), getSectorRank(4),
    opts.skipCandidates ? Promise.resolve([]) : buildCandidates(heldCodes),
    Promise.resolve(heldSnapshot(s, quotes)),
    enrichHeld(s, quotes),
  ]);

  const user = `【账户】现金 ${s.cash.toFixed(0)}元；持仓市值约 ${(heldSnap.reduce((a, h) => a + h.price * h.shares, 0)).toFixed(0)}元。当前时间 ${opts.nowBJ}。持仓上限${maxPos}只(随大盘体制调整)。
【大盘趋势体制】${regime.regime}（${regime.detail}）——risk_on可积极进攻，neutral只做精选强势股，risk_off应防守/减仓/空仓等待，逆势重仓是短线最大亏损来源。
【账户回撤状态】自净值高点回撤${(guard.dd*100).toFixed(1)}%，模式=${guard.mode}${guard.mode==='defensive'?'（防守模式：风险预算已减半，只做最高确定性的机会）':''}。回撤≥8%将触发熔断停止开新仓。
【大盘】${(indices || []).map(i => `${i.name} ${i.price}(${(i.pct*100).toFixed(2)}%)`).join('；') || '数据缺失'}
【板块】领涨: ${(sectors?.top || []).join('、')}；领跌: ${(sectors?.bottom || []).join('、')}
【持仓明细】${JSON.stringify(heldSnap)}
【持仓技术面/新闻】${JSON.stringify(heldExtra)}
【候选股(按流动性筛出的活跃股,含真实技术面/新闻/公告/财务)】${JSON.stringify(candidates)}
注：pct/turnover/profitYoy/grossMargin 等比率为小数（0.1277=12.77%）；amountYi/floatMcapYi/rzyeYi 单位为亿元；mainNet/rzjmeWan 为主力净流入(元)/融资净买入(万元)；concepts[].pct 为板块当日涨幅百分点；intraday.tail 为最近分钟分时[时间,价,量,均价]；forecast 为业绩预告(预增/预减+幅度%)；billboard 为近30天龙虎榜上榜记录(净买额万元)；billboardSeats 为席位明细(dept=机构/知名游资/北向/营业部，netWan净买万元，riseProb3d该席位3日胜率%)。龙虎榜代表大资金博弈：机构/知名游资大额净买入是加分项，上榜次日高开需谨慎（利好兑现出货）。
【历史经验教训(经过审计裁决存活的经验；(试用)=尚在验证期。优先级高于直觉，与盘面冲突时以盘面为准)】
${lessonsForDecision().map(x => '- ' + x.line).join('\n') || '- (尚无)'}

请给出本轮操作。注意：候选股"price"为最新价，买入将按该价+0.1%滑点成交；持仓 canSellToday=false 表示T+1锁定不能卖。若无需操作，actions 输出 HOLD 或空数组。`;

  const decision = await llmChat(SYS, user, { timeout: 240000 });
  return { decision, candidates, quotes, indices, sectors, heldSnap };
}

// 风控卖出（吊灯止损/保本线/时间止损）——程序强制，盈利奔跑靠止损线只升不降
// getKlines: async code => klines（供计算个股ATR滚动上抬止损线）
export async function riskCheck(s, quotes, heldDays, getKlines) {
  const R = CFG.risk;
  const orders = [];
  for (const [code, p] of Object.entries(s.positions)) {
    const q = quotes[code];
    if (!q || !q.price) continue;
    if (p.high < q.price) p.high = q.price;   // 更新持仓期最高价
    const pl = q.price / p.costPrice - 1;
    const held = heldDays(code);
    if (p.buyDate === todayBJ()) continue;    // T+1 当天买的不能卖

    // 吊灯止损：用最新ATR把止损线只升不降（趋势延续→利润奔跑；反转→立即离场）
    let atr = null;
    if (getKlines) {
      const kl = await getKlines(code).catch(() => null);
      atr = atrPct(kl, R.atrPeriod);
    }
    const newStop = chandelierStop({ position: p, price: q.price, atr });
    if (newStop != null) p.stopPrice = newStop;

    const stopPx = p.stopPrice || +(p.costPrice * (1 + R.stopLoss)).toFixed(3);
    if (q.price <= stopPx) {
      orders.push({ code, reason: `止损触发：现价${q.price}≤止损线${stopPx}（${pl >= 0 ? '吊灯/保本止盈,锁定盈利' + (pl*100).toFixed(1) + '%' : 'ATR止损,亏损' + (pl*100).toFixed(1) + '%'}）` });
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
