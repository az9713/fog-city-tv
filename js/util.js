// Shared helpers.
export const PLACE = { name: 'San Francisco', lat: 37.7749, lon: -122.4194, tz: 'America/Los_Angeles' };

export const store = {
  get(k, d) { try { const v = localStorage.getItem('tv.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('tv.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
};

export function h(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function fmtTime(d = new Date(), withSec = true) {
  return d.toLocaleTimeString('en-US', { timeZone: PLACE.tz, hour: 'numeric', minute: '2-digit', ...(withSec ? { second: '2-digit' } : {}) });
}
export function fmtDate(d = new Date()) {
  return d.toLocaleDateString('en-US', { timeZone: PLACE.tz, weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase();
}

// Solar elevation in degrees (NOAA simplified algorithm), used for night detection and gallery dimming.
export function sunElevation(date = new Date(), lat = PLACE.lat, lon = PLACE.lon) {
  const rad = Math.PI / 180;
  const jd = date.getTime() / 86400000 + 2440587.5;
  const n = jd - 2451545.0;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const dec = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const lst = (gmst * 15 + lon) * rad;
  const ha = lst - ra;
  const el = Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(ha));
  return el / rad;
}

export async function getJSON(url, { timeout = 12000 } = {}) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeout);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { Accept: 'application/geo+json, application/json' } });
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
