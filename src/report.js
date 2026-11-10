// 每日战报：收盘后由引擎自动生成，落盘 data/reports.json，看板与微信播报共用同一份
import { CFG } from './config.js';
import { loadJson, saveJson } from './util.js';
import { loadLessons } from './evolve.js';
import { bjDate } from './env.js';

const F = 'reports.json';
export function loadReports() { return loadJson(F, { list: [] }); }
export function saveReports(r) { saveJson(F, r); }

// 从账户状态构建某日战报（结构化 + markdown 双份）
export function buildDailyReport(s, { date = bjDate(), quotes = {}, regime = null, reflection = null } = {}) {
  const base = CFG.startCash;
  const day = s.daily.find(d => d.date === date);
  const prev = s.daily.slice().reverse().find(d => d.date < date);
  const equity = day ? day.equity : day?.equity ?? base;
  const dayPct = day && prev ? +((day.equity / prev.equity - 1) * 100).toFixed(2) : null;
  const peak = s.peakEquity || base;
  const dd = +((equity / peak - 1) * 100).toFixed(2);

  const dayTrades = s.trades.filter(t => t.ts.startsWith(date));
  const sells = dayTrades.filter(t => t.side === 'SELL');
  const allSells = s.trades.filter(t => t.side === 'SELL');
  const realizedDay = +sells.reduce((a, t) => a + (t.profit || 0), 0).toFixed(2);
  const realizedAll = +allSells.reduce((a, t) => a + (t.profit || 0), 0).toFixed(2);
  const wins = allSells.filter(t => t.profit > 0).length;
  const feeDay = +dayTrades.reduce((a, t) => a + (t.fee || 0), 0).toFixed(2);
  const feeAll = +s.trades.reduce((a, t) => a + (t.fee || 0), 0).toFixed(2);
  const floatPct = +(((equity - base) / base) * 100).toFixed(2);

  const positions = Object.entries(s.positions).map(([code, p]) => {
    const q = quotes[code];
    const price = q?.price ?? p.costPrice;
    return {
      code, name: p.name, shares: p.shares,
      costPrice: +(+p.costPrice).toFixed(2), price: +price.toFixed(2),
      pnlPct: +((price / p.costPrice - 1) * 100).toFixed(2),
      pnl: +((price - p.costPrice) * p.shares).toFixed(2),
      stopPrice: p.stopPrice ? +(+p.stopPrice).toFixed(2) : null,
      buyDate: p.buyDate, reason: (p.buyReason || '').slice(0, 70),
    };
  });

  const lessons = loadLessons();
  const dayLessons = lessons.items.filter(x => x.date === date).map(x => x.text);
  const dayRegime = regime || s.decisions.filter(d => d.type === 'REGIME' && d.ts.startsWith(date)).at(-1) || null;
  const summary = reflection?.summary
    || s.decisions.filter(d => d.type === 'SUMMARY' && d.ts.startsWith(date)).at(-1)?.summary
    || '';

  const rep = {
    date, equity: +equity.toFixed(2), base,
    totalPct: floatPct, dayPct,
    cash: +(day ? day.cash : s.cash).toFixed(2),
    posValue: day ? +day.posValue.toFixed(2) : 0,
    peakEquity: +peak.toFixed(2), drawdownPct: dd,
    realizedDay, realizedAll, floatPnl: +(equity - base - realizedAll).toFixed(2),
    tradesDay: dayTrades.length, buysDay: dayTrades.filter(t => t.side === 'BUY').length, sellsDay: sells.length,
    winRate: allSells.length ? +((wins / allSells.length) * 100).toFixed(0) : null,
    wins, totalSells: allSells.length,
    feeDay, feeAll,
    dayTradeCount: s.trades.length,
    regime: dayRegime ? { regime: dayRegime.regime, detail: dayRegime.detail || '', dd: dayRegime.dd } : null,
    positions, trades: dayTrades.map(t => ({
      ts: t.ts.slice(11), side: t.side, name: t.name, code: t.code,
      price: t.price, shares: t.shares, amount: t.amount, profit: t.profit ?? null,
      reason: (t.reason || '').slice(0, 90),
    })),
    reflection: summary, lessons: dayLessons,
    allLessons: lessons.items.slice(-10).map(x => ({ date: x.date, text: x.text })),
  };

  rep.md = toMarkdown(rep);
  return rep;
}

export function toMarkdown(r) {
  const sign = (x, d = 2) => (x >= 0 ? '+' : '') + Number(x).toFixed(d);
  let md = `# 📊 收盘战报 · ${r.date}\n\n`;
  md += `**净值 ¥${r.equity.toFixed(2)}**（累计 ${sign(r.totalPct)}%${r.dayPct != null ? `，当日 ${sign(r.dayPct)}%` : ''}）\n`;
  md += `现金 ¥${r.cash.toFixed(2)} | 持仓市值 ¥${r.posValue.toFixed(2)} | 高点回撤 ${sign(r.drawdownPct)}%\n`;
  md += `浮动盈亏 ¥${sign(r.floatPnl)} | 已实现 ¥${sign(r.realizedAll)} | 胜率 ${r.winRate != null ? r.winRate + '%' : '-'}（${r.wins}/${r.totalSells}）| 累计费用 ¥${r.feeAll.toFixed(2)}\n`;
  if (r.regime) md += `大盘体制：**${r.regime.regime}** ${r.regime.detail}\n`;
  md += `\n## 持仓\n`;
  if (r.positions.length) {
    md += `| 股票 | 数量 | 成本 | 现价 | 盈亏% | 止损线 |\n|---|---|---|---|---|---|\n`;
    for (const p of r.positions) {
      md += `| ${p.name}(${p.code}) | ${p.shares} | ${p.costPrice} | ${p.price} | ${sign(p.pnlPct)}% | ${p.stopPrice || '-'} |\n`;
    }
  } else md += `空仓\n`;
  md += `\n## 今日成交（${r.tradesDay}笔）\n`;
  md += r.trades.length
    ? r.trades.map(t => `- ${t.ts} ${t.side === 'BUY' ? '🟢买' : '🔴卖'} ${t.name} ${t.shares}股 @${t.price}${t.profit != null ? ` 盈亏¥${sign(t.profit)}` : ''}\n  ${t.reason}`).join('\n') + '\n'
    : `- 无\n`;
  if (r.reflection) md += `\n## 复盘\n${r.reflection}\n`;
  if (r.lessons.length) md += `\n## 今日新增经验\n${r.lessons.map(x => `- ${x}`).join('\n')}\n`;
  return md;
}

// 写入/覆盖某日战报（收盘后调用；重复调用幂等）
export function saveDailyReport(rep) {
  const store = loadReports();
  const i = store.list.findIndex(x => x.date === rep.date);
  if (i >= 0) store.list[i] = rep; else store.list.push(rep);
  store.list.sort((a, b) => a.date.localeCompare(b.date));
  if (store.list.length > 120) store.list.splice(0, store.list.length - 120);
  saveReports(store);
  return rep;
}
export function getReports(n = 40) {
  return loadReports().list.slice(-n).reverse();   // 最新在前
}
