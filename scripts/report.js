// 生成战绩报告（markdown）：node scripts/report.js
import { loadState, equityOf } from '../src/store.js';
import { loadLessons } from '../src/evolve.js';
import { getQuotes } from '../src/market.js';
import { CFG } from '../src/config.js';

const s = loadState();
const codes = Object.keys(s.positions);
const quotes = codes.length ? await getQuotes(codes) : {};
const equity = equityOf(s, quotes);
const base = CFG.startCash;
const pl = equity - base;
const plPct = (equity / base - 1) * 100;

const buys = s.trades.filter(t => t.side === 'BUY');
const sells = s.trades.filter(t => t.side === 'SELL');
const realized = sells.reduce((a, t) => a + (t.profit || 0), 0);
const wins = sells.filter(t => t.profit > 0).length;
const totalFee = s.trades.reduce((a, t) => a + (t.fee || 0), 0);

let md = `# A股短线模拟盘 战绩报告
生成时间: ${new Date(Date.now()+8*3600e3).toISOString().slice(0,19).replace('T',' ')} (北京)
实验期: ${CFG.runStart} ~ ${CFG.runEnd}

## 总览
| 指标 | 数值 |
|---|---|
| 初始资金 | ¥${base.toFixed(2)} |
| 当前净值 | ¥${equity.toFixed(2)} |
| 盈亏 | ¥${pl.toFixed(2)} (${plPct.toFixed(2)}%) |
| 现金 | ¥${s.cash.toFixed(2)} |
| 已实现盈亏 | ¥${realized.toFixed(2)} |
| 交易次数 | 买${buys.length} / 卖${sells.length} |
| 卖出胜率 | ${sells.length ? (wins/sells.length*100).toFixed(0)+'%' : '-'} (${wins}/${sells.length}) |
| 总费用 | ¥${totalFee.toFixed(2)} |

## 当前持仓
${Object.entries(s.positions).map(([c,p])=>{const q=quotes[c];const pr=q?.price||p.costPrice;return `- ${p.name}(${c}) ${p.shares}股 成本${p.costPrice.toFixed(2)} 现价${pr.toFixed(2)} 盈亏${((pr/p.costPrice-1)*100).toFixed(1)}%`;}).join('\n') || '空仓'}

## 每日净值
${s.daily.map(d=>`- ${d.date}: ¥${d.equity.toFixed(2)} (${d.totalPct>=0?'+':''}${d.totalPct}%) ${d.positions}`).join('\n') || '(尚无收盘记录)'}

## 经验库（复盘沉淀）
${loadLessons().items.slice(-10).map(x=>`- [${x.date.slice(5)}] ${x.text}`).join('\n') || '(尚无)'}

## 最近交易
${s.trades.slice(-30).reverse().map(t=>`- ${t.ts} ${t.side==='BUY'?'🟢买':'🔴卖'} ${t.name}(${t.code}) ${t.shares}股 @${t.price} ${t.profit!=null?`盈亏¥${t.profit}`:''} | ${t.reason||''}`.slice(0,180)).join('\n') || '(尚无交易)'}
`;
console.log(md);
import fs from 'node:fs';
fs.writeFileSync(new URL('../data/report.md', import.meta.url), md);
