# stock-sim · A股短线模拟盘（LLM自动盯盘）

**实验期：2026-11-10 ~ 2026-12-10（一个月）· 本金 ¥100,000**

真实股票代码、真实实时行情、真实新闻/公告/财务/龙虎榜数据，由大模型（deepseek-v4-pro，思考模式）决策买卖，全自动盯盘交易。零外部依赖（Node ≥ 22）。

> 部署提示：需自备 `data/llm.env`（LLM_BASE/LLM_KEY/LLM_MODEL，OpenAI兼容接口）。`data/`、`logs/` 均为运行时数据，已gitignore不入库。

## 架构
- `src/market.js` — 数据源：东财 push2delay(HTTPS快照/排行/财务) + push2his(日K) + 搜索API(新闻) + 公告API + 腾讯qt(GBK兜底)
- `src/picker.js` — 候选池：活跃股排行 → 过滤(价格4~55/换手3~22%/流通市值40~900亿/排除ST科创北交亏损) → 技术面(MA/RSI/MACD/20日位置/量比)+新闻+公告+财务
- `src/strategy.js` — LLM决策（严格JSON：BUY/SELL/HOLD+理由）+ 程序风控（硬止损-6%、移动止盈+10%回撤3.5%、12交易日时间止损、涨跌停检查）
- `src/store.js` — 账户状态落盘 `data/state.json`（现金/持仓/交易流水/每日净值/决策日志）
- `src/engine.js` — 主循环：盘中90s轮询，09:35~14:40每≥20分钟一轮LLM决策；15:05收盘记净值；实验到期自动停
- `web/index.html` — 实时看板（净值卡片/持仓/交易流水/决策日志）
- `scripts/report.js` — 战绩报告(markdown) · `scripts/run-once.js --dry` — 手动跑一轮决策

## A股真实规则建模
- T+1（当日买入不可卖）· 主板±10%/创业板±20%涨跌停 · 整百股
- 费用：佣金万2.5(最低5元) + 印花税0.05%(卖) + 过户费0.001% + 滑点0.1%单边
- 行情为东财海外延时快照（盘中约3分钟延迟）

## 运行
```
systemctl --user restart stock-sim          # 引擎+看板(:8082)
systemctl --user restart stock-sim-tunnel   # cloudflared隧道，URL在 logs/tunnel.log
node scripts/report.js                      # 战绩报告 → data/report.md
```
每日收盘报告由 Hermes cron（job ac9738b1cb18）推送微信。

## 决策日志字段
trades[]: ts/side/code/name/price(成交价含滑点)/refPrice(快照价)/shares/amount/fee/profit/quoteTime/reason
decisions[]: LLM_BUY/LLM_SELL/RISK_SELL/FINAL_SELL/HOLD/SUMMARY + 理由
