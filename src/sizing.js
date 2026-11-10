// 专业仓位管理：固定风险比例法(2%法则) + ATR波动率仓位(海龟交易法则核心)
// 核心思想：每笔交易承担的"风险金额"相等，而非"仓位金额"相等。
//   单笔风险预算 = 总资产 × riskPerTrade(1.5%)
//   止损距离 = max(stopFloor, atrMultiple × ATR%)   ← 波动越大止损越宽
//   买入股数 = 风险预算 / (每股止损金额)            ← 波动越大股数越少
// 结果：高波动股自动小仓位、低波动股自动大仓位，单笔最坏亏损恒定为~1.5%总资产。
import { CFG } from './config.js';

// ATR(n) 占价格的百分比（真实波幅均值）
export function atrPct(klines, n = CFG.risk.atrPeriod) {
  if (!klines || klines.length < n + 1) return null;
  const trs = [];
  for (let i = 1; i < klines.length; i++) {
    const h = klines[i].high, l = klines[i].low, pc = klines[i - 1].close;
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  const atr = trs.slice(-n).reduce((a, b) => a + b, 0) / n;
  const price = klines[klines.length - 1].close;
  return price > 0 ? atr / price : null;
}

// 计算买入股数 + 该股专属止损距离/止损价（regime联动：大盘弱→预算自动缩）
export function calcShares({ equity, cash, price, klines, regime = 'neutral', extraMul = 1 }) {
  const R = CFG.risk;
  if (!(price > 0) || !(equity > 0)) return { shares: 0, reason: 'invalid price/equity' };

  const mul = ((R.regimeRiskMul || {})[regime] ?? 1) * extraMul;
  const riskBudget = equity * R.riskPerTrade * mul;    // 单笔风险预算(元)×顺势系数×防守系数
  const atr = atrPct(klines);

  // 止损距离：固定下限 与 2×ATR 取大者，再封顶
  let stopDist = R.stopFloor;
  if (atr) stopDist = Math.max(stopDist, R.atrMultiple * atr);
  stopDist = Math.min(stopDist, R.stopCeil);

  const lossPerShare = price * stopDist;               // 每股最坏亏损
  let sharesByRisk = Math.floor(riskBudget / lossPerShare / 100) * 100;  // 风险法股数(整百)

  // 组合级硬约束：单票上限 + 现金底线
  const reserve = equity * R.minCashReserve;
  const capByPos = Math.floor(Math.min(cash - reserve, equity * R.maxPosPct) / price / 100) * 100;

  const shares = Math.max(0, Math.min(sharesByRisk, capByPos));
  const stopPrice = +(price * (1 - stopDist)).toFixed(3);

  return {
    shares, stopDist: +stopDist.toFixed(4), stopPrice, atr: atr != null ? +atr.toFixed(4) : null,
    riskBudget: +riskBudget.toFixed(0), lossPerShare: +lossPerShare.toFixed(3),
    sharesByRisk, capByPos, cappedByPos: capByPos < sharesByRisk,
    positionPct: +(shares * price / equity).toFixed(4),
    reason: shares < 100
      ? (capByPos < 100 ? '现金低于底线或单票空间不足1手' : '风险预算不足1手')
      : `2%法则×${regime}(${mul}): 预算${riskBudget.toFixed(0)}元÷每股止损${lossPerShare.toFixed(2)}=${sharesByRisk}股${atr?`(ATR${(atr*100).toFixed(1)}%→止损距离${(stopDist*100).toFixed(1)}%)`:'(无ATR,用固定止损)'}${capByPos<sharesByRisk?`，受单票上限压到${capByPos}股`:''}`,
  };
}

// 吊灯止损(Chandelier Exit)：持仓期最高价 - N×ATR，只升不降
// 趋势延续时止损线跟着抬高 → 强趋势不被震出(利润奔跑)；趋势反转回撤N×ATR立即离场
export function chandelierStop({ position, price, atr }) {
  const R = CFG.risk;
  const high = Math.max(position.high || 0, price);
  let stop = position.stopPrice || null;
  // 1) 吊灯线：最高价 - chandelier×ATR价格
  if (atr) {
    const ch = +(high * (1 - R.chandelier * atr)).toFixed(3);
    if (stop == null || ch > stop) stop = ch;           // 只升不降
  }
  // 2) 保本线：浮盈≥breakevenAt后，止损不得低于成本价（绝不让盈利单变亏损单）
  if (price / position.costPrice - 1 >= R.breakevenAt) {
    const be = +(position.costPrice * 1.002).toFixed(3); // 保本+0.2%覆盖费用
    if (stop == null || be > stop) stop = be;
  }
  return stop;
}
