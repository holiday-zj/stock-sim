// 读取 data/llm.env（不进代码库、不打日志）
import fs from 'node:fs';
import path from 'node:path';
const ENV_FILE = path.resolve(new URL('../data/llm.env', import.meta.url).pathname);
export function loadLlmEnv() {
  const cfg = {};
  try {
    for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#') || !t.includes('=')) continue;
      const i = t.indexOf('=');
      cfg[t.slice(0, i).trim()] = t.slice(i + 1).trim();
    }
  } catch {}
  for (const k of ['LLM_BASE', 'LLM_KEY', 'LLM_MODEL']) if (process.env[k]) cfg[k] = process.env[k];
  return cfg;
}
// 北京时间工具
export function bjNow(d = new Date()) {
  return new Date(d.getTime() + (8 * 60 + d.getTimezoneOffset()) * 60000);
}
export function bjStamp() {
  const n = bjNow();
  const p = (x) => String(x).padStart(2, '0');
  return `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())} ${p(n.getHours())}:${p(n.getMinutes())}:${p(n.getSeconds())}`;
}
export function bjDate() { return bjStamp().slice(0, 10); }
export function bjHM() { return bjStamp().slice(11, 16); }
