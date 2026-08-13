import { getChromium, HEADLESS_GL_ARGS } from './browser.mjs';
const chromium = await getChromium();
const query = process.argv[2] || '';
const out = process.argv[3] || '/tmp/game.png';
const waitMs = +(process.argv[4] || 8000);
const b = await chromium.launch({args: HEADLESS_GL_ARGS});
const p = await b.newPage({viewport:{width:1280,height:720}});
const errs=[];
p.on('pageerror', e=>errs.push('PAGEERROR: '+e.message+'\n'+(e.stack||'').split('\n').slice(0,4).join('\n')));
p.on('console', m=>{ if(m.type()==='error') errs.push('CONSOLE: '+m.text()); });
await p.goto('http://127.0.0.1:8099/index.html?'+query,{waitUntil:'load'});
await p.waitForTimeout(waitMs);
const st = await p.evaluate(()=>{ const g=window.__GAME; if(!g) return {boot:'no game'};
  return { mode:g.mode, bootMs:g.bootMs&&+g.bootMs.toFixed(0), t:+g.clock.simTime.toFixed(1),
    enemies:g.enemies?g.enemies.aliveNow:null, kills:g.stats.kills, nests:g.nests?g.nests.remaining:null,
    hp:g.player?+g.player.health.toFixed(0):null, calls:g.renderer.stats.calls, tris:g.renderer.stats.triangles,
    lights:g.lighting?g.lighting.activeLights:null, frames:g.profiler.frames, harness: !!window.__HARNESS, shot: window.__SHOT_INFO||null,
    result: window.__VOIDBREACH_RESULT__ ? {pass:window.__VOIDBREACH_RESULT__.pass, passed:window.__VOIDBREACH_RESULT__.beatsPassed} : null }; });
console.log(JSON.stringify(st));
if (errs.length) console.log(errs.slice(0,6).join('\n---\n'));
await p.screenshot({path:out});
await b.close();
