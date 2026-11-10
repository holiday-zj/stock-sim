// 行情数据源：东方财富(HTTPS) + 腾讯(GBK实时快照兜底)
// 全部真实数据，无任何模拟价格
import { httpJson, httpTextGbk, secid, tencentSym } from './util.js';

const EM = 'https://push2delay.eastmoney.com/api/qt';   // 延时快照(海外可用,盘中约3分钟延迟)
const EMH = 'https://push2his.eastmoney.com/api/qt';    // 历史K线

// ---------- 大盘指数 ----------
export async function getIndices() {
  try {
    const d = await httpJson(`${EM}/ulist.np/get?fltt=2&invt=2&secids=1.000001,0.399001,0.399006,1.000688&fields=f2,f3,f12,f14`);
    if (!d?.data?.diff) return null;
    return d.data.diff.map(x => ({
      code: x.f12, name: x.f14,
      price: x.f2, pct: x.f3 / 100,   // fltt=2: f3为百分点，统一存小数
    }));
  } catch { return null; }
}

// ---------- 实时/延时快照（东财优先，腾讯兜底） ----------
export async function getQuotes(codes) {
  if (!codes.length) return {};
  const out = {};
  try {
    const ids = codes.map(secid).join(',');
    const d = await httpJson(`${EM}/ulist.np/get?fltt=2&invt=2&secids=${ids}&fields=f2,f3,f4,f5,f6,f7,f8,f9,f12,f14,f15,f16,f17,f18,f20,f21,f23,f62,f100,f124,f184`);
    for (const x of d?.data?.diff || []) {
      if (!x.f12 || x.f2 === '-' || x.f2 == null) continue;
      out[x.f12] = {
        code: x.f12, name: x.f14,
        price: x.f2, pct: x.f3 / 100, chg: x.f4,    // pct存小数(显示×100)
        volume: x.f5, amount: x.f6, amplitude: x.f7,
        turnover: x.f8 / 100, pe: x.f9,
        high: x.f15, low: x.f16, open: x.f17, preClose: x.f18,
        mcap: x.f20, floatMcap: x.f21, pb: x.f23,
        mainNet: x.f62, industry: x.f100,
        time: x.f124 ? new Date(x.f124 * 1000 + 8 * 3600e3).toISOString().slice(11, 19) : null,
      };
    }
  } catch {}
  // 腾讯兜底（缺谁补谁）
  const missing = codes.filter(c => !out[c]);
  if (missing.length) {
    try {
      const syms = missing.map(tencentSym).join(',');
      const txt = await httpTextGbk(`https://qt.gtimg.cn/q=${syms}`);
      for (const line of txt.split(';')) {
        const m = line.match(/v_(\w+)="(.+)"/);
        if (!m) continue;
        const f = m[2].split('~');
        const code = f[2];
        if (!code || out[code]) continue;
        out[code] = {
          code, name: f[1],
          price: +f[3], pct: +f[32] / 100, chg: +f[31],
          volume: +f[6] * 100, amount: +f[37] * 10000,
          turnover: +f[38] / 100, pe: +f[39],
          high: +f[33], low: +f[34], open: +f[5], preClose: +f[4],
          floatMcap: +f[44] * 1e8, mcap: +f[45] * 1e8, pb: +f[46],
          time: (f[30] || '').slice(8, 10) + ':' + (f[30] || '').slice(10, 12) + ':' + (f[30] || '').slice(12, 14),
        };
      }
    } catch {}
  }
  return out;
}

// ---------- 日K线（东财，前复权） ----------
export async function getDailyKline(code, days = 60, attempt = 1) {
  try {
    const d = await httpJson(`${EMH}/stock/kline/get?secid=${secid(code)}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=${days}`);
    const ks = d?.data?.klines;
    if (!ks) throw new Error('no klines');
    return ks.map(line => {
      const [date, open, close, high, low, vol, amount] = line.split(',');
      return { date, open: +open, close: +close, high: +high, low: +low, vol: +vol, amount: +amount };
    });
  } catch (e) {
    if (attempt < 3) { await new Promise(r => setTimeout(r, 600 * attempt)); return getDailyKline(code, days, attempt + 1); }
    return null;
  }
}

