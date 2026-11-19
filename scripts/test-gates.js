// 回放验证：用历史亏损买入的当时数据检验新门禁是否能拦截
// node scripts/test-gates.js

// ---- 用 market.js 同款 shapeOf 逻辑本地重建 ----
function shapeOf(pts, preClose) {
  if (!pts || pts.length < 20) return null;
  const first = pts[0], last = pts.at(-1);
  const hi = Math.max(...pts.map(p => p.p)), lo = Math.min(...pts.map(p => p.p));
  const morning = pts.filter(p => p.t <= '11:30');
  const afternoon = pts.filter(p => p.t >= '13:00');
  const mornAvg = morning.length ? morning.reduce((a, b) => a + b.p, 0) / morning.length : first.p;
  const aftAvg = afternoon.length ? afternoon.reduce((a, b) => a + b.p, 0) / afternoon.length : mornAvg;
  const drift = (aftAvg / mornAvg - 1) * 100;
  const fromOpen = (last.p / first.p - 1) * 100;
  const fromHi = (last.p / hi - 1) * 100;
  let shape;
  if (fromHi < -0.5) shape = `冲高回落(现距高点${fromHi.toFixed(1)}%)`;
  else if (drift < -0.2) shape = '午后走弱';
  else if (drift > 0.2) shape = '午后走强(资金持续进场)';
  else if (Math.abs(fromOpen) < 0.2) shape = '横盘震荡(方向未明)';
  else shape = fromOpen > 0 ? '全天稳步上行' : '全天走弱';
  return { pctFromOpen: +fromOpen.toFixed(2), pctFromHigh: +fromHi.toFixed(2), posInDayRange: +((last.p - lo) / ((hi - lo) || 1)).toFixed(2), driftPct: +drift.toFixed(2), shape };
}

// ---- 新门禁逻辑（与 engine.js 一致） ----
function stockGate(sh, dayPct) {
  if (dayPct != null && dayPct > 6) return `拒单: 追高门禁 当日+${dayPct.toFixed(1)}%>6%`;
  if (sh) {
    const weakShape = /午后走弱|全天走弱|高开低走/.test(sh.shape);
    const deepPullback = sh.pctFromHigh != null && sh.pctFromHigh <= -1.5;
    if (weakShape || deepPullback) return `拒单: 形态「${sh.shape}」距高点${sh.pctFromHigh}%`;
  }
  return '通过';
}
function indexGate(idxSh) {
  if (idxSh && idxSh.posInDayRange < 0.4 && (idxSh.driftPct < 0 || idxSh.pctFromOpen < -0.3))
    return `拒单: 大盘日内走弱 ${idxSh.shape} 位置${idxSh.posInDayRange}`;
  return '通过';
}
// ---- regime熊市反弹降级（与 market.js 一致） ----
function regimeOf({ aboveMa20, aboveMa10, ma20up, chg5 }) {
  let score = 0;
  if (aboveMa20) score++; if (aboveMa10) score++; if (ma20up) score++; if (chg5 > 0) score++;
  let r = score >= 3 ? 'risk_on' : (score <= 1 ? 'risk_off' : 'neutral');
  if (r === 'risk_on' && !ma20up) r = 'neutral';
  return r;
}

// ---- 用例1：11-12 10:36 君正股份/先导基电买入 ----
// 当时快照(审计记录): 10:15日内高点后回落, 距高点-5.4%/-5.7%, 日内位置0.03/0.44
const case1a = { pctFromHigh: -5.4, posInDayRange: 0.03, driftPct: 0, shape: '冲高回落(现距高点-5.4%)' };
const case1b = { pctFromHigh: -5.7, posInDayRange: 0.44, driftPct: 0, shape: '冲高回落(现距高点-5.7%)' };
console.log('用例1a 君正股份@10:36 形态门禁:', stockGate(case1a, 1.2), '(期望:拒单)');
console.log('用例1b 先导基电@10:36 形态门禁:', stockGate(case1b, 0.8), '(期望:拒单)');

// 11-12 10:17 regime=risk_on(MA20走平/向下, 上证3697站上MA20) → 应降级neutral
console.log('用例1c 11-12 10:17 regime:', regimeOf({ aboveMa20: true, aboveMa10: true, ma20up: false, chg5: 0.2 }), '(期望:neutral, 原risk_on)');

// ---- 用例2：11-18 13:57 兴森科技 当日+8.2% 尾盘追首板 ----
// 当日开24.60 收26.20 高26.48: 买价26.206距高点-1.04% 形态午后走强 → 形态门禁不拦, 但当日涨幅=26.18/24.23-1=+8.0%>6% → 追高门禁应拦
console.log('用例2 兴森科技@13:57 追高门禁:', stockGate({ pctFromHigh: -1.04, posInDayRange: 0.9, driftPct: 1.2, shape: '午后走强(资金持续进场)' }, 8.0), '(期望:拒单)');

// ---- 用例3：正常好买点不应误杀 ----
// 上升趋势浅回踩: 距高点-0.8% 午后走强
console.log('用例3a 浅回踩好买点:', stockGate({ pctFromHigh: -0.8, posInDayRange: 0.7, driftPct: 0.5, shape: '午后走强(资金持续进场)' }, 2.1), '(期望:通过)');
// 大盘日内健康: 位置0.8 偏移+0.1
console.log('用例3b 大盘日内健康:', indexGate({ posInDayRange: 0.8, driftPct: 0.1, pctFromOpen: 0.2, shape: '全天稳步上行' }), '(期望:通过)');
// 大盘尾盘跳水: 位置0.1 偏移-0.3
console.log('用例3c 大盘尾盘跳水:', indexGate({ posInDayRange: 0.1, driftPct: -0.3, pctFromOpen: -0.5, shape: '午后走弱' }), '(期望:拒单)');
// regime正常risk_on(MA20向上)不降级
console.log('用例3d 真牛市regime:', regimeOf({ aboveMa20: true, aboveMa10: true, ma20up: true, chg5: 1.0 }), '(期望:risk_on)');

// ---- shapeOf 合成数据自检 ----
const up = Array.from({ length: 100 }, (_, i) => ({ t: i < 50 ? `09:${String(30 + i).padStart(2, '0')}` : `13:${String(i - 50).padStart(2, '0')}`, p: 10 + i * 0.02, avg: 10 + i * 0.015 }));
const s1 = shapeOf(up, 10);
console.log('合成上行日:', s1.shape, '(期望含 午后走强 或 稳步上行)');
