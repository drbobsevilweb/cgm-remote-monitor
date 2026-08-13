// CORE / Events — the only legal cross-subsystem channel (ARCHITECTURE §2).
//
// Payloads are plain objects taken from a small pool and are valid only for the
// duration of dispatch. Listeners that need to keep data must copy it.

export class Events {
  constructor() {
    this.map = new Map();
    this.log = null;          // set to an array by QA to record events
    this.logFilter = null;
  }

  on(type, fn) {
    let l = this.map.get(type);
    if (!l) { l = []; this.map.set(type, l); }
    l.push(fn);
    return () => this.off(type, fn);
  }

  off(type, fn) {
    const l = this.map.get(type);
    if (!l) return;
    const i = l.indexOf(fn);
    if (i >= 0) l.splice(i, 1);
  }

  emit(type, payload) {
    if (this.log && (!this.logFilter || this.logFilter(type))) {
      this.log.push({ type, t: payload && payload.t, data: shallow(payload) });
    }
    const l = this.map.get(type);
    if (!l) return;
    for (let i = 0; i < l.length; i++) l[i](payload);
  }

  clear() { this.map.clear(); }
}

function shallow(o) {
  if (!o || typeof o !== 'object') return o;
  const out = {};
  for (const k in o) {
    const v = o[k];
    if (v === null || typeof v !== 'object') out[k] = v;
  }
  return out;
}

/**
 * Event vocabulary (documented so subsystems agree without importing each other):
 *
 *  impact       {x,y,z, nx,ny,nz, surface, power, weapon}
 *  enemyHit     {id, kind, x,y,z, dmg, dirX,dirZ, crit, part}
 *  enemyDied    {id, kind, x,y,z, dirX,dirZ, gib}
 *  playerHit    {dmg, dirX, dirZ, armour}
 *  playerDied   {}
 *  shot         {x,y,z, dirX,dirZ, weapon, kick}
 *  reload       {stage}           stage: 'release'|'seat'|'charge'
 *  explosion    {x,y,z, radius, power, kind}
 *  nestDamaged  {id, x,y,z, hp01}
 *  nestDestroyed{id, x,y,z, kind, remaining}
 *  nestSpawn    {id, x,y,z, kind}
 *  tankDetonated{x,y,z}
 *  lampBroken   {x,y,z}
 *  doorState    {id, state}       state: 'cycling'|'open'|'locked'
 *  objective    {text, kind}
 *  beat         {name}            director/QA narrative beats
 *  pickup       {kind, x,y,z}
 *  bossPhase    {phase}
 *  message      {text, tone, ttl}
 */