// ---------- 选股池：活跃股排行（东财 clist，可按成交额/换手排序） ----------
export async function rankActive({ by = 'f8', limit = 60 } = {}) {
  // by: f8=换手率 f3=涨幅 f6=成交额
  const fs = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'; // 深主板+创业板+沪主板+科创板
  const out = [];
  for (let pn = 1; pn <= Math.ceil(limit / 100); pn++) {
    try {
      const d = await httpJson(`${EM}/clist/get?pn=${pn}&pz=100&po=1&np=1&fltt=2&invt=2&fid=${by}&fs=${fs}&fields=f2,f3,f6,f8,f9,f12,f14,f20,f21,f23,f100`);
      for (const x of d?.data?.diff || []) {
        if (!x.f12 || typeof x.f2 !== 'number') continue;
        out.push({
          code: x.f12, name: x.f14, price: x.f2, pct: x.f3 / 100,
          amount: x.f6, turnover: x.f8 / 100, pe: x.f9,   // 全小数约定
          mcap: x.f20, floatMcap: x.f21, pb: x.f23, industry: x.f100,
        });
      }
    } catch { break; }
  }
  return out.slice(0, limit);
}

// ---------- 个股新闻（东财搜索接口） ----------
export async function getNews(name, code, limit = 6, attempt = 1) {
  try {
    const param = {
      uid: '', keyword: `${name} ${code}`, type: ['cmsArticleWebOld'],
      client: 'web', clientType: 'web', clientVersion: 'curr',
      param: { cmsArticleWebOld: { searchScope: 'default', sort: 'time', pageIndex: 1, pageSize: limit, preTag: '', postTag: '' } },
    };
    const url = 'https://search-api-web.eastmoney.com/search/jsonp?cb=cb&param=' + encodeURIComponent(JSON.stringify(param));
    const txt = await (await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } })).text();
    const d = JSON.parse(txt.replace(/^cb\(/, '').replace(/\);?$/, ''));
    return (d?.result?.cmsArticleWebOld || []).map(a => ({
      date: (a.date || '').slice(0, 16), title: (a.title || '').replace(/<\/?em>/g, ''),
      media: a.mediaName, content: (a.content || '').replace(/<\/?em>/g, '').slice(0, 150),
    }));
  } catch {
    if (attempt < 3) { await new Promise(r => setTimeout(r, 500 * attempt)); return getNews(name, code, limit, attempt + 1); }
    return [];
  }
}

// ---------- 公司公告（含财报公告标题） ----------
export async function getAnnouncements(code, limit = 8) {
  try {
    const d = await httpJson(`https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=${limit}&page_index=1&ann_type=A&stock_list=${code}`);
    return (d?.data?.list || []).map(a => ({
      date: (a.notice_date || '').slice(0, 10), title: a.title,
      columns: (a.columns || []).map(c => c.column_name).join('/'),
    }));
  } catch { return []; }
}

// ---------- 财务快照（东财 stock/get 基本面字段，无fltt: f162/f167/f168需/100） ----------
export async function getFundamentals(code) {
  try {
    const d = await httpJson(`${EM}/stock/get?secid=${secid(code)}&fields=f57,f58,f162,f167,f168,f183,f184,f185,f186,f187,f188,f105`);
    const x = d?.data;
    if (!x) return null;
    return {
      pe: x.f162 / 100, pb: x.f167 / 100, turnover: x.f168 / 10000, // 小数
      revenue: x.f183,            // 总营收(元)
      netProfit: x.f105,          // 净利润(元)
      profitYoy: x.f184 / 100,    // 净利同比(小数)
      revYoy: x.f185 / 100,       // 营收同比(小数)
      grossMargin: x.f186 / 100,  // 毛利率(小数)
      netMargin: x.f187 / 100,    // 净利率(小数)
      debtRatio: x.f188 / 100,    // 负债率(小数)
    };
  } catch { return null; }
}

// ---------- 板块行情（行业涨跌） ----------
export async function getSectorRank(limit = 5) {
  try {
    const d = await httpJson(`${EM}/clist/get?pn=1&pz=${limit * 2}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:2&fields=f3,f12,f14`);
    const arr = (d?.data?.diff || []).filter(x => typeof x.f3 === 'number');
    return { top: arr.slice(0, limit).map(x => `${x.f14}${x.f3.toFixed(1)}%`),
             bottom: arr.slice(-limit).reverse().map(x => `${x.f14}${x.f3.toFixed(1)}%`) };
  } catch { return { top: [], bottom: [] }; }
}

