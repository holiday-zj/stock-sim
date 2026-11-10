
import { loadJson } from '../src/util.js';
import { doBuy } from '../src/store.js';
import { CFG } from '../src/config.js';
// 场景：净值10万，现金1.4万（14%<15%底线）→ 应拒单
const s1 = { cash: 14000, positions: { '600000': { name:'X', shares: 1700, costPrice: 50, buyTime:'', buyDate:'2026-11-09', high:50 } }, trades: [], daily: [], decisions: [], events: [] };
const r1 = doBuy(s1, { code: '000001', name: '平安银行', price: 12, reason: 'test' });
console.log('现金14%时买入:', r1.ok ? '❌ 竟然成功(BUG)' : '✓ 拒绝 -> ' + r1.err);
// 场景：现金2万（20%）→ 应只允许买到剩15%，即约5000元预算
const s2 = { cash: 20000, positions: { '600000': { name:'X', shares: 1600, costPrice: 50, buyTime:'', buyDate:'2026-11-09', high:50 } }, trades: [], daily: [], decisions: [], events: [] };
const r2 = doBuy(s2, { code: '000001', name: '平安银行', price: 12, reason: 'test' });
if (r2.ok) {
  console.log('现金20%时买入: ✓ 成交', r2.trade.shares, '股, 剩余现金', s2.cash.toFixed(0), '(底线15%=15000)');
  console.log(s2.cash >= 15000*0.999 ? '✓ 现金底线守住' : '❌ 击穿底线');
} else console.log('现金20%时买入: 拒绝 ->', r2.err, '(预算', ((100000*0.15)), '保留后应为~5000, 12元x100股=1200可买)');
// 场景：现金充足 → 受单票35%上限约束
const s3 = { cash: 90000, positions: {}, trades: [], daily: [], decisions: [], events: [] };
const r3 = doBuy(s3, { code: '000001', name: '平安银行', price: 12, reason: 'test' });
console.log('空仓9万现金买入: ✓', r3.trade.shares, '股 ≈', r3.trade.amount, '元 (35%上限=35000)', r3.trade.amount <= 35100 ? '✓' : '❌超限');
console.log('minCashReserve =', CFG.risk.minCashReserve);
