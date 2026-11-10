import { loadLlmEnv } from '../src/env.js';
const c = loadLlmEnv();
const H = { 'Content-Type': 'application/json', 'Authorization': ['Bear','er '].join('') + c.LLM_KEY };
const msgs = [{ role: 'user', content: '一只股票昨收10元，今日高开6%后回落，现价10.3，量比0.6，MA5=10.1。用30字分析该不该买，输出JSON {"verdict":"买/不买","why":"..."}' }];

// A) 非流式 + enable_thinking:true
let t0 = Date.now();
let r = await fetch(c.LLM_BASE + '/chat/completions', { method:'POST', headers:H, body: JSON.stringify({ model:'deepseek-v4-pro', messages:msgs, enable_thinking:true, response_format:{type:'json_object'} })});
let d = await r.json();
console.log('A 非流式thinking:', r.status, ((Date.now()-t0)/1000).toFixed(1)+'s', '| reasoning:', d?.choices?.[0]?.message?.reasoning_content ? '有'+d.choices[0].message.reasoning_content.length+'字' : '无', '| content:', (d?.choices?.[0]?.message?.content||'ERR:'+JSON.stringify(d).slice(0,200)).slice(0,150));

// B) 流式 + enable_thinking:true —— 看是否有 reasoning_content 增量
t0 = Date.now();
r = await fetch(c.LLM_BASE + '/chat/completions', { method:'POST', headers:H, body: JSON.stringify({ model:'deepseek-v4-pro', messages:msgs, enable_thinking:true, stream:true, response_format:{type:'json_object'} })});
console.log('B 流式thinking status:', r.status);
if (r.status === 200) {
  let reasoning = '', content = '';
  const dec = new TextDecoder();
  for await (const chunk of r.body) {
    for (const line of dec.decode(chunk, {stream:true}).split('\n')) {
      if (!line.startsWith('data:')) continue;
      const p = line.slice(5).trim();
      if (p === '[DONE]') continue;
      try {
        const j = JSON.parse(p);
        const delta = j?.choices?.[0]?.delta;
        if (delta?.reasoning_content) reasoning += delta.reasoning_content;
        if (delta?.content) content += delta.content;
      } catch {}
    }
  }
  console.log('B 耗时:', ((Date.now()-t0)/1000).toFixed(1)+'s', '| reasoning:', reasoning ? '有'+reasoning.length+'字' : '无', '| content:', content.slice(0,150));
  console.log('B reasoning开头:', reasoning.slice(0, 120));
} else {
  console.log('B ERROR:', (await r.text()).slice(0,300));
}
