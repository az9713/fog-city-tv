// Fog City Weather Station: a 1990s-style local forecast channel with live NWS data (Celsius),
// live NEXRAD radar from the Iowa Environmental Mesonet, a weather-matched sky cam, generative
// jazz, and a synthesized announcer.
import { h, esc, PLACE, store, fmtTime, fmtDate, getJSON, sunElevation } from './util.js';
import { drawIcon, classify, makeIconCanvas } from './icons.js';
import { createJazz } from './jazz.js';

const NWS = 'https://api.weather.gov';
const IEM_RADAR = 'https://mesonet.agron.iastate.edu/cache/tile.py/1.0.0';
const IEM_BASE = 'https://mesonet.agron.iastate.edu/c/tile.py/1.0.0';
const WX_REFRESH = 10 * 60 * 1000, RADAR_REFRESH = 5 * 60 * 1000;

const LOGO_SVG = (w = 1300) => `
<svg viewBox="0 0 1300 560" width="${w}" xmlns="http://www.w3.org/2000/svg" aria-label="Fog City Weather Station">
  <defs>
    <linearGradient id="chrome" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffffff"/><stop offset=".45" stop-color="#c9d3ea"/><stop offset=".5" stop-color="#6f7ea6"/><stop offset="1" stop-color="#e8eefc"/>
    </linearGradient>
    <linearGradient id="gold" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff6b0"/><stop offset=".5" stop-color="#ffc21a"/><stop offset=".52" stop-color="#d07c00"/><stop offset="1" stop-color="#ffe066"/>
    </linearGradient>
    <linearGradient id="orbit" x1="0" x2="1"><stop offset="0" stop-color="#7a3cff" stop-opacity="0"/><stop offset=".5" stop-color="#9b6bff"/><stop offset="1" stop-color="#3cc8ff" stop-opacity=".2"/></linearGradient>
    <radialGradient id="sunG"><stop offset="0" stop-color="#fff7a8"/><stop offset=".6" stop-color="#ffc400"/><stop offset="1" stop-color="#ff8a00"/></radialGradient>
  </defs>
  <ellipse cx="650" cy="330" rx="610" ry="120" fill="none" stroke="url(#orbit)" stroke-width="26" transform="rotate(-6 650 330)"/>
  <g transform="translate(1020 6) scale(.82)">
    ${Array.from({ length: 12 }, (_, i) => `<polygon points="0,-118 14,-80 -14,-80" fill="#ffb300" transform="translate(110 120) rotate(${i * 30})"/>`).join('')}
    <circle cx="110" cy="120" r="78" fill="url(#sunG)" stroke="#c46a00" stroke-width="6"/>
    <path d="M40 190 q-10 -60 55 -62 q20 -48 80 -30 q55 -12 70 40 q50 6 40 52 z" fill="#f4f7ff" stroke="#8a97c4" stroke-width="7"/>
    <polygon points="140,170 108,232 134,232 112,292 176,214 146,214 168,170" fill="#ffe94d" stroke="#b07a00" stroke-width="5"/>
  </g>
  <text x="650" y="300" text-anchor="middle" font-family="'Barlow Condensed', sans-serif" font-weight="800" font-style="italic" font-size="196" fill="url(#chrome)" stroke="#0b1450" stroke-width="10" paint-order="stroke" letter-spacing="4">FOG CITY</text>
  <text x="650" y="455" text-anchor="middle" font-family="'Barlow Condensed', sans-serif" font-weight="800" font-size="128" fill="url(#gold)" stroke="#3a1a00" stroke-width="9" paint-order="stroke" letter-spacing="6">WEATHER STATION</text>
</svg>`;

