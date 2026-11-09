// 候选池构建：真实活跃股排行 → 过滤 → 附加K线技术面/新闻/公告/财务
import { CFG } from './config.js';
import { rankActive, getQuotes, getDailyKline, getNews, getAnnouncements, getFundamentals } from './market.js';
import { sma, rsi, macd } from './util.js';

function passFilter(x, heldCodes) {
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

export async function buildCandidates(heldCodes = new Set()) {
  // 1. 按换手率取活跃股，再按成交额取一批，混合去重
  const byTurnover = await rankActive({ by: 'f8', limit: 80 });
  const byAmount = await rankActive({ by: 'f6', limit: 60 });
  const pool = new Map();
  for (const x of [...byTurnover, ...byAmount]) if (passFilter(x, heldCodes)) pool.set(x.code, x);
  // 排序：换手率适中偏高 + 成交额大者优先，取前N*2做深度分析
  const arr = [...pool.values()].sort((a, b) => (b.amount || 0) - (a.amount || 0));
  const shortlist = arr.slice(0, CFG.picker.topN * 2);

  // 2. 实时快照刷新价格
  const quotes = await getQuotes(shortlist.map(x => x.code));

  // 3. 深度信息（K线技术面+新闻+公告+财务），并发但限流
  const out = [];
  for (const x of shortlist) {
    if (out.length >= CFG.picker.topN) break;
    const q = quotes[x.code];
    if (!q || q.price <= 0) continue;
    try {
      const [kl, news, ann, fund] = await Promise.all([
        getDailyKline(x.code, 60), getNews(x.name, x.code, 3),
        getAnnouncements(x.code, 3), getFundamentals(x.code),
      ]);
      const tech = technicals(kl);
      if (!tech) continue;
      out.push({
        code: x.code, name: x.name, industry: x.industry || '',
        price: q.price, pct: q.pct,
        turnover: q.turnover,
        amountYi: +(q.amount / 1e8).toFixed(1),
        floatMcapYi: +(q.floatMcap / 1e8).toFixed(0),
        pe: q.pe ? +q.pe.toFixed(1) : null,
        tech, fund,
        news: news.slice(0, 3),
        ann: ann.slice(0, 3),
      });
    } catch {}
  }
  return out;
}
