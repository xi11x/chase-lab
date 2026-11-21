/**
 * 真实点击走一遍完整流程，逐屏截图 + 收集异常
 */
import { writeFileSync } from 'node:fs';
const PORT = Number(process.env.CDP_PORT || 9456);
const URL = process.env.PAGE || 'http://127.0.0.1:8777/index.html';
const OUT = 'shots';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const created = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(created.webSocketDebuggerUrl);
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', ev => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); return; }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    logs.push('[console.error] ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails;
    logs.push('[EXCEPTION] ' + (d.exception?.description || d.text));
  }
});
await new Promise(r => ws.addEventListener('open', r));
const send = (method, params = {}) => {
  const i = ++id; ws.send(JSON.stringify({ id: i, method, params }));
  return new Promise(res => pending.set(i, res));
};
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) return 'ERR:' + (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text || '').split('\n').slice(0,3).join(' / ');
  return r.result?.result?.value;
};
const shot = async (name) => {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  if (r.result?.data) { writeFileSync(`${OUT}/flow-${name}.png`, Buffer.from(r.result.data, 'base64')); console.log('  shot', name); }
  else console.log('  SHOT FAILED', name);
};

await send('Runtime.enable'); await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: URL });
await sleep(3500);

const step = async (label, expr, wait = 700, shotName = null) => {
  const v = await evaluate(expr);
  console.log(label, '=>', JSON.stringify(v));
  if (wait) await sleep(wait);
  if (shotName) await shot(shotName);
};

await step('boot', `!!window.__lab && document.title`, 300, null);
await step('click-start', `document.querySelector('#btnStart').click(), document.querySelector('#scrPredict').classList.contains('hidden')`, 500, 'predict');
await step('choose-5', `document.querySelector('#optWrap .opt[data-v="5"]').click(), window.__lab.G.phase`, 600, 'lab');
await step('set6-run', `(window.__lab.speed(6), window.__lab.run(), window.__lab.G.playing)`, 400, 'running');
await step('ff-to-end', `(window.__lab.G.t = 14.7, 'ok')`, 3000, 'result');
await step('result-state', `[window.__lab.G.caught, !document.querySelector('#sheetResult').classList.contains('hidden')]`);
await step('continue', `document.querySelector('#rNext').click(), 1`, 800, 'theater');
await step('theater-state', `window.__lab.G.t`);
await step('theater-next', `document.querySelector('#thNext').click(), 1`, 700, 'reframe-intro');
await step('reframe-go', `document.querySelector('#rfGo').click(), window.__lab.lab.camMode`, 600, 'reframe-start');
await step('reframe-ff', `(window.__lab.G.t = 14.6, 'ok')`, 3000, 'reframe-done');
await step('reframe-state', `[window.__lab.lab.camMode, !!document.querySelector('#pfGo')]`);
await step('to-proof', `document.querySelector('#pfGo').click(), 1`, 1800, 'proof');
await step('to-end', `document.querySelector('#prEnd').click(), 1`, 900, 'end');
await step('egg-7', `document.querySelector('#eggOpts button[data-v="7"]').click(), 1`, 700, 'egg');
await step('end-state', `!!window.__lab.G.badges.size`);

console.log('--- errors ---');
console.log(logs.length ? logs.join('\n') : '(none)');
ws.close(); process.exit(0);
