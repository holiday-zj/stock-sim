// 每日复盘进化：收盘后用LLM总结当天交易的涨跌经验 → data/lessons.json → 注入后续决策提示词
import { llmChat } from './llm.js';
import { loadJson, saveJson } from './util.js';
import { getIndices } from './market.js';
import { bjDate, bjStamp } from './env.js';

const F = 'lessons.json';
export function loadLessons() { return loadJson(F, { items: [], reflections: [] }); }
export function saveLessons(l) { saveJson(F, l); }

const SYS = `你是一名A股短线交易系统的教练，负责每日收盘复盘，让系统持续进化。
根据当天真实成交、决策理由、盈亏结果和大盘环境，提炼能改进未来决策的经验教训。
要求：
- 输出严格JSON：{"lessons":["每条≤40字，具体可执行"],"summary":"当日复盘≤100字"}
- lessons最多5条，必须是可执行的规则（如"高开>5%后滞涨的题材股次日不接力"），不要空话套话
- 结合已有经验列表：相似的不重复；被今天走势证伪的要给出修正条目；没有新认知可输出空数组
- 盈利单也要复盘：赚的是运气（大盘普涨）还是逻辑兑现，只有逻辑兑现的经验才值得保留
- 只基于给定的事实数据判断，不要编造行情`;

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
【已有经验教训(最近20条)】${store.items.slice(-20).map(x => `[${x.date}] ${x.text}`).join('\n') || '无'}

请复盘输出。`;

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
