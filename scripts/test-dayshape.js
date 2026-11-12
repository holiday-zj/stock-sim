// 验证日内形态分析 + 大盘日内走势（T+1隔夜责任的数据基础）
import { getIntradayTrend, getIndexIntraday } from '../src/market.js';

console.log('=== 大盘日内走势（判断今天是走强还是走弱的一天）===');
const idx = await getIndexIntraday('1.000001');
console.log(JSON.stringify(idx, null, 1));

console.log('\n=== 个股日内形态（今日持仓+已卖出的对比）===');
for (const c of ['300223', '600641', '300136']) {
  const t = await getIntradayTrend(c, 5);
  if (!t) { console.log(c, 'null'); continue; }
  const s = t.dayShape;
  console.log(`${c}: 开${s.open} 现${s.now} 高${s.high}@${s.highTime} 低${s.low}@${s.lowTime}`);
  console.log(`   高开${s.gapPct}% 距高点${s.pctFromHigh}% 日内位置${s.posInDayRange} 站上均价线${s.aboveVwap} 上下午偏移${s.driftPct}%`);
  console.log(`   → 形态: ${s.shape}`);
}

console.log('\n=== 尾盘出货形态识别测试 ===');
const tests = [
  { name: '冲高回落', p: '14:00开高→现价距高点>0.5%' },
];
// 用真实数据验证判定逻辑
const t = await getIntradayTrend('300136', 5);
if (t?.dayShape) {
  const s = t.dayShape;
  const wouldReject = /冲高回落|午后走弱|全天走弱/.test(s.shape);
  console.log(`信维通信 形态「${s.shape}」→ 尾盘门禁${wouldReject ? '会拒单 ✓' : '放行'}`);
}
