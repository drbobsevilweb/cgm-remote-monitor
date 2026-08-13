import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
const seed = process.argv[2] || '1337';
const timeoutMs = +(process.argv[3] || 900000);
const b = await chromium.launch({args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--mute-audio']});
const p = await b.newPage({viewport:{width:960,height:540}});
const errs=[];
p.on('pageerror', e=>errs.push('PAGEERROR: '+e.message+'\n'+(e.stack||'').split('\n').slice(0,3).join('\n')));
p.on('console', m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
await p.goto(`http://127.0.0.1:8099/index.html?test=replay&seed=${seed}`,{waitUntil:'load'});
const t0=Date.now();
let last=null;
while (Date.now()-t0 < timeoutMs) {
  const r = await p.evaluate(()=>window.__VOIDBREACH_RESULT__ || null);
  if (r) { last=r; break; }
  const prog = await p.evaluate(()=>{ const h=window.__HARNESS; const g=window.__GAME;
    return h? {t:+h.time.toFixed(0), beats:[...h.beats.values()].filter(x=>x.done).length, kills:g.stats.kills, alive:g.enemies.aliveNow, hp:+g.player.health.toFixed(0), nests:g.nests.remaining, room:h.roomId()}:null; });
  if (prog) process.stderr.write(`t=${prog.t}s beats=${prog.beats}/12 kills=${prog.kills} alive=${prog.alive} hp=${prog.hp} nests=${prog.nests} room=${prog.room}\n`);
  await p.waitForTimeout(6000);
}
if (last) console.log(JSON.stringify(last, null, 1));
else console.log('NO RESULT');
if (errs.length) console.log('ERRORS:\n'+errs.slice(0,5).join('\n'));
await p.screenshot({path:'/tmp/replay_end.png'});
await b.close();
