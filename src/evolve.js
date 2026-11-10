// 每日复盘进化 + 经验生命周期治理：
//   candidate(试用) → active(启用) → retired(淘汰)
// 证据驱动：决策声明引用哪条经验(id) → 买入绑定持仓 → 卖出按真实盈亏记账 → 收盘审计官裁决
import { llmChat } from './llm.js';
import { loadJson, saveJson } from './util.js';
import { CFG } from './config.js';
import { getIndices } from './market.js';
import { bjDate, bjStamp } from './env.js';

const F = 'lessons.json';
const MAX_ACTIVE = 12;          // 注入提示词的 active 经验上限（防提示词膨胀/自相矛盾）
const MAX_CANDIDATE_INJECT = 3; // 同时注入的试用经验上限
const PROMOTE = { cites: 3, trades: 2 };   // 转正门槛：被引用≥3次且已了结≥2笔
const RETIRE = { trades: 3, winRate: 0.34 }; // 淘汰：了结≥3笔且胜率<34%且净亏

export function loadLessons() {
  const raw = loadJson(F, { items: [], reflections: [] });
  return normalize(raw);
}
export function saveLessons(l) { saveJson(F, l); }

// 兼容旧数据：补齐 id/status/stats 字段
function normalize(store) {
  if (!Array.isArray(store.items)) store.items = [];
  let seq = 0;
  for (const it of store.items) {
    if (!it.id) it.id = 'L' + (it.date || '00000000').replace(/-/g, '') + '-' + (++seq);
    if (!it.status) it.status = it.vetted || it.fixed ? 'active' : 'candidate'; // 旧数据(已人工审)默认active
    it.citations = it.citations || 0;
    it.trades = it.trades || 0;
    it.wins = it.wins || 0;
    it.netPnl = it.netPnl || 0;
    it.lastCited = it.lastCited || null;
    if (!Array.isArray(it.history)) it.history = [];
    if (it.text && it.text.length > 90) it.text = it.text.slice(0, 90);
  }
  // id 去重兜底
  const seen = new Set();
  for (const it of store.items) { while (seen.has(it.id)) it.id += 'x'; seen.add(it.id); }
  if (!Array.isArray(store.reflections)) store.reflections = [];
  return store;
}

// ============ 复盘：生成新经验（候选） ============
const COACH_SYS = `你是一名严谨的A股短线交易系统教练，负责每日收盘复盘沉淀经验。你的首要职责是**质量把关**——宁缺毋滥，一条错误经验会长期毒害后续决策。
硬性质量闸门（违反即丢弃）：
1. 样本量诚实：单日单笔得出的规律是"待验证假设"，措辞用"倾向/注意/警惕"，禁用"必须/无条件/永远"。数据不足时输出空数组[]是正确选择。
2. 禁止复述既有配置：仓位/持仓数/现金底线/止损止盈数值已由程序强制，不要写进经验。只提炼配置之外的盘面认知（买卖时机、题材辨识、量价配合、板块轮动）。
3. 禁止自相矛盾：多条经验之间、与已知配置之间不能有数值冲突，给数值前先心算自洽。
4. 必须可执行且可证伪：每条对应明确动作+触发条件("当X出现，做Y")，空泛口号("控制风险""保持纪律")一律丢弃。
5. 归因分清：盈利区分逻辑兑现 vs 大盘beta/运气，只沉淀前者；亏损区分系统性下跌 vs 个股逻辑错误，只记后者。
输出严格JSON：{"lessons":["每条≤50字，当X则Y"],"summary":"≤100字，点明今天是逻辑赚钱还是运气/大盘"}
lessons最多3条。相似经验不重复；被今天走势证伪的给修正条目。`;

