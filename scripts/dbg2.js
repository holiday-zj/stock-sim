import { getDailyKline } from '../src/market.js';
const ks = await getDailyKline('000001', 5);
console.log('last kline dates:', ks ? ks.map(k => k.date).join(',') : 'NULL');
