// 看板服务：GET / 网页, /api/state 全量状态, /api/trades, POST /api/decide 手动触发
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { CFG } from './config.js';
import { getState, status, manualDecision, manualClose } from './engine.js';
import { loadLessons } from './evolve.js';
import { getReports } from './report.js';
import { getQuotes } from './market.js';
import { equityOf } from './store.js';

const WEB = path.resolve(new URL('../web/', import.meta.url).pathname);

function json(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

export function startServer() {
  const srv = http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    try {
      if (u.pathname === '/' || u.pathname === '/index.html') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(WEB, 'index.html')));
      }
      if (u.pathname === '/api/status') return json(res, 200, status());
      if (u.pathname === '/api/reports') {
        const n = Math.min(+(u.searchParams.get('n') || 40), 120);
        return json(res, 200, { reports: getReports(n) });
      }
      if (u.pathname === '/api/state') {
        const s = getState();
        const quotes = Object.keys(s.positions).length ? await getQuotes(Object.keys(s.positions)) : {};
        return json(res, 200, {
          cfg: { startCash: CFG.startCash, runStart: CFG.runStart, runEnd: CFG.runEnd, fee: CFG.fee, risk: CFG.risk },
          status: status(),
          cash: s.cash,
          equity: equityOf(s, quotes),
          positions: Object.entries(s.positions).map(([code, p]) => {
            const q = quotes[code];
            const price = q?.price || p.costPrice;
            return {
              code, name: p.name, shares: p.shares,
              costPrice: +p.costPrice.toFixed(3), price: +price.toFixed(2),
              dayPct: q ? +(q.pct * 100).toFixed(2) : null,
              pnl: +((price - p.costPrice) * p.shares).toFixed(2),
              pnlPct: +((price / p.costPrice - 1) * 100).toFixed(2),
              buyTime: p.buyTime, high: +p.high.toFixed(2),
              reason: (p.buyReason || '').slice(0, 80),
            };
          }),
          trades: s.trades.slice(-200),
          daily: s.daily,
          decisions: s.decisions.slice(-60),
          events: s.events.slice(-40),
          lessons: loadLessons(),
        });
      }
      if (u.pathname === '/api/decide' && req.method === 'POST') {
        manualDecision().then(() => {}).catch(() => {});
        return json(res, 200, { ok: true, msg: '已触发决策回合' });
      }
      if (u.pathname === '/api/close' && req.method === 'POST') {
        await manualClose();
        return json(res, 200, { ok: true });
      }
      json(res, 404, { err: 'not found' });
    } catch (e) {
      json(res, 500, { err: e.message });
    }
  });
  srv.listen(CFG.port, '0.0.0.0', () => console.log(`看板 http://0.0.0.0:${CFG.port}`));
  return srv;
}
