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
    if (!ks || !ks.length) throw new Error('no klines');
    return ks.map(line => {
      const [date, open, close, high, low, vol, amount] = line.split(',');
      return { date, open: +open, close: +close, high: +high, low: +low, vol: +vol, amount: +amount };
    });
  } catch (e) {
    if (attempt < 2) { await new Promise(r => setTimeout(r, 500 * attempt)); return getDailyKline(code, days, attempt + 1); }
    return getDailyKlineTencent(code, days);   // 东财失败→腾讯备用源
  }
}

// 腾讯日K备用源（前复权）——东财不可用时兜底，保证ATR/技术面不瘫痪
export async function getDailyKlineTencent(code, days = 60) {
  try {
    const d = await httpJson(`https://web.ifzq.gtimg.cn/appstock/app/fqkline/get?param=${tencentSym(code)},day,,,${days},qfq`);
    const node = d?.data?.[tencentSym(code)];
    const ks = node?.qfqday || node?.day;
    if (!ks || !ks.length) return null;
    return ks.map(a => ({
      date: a[0], open: +a[1], close: +a[2], high: +a[3], low: +a[4],
      vol: +(a[5] || 0) * 100, amount: +(a[6] || 0),
    }));
  } catch { return null; }
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

// ---------- 日内形态分析（通用）：判断"当天走势"而非"一时走势" ----------
function shapeOf(pts, preClose) {
  if (!pts || pts.length < 20) return null;
  const first = pts[0], last = pts.at(-1);
  const hi = Math.max(...pts.map(p => p.p)), lo = Math.min(...pts.map(p => p.p));
  const hiT = pts.find(p => p.p === hi).t, loT = pts.find(p => p.p === lo).t;
  const morning = pts.filter(p => p.t <= '11:30');
  const afternoon = pts.filter(p => p.t >= '13:00');
  const mornAvg = morning.length ? morning.reduce((a, b) => a + b.p, 0) / morning.length : first.p;
  const aftAvg = afternoon.length ? afternoon.reduce((a, b) => a + b.p, 0) / afternoon.length : mornAvg;
  const drift = (aftAvg / mornAvg - 1) * 100;
  const fromOpen = (last.p / first.p - 1) * 100;
  const fromHi = (last.p / hi - 1) * 100;
  const gapPct = preClose ? (first.p / preClose - 1) * 100 : null;

  let shape;
  if (fromHi < -0.5) shape = `冲高回落(高点${hiT},现距高点${fromHi.toFixed(1)}%)`;      // 出货形态
  else if (drift < -0.2) shape = `午后走弱(上午均${mornAvg.toFixed(2)}→下午均${aftAvg.toFixed(2)})`;
  else if (drift > 0.2) shape = '午后走强(资金持续进场)';
  else if (Math.abs(fromOpen) < 0.2) shape = '横盘震荡(方向未明)';
  else shape = fromOpen > 0 ? '全天稳步上行' : '全天走弱';

  return {
    open: +first.p.toFixed(2), now: +last.p.toFixed(2), time: last.t,
    high: +hi.toFixed(2), highTime: hiT, low: +lo.toFixed(2), lowTime: loT,
    gapPct: gapPct != null ? +gapPct.toFixed(2) : null,      // 高开/低开幅度
    pctFromOpen: +fromOpen.toFixed(2), pctFromHigh: +fromHi.toFixed(2),
    vwap: +last.avg.toFixed(2), aboveVwap: last.p >= last.avg,   // 站上均价线=日内多头
    posInDayRange: +((last.p - lo) / ((hi - lo) || 1)).toFixed(2), // 0=全天最低 1=全天最高
    driftPct: +drift.toFixed(2), shape,
  };
}

// ---------- 当日分时（1分钟）+ 日内形态 ----------
export async function getIntradayTrend(code, tailMinutes = 40) {
  try {
    const d = await httpJson(`${EM}/stock/trends2/get?secid=${secid(code)}&fields1=f1,f2,f3,f8&fields2=f51,f53,f56,f58&iscr=0&ndays=1`);
    const tr = d?.data?.trends;
    const preClose = d?.data?.preClose;
    if (!tr || !tr.length) return null;
    const pts = tr.map(line => { const [t, p, v, avg] = line.split(','); return { t: t.slice(11), p: +p, v: +v, avg: +avg }; });
    const tail = pts.slice(-tailMinutes);
    const last = pts.at(-1);
    return {
      preClose, points: tr.length,
      lastPrice: last.p, lastTime: last.t,
      tail,
      dayShape: shapeOf(pts, preClose),   // 全天形态：高开低走/冲高回落/午后走弱等
    };
  } catch { return null; }
}

// ---------- 大盘日内走势（判断今天是走强还是走弱的一天，而非此刻涨跌） ----------
export async function getIndexIntraday(idxSecid = '1.000001') {
  try {
    const d = await httpJson(`${EM}/stock/trends2/get?secid=${idxSecid}&fields1=f1,f2,f3,f8&fields2=f51,f53,f56,f58&iscr=0&ndays=1`);
    const tr = d?.data?.trends;
    if (!tr || tr.length < 20) return null;
    const pts = tr.map(line => { const [t, p, v, avg] = line.split(','); return { t: t.slice(11), p: +p, v: +v, avg: +avg }; });
    const s = shapeOf(pts, d?.data?.preClose);
    return { ...s, label: '上证指数' };
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

// ---------- 龙虎榜：个股上榜记录（最近days天内） ----------
export async function getBillboard(code, { days = 30, limit = 5 } = {}) {
  try {
    const since = new Date(Date.now() - days * 86400e3).toISOString().slice(0, 10);
    const filter = encodeURIComponent('(SECURITY_CODE="' + code + '")(TRADE_DATE>=\'' + since + '\')');
    const d = await httpJson(`https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=TRADE_DATE,SECURITY_CODE,SECURITY_NAME_ABBR,EXPLANATION,BILLBOARD_NET_AMT,BILLBOARD_BUY_AMT,BILLBOARD_SELL_AMT,CHANGE_RATE,ACCUM_AMOUNT&filter=${filter}&pageSize=${limit}&sortColumns=TRADE_DATE&sortTypes=-1&source=WEB&client=WEB`,
      { headers: { Referer: 'https://data.eastmoney.com/' } });
    return (d?.result?.data || []).map(x => ({
      date: (x.TRADE_DATE || '').slice(0, 10),
      reason: x.EXPLANATION,                 // 上榜原因
      netAmtWan: +((x.BILLBOARD_NET_AMT || 0) / 1e4).toFixed(0),   // 龙虎榜净买额(万)
      buyAmtWan: +((x.BILLBOARD_BUY_AMT || 0) / 1e4).toFixed(0),
      sellAmtWan: +((x.BILLBOARD_SELL_AMT || 0) / 1e4).toFixed(0),
      chgPct: x.CHANGE_RATE != null ? +x.CHANGE_RATE.toFixed(2) : null,
    }));
  } catch { return []; }
}

// ---------- 龙虎榜：席位明细（游资/机构身份） ----------
export async function getBillboardSeats(code, { date, limit = 10 } = {}) {
  try {
    let filter = '(SECURITY_CODE="' + code + '")';
    if (date) filter += "(TRADE_DATE='" + date + "')";
    const d = await httpJson(`https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_BILLBOARD_DAILYDETAILSBUY&columns=TRADE_DATE,OPERATEDEPT_NAME,BUY,SELL,NET,EXPLANATION,RISE_PROBABILITY_3DAY&filter=${encodeURIComponent(filter)}&pageSize=${limit}&sortColumns=NET&sortTypes=-1&source=WEB&client=WEB`,
      { headers: { Referer: 'https://data.eastmoney.com/' } });
    return (d?.result?.data || []).map(x => ({
      date: (x.TRADE_DATE || '').slice(0, 10),
      dept: classifySeat(x.OPERATEDEPT_NAME || ''),
      name: (x.OPERATEDEPT_NAME || '').replace(/证券股份有限公司|股份有限公司|证券营业部/g, '').slice(0, 24),
      buyWan: +((x.BUY || 0) / 1e4).toFixed(0),
      sellWan: +((x.SELL || 0) / 1e4).toFixed(0),
      netWan: +((x.NET || 0) / 1e4).toFixed(0),
      riseProb3d: x.RISE_PROBABILITY_3DAY != null ? +x.RISE_PROBABILITY_3DAY.toFixed(1) : null,
    }));
  } catch { return []; }
}

// 席位分类：机构 / 知名游资 / 普通营业部
const FAMOUS_SEATS = ['章盟主', '赵老哥', '炒股养家', '孙哥', '方新侠', '量化打板', '深南东路', '溧阳路', '拉萨团结路', '拉萨东环路', '拉萨金珠西路', '拉萨金融城南环路', '华鑫上海分', '中信上海溧阳路', '国泰海通上海江苏路', '银河绍兴', '财通杭州上塘路', '国盛宁波桑田路', '东方财富拉萨', '沪股通', '深股通', '北向'];
function classifySeat(name) {
  if (!name) return '未知';
  if (name.includes('机构专用')) return '机构';
  if (/股通/.test(name)) return '北向';
  for (const f of FAMOUS_SEATS) if (name.includes(f)) return '知名游资';
  return '营业部';
}

// ---------- 指数日K（指数secid固定：上证1.000001 深成0.399001 创业板0.399006）----------
export async function getIndexKline(idxSecid = '1.000001', days = 40, attempt = 1) {
  try {
    const d = await httpJson(`${EMH}/stock/kline/get?secid=${idxSecid}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=1&end=20500101&lmt=${days}`);
    const ks = d?.data?.klines;
    if (!ks || !ks.length) throw new Error('no klines');
    return ks.map(line => {
      const [date, open, close, high, low, vol, amount] = line.split(',');
      return { date, open: +open, close: +close, high: +high, low: +low, vol: +vol, amount: +amount };
    });
  } catch {
    if (attempt < 3) { await new Promise(r => setTimeout(r, 700 * attempt)); return getIndexKline(idxSecid, days, attempt + 1); }
    return null;
  }
}

// ---------- 大盘趋势体制：决定该进攻还是防守（顺势而为是短线盈亏第一杠杆）----------
// 返回 regime: 'risk_on'(强,放手做多) / 'neutral'(中性,精选) / 'risk_off'(弱,降仓/空仓)
export async function getMarketRegime() {
  const [sh, cyb] = await Promise.all([
    getIndexKline('1.000001', 30),
    getIndexKline('0.399006', 30),
  ]);
  if (!sh || sh.length < 20) return { regime: 'unknown', detail: '指数K线缺失' };
  const closes = sh.map(k => k.close);
  const last = closes.at(-1);
  const ma20 = closes.slice(-20).reduce((a, b) => a + b, 0) / 20;
  const ma10 = closes.slice(-10).reduce((a, b) => a + b, 0) / 10;
  const ma20prev = closes.slice(-25, -5).length >= 20 ? closes.slice(-25, -5).reduce((a, b) => a + b, 0) / 20 : ma20;
  const ma20up = ma20 > ma20prev;                       // MA20向上=中期趋势多头
  const aboveMa20 = last > ma20;
  const aboveMa10 = last > ma10;
  const chg5 = last / closes.at(-6) - 1;

  let score = 0;
  if (aboveMa20) score++;
  if (aboveMa10) score++;
  if (ma20up) score++;
  if (chg5 > 0) score++;
  const regime = score >= 3 ? 'risk_on' : (score <= 1 ? 'risk_off' : 'neutral');
  const cybNote = cyb ? `创业板${(cyb.at(-1).close / cyb.at(-6).close - 1) > 0 ? '强' : '弱'}` : '';
  return {
    regime, score,
    sh: +last.toFixed(0), ma20: +ma20.toFixed(0),
    aboveMa20, aboveMa10, ma20up, chg5: +(chg5 * 100).toFixed(2),
    detail: `上证${last.toFixed(0)} ${aboveMa20 ? '站上' : '跌破'}MA20(${ma20.toFixed(0)}) MA20${ma20up ? '向上' : '走平/向下'} 5日${(chg5*100).toFixed(1)}% ${cybNote} → ${regime}`,
  };
}

// ---------- 市场情绪周期（短线择时核心：涨停池/炸板率/昨日涨停赚钱效应/隔夜外盘） ----------
export async function getSentiment() {
  const today = bjDateCompact();
  const out = { date: today };
  try {
    // 1) 今日涨停池：家数、最高连板、炸板次数
    const zt = await httpJson(`https://push2ex.eastmoney.com/getTopicZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=320&sort=fbt%3Aasc&date=${today}`);
    const ztPool = zt?.data?.pool || [];
    out.ztCount = zt?.data?.tc ?? ztPool.length;
    out.maxBoard = ztPool.reduce((m, x) => Math.max(m, x.zttj?.days || x.lbc || 1), 0);
    out.boardLadder = {};   // 连板梯队 {2:家数, 3:家数...}
    for (const x of ztPool) { const d = x.zttj?.days || x.lbc || 1; if (d >= 2) out.boardLadder[d] = (out.boardLadder[d] || 0) + 1; }
    out.topBoards = ztPool.filter(x => (x.zttj?.days || 1) >= 3)
      .sort((a, b) => (b.zttj?.days || 0) - (a.zttj?.days || 0))
      .slice(0, 5).map(x => `${x.n}${x.zttj?.days || x.lbc}板(${x.hybk || ''})`);
    out.ztAvgSeal = ztPool.length ? +(ztPool.reduce((a, x) => a + (x.fund || 0), 0) / ztPool.length / 1e8).toFixed(2) : 0; // 平均封单(亿)

    // 2) 炸板池：炸板率 = 炸板/(涨停+炸板)
    const zb = await httpJson(`https://push2ex.eastmoney.com/getTopicZBPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=320&sort=fbt%3Aasc&date=${today}`);
    const zbCount = zb?.data?.tc ?? (zb?.data?.pool || []).length;
    out.zbCount = zbCount;
    out.zbRate = (out.ztCount + zbCount) > 0 ? +((zbCount / (out.ztCount + zbCount)) * 100).toFixed(0) : null;

    // 3) 昨日涨停今日表现（打板赚钱效应）
    const yzt = await httpJson(`https://push2ex.eastmoney.com/getYesterdayZTPool?ut=7eea3edcaed734bea9cbfc24409ed989&dpt=wz.ztzt&Pageindex=0&pagesize=320&sort=zs%3Adesc&date=${today}`);
    const yPool = yzt?.data?.pool || [];
    if (yPool.length) {
      const zs = yPool.map(x => x.zdp ?? 0);   // 昨涨停股今日涨跌幅
      out.yztAvgPct = +(zs.reduce((a, b) => a + b, 0) / zs.length).toFixed(2);
      out.yztUpRate = +((zs.filter(v => v > 0).length / zs.length) * 100).toFixed(0);
      out.yztCount = yPool.length;
    }

    // 4) 隔夜外盘
    const os = await httpJson(`${EM}/ulist.np/get?fltt=2&secids=100.DJIA,100.NDX,100.SPX,100.HSI&fields=f2,f3,f14`);
    out.overseas = (os?.data?.diff || []).map(x => `${x.f14}${x.f3 > 0 ? '+' : ''}${x.f3}%`);

    // 5) 情绪周期定性：冰点/修复/发酵/高潮/退潮
    out.phase = sentimentPhase(out);
  } catch (e) { out.error = e.message; }
  return out;
}

function bjDateCompact() {
  const d = new Date(Date.now() + 8 * 3600e3);
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

// 情绪周期定性（游资情绪周期理论：冰点→修复→发酵→高潮→退潮）
function sentimentPhase(s) {
  const { ztCount = 0, maxBoard = 0, zbRate, yztAvgPct } = s;
  if (zbRate == null && !ztCount) return '数据不足';
  const zr = zbRate ?? 50;
  if (ztCount < 30 && maxBoard <= 3 && (yztAvgPct ?? 0) < 0) return '冰点(轻仓试错或空仓，等转折信号)';
  if ((yztAvgPct ?? 0) < -1 || zr > 45) return '退潮(防守，不接力高位板，谨防补跌)';
  if (maxBoard >= 6 && ztCount > 60 && zr < 30) return '高潮(可参与但只买最强主线龙头，警惕次日分歧)';
  if ((yztAvgPct ?? 0) > 1 && ztCount > 40) return '发酵(赚钱效应扩散，积极做多主线)';
  return '修复(可低吸主线核心股，控制节奏)';
}

// ---------- 实时行情（腾讯源，真·实时~3秒，用于风控价格判断） ----------
export async function getRealtimeQuotes(codes) {
  const out = {};
  if (!codes || !codes.length) return out;
  for (let i = 0; i < codes.length; i += 50) {
    const batch = codes.slice(i, i + 50);
    try {
      const txt = await httpTextGbk(`https://qt.gtimg.cn/q=${batch.map(tencentSym).join(',')}`);
      for (const line of txt.split(';')) {
        const m = line.match(/v_\w+="([^"]*)"/);
        if (!m || !m[1]) continue;
        const f = m[1].split('~');
        const code = f[2];
        if (!code || !f[3]) continue;
        const t = f[30] || '';
        out[code] = {
          code, name: f[1], price: +f[3], preClose: +f[4], open: +f[5],
          chg: +f[31], pct: +f[32] / 100, high: +f[33], low: +f[34],
          volume: +f[6] * 100, amount: +f[37] * 10000,
          time: t.length >= 14 ? `${t.slice(8,10)}:${t.slice(10,12)}:${t.slice(12,14)}` : null,
          ts: t.length >= 14 ? Date.parse(`${t.slice(0,4)}-${t.slice(4,6)}-${t.slice(6,8)}T${t.slice(8,10)}:${t.slice(10,12)}:${t.slice(12,14)}+08:00`) : 0,
        };
      }
    } catch {}
  }
  return out;
}

// ---------- 五档盘口（东财，价差/委比/挂单压力，判断买卖盘真实意愿） ----------
export async function getOrderBook(code) {
  try {
    const d = await httpJson(`${EM}/stock/get?secid=${secid(code)}&fields=f19,f20,f17,f18,f11,f12,f31,f32,f39,f40,f531`);
    const x = d?.data;
    if (!x || x.f19 == null) return null;
    const px = v => v == null ? null : +(v / 100).toFixed(3);
    const bids = [[x.f19,x.f20],[x.f17,x.f18],[x.f15,x.f16],[x.f13,x.f14],[x.f11,x.f12]];  // 买一~买五 [价,量(手)]
    const asks = [[x.f31,x.f32],[x.f33,x.f34],[x.f35,x.f36],[x.f37,x.f38],[x.f39,x.f40]];  // 卖一~卖五
    const bidVol = bids.reduce((a,b)=>a+(b[1]||0),0), askVol = asks.reduce((a,b)=>a+(b[1]||0),0);
    const weiBi = (bidVol+askVol)>0 ? +(((bidVol-askVol)/(bidVol+askVol))*100).toFixed(1) : 0;  // 委比%
    return {
      bid1: px(x.f19), ask1: px(x.f31), spread: +(px(x.f31)-px(x.f19)).toFixed(3),
      bids: bids.map(b=>({p:px(b[0]),v:b[1]})), asks: asks.map(a=>({p:px(a[0]),v:a[1]})),
      bidVol, askVol, weiBi,   // 委比>0买盘强，<0卖盘强
      note: weiBi>20?'买盘明显占优(承接强)':weiBi<-20?'卖盘明显占优(抛压重)':'买卖均衡',
    };
  } catch { return null; }
}

// ---------- 逐分钟主力资金流（东财fflow，累计净流入，判断主力真买真卖） ----------
export async function getFundFlow(code, minutes = 30) {
  try {
    const d = await httpJson(`${EM}/stock/fflow/kline/get?secid=${secid(code)}&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55&klt=1&lmt=${minutes}`);
    const ks = d?.data?.klines;
    if (!ks || !ks.length) return null;
    const rows = ks.map(l => { const [t,main,small,mid,big]=l.split(','); return { t:t.slice(11), main:+main, big:+big }; });
    const last = rows.at(-1).main;
    const prev5 = rows.length>=6 ? rows.at(-6).main : rows[0].main;
    const recent = last - prev5;   // 最近5分钟主力净流入增量
    return {
      totalMainWan: +(last/1e4).toFixed(0),       // 当日累计主力净流入(万)
      recentMainWan: +(recent/1e4).toFixed(0),     // 最近5分钟主力净流入(万)
      bigWan: +(rows.at(-1).big/1e4).toFixed(0),   // 累计大单净流入(万)
      trend: rows.slice(-8).map(r=>+(r.main/1e4).toFixed(0)),  // 主力净流入走势(万)
      note: recent>500?'主力近5分钟加速流入':recent<-500?'主力近5分钟加速流出':'主力资金平稳',
    };
  } catch { return null; }
}

// ---------- 题材梯队（概念板块排行+领涨股，判断主线与卡位） ----------
export async function getConceptLeaders(limit = 8) {
  try {
    const d = await httpJson(`${EM}/clist/get?pn=1&pz=${limit}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=m:90+t:3&fields=f3,f14,f104,f105,f128,f136,f140`);
    return (d?.data?.diff || []).filter(x => typeof x.f3 === 'number' && !/昨日|连板|百元|高送|次新|标准普尔|富时|MSCI|机构重仓|基金重仓|社保|QFII|预盈预增|预亏预减|股权激励|转债/.test(x.f14)).map(x => ({
      name: x.f14, pct: +x.f3.toFixed(2), up: x.f104, down: x.f105,
      leader: x.f128, leaderPct: x.f136, leaderCode: x.f140,
    })).slice(0, limit);
  } catch { return []; }
}

// 交易日历：用上证指数日K判断最近交易日
export async function lastTradeDate() {
  const ks = await getDailyKline('000001', 3); // 平安银行K线日期即交易日
  return ks?.length ? ks[ks.length - 1].date : null;
}
