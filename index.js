// 入口：启动引擎 + 看板
import { startEngine } from './src/engine.js';
import { startServer } from './src/server.js';
import { llmOk } from './src/llm.js';
import { CFG } from './src/config.js';

console.log('=== A股短线模拟盘 ===');
console.log(`实验期: ${CFG.runStart} ~ ${CFG.runEnd}  本金: ${CFG.startCash}元`);
console.log(`LLM: ${llmOk() ? '已配置 ✓' : '未配置 ✗（决策将失败）'}`);
startServer();
startEngine();
console.log('引擎已启动，轮询间隔', CFG.loop.pollSec, '秒');