const SAMPLE = {   // shown only if live data cannot be fetched
  station: 'San Francisco Downtown', obsTime: new Date().toISOString(),
  temp: 16, dew: 9, rh: 63, pres: 1017, wind: 'W 18 km/h', gust: null, vis: 16, text: 'Partly Cloudy', sky: 'sunny', kind: 'partly', night: false,
  periods: [
    { name: 'Today', isDaytime: true, temperature: 18, shortForecast: 'Mostly Sunny', detailedForecast: 'Mostly sunny, with a high near 18. West wind 10 to 20 km/h.' },
    { name: 'Tonight', isDaytime: false, temperature: 11, shortForecast: 'Patchy Fog', detailedForecast: 'Patchy fog after 11pm. Mostly cloudy, with a low around 11.' },
    { name: 'Tuesday', isDaytime: true, temperature: 19, shortForecast: 'Partly Sunny', detailedForecast: 'Partly sunny, with a high near 19.' },
    { name: 'Tuesday Night', isDaytime: false, temperature: 12, shortForecast: 'Mostly Cloudy', detailedForecast: 'Mostly cloudy, with a low around 12.' },
    { name: 'Wednesday', isDaytime: true, temperature: 17, shortForecast: 'Chance Light Rain', detailedForecast: 'A chance of light rain. Cloudy, with a high near 17.' },
    { name: 'Wednesday Night', isDaytime: false, temperature: 11, shortForecast: 'Light Rain Likely', detailedForecast: 'Light rain likely. Low around 11.' },
    { name: 'Thursday', isDaytime: true, temperature: 16, shortForecast: 'Rain Showers Likely', detailedForecast: 'Rain showers likely. High near 16.' },
    { name: 'Thursday Night', isDaytime: false, temperature: 10, shortForecast: 'Partly Cloudy', detailedForecast: 'Partly cloudy, low around 10.' },
    { name: 'Friday', isDaytime: true, temperature: 18, shortForecast: 'Sunny', detailedForecast: 'Sunny, with a high near 18.' },
    { name: 'Friday Night', isDaytime: false, temperature: 10, shortForecast: 'Clear', detailedForecast: 'Clear, low around 10.' },
    { name: 'Saturday', isDaytime: true, temperature: 20, shortForecast: 'Sunny', detailedForecast: 'Sunny, with a high near 20.' },
  ],
  alerts: [],
};

const CITIES = [
  ['San Francisco', 37.7749, -122.4194, true], ['Oakland', 37.8044, -122.2712, false, -26], ['San Jose', 37.3382, -121.8863],
  ['Santa Rosa', 38.4405, -122.7144], ['Napa', 38.2975, -122.2869], ['Vallejo', 38.1041, -122.2566],
  ['Half Moon Bay', 37.4636, -122.4286], ['Santa Cruz', 36.9741, -122.0308], ['Monterey', 36.6002, -121.8947],
  ['Stockton', 37.9577, -121.2908], ['Sacramento', 38.5816, -121.4944], ['Livermore', 37.6819, -121.768], ['Point Reyes', 38.0697, -122.8069],
];

function compass(deg) {
  if (deg == null) return '';
  return ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(deg / 22.5) % 16];
}
const r0 = v => (v == null || Number.isNaN(v) ? null : Math.round(v));

function skyFor(kind, night) {
  if (kind === 'storm') return 'storm';
  if (kind === 'rain' || kind === 'showers') return 'rain';
  if (kind === 'fog' || kind === 'snow') return 'fog';
  if (kind === 'cloudy') return night ? 'night' : 'overcast';
  return night ? 'night' : 'sunny';
}

export class Weather {
  constructor({ go, audio }) {
    this.go = go; this.audio = audio;
    this.el = h('div', 'layer wx');
    this.data = null; this.segIdx = 0; this.timers = [];
    this.icons = [];
  }

