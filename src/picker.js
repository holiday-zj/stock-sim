// 候选池构建：活跃股排行 + 主线板块通道 → 过滤 → 附加K线技术面/新闻/公告/财务
import { CFG } from './config.js';
import { rankActive, getQuotes, getDailyKline, getNews, getAnnouncements, getFundamentals, getIntradayTrend, getConcepts, getMargin, getProfitForecast, getBillboard, getBillboardSeats, getFundFlow, getOrderBook, getSectorRank, sectorStocks } from './market.js';
import { sma, rsi, macd } from './util.js';

export function passFilter(x, heldCodes) {
  const P = CFG.picker;
  if (!x.code || !x.name) return false;
  if (heldCodes.has(x.code)) return false;               // 已持仓的不进候选
  if (P.excludeST && (/ST|退/.test(x.name))) return false;
  if (x.price < P.priceMin || x.price > P.priceMax) return false;
  // 全小数约定：turnover 0.03 = 3%
  if (x.turnover < P.turnoverMin / 100 || x.turnover > P.turnoverMax / 100) return false;
  if (!x.floatMcap || x.floatMcap < P.mcapMin || x.floatMcap > P.mcapMax) return false;
  if (/^68/.test(x.code)) return false;                   // 科创板50万门槛+20%波动，1万本金不合适
  if (/^8|^4|^92/.test(x.code)) return false;             // 北交所排除
  if (x.pe !== undefined && (x.pe < 0)) return false;     // 亏损股排除（短线也不碰雷）
  return true;
}

// 技术面摘要（基于真实日K）
function technicals(klines) {
  if (!klines || klines.length < 30) return null;
  const closes = klines.map(k => k.close);
  const last = closes[closes.length - 1];
  const ma5 = sma(closes, 5), ma10 = sma(closes, 10), ma20 = sma(closes, 20);
  const r = rsi(closes, 14);
  const m = macd(closes);
  const win = klines.slice(-20);
  const hi20 = Math.max(...win.map(k => k.high));
  const lo20 = Math.min(...win.map(k => k.low));
  const chg5 = last / closes[closes.length - 6] - 1;
  const chg20 = closes.length >= 21 ? last / closes[closes.length - 21] - 1 : null;
  return {
    last, ma5: +ma5.toFixed(2), ma10: +ma10.toFixed(2), ma20: +ma20.toFixed(2),
    aboveMA5: last > ma5, aboveMA10: last > ma10, aboveMA20: last > ma20,
    rsi14: r ? +r.toFixed(1) : null,
    macdHist: m ? +m.hist.toFixed(3) : null,
    hi20: +hi20.toFixed(2), lo20: +lo20.toFixed(2),
    pos20: +((last - lo20) / (hi20 - lo20 || 1)).toFixed(2),   // 0=20日最低 1=20日最高
    chg5d: +(chg5 * 100).toFixed(1), chg20d: chg20 != null ? +(chg20 * 100).toFixed(1) : null,
    volRatio: +(klines[klines.length - 1].vol / (klines.slice(-6, -1).reduce((a, k) => a + k.vol, 0) / 5)).toFixed(2),
  };
}

// 主线板块通道：当日涨幅前2的行业板块内正在上涨但未封板的股票（结构市进攻的标的来源）
export async function hotSectorStocks(heldCodes) {
  const hot = [];
  try {
    const sectors = await getSectorRank(2);
    for (const sec of sectors.top || []) {
      if (sec.pct < 1) continue;                          // 板块涨幅<1%不算主线
      const stocks = await sectorStocks(sec.code, 15);
      for (const x of stocks) {
        // 在涨(≥1%)、未封板(主板<9.5%/创业板<19.5%)、通过基础过滤
        const lim = /^30/.test(x.code) ? 0.195 : 0.095;
        if (x.pct < 0.01 || x.pct > lim) continue;
        if (!passFilter(x, heldCodes)) continue;
        x.hotSector = sec.name; x.hotSectorPct = sec.pct;
        hot.push(x);
      }
      if (hot.length >= 8) break;
    }
  } catch {}
  return hot;
}

