// 冒烟测试：行情/K线/新闻/公告/财务/选股池 全链路
import { getIndices, getQuotes, getDailyKline, getNews, getAnnouncements, getFundamentals, getSectorRank, rankActive } from '../src/market.js';
import { buildCandidates } from '../src/picker.js';

const idx = await getIndices();
console.log('指数:', JSON.stringify(idx));

const q = await getQuotes(['600519', '300750', '002594']);
console.log('快照:', Object.values(q).map(x => `${x.name} ${x.price} ${(x.pct*100).toFixed(2)}% 换手${(x.turnover*100).toFixed(1)}% t=${x.time}`).join(' | '));

const kl = await getDailyKline('300750', 5);
console.log('K线:', JSON.stringify(kl?.slice(-2)));

const news = await getNews('宁德时代', '300750', 2);
console.log('新闻:', news.map(n => `${n.date} ${n.title.slice(0, 40)}`).join(' || '));

const ann = await getAnnouncements('300750', 2);
console.log('公告:', ann.map(a => `${a.date} ${a.title.slice(0, 40)}`).join(' || '));

const fund = await getFundamentals('300750');
console.log('财务:', JSON.stringify(fund));

const sec = await getSectorRank(3);
console.log('板块:', JSON.stringify(sec));

const rank = await rankActive({ by: 'f8', limit: 10 });
console.log('换手排行前10:', rank.map(x => `${x.name}${x.code} ${(x.turnover/100).toFixed(1)}%`).join(', '));

console.log('\n=== 选股池 buildCandidates ===');
const t0 = Date.now();
const cands = await buildCandidates(new Set());
console.log(`耗时${((Date.now()-t0)/1000).toFixed(1)}s, 候选数: ${cands.length}`);
for (const c of cands) {
  console.log(`- ${c.name}(${c.code}) ${c.industry} ¥${c.price} 今日${c.pct}% 换手${c.turnover}% 流通${c.floatMcapYi}亿 | MA5=${c.tech.ma5} RSI=${c.tech.rsi14} 20日位置=${c.tech.pos20} 量比=${c.tech.volRatio} | 新闻${c.news.length}条 公告${c.ann.length}条`);
}
