// 全局配置：资金、费用、风控、调度
export const CFG = {
  startCash: 100000,          // 初始资金（元）
  runStart: '2026-11-10',     // 实验起始日（北京时间）
  runEnd: '2026-12-10',       // 实验结束日（收盘后终止）

  // A股真实费用
  fee: {
    commissionRate: 0.00025,  // 佣金 万2.5
    commissionMin: 5,         // 最低5元
    stampTaxRate: 0.0005,     // 印花税 0.05%（仅卖出）
    transferFeeRate: 0.00001, // 过户费 0.001%（双边）
    slippage: 0.001,          // 滑点 0.1%（买加卖减）
  },

  risk: {
    // —— 仓位规模：固定风险比例法(2%法则) + ATR波动率仓位(海龟法则核心) ——
    riskPerTrade: 0.015,      // 单笔风险预算 = 总资产1.5%（本金是命根子，保守取值）
    regimeRiskMul: { risk_on: 1.0, neutral: 0.6, risk_off: 0.3 },  // 顺势调仓：大盘弱→预算大砍
    regimeMaxPos: { risk_on: 3, neutral: 2, risk_off: 1 },          // 弱势时持仓数也收缩
    // —— 主线试错通道（结构市进攻：大盘弱但主线板块强时，用更积极的预算上车）——
    regimeRiskMulMainline: { risk_on: 1.0, neutral: 0.8, risk_off: 0.6 }, // 主线单预算系数（弱市也敢试错，单笔最坏亏损≈0.9%）
    regimeMaxPosMainline: { risk_on: 3, neutral: 2, risk_off: 2 },        // 主线试错时持仓上限（risk_off也给2个位子）
    mainlineProbeMaxPosPct: 0.10,  // 保底1手时单票不得超过总资产10%（防高价股一手就重仓）
    scan: {
      enabled: true,
      everySec: 180,          // 主线异动扫描间隔（3分钟，比20分钟决策轮灵敏得多）
      minSectorPct: 1.5,      // 板块涨幅门槛：主线认定
      minCandidates: 2,       // 板块内符合条件的强势股≥2只才算主线发酵
      stockPctMin: 0.01, stockPctMax: 0.06,  // 标的当日涨幅区间：在涨但未追高
      maxFastRoundsPerDay: 3, // 每天最多触发几次快速决策（防token浪费+防抖动）
      minGapMin: 40,          // 两次快速决策最小间隔
      phases: ['修复', '发酵'], // 只在情绪修复/发酵期扫（冰点/退潮/高潮不扫）
      maxZbRate: 45,          // 炸板率>45%说明接力资金亏钱，不扫
    },
    // —— 账户级回撤熔断（保本金的最后防线）——
    ddDefensive: -0.05,       // 净值自高点回撤≥5% → 防守模式：风险预算再减半
    ddHalt: -0.08,            // 回撤≥8% → 熔断：停止一切新买入，只管存量止损
    atrMultiple: 2.0,         // 初始止损距离 = max(stopFloor, 2×ATR%)
    stopFloor: 0.05,          // 止损距离下限5%（短线紧止损，砍亏损要快）
    stopCeil: 0.12,           // 止损距离上限12%
    atrPeriod: 14,            // ATR周期
    chandelier: 3.0,          // 吊灯止损：持仓期最高价 - 3×ATR（趋势走完前不出局，利润奔跑）
    breakevenAt: 0.05,        // 浮盈≥5%后止损抬到保本价（绝不让盈利单变亏损单）
    // —— 组合级约束（叠加在单笔仓位之上）——
    maxPositions: 3,          // 最多同时持仓数
    maxPosPct: 0.35,          // 单票硬顶 ≤ 总资产35%（防低波动股仓位过大）
    minCashReserve: 0.15,     // 现金底线 ≥ 总资产15%
    maxBuyDayPct: 0.06,       // 追高硬门禁：当日涨幅>6%禁止买入（程序强制，不靠提示词自觉）
    // —— 离场 ——
    stopLoss: -0.06,          // 兜底固定止损（无ATR数据时用）
    trailTrigger: 0.10,       // 浮盈 ≥10% 启动移动止盈
    trailGiveback: 0.035,     // 高点回撤 3.5% 触发卖出
    maxHoldTradeDays: 12,     // 最长持有12个交易日
  },

  picker: {
    priceMin: 4, priceMax: 150,     // 价格区间（10万资金1手可买）
    turnoverMin: 3, turnoverMax: 22,// 换手率%
    mcapMin: 40e8, mcapMax: 900e8,  // 流通市值 40亿~900亿
    topN: 8,                        // 候选池大小
    excludeST: true, excludeNewDays: 90,
  },

  loop: {
    pollSec: 30,               // 引擎心跳(实时风控扫描止损线)
    decisionMinGapMin: 20,     // LLM决策最小间隔（分钟）
    firstDecision: '09:35',
    lastDecision: '14:40',
    closeReport: '15:10',      // 收盘处理时间
  },

  port: 8082,                  // 看板端口
};

export const DATA_DIR = new URL('../data/', import.meta.url).pathname;