// 单只股票深度增强（K线/新闻/公告/财务/分时/板块/两融/预告/龙虎榜）
async function enrichOne(x, quotes) {
  const q = quotes[x.code];
  if (!q || q.price <= 0) return null;
  try {
    const [kl, news, ann, fund, trend, concepts, margin, forecast, billboard] = await Promise.all([
      getDailyKline(x.code, 60), getNews(x.name, x.code, 3),
      getAnnouncements(x.code, 3), getFundamentals(x.code),
      getIntradayTrend(x.code, 25), getConcepts(x.code, 6),
      getMargin(x.code), getProfitForecast(x.code),
      getBillboard(x.code, { days: 30, limit: 3 }),
    ]);
    const tech = technicals(kl);
    if (!tech) return null;
    const c = {
      code: x.code, name: x.name, industry: x.industry || '',
      price: q.price, pct: q.pct,
      turnover: q.turnover,
      amountYi: +(q.amount / 1e8).toFixed(1),
      floatMcapYi: +(q.floatMcap / 1e8).toFixed(0),
      pe: q.pe ? +q.pe.toFixed(1) : null,
      tech, fund,
      news: news.slice(0, 3),
      ann: ann.slice(0, 3),
      intraday: trend ? { lastPrice: trend.lastPrice, lastTime: trend.lastTime, preClose: trend.preClose, tail: trend.tail.slice(-12), dayShape: trend.dayShape } : null,
      concepts,
      margin: margin ? { rzyeYi: +(margin.rzye / 1e8).toFixed(1), rzjmeWan: +(margin.rzjme / 1e4).toFixed(0), rzyezb: +(margin.rzyezb || 0).toFixed(2), date: margin.date } : null,
      forecast: forecast.slice(0, 2),
      billboard,
    };
    if (x.hotSector) { c.hotSector = x.hotSector; c.hotSectorPct = x.hotSectorPct; }
    if (billboard.length) {
      const seats = await getBillboardSeats(x.code, { date: billboard[0].date, limit: 8 }).catch(() => []);
      c.billboardSeats = seats;
    }
    const [ff, ob] = await Promise.all([
      getFundFlow(x.code, 30).catch(() => null),
      getOrderBook(x.code).catch(() => null),
    ]);
    c.fundFlow = ff;
    c.orderBook = ob ? { bid1: ob.bid1, ask1: ob.ask1, spread: ob.spread, weiBi: ob.weiBi, note: ob.note } : null;
    return c;
  } catch { return null; }
}

export async function buildCandidates(heldCodes = new Set()) {
  // 1. 三条通道混合：换手率活跃 + 成交额活跃 + 主线板块(结构市进攻核心)
  const [byTurnover, byAmount, hot] = await Promise.all([
    rankActive({ by: 'f8', limit: 80 }),
    rankActive({ by: 'f6', limit: 60 }),
    hotSectorStocks(heldCodes),
  ]);
  const pool = new Map();
  for (const x of [...byTurnover, ...byAmount]) if (passFilter(x, heldCodes)) pool.set(x.code, x);
  // 主线板块股合并进池（保留hotSector标记，已存在则补标记）
  for (const x of hot) {
    const ex = pool.get(x.code);
    if (ex) { ex.hotSector = x.hotSector; ex.hotSectorPct = x.hotSectorPct; }
    else pool.set(x.code, x);
  }
  // 排序：主线板块股优先（涨幅大的板块在前），其余按成交额
  const arr = [...pool.values()].sort((a, b) => {
    const ah = a.hotSector ? (a.hotSectorPct || 0) : -1, bh = b.hotSector ? (b.hotSectorPct || 0) : -1;
    if (ah !== bh) return bh - ah;
    return (b.amount || 0) - (a.amount || 0);
  });
  // 深度分析名额：主线股保底一半，其余给成交额活跃股
  const hotN = Math.min(Math.ceil(CFG.picker.topN / 2), arr.filter(x => x.hotSector).length);
  const shortlist = [...arr.filter(x => x.hotSector).slice(0, hotN), ...arr.filter(x => !x.hotSector)];

  // 2. 实时快照刷新价格
  const quotes = await getQuotes(shortlist.slice(0, CFG.picker.topN * 2).map(x => x.code));

  // 3. 深度信息（K线技术面+新闻+公告+财务），并发但限流
  const out = [];
  for (const x of shortlist) {
    if (out.length >= CFG.picker.topN) break;
    const c = await enrichOne(x, quotes);
    if (c) out.push(c);
  }
  return out;
}

// 定点决策候选：只深度增强指定code（快速扫描触发时用，省请求省时间）
export async function buildFocusCandidates(codes, heldCodes = new Set()) {
  const list = codes.filter(c => !heldCodes.has(c));
  if (!list.length) return [];
  const quotes = await getQuotes(list);
  const out = [];
  for (const code of list) {
    const q = quotes[code];
    if (!q || q.price <= 0) continue;
    if (!passFilter({ code, name: q.name, price: q.price, turnover: q.turnover, floatMcap: q.floatMcap, pe: q.pe }, heldCodes)) continue;
    const c = await enrichOne({ code, name: q.name, industry: q.industry }, quotes);
    if (c) out.push(c);
  }
  return out;
}
