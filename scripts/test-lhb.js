// 龙虎榜实测：先查今日上榜的股票，再取席位
import { getBillboard, getBillboardSeats } from '../src/market.js';
import { httpJson } from '../src/util.js';

// 1. 今日全市场龙虎榜（验证接口时效）
const d = await httpJson('https://datacenter-web.eastmoney.com/api/data/v1/get?reportName=RPT_DAILYBILLBOARD_DETAILSNEW&columns=TRADE_DATE,SECURITY_CODE,SECURITY_NAME_ABBR,EXPLANATION,BILLBOARD_NET_AMT,CHANGE_RATE&pageSize=8&sortColumns=BILLBOARD_NET_AMT&sortTypes=-1&source=WEB&client=WEB&filter=' + encodeURIComponent("(TRADE_DATE>='2026-11-10')"), { headers: { Referer: 'https://data.eastmoney.com/' } });
const rows = d?.result?.data || [];
console.log('=== 今日(11-10)龙虎榜净买入TOP ===');
for (const r of rows) console.log(`${r.SECURITY_NAME_ABBR}(${r.SECURITY_CODE}) 净买${(r.BILLBOARD_NET_AMT/1e8).toFixed(2)}亿 涨${r.CHANGE_RATE?.toFixed(1)}% | ${r.EXPLANATION}`);

// 2. 取净买第一名个股的席位明细（游资身份）
if (rows.length) {
  const top = rows[0];
  const seats = await getBillboardSeats(top.SECURITY_CODE, { date: top.TRADE_DATE.slice(0,10), limit: 8 });
  console.log(`\n=== ${top.SECURITY_NAME_ABBR} 席位明细 ===`);
  for (const s of seats) console.log(`[${s.dept}] ${s.name} 买${s.buyWan}万 卖${s.sellWan}万 净${s.netWan}万 3日胜率${s.riseProb3d}%`);
}

// 3. 验证候选股链路（近期上榜股票会带席位）
const bb = await getBillboard('002636', { days: 30, limit: 3 });
console.log('\n金安国纪近30天龙虎榜:', JSON.stringify(bb));