  mount() {
    this.el.innerHTML = `
      <div class="frame"></div>
      <div class="topbar">
        <div class="logo-box">${LOGO_SVG(280)}</div>
        <div class="title-box"><div class="title">Fog City Weather Station</div><div class="subtitle">${PLACE.name}</div></div>
        <div class="time-box"><div class="time"></div><div class="datestr"></div></div>
      </div>
      <div class="panel"></div>
      <div class="crawl"><div class="tag">FOG CITY 24/7</div><div class="track"><div class="text">LOADING THE LATEST FORECAST FROM THE NATIONAL WEATHER SERVICE...</div></div></div>
      <div class="flash"></div>
      <div class="intro">${LOGO_SVG(1300)}</div>`;
    this.panel = this.el.querySelector('.panel');
    this.titleEl = this.el.querySelector('.title');
    this.subEl = this.el.querySelector('.subtitle');
    this.crawlText = this.el.querySelector('.crawl .text');
    this.flashEl = this.el.querySelector('.flash');

    const clock = () => { this.el.querySelector('.time').textContent = fmtTime(); this.el.querySelector('.datestr').textContent = fmtDate(); };
    clock(); this.every(clock, 1000);

    // music + announcer
    if (this.audio.ctx) { this.jazz = createJazz(this.audio); this.jazz.start(); }
    this.say(`You're watching the Fog City Weather Station. Your weather, all day and all night, right here in ${PLACE.name}.`, 900);

    this.buildSegments();
    this.loadWeather();
    this.every(() => this.loadWeather(), WX_REFRESH);
    this.every(() => this.refreshRadar(), RADAR_REFRESH);

    // icon animation loop
    const loop = t => {
      if (!this.alive) return;
      this.icons.forEach(({ cv, kind, night }) => drawIcon(cv, kind, t, night));
      this.drawPrecip(t);
      this.crawlStep(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.alive = true;
    this.raf = requestAnimationFrame(loop);

    setTimeout(() => { const i = this.el.querySelector('.intro'); if (i) { i.style.opacity = 0; setTimeout(() => i.remove(), 900); } this.showSeg(0); }, 4200);
  }

  every(fn, ms) { this.timers.push(setInterval(fn, ms)); }

  unmount() {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    this.timers.forEach(clearInterval);
    clearTimeout(this.segTimer); clearTimeout(this.radarTimer); clearTimeout(this.boltTimer);
    if (this.jazz) this.jazz.stop();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }

  onKey(k) {
    if (k === 'ArrowRight') { this.showSeg(this.segIdx + 1); return true; }
    if (k === 'ArrowLeft') { this.showSeg(this.segIdx - 1 + this.segs.length); return true; }
    return false;
  }

  // ---------- announcer ----------
  say(text, delay = 0) {
    if (!('speechSynthesis' in window) || this.audio.muted) return;
    setTimeout(() => {
      if (!this.alive && delay) return;
      const u = new SpeechSynthesisUtterance(text);
      const voices = speechSynthesis.getVoices();
      const pick = voices.find(v => /en-US/i.test(v.lang) && /(Guy|David|Mark|Daniel|Alex|Male|Christopher|Eric)/i.test(v.name)) || voices.find(v => /en-US/i.test(v.lang)) || voices[0];
      if (pick) u.voice = pick;
      u.rate = 1.02; u.pitch = 0.92; u.volume = Math.min(1, this.audio.volume * 1.2);
      u.onstart = () => this.jazz?.duck(true);
      u.onend = u.onerror = () => this.jazz?.duck(false);
      speechSynthesis.cancel();
      speechSynthesis.speak(u);
    }, delay);
  }

  // ---------- data ----------
  async loadWeather() {
    try {
      let meta = store.get('nwsMeta', null);
      if (!meta || Date.now() - meta.at > 7 * 864e5) {
        const pts = await getJSON(`${NWS}/points/${PLACE.lat},${PLACE.lon}`);
        const st = await getJSON(pts.properties.observationStations);
        const stations = st.features.map(f => ({ id: f.properties.stationIdentifier, name: f.properties.name }));
        stations.sort((a, b) => (/san francisco/i.test(b.name) - /san francisco/i.test(a.name)));
        meta = { at: Date.now(), forecast: pts.properties.forecast, stations: stations.slice(0, 4) };
        store.set('nwsMeta', meta);
      }
      const [fc, alerts] = await Promise.all([
        getJSON(meta.forecast + (meta.forecast.includes('?') ? '&' : '?') + 'units=si'),
        getJSON(`${NWS}/alerts/active?point=${PLACE.lat},${PLACE.lon}`).catch(() => ({ features: [] })),
      ]);
      // Small stations often omit pressure, wind or visibility: take each missing field
      // from the next nearest station that reports it.
      const all = (await Promise.all(meta.stations.map(s =>
        getJSON(`${NWS}/stations/${s.id}/observations/latest`).then(o => ({ s, p: o.properties })).catch(() => null)))).filter(Boolean);
      const primary = all.find(x => x.p?.temperature?.value != null);
      let obs = null, station = primary?.s || null;
      if (primary) {
        obs = { ...primary.p };
        const pick = k => (all.find(x => x.p?.[k]?.value != null) || {}).p?.[k];
        if (obs.barometricPressure?.value == null) obs.barometricPressure = pick('barometricPressure') || pick('seaLevelPressure');
        if (obs.windSpeed?.value == null) { obs.windSpeed = pick('windSpeed'); obs.windDirection = (all.find(x => x.p?.windSpeed?.value != null) || {}).p?.windDirection; }
        if (obs.windGust?.value == null) obs.windGust = pick('windGust');
        if (obs.visibility?.value == null) obs.visibility = pick('visibility');
        if (!obs.textDescription) obs.textDescription = (all.find(x => x.p?.textDescription) || {}).p?.textDescription;
      }
      const periods = fc.properties.periods;
      const night = sunElevation() < -2;
      const text = obs?.textDescription || periods[0].shortForecast;
      const kind = classify(text);
      const ws = obs?.windSpeed?.value;   // km/h
      this.data = {
        live: true,
        station: station?.name || PLACE.name, obsTime: obs?.timestamp,
        temp: r0(obs?.temperature?.value ?? periods[0].temperature),
        dew: r0(obs?.dewpoint?.value), rh: r0(obs?.relativeHumidity?.value),
        pres: obs?.barometricPressure?.value ? Math.round(obs.barometricPressure.value / 100) : null,
        wind: ws == null ? null : (ws < 1 ? 'CALM' : `${compass(obs.windDirection?.value)} ${Math.round(ws)} km/h`),
        gust: r0(obs?.windGust?.value),
        vis: obs?.visibility?.value != null ? Math.round(obs.visibility.value / 1000) : null,
        text, kind, night, sky: skyFor(kind, night), periods,
        alerts: (alerts.features || []).map(f => f.properties),
      };
    } catch (e) {
      console.warn('NWS fetch failed, using sample data', e);
      if (!this.data) {
        const night = sunElevation() < -2;
        this.data = { ...SAMPLE, live: false, night, sky: skyFor(SAMPLE.kind, night) };
      }
    }
    store.set('wxLast', { temp: this.data.temp, cond: this.data.text, sky: this.data.sky });
    this.render();
  }

  // ---------- segments ----------
  buildSegments() {
    this.segs = [
      { id: 'current', title: 'Current Conditions', dur: 12000 },
      { id: 'radar', title: 'Local Doppler Radar', dur: 16000 },
      { id: 'local', title: 'Local Forecast', dur: 14000 },
      { id: 'extended', title: 'Extended Forecast', dur: 12000 },
      { id: 'skycam', title: "Fog City Sky Cam", dur: 15000 },
    ];
    this.segEls = {};
    for (const s of this.segs) { const e = h('div', 'seg'); e.dataset.id = s.id; this.panel.appendChild(e); this.segEls[s.id] = e; }
    this.segEls.alerts = h('div', 'seg'); this.panel.appendChild(this.segEls.alerts);
    this.buildRadar();
  }

  activeSegs() {
    const list = [...this.segs];
    if (this.data?.alerts?.length) list.splice(1, 0, { id: 'alerts', title: 'Weather Alert', dur: 14000 });
    return list;
  }

  showSeg(i) {
    const list = this.activeSegs();
    this.segIdx = ((i % list.length) + list.length) % list.length;
    const seg = list[this.segIdx];
    Object.entries(this.segEls).forEach(([id, e]) => e.classList.toggle('active', id === seg.id));
    this.titleEl.textContent = seg.title;
    this.subEl.textContent = seg.id === 'radar' ? 'Bay Area · NEXRAD' : PLACE.name;
    if (seg.id === 'radar') this.playRadar();
    this.announce(seg.id);
    this.maybeLightning(seg.id);
    clearTimeout(this.segTimer);
    this.segTimer = setTimeout(() => this.showSeg(this.segIdx + 1), seg.dur);
  }

  announce(id) {
    const d = this.data; if (!d) return;
    const lines = {
      current: `Right now in ${PLACE.name}, it's ${d.temp} degrees and ${d.text.toLowerCase()}.`,
      radar: 'Here is your local Doppler radar.',
      local: d.periods?.[0] ? `${d.periods[0].name}: ${d.periods[0].detailedForecast}` : '',
      extended: 'And here is your extended forecast.',
      skycam: `Let's take a look outside at the Fog City Sky Cam.`,
      alerts: d.alerts?.[0] ? `Attention. The National Weather Service has issued a ${d.alerts[0].event}.` : '',
    };
    if (lines[id]) this.say(lines[id], 300);
  }

  maybeLightning(id) {
    clearTimeout(this.boltTimer);
    if (this.data?.kind !== 'storm' || id !== 'skycam') return;
    const strike = () => {
      const host = this.segEls.skycam.querySelector('.skycam');
      if (host && this.flashEl.parentNode !== host) host.appendChild(this.flashEl);
      this.flashEl.classList.remove('go'); void this.flashEl.offsetWidth; this.flashEl.classList.add('go');
      this.boltTimer = setTimeout(strike, 2500 + Math.random() * 6000);
    };
    this.boltTimer = setTimeout(strike, 1500);
  }

  render() {
    const d = this.data;
    this.icons = [];
    this.el.querySelector('.offline')?.remove();
    if (!d.live) this.el.appendChild(h('div', 'offline', 'SAMPLE DATA · NWS UNREACHABLE'));

    // current conditions
    const cur = this.segEls.current;
    const cv = makeIconCanvas(300);
    const rows = [['Humidity', d.rh != null ? `${d.rh}%` : 'N/A'], ['Dew Point', d.dew != null ? `${d.dew}°` : 'N/A'],
      ['Pressure', d.pres != null ? `${d.pres} hPa` : 'N/A'], ['Wind', d.wind || 'N/A'], ['Gusts', d.gust ? `${d.gust} km/h` : 'None'],
      ['Visibility', d.vis != null ? `${d.vis} km` : 'N/A']];
    cur.innerHTML = `
      <div style="position:absolute;left:60px;top:60px;width:400px;overflow:hidden;display:flex;flex-direction:column;align-items:center" class="ic"></div>
      <div class="big-temp" style="position:absolute;left:500px;top:110px">${d.temp ?? '--'}&deg;</div>
      <div style="position:absolute;left:510px;top:400px" class="lbl">Celsius</div>
      <div style="position:absolute;right:90px;top:60px;width:640px;display:grid;grid-template-columns:1fr auto;column-gap:30px">
        ${rows.map(([a, b]) => `<div class="lbl">${a}</div><div class="lbl val">${esc(b)}</div>`).join('')}
      </div>
      <div class="foot-note">Observed at ${esc(d.station)} ${d.obsTime ? fmtTime(new Date(d.obsTime), false) : ''}</div>`;
    const ic = cur.querySelector('.ic');
    ic.appendChild(cv);
    const cn = h('div', 'cond-name', esc(d.text));
    const longest = Math.max(...String(d.text || '').split(/\s+/).map(w => w.length));
    if (longest > 11) cn.style.fontSize = Math.max(30, Math.floor(46 * 11 / longest)) + 'px';
    ic.appendChild(cn);
    this.icons.push({ cv, kind: d.kind, night: d.night });

    // local forecast (next 2 periods)
    const p = d.periods || [];
    this.segEls.local.innerHTML = `<div class="fc-text">${p.slice(0, 2).map(x => `<div><h3>${esc(x.name)}</h3><p>${esc(x.detailedForecast)}</p></div>`).join('')}</div>`;

    // extended: 5 daytime periods paired with following night
    const days = [];
    for (let i = 0; i < p.length && days.length < 5; i++) {
      if (!p[i].isDaytime) continue;
      const n = p[i + 1] && !p[i + 1].isDaytime ? p[i + 1] : null;
      days.push({ name: /^(today|this afternoon)/i.test(p[i].name) ? 'TODAY' : p[i].name.slice(0, 3).toUpperCase(), hi: p[i].temperature, lo: n?.temperature, txt: p[i].shortForecast });
    }
    const ext = this.segEls.extended;
    ext.innerHTML = `<div class="days">${days.map(dd => `<div class="day"><div class="dname">${esc(dd.name)}</div><div class="dic"></div><div class="dcond">${esc(dd.txt)}</div><div class="hl">HI<b>${dd.hi ?? '--'}&deg;</b></div><div class="hl">LO<b>${dd.lo ?? '--'}&deg;</b></div></div>`).join('')}</div>`;
    ext.querySelectorAll('.dic').forEach((slot, i) => { const c2 = makeIconCanvas(190); slot.appendChild(c2); this.icons.push({ cv: c2, kind: classify(days[i].txt), night: false }); });

    // sky cam
    const sc = this.segEls.skycam;
    const dimNight = d.night && d.sky !== 'night' ? 'filter:brightness(.45) saturate(.8)' : '';
    sc.innerHTML = `<div class="skycam">
        ${['sunny', 'overcast', 'fog', 'rain', 'storm', 'night'].map(k => `<img data-k="${k}" src="assets/skycam/${k}.jpg" alt="" class="${k === d.sky ? 'show' : ''}" style="${k === d.sky ? dimNight : ''}">`).join('')}
        <canvas width="960" height="390"></canvas>
        <div class="sc-temp">${d.temp ?? '--'}&deg;C</div>
        <div class="sc-lower"><div class="l1"><b>FOG CITY SKY CAM</b><span>Treasure Island · looking at ${PLACE.name} · ${esc(d.text)}</span></div><div class="live">LIVE</div></div>
      </div>`;
    this.precipCanvas = sc.querySelector('canvas');
    this.precipKind = d.kind;
    this.drops = null;

    // alerts
    if (d.alerts?.length) {
      const a = d.alerts[0];
      this.segEls.alerts.innerHTML = `<div class="alert-box"><h3>${esc(a.event)}</h3><p>${esc((a.headline || '') + '. ' + (a.description || '').slice(0, 360))}</p></div>`;
    }

    // crawl
    const crawl = [d.alerts?.[0] ? `${d.alerts[0].event}: ${d.alerts[0].headline || ''}` : null,
      ...p.slice(0, 3).map(x => `${x.name}: ${x.detailedForecast}`),
      d.night ? null : `Sunset tonight at ${this.sunsetStr()}`].filter(Boolean).join('   ·   ');
    this.setCrawl(crawl);
  }

  sunsetStr() {
    const now = new Date(); let last = null;
    for (let m = 0; m < 24 * 60; m += 2) {
      const t = new Date(now.getTime() + m * 60000);
      const e = sunElevation(t);
      if (last != null && last > -0.83 && e <= -0.83) return fmtTime(t, false);
      last = e;
    }
    return '';
  }

  // ---------- crawl ----------
  setCrawl(text) { this.crawlText.textContent = text.toUpperCase(); this.crawlX = null; }
  crawlStep(t) {
    const track = this.crawlText.parentElement;
    if (this.crawlX == null) { this.crawlX = track.clientWidth; this.crawlLast = t; }
    const dt = Math.min(100, t - (this.crawlLast || t)); this.crawlLast = t;
    this.crawlX -= dt * 0.14;
    if (this.crawlX < -this.crawlText.scrollWidth) this.crawlX = track.clientWidth;
    this.crawlText.style.transform = `translateX(${this.crawlX}px)`;
  }

  // ---------- precipitation overlay on the sky cam ----------
  drawPrecip(t) {
    const cv = this.precipCanvas;
    if (!cv || !this.segEls.skycam.classList.contains('active')) return;
    const k = this.precipKind;
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);
    if (!['rain', 'showers', 'storm', 'snow', 'fog'].includes(k)) return;
    if (!this.drops) {
      const n = k === 'fog' ? 6 : k === 'snow' ? 160 : 260;
      this.drops = Array.from({ length: n }, () => ({ x: Math.random() * cv.width, y: Math.random() * cv.height, v: 0.6 + Math.random() * 0.8, s: Math.random() }));
      this.pt = t;
    }
    const dt = Math.min(60, t - this.pt); this.pt = t;
    if (k === 'fog') {
      for (const d of this.drops) {
        d.x += dt * 0.006 * d.v; if (d.x > cv.width + 300) d.x = -300;
        const g = c.createRadialGradient(d.x, cv.height * (0.35 + d.s * 0.3), 10, d.x, cv.height * (0.35 + d.s * 0.3), 260);
        g.addColorStop(0, 'rgba(235,238,245,.22)'); g.addColorStop(1, 'rgba(235,238,245,0)');
        c.fillStyle = g; c.fillRect(0, 0, cv.width, cv.height);
      }
      return;
    }
    if (k === 'snow') {
      c.fillStyle = 'rgba(255,255,255,.85)';
      for (const d of this.drops) {
        d.y += dt * 0.03 * d.v; d.x += Math.sin(t / 900 + d.s * 10) * 0.3;
        if (d.y > cv.height) { d.y = -4; d.x = Math.random() * cv.width; }
        c.fillRect(d.x, d.y, 1 + d.s * 2, 1 + d.s * 2);
      }
      return;
    }
    c.strokeStyle = 'rgba(200,215,235,.35)'; c.lineWidth = 1;
    c.beginPath();
    for (const d of this.drops) {
      d.y += dt * 0.9 * d.v; d.x -= dt * 0.12 * d.v;
      if (d.y > cv.height) { d.y = -20; d.x = Math.random() * (cv.width + 100); }
      c.moveTo(d.x, d.y); c.lineTo(d.x + 3 * d.v, d.y - 16 * d.v);
    }
    c.stroke();
  }

  // ---------- radar ----------
  buildRadar() {
    const el = this.segEls.radar;
    el.innerHTML = `<div class="radar"><div class="tiles base"></div><div class="tiles frames"></div><div class="tiles labels"></div>
      <div class="legend">LIGHT <i style="background:#04e9e7"></i><i style="background:#019ff4"></i><i style="background:#02fd02"></i><i style="background:#01c501"></i><i style="background:#fdf802"></i><i style="background:#fd9500"></i><i style="background:#fd0000"></i><i style="background:#bc0000"></i><i style="background:#f800fd"></i> HEAVY</div>
      <div class="rtime"></div><div class="credit">Radar: NOAA NEXRAD via Iowa Environmental Mesonet</div></div>`;
    const W = 1840, H = 780, z = 9;
    const world = (lat, lon) => {
      const s = 256 * 2 ** z;
      const x = (lon + 180) / 360 * s;
      const sin = Math.sin(lat * Math.PI / 180);
      const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s;
      return [x, y];
    };
    const [cx, cy] = world(37.75, -122.15);
    const ox = cx - W / 2, oy = cy - H / 2;
    this.radarGeo = { z, ox, oy, W, H };
    const x0 = Math.floor(ox / 256), x1 = Math.floor((ox + W) / 256), y0 = Math.floor(oy / 256), y1 = Math.floor((oy + H) / 256);
    this.tileList = [];
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) this.tileList.push([x, y, x * 256 - ox, y * 256 - oy]);
    const base = el.querySelector('.base');
    for (const layer of ['uscounties', 'usstates']) {
      for (const [x, y, lx, ly] of this.tileList) {
        const img = new Image(); img.alt = '';
        img.src = `${IEM_BASE}/${layer}/${z}/${x}/${y}.png`;
        img.style.left = lx + 'px'; img.style.top = ly + 'px';
        if (layer === 'usstates') img.style.opacity = '.9';
        img.onerror = () => img.remove();
        base.appendChild(img);
      }
    }
    const labels = el.querySelector('.labels');
    for (const [name, lat, lon, home, dy = 0] of CITIES) {
      const [wx, wy] = world(lat, lon);
      const lx = wx - ox, ly = wy - oy;
      if (lx < 20 || lx > W - 200 || ly < 30 || ly > H - 60) continue;
      const d = h('div', 'city' + (home ? ' home' : ''), esc(name));
      d.style.left = lx + 'px'; d.style.top = ly + 'px';
      if (dy) d.style.transform = `translate(-6px, calc(-50% + ${dy}px))`;
      labels.appendChild(d);
    }
    this.refreshRadar();
  }

