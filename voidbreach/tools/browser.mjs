// QA / browser — one place that knows how to find Playwright.
//
// The tools used to hardcode an absolute path into a specific container's
// node_modules, which meant the whole QA suite only ran on the machine it was
// written on. Resolve it normally instead, and fail with an instruction rather
// than a stack trace.

let chromium = null;

export async function getChromium() {
  if (chromium) return chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (e) {
    try {
      // fall back to a global install, which is common for Playwright
      const { execSync } = await import('node:child_process');
      const root = execSync('npm root -g', { encoding: 'utf8' }).trim();
      ({ chromium } = await import(`file://${root}/playwright/index.mjs`));
    } catch (e2) {
      console.error(
        '\nPlaywright is required for the capture and replay tools.\n' +
        '  npm install --no-save playwright && npx playwright install chromium\n' +
        '\nThe game itself needs none of this — just `node tools/serve.mjs`.\n');
      process.exit(2);
    }
  }
  return chromium;
}

/** Launch args that make WebGL work in headless environments without a GPU. */
export const HEADLESS_GL_ARGS = [
  '--use-gl=angle',
  '--use-angle=swiftshader',
  '--enable-unsafe-swiftshader',
  '--ignore-gpu-blocklist',
  '--mute-audio',
];
