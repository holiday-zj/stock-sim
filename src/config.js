// 全局配置：资金、费用、风控、调度
export const CFG = {
  startCash: 10000,           // 初始资金（元）
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
    maxPositions: 2,          // 最多同时持仓数（1万本金）
    maxPosPct: 0.48,          // 单票仓位 ≤ 总资产48%
    stopLoss: -0.06,          // 硬止损 -6%（程序强制，不问LLM）
    trailTrigger: 0.10,       // 浮盈 ≥10% 启动移动止盈
    trailGiveback: 0.035,     // 高点回撤 3.5% 触发卖出
    maxHoldTradeDays: 12,     // 最长持有12个交易日，强制复盘清仓
  },

  picker: {
    priceMin: 4, priceMax: 55,      // 价格区间（1万资金1手可买）
    turnoverMin: 3, turnoverMax: 22,// 换手率%
    mcapMin: 40e8, mcapMax: 900e8,  // 流通市值 40亿~900亿
    topN: 8,                        // 候选池大小
    excludeST: true, excludeNewDays: 90,
  },

  loop: {
    pollSec: 90,               // 行情轮询间隔
    decisionMinGapMin: 20,     // LLM决策最小间隔（分钟）
    firstDecision: '09:35',
    lastDecision: '14:40',
    closeReport: '15:10',      // 收盘处理时间
  },

  port: 8082,                  // 看板端口
};

export const DATA_DIR = new URL('../data/', import.meta.url).pathname;