  refreshRadar() {
    const el = this.segEls.radar.querySelector('.frames');
    el.innerHTML = '';
    const bust = Math.floor(Date.now() / RADAR_REFRESH);
    const names = [];
    for (let m = 55; m >= 5; m -= 5) names.push(`nexrad-n0q-m${String(m).padStart(2, '0')}m`);
    names.push('nexrad-n0q');
    this.radarFrames = names.map((n, i) => {
      const g = h('div', 'rframe'); g.style.position = 'absolute'; g.style.inset = '0';
      for (const [x, y, lx, ly] of this.tileList) {
        const img = new Image(); img.alt = '';
        img.src = `${IEM_RADAR}/${n}/${this.radarGeo.z}/${x}/${y}.png?${bust}`;
        img.onerror = () => { if (!img.dataset.retry) { img.dataset.retry = 1; img.src = `${IEM_RADAR}/${n.replace('nexrad-n0q', 'nexrad-n0q-900913')}/${this.radarGeo.z}/${x}/${y}.png?${bust}`; } else img.remove(); };
        img.style.left = lx + 'px'; img.style.top = ly + 'px';
        g.appendChild(img);
      }
      g.dataset.mins = (names.length - 1 - i) * 5;
      el.appendChild(g);
      return g;
    });
  }

  playRadar() {
    clearTimeout(this.radarTimer);
    let i = 0;
    const now = new Date();
    const base = new Date(Math.floor(now.getTime() / 300000) * 300000);
    const step = () => {
      if (!this.alive || !this.radarFrames) return;
      this.radarFrames.forEach((f, j) => f.classList.toggle('on', j === i));
      const mins = +this.radarFrames[i].dataset.mins;
      this.segEls.radar.querySelector('.rtime').textContent = fmtTime(new Date(base.getTime() - mins * 60000), false);
      const last = i === this.radarFrames.length - 1;
      i = last ? 0 : i + 1;
      this.radarTimer = setTimeout(step, last ? 1800 : 420);
    };
    step();
  }
}
