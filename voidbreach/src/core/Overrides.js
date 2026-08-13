// CORE / Overrides — authoring overrides from the Studio.
//
// The Studio (studio.html) edits the same parameter objects the game builds
// from, and stores the result here. The game picks them up at boot.
//
// DETERMINISM: overrides are IGNORED in any deterministic run (?test= or
// ?shot=). The gates must measure what ships, not what somebody left in their
// browser — otherwise a golden capture would depend on local state, which is
// exactly what ARCHITECTURE §3.6 forbids.

const KEY = 'voidbreach.overrides.v1';

let cache = null;
let loaded = false;

function deterministicRun() {
  if (typeof location === 'undefined') return true;
  const p = new URLSearchParams(location.search);
  return p.has('test') || p.has('shot');
}

export function loadOverrides() {
  if (loaded) return cache;
  loaded = true;
  cache = null;
  if (deterministicRun()) return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) cache = JSON.parse(raw);
  } catch (e) {
    console.warn('[overrides] ignored unreadable overrides:', e.message);
    cache = null;
  }
  return cache;
}

export function saveOverrides(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)); return true; }
  catch (e) { console.warn('[overrides] could not save:', e.message); return false; }
}

export function clearOverrides() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
  cache = null; loaded = false;
}

export function overridesActive() {
  return !!loadOverrides();
}

/** Deep merge of plain objects; arrays and scalars from `src` replace `dst`. */
export function merge(dst, src) {
  if (!src) return dst;
  const out = Array.isArray(dst) ? dst.slice() : { ...dst };
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v && typeof v === 'object' && !Array.isArray(v) &&
        out[k] && typeof out[k] === 'object' && !Array.isArray(out[k])) {
      out[k] = merge(out[k], v);
    } else {
      out[k] = v;
    }
  }
  return out;
}

/** Section helper: `section('materials')` returns just that slice, or null. */
export function section(name) {
  const o = loadOverrides();
  return o && o[name] ? o[name] : null;
}
