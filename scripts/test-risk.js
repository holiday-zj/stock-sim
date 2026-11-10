// 风控体系测试：吊灯止损只升不降 + 保本线 + 回撤防守/熔断
import { chandelierStop, calcShares, atrPct } from '../src/sizing.js';
import { riskCheck } from '../src/strategy.js';
import { CFG } from '../src/config.js';

const ATR = 0.05; // 假设5% ATR

// 1) 吊灯止损只升不降
const pos1 = { costPrice: 10, high: 10, stopPrice: 9.4 };
const s1 = chandelierStop({ position: pos1, price: 12, atr: ATR });   // 涨到12 → 吊灯线=12*(1-15%)=10.2
console.log('涨到12元:', s1, s1 === 10.2 ? '✓ 止损抬到10.2(锁定盈利+2%)' : '❌');
const s2 = chandelierStop({ position: { ...pos1, high: 12, stopPrice: 10.2 }, price: 11.5, atr: ATR });
console.log('回落到11.5:', s2, s2 === 10.2 ? '✓ 止损线不降(只升不降)' : '❌');

// 2) 保本线：浮盈5%后止损≥成本
const s3 = chandelierStop({ position: { costPrice: 10, high: 10.5, stopPrice: null }, price: 10.6, atr: null });
console.log('浮盈6%无ATR:', s3, s3 >= 10 ? '✓ 抬到保本价10.02' : '❌');

// 3) riskCheck 吊灯触发卖出
const quotes = { '300001': { code: '300001', price: 9.0, preClose: 9.5 } };
const state = { positions: { '300001': { name: '测试', shares: 100, costPrice: 10, high: 11, buyDate: '2026-11-09', stopPrice: 9.35 } } };
const orders = await riskCheck(state, quotes, () => 2, async () => null);
console.log('价格9.0跌破吊灯线9.35:', orders.length === 1 ? '✓ 触发止损卖出: ' + orders[0].reason : '❌ 未触发');

// 4) T+1当天买入不卖
const state2 = { positions: { '300001': { name: '测试', shares: 100, costPrice: 10, high: 11, buyDate: new Date(Date.now()+8*3600e3).toISOString().slice(0,10), stopPrice: 9.35 } } };
const o2 = await riskCheck(state2, quotes, () => 0, async () => null);
console.log('T+1锁定:', o2.length === 0 ? '✓ 不卖' : '❌');

// 5) regime联动仓位
for (const reg of ['risk_on', 'neutral', 'risk_off']) {
  const sz = calcShares({ equity: 100000, cash: 100000, price: 10, klines: null, regime: reg });
  console.log(`regime=${reg}: ${sz.shares}股 最坏亏≈${(sz.shares*0.6).toFixed(0)}元`);
}
