// 手动/验证：跑一次每日复盘 node scripts/reflect-once.js
import { loadState } from '../src/store.js';
import { getQuotes } from '../src/market.js';
import { dailyReflection, loadLessons } from '../src/evolve.js';

const s = loadState();
const quotes = Object.keys(s.positions).length ? await getQuotes(Object.keys(s.positions)) : {};
const r = await dailyReflection(s, { quotes });
console.log('=== 复盘结果 ===');
console.log('summary:', r.summary);
console.log('新增经验:', r.lessons.length ? r.lessons.join('\n  - ') : '(无)');
console.log('经验库总数:', loadLessons().items.length);