export async function dailyReflection(s, { quotes = {} } = {}) {
  const today = bjDate();
  const store = loadLessons();
  const dayTrades = s.trades.filter(t => t.ts.startsWith(today));
  const dayDecisions = s.decisions.filter(d => d.ts.startsWith(today));
  const equityToday = s.daily.at(-1);
  const prev = s.daily.slice().reverse().find(d => d.date < today);
  const indices = await getIndices().catch(() => null);
  const held = Object.entries(s.positions).map(([c, p]) => {
    const q = quotes[c];
    const price = q?.price || p.costPrice;
    return `${p.name}(${c}) ${p.shares}股 成本${(+p.costPrice).toFixed(2)} 现价${(+price).toFixed(2)} 盈亏${((price / p.costPrice - 1) * 100).toFixed(1)}%`;
  }).join('；') || '空仓';
  const dayPnl = equityToday && prev ? ((equityToday.equity - prev.equity) / prev.equity * 100).toFixed(2) + '%' : '(首日)';

  const user = `【日期】${today}
【大盘】${(indices || []).map(i => `${i.name} ${(i.pct * 100).toFixed(2)}%`).join('；') || '缺失'}
【当日盈亏】净值 ${equityToday?.equity ?? '?'} 当日${dayPnl} 累计${equityToday ? equityToday.totalPct + '%' : '-'}
【当日成交】${dayTrades.length ? JSON.stringify(dayTrades.map(t => ({ side: t.side, name: t.name, price: t.price, shares: t.shares, profit: t.profit ?? null, reason: (t.reason || '').slice(0, 80) }))) : '无'}
【当日决策思路】${dayDecisions.filter(d => d.type === 'SUMMARY').map(d => d.summary).join(' | ') || '无'}
【当前持仓】${held}
【已由程序强制的风控(勿写进经验)】单笔风险${(CFG.risk.riskPerTrade * 100)}%+ATR止损；持仓≤${CFG.risk.maxPositions}只；单票≤${(CFG.risk.maxPosPct * 100)}%；现金底线${(CFG.risk.minCashReserve * 100)}%；吊灯止损+浮盈5%保本线；账户回撤5%防守/8%熔断。
【已有经验】${store.items.filter(x => x.status !== 'retired').slice(-20).map(x => `[${x.id}][${x.status}] ${x.text}`).join('\n') || '无'}

请复盘输出。交易太少或行情平淡时，直接输出空lessons数组。`;

  const res = await llmChat(COACH_SYS, user, { timeout: 90000 });
  const items = Array.isArray(res?.lessons) ? res.lessons.slice(0, 3) : [];
  const added = [];
  let seq = store.items.length;
  for (const text of items) {
    if (typeof text === 'string' && text.trim()) {
      const t = text.trim().slice(0, 90);
      const item = {
        id: 'L' + today.replace(/-/g, '') + '-' + (++seq),
        date: today, text: t, ts: bjStamp(), status: 'candidate',
        citations: 0, trades: 0, wins: 0, netPnl: 0, lastCited: null, history: [],
      };
      store.items.push(item);
      added.push({ id: item.id, text: t });
    }
  }
  if (res?.summary) {
    store.reflections = [...store.reflections, { date: today, summary: String(res.summary).slice(0, 200) }].slice(-40);
  }
  saveLessons(store);
  return { lessons: added.map(a => a.text), addedIds: added.map(a => a.id), summary: res?.summary || '' };
}

// ============ 证据记账 ============
// 买入时记录引用了哪些经验（绑定到持仓），经验.citations++
export function recordCitation(store, lessonIds, ts) {
  if (!Array.isArray(lessonIds) || !lessonIds.length) return;
  for (const id of lessonIds) {
    const it = store.items.find(x => x.id === id);
    if (it && it.status !== 'retired') { it.citations++; it.lastCited = ts || bjDate(); }
  }
}
// 卖出时把该笔真实盈亏记到买入时引用的经验上
export function settleOnSell(store, lessonIds, profit) {
  if (!Array.isArray(lessonIds) || !lessonIds.length) return;
  for (const id of lessonIds) {
    const it = store.items.find(x => x.id === id);
    if (!it || it.status === 'retired') continue;
    it.trades++; it.netPnl = +((it.netPnl || 0) + (profit || 0)).toFixed(2);
    if ((profit || 0) > 0) it.wins++;
  }
}

// ============ 程序硬规则：转正 / 淘汰（证据驱动，不需LLM） ============
export function autoGovern(store, today) {
  const acts = [];
  for (const it of store.items) {
    if (it.status === 'retired') continue;
    const winRate = it.trades ? it.wins / it.trades : 0;
    // 淘汰：反复引用仍亏钱
    if (it.trades >= RETIRE.trades && winRate < RETIRE.winRate && it.netPnl < 0) {
      it.status = 'retired';
      it.history.push({ date: today, act: 'auto-retire', why: `了结${it.trades}笔胜率${(winRate*100).toFixed(0)}%净亏${it.netPnl}，证据证伪` });
      acts.push(`淘汰[${it.id}] ${it.text.slice(0,20)}（战绩证伪）`);
      continue;
    }
    // 转正：candidate 战绩达标
    if (it.status === 'candidate' && it.citations >= PROMOTE.cites && it.trades >= PROMOTE.trades && (winRate >= 0.5 || it.netPnl > 0)) {
      it.status = 'active';
      it.history.push({ date: today, act: 'auto-promote', why: `引用${it.citations}次了结${it.trades}笔胜率${(winRate*100).toFixed(0)}%净${it.netPnl}，转正` });
      acts.push(`转正[${it.id}] ${it.text.slice(0,20)}`);
    }
  }
  // active 超上限：按战绩+新近度排序，末位降级为 candidate（不直接删，留机会）
  const actives = store.items.filter(x => x.status === 'active');
  if (actives.length > MAX_ACTIVE) {
    const score = x => (x.trades ? (x.wins / x.trades) * 100 + Math.min(x.netPnl / 100, 50) : 50) + (x.lastCited === today ? 10 : 0);
    actives.sort((a, b) => score(b) - score(a));
    for (const x of actives.slice(MAX_ACTIVE)) {
      x.status = 'candidate';
      x.history.push({ date: today, act: 'auto-demote', why: 'active超上限，按战绩降级试用' });
    }
  }
  return acts;
}