// ---------- 当日分时（1分钟：时间,价,量,均价）——日内节奏/尾盘异动 ----------
export async function getIntradayTrend(code, tailMinutes = 40) {
  try {
    const d = await httpJson(`${EM}/stock/trends2/get?secid=${secid(code)}&fields1=f1,f2,f3,f8&fields2=f51,f53,f56,f58&iscr=0&ndays=1`);
    const tr = d?.data?.trends;
    const preClose = d?.data?.preClose;
    if (!tr || !tr.length) return null;
    const tail = tr.slice(-tailMinutes).map(line => {
      const [t, p, v, avg] = line.split(',');
      return { t: t.slice(11), p: +p, v: +v, avg: +avg };
    });
    const last = tr[tr.length - 1].split(',');
    return {
      preClose, points: tr.length,
      lastPrice: +last[1], lastTime: last[0].slice(11),
      tail,   // 最近N分钟明细，LLM可看日内节奏
    };
  } catch { return null; }
}

// ---------- 所属概念板块及板块当日涨幅 ----------
export async function getConcepts(code, limit = 8) {
  try {
    const d = await httpJson(`${EM}/slist/get?spt=3&fltt=2&invt=2&fields=f3,f12,f14&secid=${secid(code)}&pn=1&pz=${limit}&po=1&np=1`);
    return (d?.data?.diff || [])
      .filter(x => x.f14 && !/板块$/.test(x.f14))   // 去掉地域板块
      .slice(0, limit)
      .map(x => ({ name: x.f14, pct: x.f3 }));      // pct为百分点
  } catch { return []; }
}

// ---------- 融资融券（最新一日） ----------
export async function getMargin(code) {
  try {
    const d = await httpJson(`https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPTA_WEB_RZRQ_GGMX&columns=DATE,RZYE,RZMRE,RZCHE,RZJME,RQYE,RZRQYE,RZYEZB&filter=${encodeURIComponent(`(scode="${code}")`)}&pageSize=1&sortColumns=DATE&sortTypes=-1`,
      { headers: { Referer: 'https://data.eastmoney.com/' } });
    const x = d?.result?.data?.[0];
    if (!x) return null;
    return {
      date: (x.DATE || '').slice(0, 10),
      rzye: x.RZYE,        // 融资余额
      rzmre: x.RZMRE,      // 融资买入额
      rzjme: x.RZJME,      // 融资净买入
      rzyezb: x.RZYEZB,    // 融资余额占流通市值%
    };
  } catch { return null; }
}

// ---------- 业绩预告/快报（最近2条） ----------
export async function getProfitForecast(code) {
  try {
    const d = await httpJson(`https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_PUBLIC_OP_NEWPREDICT&columns=SECURITY_CODE,PREDICT_TYPE,ADD_AMP_LOWER,ADD_AMP_UPPER,PREDICT_FINANCE_CODE,NOTICE_DATE&filter=${encodeURIComponent(`(SECURITY_CODE="${code}")`)}&pageSize=2&sortColumns=NOTICE_DATE&sortTypes=-1`,
      { headers: { Referer: 'https://data.eastmoney.com/' } });
    const cutoff = Date.now() - 180 * 86400e3;
    return (d?.result?.data || []).map(x => ({
      date: (x.NOTICE_DATE || '').slice(0, 10),
      type: x.PREDICT_TYPE,                 // 预增/预减/扭亏/不确定...
      ampLower: x.ADD_AMP_LOWER, ampUpper: x.ADD_AMP_UPPER,
    })).filter(x => x.date && new Date(x.date).getTime() > cutoff);  // 半年内的才有效，老数据会误导决策
  } catch { return []; }
}

// 交易日历：用上证指数日K判断最近交易日
export async function lastTradeDate() {
  const ks = await getDailyKline('000001', 3); // 平安银行K线日期即交易日
  return ks?.length ? ks[ks.length - 1].date : null;
}
