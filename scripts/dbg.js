import { rankActive, getDailyKline, getIndices, getQuotes } from '../src/market.js';
const idx = await getIndices();
console.log('指数:', JSON.stringify(idx));
const kl = await getDailyKline('300750', 5);
console.log('K线:', kl ? JSON.stringify(kl.slice(-2)) : 'NULL');
const r = await rankActive({ by: 'f8', limit: 8 });
console.log('换手排行:', r.map(x => `${x.name} ${x.turnover}%`).join(', '));
const q = await getQuotes(['600519']);
console.log('快照:', JSON.stringify(q['600519']));
