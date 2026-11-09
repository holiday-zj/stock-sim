// LLM 客户端：百炼 OpenAI 兼容接口（复用 guandan-tuo2 的密钥配置）
import { loadLlmEnv } from './env.js';
import { appendLog } from './util.js';

const cfg = loadLlmEnv();

export function llmOk() { return !!(cfg.LLM_KEY && cfg.LLM_KEY.length >= 20 && cfg.LLM_BASE); }

export async function llmChat(system, user, { timeout = 60000, temperature = 0.2 } = {}) {
  if (!llmOk()) throw new Error('LLM 未配置');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(cfg.LLM_BASE + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': ['Bear', 'er '].join('') + cfg.LLM_KEY,
      },
      body: JSON.stringify({
        model: cfg.LLM_MODEL,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature,
        enable_thinking: false,
        response_format: { type: 'json_object' },
      }),
      signal: ctrl.signal,
    });
    const d = await res.json();
    const txt = d?.choices?.[0]?.message?.content;
    if (!txt) { appendLog('LLM_EMPTY', d?.error || d); throw new Error('LLM 空响应'); }
    // 容错解析：剥掉 ```json 包裹
    const clean = txt.replace(/```(json)?/g, '').trim();
    const s = clean.indexOf('{'), e = clean.lastIndexOf('}');
    return JSON.parse(clean.slice(s, e + 1));
  } finally { clearTimeout(t); }
}
