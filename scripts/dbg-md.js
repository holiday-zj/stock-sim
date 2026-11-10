// 复现看板 mdToHtml 渲染，定位空白来源
import fs from 'node:fs';
const reports = JSON.parse(fs.readFileSync(new URL('../data/reports.json', import.meta.url))).list;
const md = reports.at(-1).md;

function mdToHtml(md){
 return md
  .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
  .replace(/^# (.+)$/gm,'<h1>$1</h1>')
  .replace(/^## (.+)$/gm,'<h2>$1</h2>')
  .replace(/\*\*(.+?)\*\*/g,'<b>$1</b>')
  .replace(/^- (.+)$/gm,'<div style="padding-left:10px">• $1</div>')
  .replace(/^  (.+)$/gm,'<div style="padding-left:26px;color:var(--dim);font-size:12px">$1</div>')
  .replace(/^\|(.+)\|$/gm,(m)=>{const c=m.split('|').slice(1,-1).map(x=>x.trim());return '<tr>'+c.map(x=>x==='---'||/^-+$/.test(x)?'':`<td>${x}</td>`).join('')+'</tr>'})
  .replace(/(<tr>.*<\/tr>)(\n<tr>.*<\/tr>)+/gs,(block)=>{
    const rows=block.split('\n');
    const head=rows[0].replace(/<tr>/,'<thead><tr>').replace(/<\/tr>/,'</tr></thead>');
    return '<table>'+head+rows.slice(2).join('')+'</table>';
  })
  .replace(/\n{2,}/g,'<br>').replace(/\n/g,'');
}

const html = mdToHtml(md);
console.log('md长度:', md.length, '→ html长度:', html.length);
console.log('\n--- 连续<br>数量统计 ---');
const brRuns = html.match(/(<br>)+/g) || [];
console.log('br片段数:', brRuns.length, '| 最长连续br:', brRuns.sort((a,b)=>b.length-a.length)[0]?.match(/<br>/g).length);
console.log('\n--- html中<br>总数 ---', (html.match(/<br>/g)||[]).length);
console.log('\n--- html前1200字 ---');
console.log(html.slice(0,1200));
