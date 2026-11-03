const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const T = __dirname;
const OUT = path.join(T, process.argv[2] === 'offline' ? 'shots_off' : 'shots');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://127.0.0.1:8765/';

const periods = [
  ['This Afternoon', true, 17, 'Mostly Sunny', 'Mostly sunny, with a high near 17. West wind 15 to 25 km/h.'],
  ['Tonight', false, 11, 'Patchy Fog', 'Patchy fog after 10pm. Otherwise, mostly cloudy, with a low around 11. West wind 10 to 20 km/h.'],
  ['Tuesday', true, 18, 'Partly Sunny', 'Partly sunny, with a high near 18.'],
  ['Tuesday Night', false, 12, 'Mostly Cloudy', 'Mostly cloudy, with a low around 12.'],
  ['Wednesday', true, 16, 'Chance Light Rain', 'A chance of light rain. Cloudy, with a high near 16.'],
  ['Wednesday Night', false, 11, 'Light Rain Likely', 'Light rain likely.'],
  ['Thursday', true, 15, 'Showers And Thunderstorms', 'Showers and thunderstorms. High near 15.'],
  ['Thursday Night', false, 9, 'Partly Cloudy', 'Partly cloudy.'],
  ['Friday', true, 17, 'Sunny', 'Sunny.'],
  ['Friday Night', false, 10, 'Clear', 'Clear.'],
  ['Saturday', true, 19, 'Sunny', 'Sunny.'],
].map(([name, isDaytime, temperature, shortForecast, detailedForecast]) => ({ name, isDaytime, temperature, shortForecast, detailedForecast }));

const mode = process.argv[2] || 'mock';
(async () => {
  const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  const errors = [];
  page.on('requestfailed', r => errors.push('failed: ' + r.url()));
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  if (mode === 'offline') await page.route(u => !u.href.startsWith('http://127.0.0.1'), r => r.abort());
  if (mode === 'mock') {
    await page.route('https://fonts.googleapis.com/**', r => r.abort());
    await page.route('https://api.weather.gov/**', r => {
      const u = r.request().url();
      let body;
      if (u.includes('/points/')) body = { properties: { forecast: 'https://api.weather.gov/gridpoints/MTR/85,105/forecast', observationStations: 'https://api.weather.gov/gridpoints/MTR/85,105/stations' } };
      else if (u.endsWith('/stations')) body = { features: [{ properties: { stationIdentifier: 'KOAK', name: 'Oakland International Airport' } }, { properties: { stationIdentifier: 'SFOC1', name: 'San Francisco Downtown' } }] };
      else if (u.includes('/observations/latest')) body = { properties: { timestamp: new Date().toISOString(), textDescription: 'Thunderstorms and Rain', temperature: { value: 15.6 }, dewpoint: { value: 10.2 }, relativeHumidity: { value: 70.4 }, barometricPressure: { value: 101520 }, windSpeed: { value: 22.3 }, windDirection: { value: 260 }, windGust: { value: 38.9 }, visibility: { value: 16090 } } };
      else if (u.includes('/forecast')) body = { properties: { periods } };
      else if (u.includes('/alerts/')) body = { features: [{ properties: { event: 'Wind Advisory', headline: 'Wind Advisory issued November 2 until November 3 at 6PM PST', description: 'West winds 30 to 45 km/h with gusts up to 70 km/h expected along the coast and over the bay.' } }] };
      r.fulfill({ status: 200, contentType: 'application/geo+json', body: JSON.stringify(body) });
    });
    await page.route('https://mesonet.agron.iastate.edu/**', r => {
      const u = r.request().url();
      r.fulfill({ status: 200, contentType: 'image/png', body: fs.readFileSync(path.join(T, u.includes('nexrad') ? 'radar.png' : 'lines.png')) });
    });
    await page.route('https://api.artic.edu/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [
      { id: 1, title: 'Water Lilies', artist_title: 'Claude Monet', date_display: '1906', image_id: 'abc', classification_title: 'painting', is_public_domain: true },
      { id: 2, title: 'Paris Street; Rainy Day', artist_title: 'Gustave Caillebotte', date_display: '1877', image_id: 'def', classification_title: 'painting', is_public_domain: true },
    ] }) }));
    await page.route('https://www.artic.edu/iiif/**', r => r.fulfill({ status: 200, contentType: 'image/jpeg', body: fs.readFileSync(path.join(T, '..', 'assets', 'fireplace', 'poster.jpg')) }));
  }
  await page.goto(BASE);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/00_power.png` });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/01_home.png` });
  await page.keyboard.press('Enter'); // weather
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/02_wx_intro.png` });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/03_wx_current.png` });
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(1600);
    await page.screenshot({ path: `${OUT}/04_wx_seg${i}.png` });
  }
  await page.keyboard.press('h');
  await page.waitForTimeout(800);
  await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter'); // fireplace
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/05_fire.png` });
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/06_fire_menu.png` });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/07_fire_timer.png` });
  const vt = await page.evaluate(() => [...document.querySelectorAll('.fire video')].map(v => ({ t: v.currentTime, d: v.duration, p: v.paused, o: v.style.opacity })));
  console.log('videos', JSON.stringify(vt));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('Enter'); // gallery
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/08_gallery.png` });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/09_gallery_menu.png` });
  for (let i = 0; i < 8; i++) await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/10_gallery_mat.png` });
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
  await page.waitForTimeout(1600);
  await page.screenshot({ path: `${OUT}/11_gallery_ivorygold.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/12_mobile.png` });
  console.log('ERRORS:\n' + errors.join('\n'));
  await browser.close();
})();
