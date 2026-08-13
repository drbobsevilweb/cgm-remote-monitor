// Dev capture: node tools/shot.mjs <url-query> <outfile>
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';

const query = process.argv[2] || '';
const out = process.argv[3] || '/tmp/shot.png';
const page18 = process.argv.includes('--wait');

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.goto(`http://127.0.0.1:8099/preview.html?${query}`, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__READY === true, { timeout: 120000 });
} catch (e) {
  console.log('TIMEOUT waiting for __READY');
}
const stats = await page.evaluate(() => window.__STATS);
console.log(JSON.stringify(stats));
if (errors.length) console.log('ERRORS:\n' + errors.slice(0, 8).join('\n'));
await page.screenshot({ path: out });
await browser.close();
