// 进攻端验证：主线通道数据源 + 试错仓位 + 定点候选
// node scripts/test-offense.js
import { CFG } from '../src/config.js';
import { getSectorRank, sectorStocks, getSentiment } from '../src/market.js';
import { calcShares } from '../src/sizing.js';
import { buildFocusCandidates, hotSectorStocks } from '../src/picker.js';

console.log('=== 1. 领涨板块(新格式含code) ===');
const sec = await getSectorRank(4);
console.log(JSON.stringify(sec.top));
if (!sec.top.length) { console.log('!! 板块接口失败'); process.exit(1); }
if (typeof sec.top[0] !== 'object' || !sec.top[0].code) { console.log('!! 板块格式不对'); process.exit(1); }

console.log('\n=== 2. 板块成分股(sectorStocks) ===');
const top = sec.top[0];
const stocks = await sectorStocks(top.code, 10);
console.log(`${top.name} 前10:`, stocks.map(x => `${x.name}+${(x.pct*100).toFixed(1)}%主力${x.mainNet!=null?(x.mainNet/1e4).toFixed(0)+'万':'?'}`).join(' | '));
if (!stocks.length) { console.log('!! 成分股接口失败'); process.exit(1); }

console.log('\n=== 3. 情绪(含涨停板块分布) ===');
const s = await getSentiment();
console.log('phase:', s.phase, '| 涨停', s.ztCount, '| 炸板率', s.zbRate, '| ztBySector:', JSON.stringify(Object.entries(s.ztBySector||{}).sort((a,b)=>b[1]-a[1]).slice(0,5)));

console.log('\n=== 4. 主线候选通道(hotSectorStocks) ===');
const hot = await hotSectorStocks(new Set());
console.log(`找到 ${hot.length} 只主线强势股:`, hot.slice(0,6).map(x=>`${x.name}[${x.hotSector}]+${(x.pct*100).toFixed(1)}%`).join(' | '));

console.log('\n=== 5. 主线试错仓位(risk_off对比) ===');
// 通富微电场景复现: 11-17 risk_off 价格44 预算不足1手被跳过
const klines = null; // 无ATR时用stopFloor=5%
const old = calcShares({ equity: 96000, cash: 93000, price: 44, klines, regime: 'risk_off', mainline: false });
const nw = calcShares({ equity: 96000, cash: 93000, price: 44, klines, regime: 'risk_off', mainline: true });
console.log('常规risk_off @44元:', old.shares, '股 |', old.reason);
console.log('主线risk_off @44元:', nw.shares, '股 |', nw.reason);
if (nw.shares < 100) { console.log('!! 主线试错应保底1手'); process.exit(1); }
// 高价股: 120元 正常风险公式给100股(最坏亏损600元=0.6%在预算内)；若走保底路径则受10%上限约束
const hi = calcShares({ equity: 96000, cash: 93000, price: 120, klines, regime: 'risk_off', mainline: true });
console.log('主线risk_off @120元:', hi.shares, '股 |', hi.reason, `| probe=${hi.probe} 仓位=${(hi.positionPct*100).toFixed(1)}%`);
if (hi.probe && hi.shares * 120 / 96000 > 0.10) { console.log('!! 高价股保底超限'); process.exit(1); }
// 低价股正常
const lo = calcShares({ equity: 96000, cash: 93000, price: 15, klines, regime: 'risk_off', mainline: true });
console.log('主线risk_off @15元:', lo.shares, '股 |', lo.reason);

console.log('\n=== 6. 定点候选(buildFocusCandidates) ===');
// 用主线通道已筛出的票(已过passFilter)，避免选中科创板688被正确过滤导致误判
const probeCode = hot.length ? hot[0].code : stocks.find(x => !/^68|^8|^4|^92/.test(x.code))?.code;
const focus = await buildFocusCandidates([probeCode]);
console.log(`${probeCode}:`, focus.length ? `name=${focus[0].name} price=${focus[0].price} tech.ma5=${focus[0].tech?.ma5} dayShape=${focus[0].intraday?.dayShape?.shape||'?'}` : 'FAILED');
if (!focus.length) { console.log('!! 定点候选失败'); process.exit(1); }

console.log('\n✅ 进攻端全部验证通过');
process.exit(0);
