// 仓位算法验证：高波动 vs 低波动股票应得到显著不同的仓位
import { calcShares, atrPct } from '../src/sizing.js';
import { getDailyKline } from '../src/market.js';

const cases = [
  { code: '300136', name: '信维通信', note: '20cm创业板高波动' },
  { code: '300413', name: '芒果超媒', note: '创业板题材' },
  { code: '601398', name: '工商银行', note: '大盘低波动对照' },
  { code: '600519', name: '贵州茅台', note: '高价股(现金约束对照)' },
];
const equity = 100000, cash = 100000;
for (const c of cases) {
  let kl = null;
  for (let i = 0; i < 3 && !kl; i++) { kl = await getDailyKline(c.code, 40); if (!kl) await new Promise(r=>setTimeout(r,800)); }
  if (!kl) { console.log(`${c.name}: K线拉取失败,跳过`); continue; }
  const price = kl.at(-1).close;
  const sz = calcShares({ equity, cash, price, klines: kl });
  console.log(`${c.name}(${c.code}) ${c.note}: 价${price} ATR=${sz.atr!=null?(sz.atr*100).toFixed(1)+'%':'无'} → 止损距离${(sz.stopDist*100).toFixed(1)}% 止损价${sz.stopPrice} | 买${sz.shares}股(${(sz.positionPct*100).toFixed(1)}%仓) 最坏亏≈${(sz.shares*sz.lossPerShare).toFixed(0)}元`);
  console.log(`   ${sz.reason}`);
}
// 边界：现金不足
const low = calcShares({ equity: 100000, cash: 14000, price: 12, klines: null });
console.log('\n现金14%(低于15%底线):', low.shares, '股 →', low.reason);
// 边界：无K线数据回退
const noatr = calcShares({ equity: 100000, cash: 100000, price: 10, klines: null });
console.log('无K线数据:', noatr.shares, '股, 止损距离', (noatr.stopDist*100)+'% →', noatr.reason);