// ============ 收盘审计官：独立LLM角色，凭战绩裁决（与生成者分离） ============
const AUDITOR_SYS = `你是独立的风控审计官，不参与经验生成，只负责**裁决已有经验的去留**，目标是防止经验库劣化。你比教练更保守：宁可淘汰也不让可疑经验污染决策。
对每条经验，依据其"实战战绩"(被引用次数/已了结笔数/胜率/净盈亏)和"内容质量"给出裁决：
- KEEP：战绩为正或样本不足但逻辑严谨，保留。
- PROMOTE：candidate 且战绩/逻辑明确优秀，升为 active。
- DEMOTE：active 但战绩转差或近期失效，降为 candidate 观察。
- RETIRE：满足任一即淘汰——①战绩明确证伪(多次引用仍亏)；②与更强的新经验/程序风控重复冗余；③内容空泛不可证伪；④自相矛盾；⑤长期(>10交易日)零引用的过时经验。
- REVISE：方向对但表述有缺陷(过于绝对/条件不清)，给出修订文本。
输出严格JSON：{"verdicts":[{"id":"L20261110-1","action":"KEEP|PROMOTE|DEMOTE|RETIRE|REVISE","revisedText":"仅REVISE时填,≤50字","why":"≤30字"}],"summary":"≤60字整体评价"}
只裁决给定清单里的id，不要编造。对每条都要给verdict。`;

export async function reviewLessons(s) {
  const today = bjDate();
  const store = loadLessons();
  const live = store.items.filter(x => x.status !== 'retired');
  if (!live.length) return { reviewed: 0, acts: [] };

  // 交易日历粗判"长期零引用"：用最后引用日与今天的自然日差近似
  const listing = live.map(x => ({
    id: x.id, status: x.status, text: x.text,
    citations: x.citations, trades: x.trades,
    winRate: x.trades ? +((x.wins / x.trades) * 100).toFixed(0) + '%' : '未了结',
    netPnl: x.netPnl, lastCited: x.lastCited || '从未',
    ageDays: x.date ? Math.round((new Date(today) - new Date(x.date)) / 86400e3) : 0,
  }));

  const user = `【今日】${today}
【经验清单(含实战战绩)】
${JSON.stringify(listing, null, 1)}

注：citations=被决策引用次数，trades=引用后已了结笔数，winRate/netPnl=这些了结交易的真实战绩，ageDays=产生至今天数。样本少(trades=0)时按内容逻辑裁决，不要轻易RETIRE新经验；对trades≥2且netPnl<0的要重点审查是否证伪。请逐条裁决。`;

  let res;
  try {
    res = await llmChat(AUDITOR_SYS, user, { timeout: 120000 });
  } catch (e) {
    return { reviewed: 0, acts: ['审计LLM失败:' + e.message], error: true };
  }

  const acts = [];
  for (const v of (res?.verdicts || [])) {
    const it = store.items.find(x => x.id === v.id);
    if (!it || it.status === 'retired') continue;
    const action = String(v.action || '').toUpperCase();
    const why = (v.why || '').slice(0, 40);
    if (action === 'RETIRE') {
      it.status = 'retired';
      it.history.push({ date: today, act: 'audit-retire', why });
      acts.push(`审计淘汰[${it.id}] ${why}`);
    } else if (action === 'PROMOTE' && it.status === 'candidate') {
      it.status = 'active';
      it.history.push({ date: today, act: 'audit-promote', why });
      acts.push(`审计转正[${it.id}] ${why}`);
    } else if (action === 'DEMOTE' && it.status === 'active') {
      it.status = 'candidate';
      it.history.push({ date: today, act: 'audit-demote', why });
      acts.push(`审计降级[${it.id}] ${why}`);
    } else if (action === 'REVISE' && v.revisedText) {
      const old = it.text;
      it.text = String(v.revisedText).slice(0, 90);
      it.history.push({ date: today, act: 'audit-revise', why, from: old });
      acts.push(`审计修订[${it.id}]：${it.text.slice(0,20)}`);
    } else if (action === 'KEEP') {
      it.history.push({ date: today, act: 'audit-keep', why });
    }
  }
  saveLessons(store);
  return { reviewed: (res?.verdicts || []).length, acts, summary: res?.summary || '' };
}

// ============ 注入决策提示词：只给 active + 少量试用 candidate，带id供引用 ============
export function lessonsForDecision(limitActive = MAX_ACTIVE) {
  const store = loadLessons();
  const today = bjDate();
  const actives = store.items.filter(x => x.status === 'active')
    .sort((a, b) => (b.netPnl - a.netPnl) || (b.citations - a.citations));
  const cands = store.items.filter(x => x.status === 'candidate')
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
    .slice(0, MAX_CANDIDATE_INJECT);
  const picked = [...actives.slice(0, limitActive), ...cands];
  return picked.map(x => ({
    id: x.id, status: x.status,
    line: `[${x.id}]${x.status === 'candidate' ? '(试用)' : ''} ${x.text}${x.trades ? `（战绩${x.wins}/${x.trades}胜,净${x.netPnl}）` : ''}`,
  }));
}
// 兼容旧调用：纯文本列表
export function lessonsForPrompt(n = 15) {
  return lessonsForDecision(n).map(x => x.line);
}
export function reflectionForDate(date) {
  return (loadLessons().reflections || []).find(r => r.date === date);
}
