// RENDERER / Quality — explicit tiers. Never adapts silently mid-capture:
// a golden image must be reproducible, so the tier is fixed at boot.

export const TIERS = {
  low:    { bloomLevels: 3, fxaa: false, shadowMap: 1024, pixelRatio: 1.0, particles: 1200, decals: 96,  dust: false, lights: 4 },
  medium: { bloomLevels: 4, fxaa: true,  shadowMap: 1536, pixelRatio: 1.0, particles: 2600, decals: 176, dust: true,  lights: 6 },
  high:   { bloomLevels: 5, fxaa: true,  shadowMap: 2048, pixelRatio: 1.25, particles: 4096, decals: 256, dust: true, lights: 8 },
};

export function pickQuality(name) {
  if (name && TIERS[name]) return { name, ...TIERS[name] };
  // Headless/software rendering: the tier must still be deterministic, so we
  // choose by an explicit signal rather than by measured performance.
  const mem = (typeof navigator !== 'undefined' && navigator.deviceMemory) || 8;
  const tier = mem >= 8 ? 'high' : mem >= 4 ? 'medium' : 'low';
  return { name: tier, ...TIERS[tier] };
}
