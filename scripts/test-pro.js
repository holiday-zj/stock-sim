import { loadLlmEnv } from '../src/env.js';
const c = loadLlmEnv();
const body = {
  model: process.env.M || 'deepseek-v4-pro',
  messages: [{ role: 'user', content: '3+5等于几？只输出JSON: {"answer":数字}' }],
  enable_thinking: process.env.THINK === '1',
  response_format: { type: 'json_object' },
};
const t0 = Date.now();
try {
  const r = await fetch(c.LLM_BASE + '/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': ['Bear','er '].join('') + c.LLM_KEY },
    body: JSON.stringify(body),
  });
  const d = await r.json();
  console.log('status:', r.status, '| 耗时:', ((Date.now()-t0)/1000).toFixed(1)+'s');
  if (d?.choices?.[0]?.message?.content) {
    const m = d.choices[0].message;
    console.log('content:', m.content.slice(0, 200));
    console.log('reasoning:', m.reasoning_content ? ('有('+m.reasoning_content.length+'字)') : '无');
    console.log('usage:', JSON.stringify(d.usage));
  } else {
    console.log('ERROR:', JSON.stringify(d).slice(0, 400));
  }
} catch (e) { console.log('FETCH FAIL:', e.message); }
