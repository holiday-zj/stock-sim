// 测试4个新数据源：实时行情/五档盘口/资金流/题材梯队
import { getRealtimeQuotes, getOrderBook, getFundFlow, getConceptLeaders } from '../src/market.js';
import { getQuotes } from '../src/market.js';

console.log('=== 1. 实时行情(腾讯) vs 延时快照(东财) 时间戳对比 ===');
const rt = await getRealtimeQuotes(['300136', '600519']);
const dl = await getQuotes(['300136', '600519']);
for (const c of ['300136', '600519']) {
  console.log(`${rt[c]?.name}: 腾讯实时 t=${rt[c]?.time} 价${rt[c]?.price} | 东财延时 t=${dl[c]?.time} 价${dl[c]?.price}`);
}

console.log('\n=== 2. 五档盘口 300136 ===');
const ob = await getOrderBook('300136');
if (ob) {
  console.log(`买一${ob.bid1} 卖一${ob.ask1} 价差${ob.spread} 委比${ob.weiBi}% → ${ob.note}`);
  console.log('买盘:', ob.bids.map(b => `${b.p}×${b.v}`).join(' '));
  console.log('卖盘:', ob.asks.map(a => `${a.p}×${a.v}`).join(' '));
} else console.log('盘口null(可能休市)');

console.log('\n=== 3. 逐分钟主力资金流 300136 ===');
const ff = await getFundFlow('300136', 30);
console.log(ff ? `累计主力净流入${ff.totalMainWan}万 最近5分钟${ff.recentMainWan}万 大单${ff.bigWan}万 → ${ff.note}\n走势(近8分钟,万): ${ff.trend.join(' ')}` : 'null');

console.log('\n=== 4. 题材梯队(概念领涨) ===');
const cl = await getConceptLeaders(6);
for (const x of cl) console.log(`${x.name} +${x.pct}% (涨${x.up}/跌${x.down}) 龙头:${x.leader}(${x.leaderCode}) +${x.leaderPct}%`);
