import { getChromium, HEADLESS_GL_ARGS } from './browser.mjs';
const chromium = await getChromium();
const seed = process.argv[2] || '1337';
const timeoutMs = +(process.argv[3] || 900000);
const b = await chromium.launch({args: HEADLESS_GL_ARGS});
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
    if (!h) return null;
    // Position, goal and field reachability, because "stalled" on its own has
    // never once been enough to find out WHY a run stopped moving.
    let goal = null, fd = -1;
    try { goal = h.chooseGoal(); fd = h.field.distanceAt(g.player.x, g.player.z); } catch (e) { /* mid-step */ }
    return {t:+h.time.toFixed(0), beats:[...h.beats.values()].filter(x=>x.done).length,
      kills:g.stats.kills, alive:g.enemies.aliveNow, hp:+g.player.health.toFixed(0),
      queens:g.broods.remaining, eggs:g.broods.eggsAlive, room:h.roomId(),
      at:`${(g.player.x/2.5).toFixed(1)},${(g.player.z/2.5).toFixed(1)}`,
      goal: goal ? `${goal.kind}@${(goal.x/2.5).toFixed(0)},${(goal.z/2.5).toFixed(0)}` : '?',
      fd, forced:h.forcedExit?1:0, unreach:h.unreachable.size,
      doors:g.sector.doors.filter(d=>d.state!=='closed').map(d=>d.id+':'+d.state).join(',')||'-'};
  });
  if (prog) process.stderr.write(`t=${prog.t}s beats=${prog.beats}/15 kills=${prog.kills} alive=${prog.alive} hp=${prog.hp} queens=${prog.queens} eggs=${prog.eggs} room=${prog.room} at=${prog.at} goal=${prog.goal} fd=${prog.fd} forced=${prog.forced} unreach=${prog.unreach} doors=${prog.doors}\n`);
  await p.waitForTimeout(6000);
}
if (last) console.log(JSON.stringify(last, null, 1));
else console.log('NO RESULT');
if (errs.length) console.log('ERRORS:\n'+errs.slice(0,5).join('\n'));
await p.screenshot({path:'/tmp/replay_end.png'});
await b.close();
