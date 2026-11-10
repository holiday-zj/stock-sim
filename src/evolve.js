// 每日复盘进化：收盘后用LLM总结当天交易的涨跌经验 → data/lessons.json → 注入后续决策提示词
import { llmChat } from './llm.js';
import { loadJson, saveJson } from './util.js';
import { CFG } from './config.js';
import { getIndices } from './market.js';
import { bjDate, bjStamp } from './env.js';

const F = 'lessons.json';
export function loadLessons() { return loadJson(F, { items: [], reflections: [] }); }
export function saveLessons(l) { saveJson(F, l); }

const SYS = `你是一名严谨的A股短线交易系统教练，负责每日收盘复盘沉淀经验。你的首要职责是**质量把关**——宁缺毋滥，一条错误经验会长期毒害后续决策。
根据当天真实成交、决策理由、盈亏结果和大盘环境，提炼可改进未来决策的经验。

硬性质量闸门（违反即丢弃，不要输出）：
1. **样本量诚实**：单日、单笔交易得出的规律是"待验证假设"，不是铁律。措辞必须体现不确定性（用"倾向/注意/警惕"，禁用"必须/无条件/永远"这种绝对词）。数据不足时，lessons 输出空数组 [] 是完全正确、值得表扬的选择。
2. **禁止复述既有配置**：仓位上限、持仓只数、现金底线、止损止盈数值等已由程序风控强制，写进经验是噪音。只提炼"配置之外"的盘面认知（如买卖时机、题材辨识、量价配合、板块轮动节奏）。
3. **禁止自相矛盾**：输出的多条经验之间、以及与已知配置之间不能有数值冲突。给数值前先心算是否自洽。
4. **必须可执行且可证伪**：每条经验要能对应一个明确动作和触发条件（"当X出现，做Y"），空泛心态口号（"控制风险""保持纪律"）一律丢弃。
5. **归因要分清**：盈利要区分是逻辑兑现还是大盘beta/运气，只有逻辑兑现的才值得沉淀；亏损要区分是系统性下跌（大盘拖累，非策略错）还是个股逻辑错误（才是真教训）。别把大盘普跌的锅扣到选股逻辑上。

输出严格JSON：{"lessons":["每条≤50字，当X则Y"],"summary":"当日复盘≤100字，须点明今天是逻辑赚钱还是运气/大盘"}
lessons 最多3条（少而精优于多而杂）。结合已有经验：相似不重复；被今天走势证伪的给出修正条目。`;

export async function dailyReflection(s, { quotes = {} } = {}) {
  const today = bjDate();
  const store = loadLessons();
  const dayTrades = s.trades.filter(t => t.ts.startsWith(today));
  const dayDecisions = s.decisions.filter(d => d.ts.startsWith(today));
  const equityToday = s.daily.at(-1);
  const prev = s.daily.at(-2);
  const indices = await getIndices().catch(() => null);
  const held = Object.entries(s.positions).map(([c, p]) => {
    const q = quotes[c];
    const price = q?.price || p.costPrice;
    return `${p.name}(${c}) ${p.shares}股 成本${(+p.costPrice).toFixed(2)} 现价${(+price).toFixed(2)} 盈亏${((price / p.costPrice - 1) * 100).toFixed(1)}% 买入理由:${(p.buyReason || '').slice(0, 50)}`;
  }).join('；') || '空仓';

  const dayPnl = equityToday && prev ? ((equityToday.equity - prev.equity) / prev.equity * 100).toFixed(2) + '%' : '(首日)';
  const user = `【日期】${today}
【大盘】${(indices || []).map(i => `${i.name} ${(i.pct * 100).toFixed(2)}%`).join('；') || '缺失'}
【当日盈亏】净值 ${equityToday?.equity ?? '?'} 当日${dayPnl} 累计${equityToday ? equityToday.totalPct + '%' : '-'}
【当日成交】${dayTrades.length ? JSON.stringify(dayTrades.map(t => ({ side: t.side, name: t.name, code: t.code, price: t.price, shares: t.shares, profit: t.profit ?? null, reason: (t.reason || '').slice(0, 90) }))) : '无'}
【当日决策思路】${dayDecisions.filter(d => d.type === 'SUMMARY').map(d => d.summary).join(' | ') || '无'}
【当前持仓】${held}
【已由程序强制的风控配置(这些不要写进经验)】单笔风险预算${(CFG.risk.riskPerTrade*100)}%总资产+ATR止损；持仓≤${CFG.risk.maxPositions}只(risk_off时1只)；单票≤${(CFG.risk.maxPosPct*100)}%；现金底线${(CFG.risk.minCashReserve*100)}%；吊灯止损(最高价-3ATR只升不降)+浮盈5%保本线；账户回撤5%防守/8%熔断；时间止损${CFG.risk.maxHoldTradeDays}日。
【已有经验教训(最近20条)】${store.items.slice(-20).map(x => `[${x.date}] ${x.text}`).join('\n') || '无'}

请复盘输出。若今日交易太少或行情平淡不足以提炼可靠规律，直接输出空 lessons 数组。`;

  const res = await llmChat(SYS, user, { timeout: 90000 });
  const items = Array.isArray(res?.lessons) ? res.lessons.slice(0, 5) : [];
  const added = [];
  for (const text of items) {
    if (typeof text === 'string' && text.trim()) {
      const t = text.trim().slice(0, 80);
      store.items.push({ date: today, text: t, ts: bjStamp() });
      added.push(t);
    }
  }
  if (store.items.length > 60) store.items.splice(0, store.items.length - 60);
  if (res?.summary) {
    store.reflections = [...(store.reflections || []), { date: today, summary: String(res.summary).slice(0, 200) }].slice(-40);
  }
  saveLessons(store);
  return { lessons: added, summary: res?.summary || '' };
}

// 注入决策提示词用：最近n条经验
export function lessonsForPrompt(n = 15) {
  return loadLessons().items.slice(-n).map(x => `[${x.date.slice(5)}] ${x.text}`);
}
export function reflectionForDate(date) {
  return (loadLessons().reflections || []).find(r => r.date === date);
}
