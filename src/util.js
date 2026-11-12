// 通用工具：HTTP(GBK)、JSON存储、技术指标、费用计算
import fs from 'node:fs';
import path from 'node:path';
import dns from 'node:dns';
import { CFG, DATA_DIR } from './config.js';

// 关键：强制IPv4优先。东财部分域名(push2his等)有AAAA记录但本机IPv6路由不通，
// Node fetch 会优先试IPv6并失败（curl靠happy-eyeballs回退所以正常）——这是K线"偶发失败"的根因。
dns.setDefaultResultOrder('ipv4first');

const UA = { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36' };

export async function httpJson(url, { timeout = 12000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { ...UA, ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

// GBK 文本接口（腾讯/新浪行情）
export async function httpTextGbk(url, { timeout = 10000, headers = {} } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(url, { headers: { ...UA, ...headers }, signal: ctrl.signal });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const buf = Buffer.from(await res.arrayBuffer());
    return new TextDecoder('gbk').decode(buf);
  } finally { clearTimeout(t); }
}

export function secid(code) {
  // 6开头沪市=1，其余深市=0；北交所(4/8开头)=0
  const m = code.startsWith('6') || code.startsWith('9') || code.startsWith('5') ? 1 : 0;
  return `${m}.${code}`;
}
export function tencentSym(code) { return (code.startsWith('6') || code.startsWith('9') || code.startsWith('5') ? 'sh' : 'sz') + code; }

// ---------- JSON 持久化 ----------
export function loadJson(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8')); }
  catch { return fallback; }
}
export function saveJson(name, obj) {
  const f = path.join(DATA_DIR, name);
  const tmp = f + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 1));
  fs.renameSync(tmp, f);
}
export function appendLog(tag, obj) {
  try {
    fs.appendFileSync(path.join(DATA_DIR, '..', 'logs', 'engine.log'),
      `[${new Date().toISOString()}] ${tag} ${JSON.stringify(obj)}\n`);
  } catch {}
}

// ---------- 技术指标 ----------
export function sma(closes, n) {
  if (closes.length < n) return null;
  const s = closes.slice(-n).reduce((a, b) => a + b, 0);
  return s / n;
}
export function ema(closes, n) {
  if (!closes.length) return null;
  const k = 2 / (n + 1);
  let e = closes[0];
  for (let i = 1; i < closes.length; i++) e = closes[i] * k + e * (1 - k);
  return e;
}
export function rsi(closes, n = 14) {
  if (closes.length < n + 1) return null;
  let up = 0, dn = 0;
  const arr = closes.slice(-(n + 1));
  for (let i = 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    if (d > 0) up += d; else dn -= d;
  }
  if (dn === 0) return 100;
  return 100 - 100 / (1 + (up / n) / (dn / n));
}
export function macd(closes) {
  if (closes.length < 35) return null;
  const dif = ema(closes, 12) - ema(closes, 26);
  const difs = [];
  // 逐日DIF序列近似：滚动计算
  for (let i = 34; i <= closes.length; i++) difs.push(ema(closes.slice(0, i), 12) - ema(closes.slice(0, i), 26));
  const dea = ema(difs, 9);
  return { dif: difs[difs.length - 1], dea, hist: (difs[difs.length - 1] - dea) * 2 };
}

// ---------- 交易费用 ----------
export function buyFees(amount) {
  const comm = Math.max(amount * CFG.fee.commissionRate, CFG.fee.commissionMin);
  const transfer = amount * CFG.fee.transferFeeRate;
  return +(comm + transfer).toFixed(2);
}
export function sellFees(amount) {
  const comm = Math.max(amount * CFG.fee.commissionRate, CFG.fee.commissionMin);
  const stamp = amount * CFG.fee.stampTaxRate;
  const transfer = amount * CFG.fee.transferFeeRate;
  return +(comm + stamp + transfer).toFixed(2);
}
// 滑点后的成交价
export function execBuyPrice(price) { return +(price * (1 + CFG.fee.slippage)).toFixed(3); }
export function execSellPrice(price) { return +(price * (1 - CFG.fee.slippage)).toFixed(3); }

export function fmtMoney(x) { return (Math.round(x * 100) / 100).toFixed(2); }
export function pct(x) { return (x * 100).toFixed(2) + '%'; }
export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
