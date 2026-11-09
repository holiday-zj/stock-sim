// 手动跑一轮完整决策（调试用）：node scripts/run-once.js
import { decide } from '../src/strategy.js';
import { loadState, persist, doBuy, doSell, logDecision } from '../src/store.js';
import { bjStamp } from '../src/env.js';
import { getQuotes } from '../src/market.js';
import { limitUp, limitDown } from '../src/strategy.js';

const dryRun = process.argv.includes('--dry');
const s = loadState();
console.log('账户: 现金', s.cash, '持仓', Object.keys(s.positions));
const res = await decide(s, { nowBJ: bjStamp() });
console.log('\n=== LLM 决策 ===');
console.log(JSON.stringify(res.decision, null, 1));
console.log('\n候选股:', res.candidates.map(c => `${c.name}(${c.code}) ${c.price} ${c.pct}%`).join(', '));

if (dryRun) { console.log('\n[dry-run] 不执行'); process.exit(0); }

let quotes = res.quotes;
for (const a of res.decision?.actions || []) {
  if (a.type === 'BUY' && a.code) {
    const q = (await getQuotes([a.code]))[a.code];
    if (!q) { console.log('行情缺失', a.code); continue; }
    if (limitUp(q)) { console.log('涨停买不进', a.code); continue; }
    const r = doBuy(s, { code: a.code, name: q.name, price: q.price, reason: a.reason, quoteTime: q.time });
    console.log(r.ok ? `买入 ${r.trade.name} ${r.trade.shares}股 @${r.trade.price} 费${r.trade.fee}` : '买入失败: ' + r.err);
    if (r.ok) logDecision(s, { type: 'LLM_BUY', code: a.code, name: r.trade.name, price: r.trade.price, shares: r.trade.shares, reason: a.reason });
  } else if (a.type === 'SELL' && a.code && s.positions[a.code]) {
    const q = (await getQuotes([a.code]))[a.code];
    if (!q || limitDown(q)) { console.log('卖不出', a.code); continue; }
    const r = doSell(s, { code: a.code, price: q.price, reason: a.reason, quoteTime: q.time });
    console.log(r.ok ? `卖出 ${r.trade.name} ${r.trade.shares}股 @${r.trade.price} 盈亏${r.trade.profit}` : '卖出失败: ' + r.err);
    if (r.ok) logDecision(s, { type: 'LLM_SELL', code: a.code, name: r.trade.name, price: r.trade.price, shares: r.trade.shares, profit: r.trade.profit, reason: a.reason });
  }
}
persist(s);
console.log('\n执行后: 现金', s.cash.toFixed(2), '持仓', Object.entries(s.positions).map(([c,p])=>`${p.name}${p.shares}股`).join(',') || '空仓');
