/**
 * 极简 CDP 驱动：加载页面、收集控制台/异常、执行脚本、截图
 * 用法: node tools/cdp.mjs <url> <out.png> [evalFile] [waitMs]
 */
import { writeFileSync, readFileSync } from 'node:fs';

const [, , url, out, evalFile, waitArg] = process.argv;
const WAIT = Number(waitArg || 5000);
const PORT = Number(process.env.CDP_PORT || 9222);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 总是新建一个干净的标签页，避免挂到别的页面上
const created = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
if (!created.webSocketDebuggerUrl) { console.error('no new target', JSON.stringify(created).slice(0, 300)); process.exit(1); }
const page = created;

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const logs = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled') {
    logs.push('[console.' + m.params.type + '] ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push('[EXCEPTION] ' + (d.exception?.description || d.text));
  }
  if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
    logs.push('[log.error] ' + m.params.entry.text);
  }
});
await new Promise(r => ws.addEventListener('open', r));

function send(method, params = {}) {
  const i = ++id;
  ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise(res => pending.set(i, res));
}

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', {
  width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
});
await send('Page.navigate', { url });
await sleep(1200);

if (evalFile) {
  const src = readFileSync(evalFile, 'utf8');
  const r = await send('Runtime.evaluate', { expression: src, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) logs.push('[EVAL ERROR] ' + JSON.stringify(r.result.exceptionDetails.text || r.result.exceptionDetails));
  else if (r.result?.result?.value !== undefined) console.log('EVAL =>', JSON.stringify(r.result.result.value).slice(0, 800));
}

await sleep(WAIT);

const shot = await send('Page.captureScreenshot', { format: 'png' });
if (shot.result?.data) { writeFileSync(out, Buffer.from(shot.result.data, 'base64')); console.log('saved', out); }
else console.error('screenshot failed', JSON.stringify(shot).slice(0, 300));

if (logs.length) console.log('--- logs ---\n' + logs.join('\n'));
else console.log('--- no console errors ---');
ws.close();
process.exit(0);
