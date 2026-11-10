// 补录指定日期战报：node scripts/backfill-report.js 2026-11-10
import { loadState } from '../src/store.js';
import { getQuotes } from '../src/market.js';
import { buildDailyReport, saveDailyReport } from '../src/report.js';
import { bjDate } from '../src/env.js';

const date = process.argv[2] || bjDate();
const s = loadState();
const quotes = Object.keys(s.positions).length ? await getQuotes(Object.keys(s.positions)) : {};
const rep = buildDailyReport(s, { date, quotes });
saveDailyReport(rep);
console.log('已补录', date, '净值', rep.equity, rep.totalPct + '%');
