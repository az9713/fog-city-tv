// Animated pixel-art weather icons drawn on a 32x32 grid, scaled up with pixelated rendering.
// kinds: clear, partly, cloudy, fog, rain, showers, storm, snow, windy  (+ night flag)

const P = {
  sun: '#ffd21f', sunEdge: '#ff9a00', moon: '#f4f0c8', moonEdge: '#b9b38a',
  cloud: '#f2f4ff', cloudShade: '#a9b2d6', dark: '#7c84a8', darkShade: '#4b5275',
  rain: '#5fc8ff', snow: '#ffffff', bolt: '#fff26b', fog: '#d9dcef',
};

function px(c, x, y, col) { c.fillStyle = col; c.fillRect(x, y, 1, 1); }
function disc(c, cx, cy, r, col) {
  c.fillStyle = col;
  for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) if (x * x + y * y <= r * r + r * 0.6) c.fillRect(cx + x, cy + y, 1, 1);
}
function sun(c, cx, cy, r, t) {
  const n = 8, phase = t / 1600;
  for (let i = 0; i < n; i++) {
    const a = phase + i * Math.PI * 2 / n;
    const len = 2 + ((Math.sin(t / 250 + i) + 1) > 1 ? 1 : 0);
    for (let k = 0; k < len; k++) {
      const d = r + 2 + k;
      px(c, Math.round(cx + Math.cos(a) * d), Math.round(cy + Math.sin(a) * d), P.sunEdge);
    }
  }
  disc(c, cx, cy, r, P.sunEdge);
  disc(c, cx, cy, r - 1, P.sun);
  px(c, cx - 2, cy - 2, '#fff8b0'); px(c, cx - 1, cy - 2, '#fff8b0');
}
function moon(c, cx, cy, r) {
  disc(c, cx, cy, r, P.moonEdge);
  disc(c, cx, cy, r - 1, P.moon);
  disc(c, cx + 3, cy - 2, r - 1, 'rgba(0,0,0,0)');
  c.save(); c.globalCompositeOperation = 'destination-out'; disc(c, cx + 3, cy - 2, r - 1, '#000'); c.restore();
}
function cloud(c, x, y, dark, w = 1) {
  const main = dark ? P.dark : P.cloud, shade = dark ? P.darkShade : P.cloudShade;
  const blobs = [[x + 5, y + 5, 4], [x + 11, y + 3, 5], [x + 17, y + 5, 4], [x + 21 * w, y + 7, 3]];
  blobs.forEach(([bx, by, r]) => disc(c, bx, by + 1, r, shade));
  c.fillStyle = shade; c.fillRect(x + 2, y + 7, 21 * w, 4);
  blobs.forEach(([bx, by, r]) => disc(c, bx, by, r, main));
  c.fillStyle = main; c.fillRect(x + 2, y + 6, 21 * w, 4);
}

export function drawIcon(canvas, kind, t, night = false) {
  const c = canvas.getContext('2d');
  c.clearRect(0, 0, 32, 32);
  const celestial = (cx, cy, r) => night ? moon(c, cx, cy, r) : sun(c, cx, cy, r, t);
  switch (kind) {
    case 'clear': celestial(16, 16, 7); break;
    case 'windy': {
      celestial(10, 10, 5);
      c.fillStyle = P.cloud;
      for (let i = 0; i < 3; i++) {
        const off = ((t / 60) + i * 11) % 40 - 8;
        c.fillRect(Math.round(off), 18 + i * 4, 12, 1);
      }
      break;
    }
    case 'partly': celestial(11, 11, 6); cloud(c, 6, 15, false, .95); break;
    case 'cloudy': cloud(c, 1, 6, true, .8); cloud(c, 6, 13, false); break;
    case 'fog': {
      cloud(c, 4, 4, false, .9);
      c.fillStyle = P.fog;
      for (let i = 0; i < 4; i++) {
        const off = Math.round(Math.sin(t / 700 + i) * 3);
        c.fillRect(4 + off + (i % 2) * 3, 18 + i * 3, 20, 1);
      }
      break;
    }
    case 'showers': case 'rain': {
      if (kind === 'showers') celestial(23, 7, 4);
      cloud(c, 3, 4, kind === 'rain');
      c.fillStyle = P.rain;
      const drops = kind === 'rain' ? 7 : 4;
      for (let i = 0; i < drops; i++) {
        const x = 5 + i * 3;
        const y = 17 + ((t / 45 + i * 5) % 13);
        c.fillRect(x - Math.floor((y - 17) / 5), Math.floor(y), 1, 2);
      }
      break;
    }
    case 'storm': {
      cloud(c, 3, 3, true);
      c.fillStyle = P.rain;
      for (let i = 0; i < 5; i++) { const y = 17 + ((t / 40 + i * 7) % 13); c.fillRect(4 + i * 5, Math.floor(y), 1, 2); }
      if ((t % 1800) < 260 || ((t % 1800) > 380 && (t % 1800) < 480)) {
        c.fillStyle = P.bolt;
        [[16, 14], [15, 15], [14, 16], [14, 17], [15, 17], [16, 17], [15, 18], [14, 19], [13, 20], [13, 21], [12, 22]].forEach(([x, y]) => c.fillRect(x, y, 2, 1));
      }
      break;
    }
    case 'snow': {
      cloud(c, 3, 4, false);
      for (let i = 0; i < 6; i++) {
        const x = 5 + i * 4 + Math.round(Math.sin(t / 400 + i) * 1.5);
        const y = 17 + ((t / 90 + i * 4) % 13);
        px(c, x, Math.floor(y), P.snow); px(c, x - 1, Math.floor(y), '#cfe'); px(c, x + 1, Math.floor(y), '#cfe');
      }
      break;
    }
    default: celestial(16, 16, 7);
  }
}

// Map NWS text to icon kinds.
export function classify(text = '') {
  const s = text.toLowerCase();
  if (/thunder|t-storm|tstorm/.test(s)) return 'storm';
  if (/snow|sleet|flurr|blizzard|ice pellets|freezing/.test(s)) return 'snow';
  if (/shower/.test(s)) return 'showers';
  if (/rain|drizzle/.test(s)) return 'rain';
  if (/fog|haze|smoke|mist|dust/.test(s)) return 'fog';
  if (/partly sunny|mostly cloudy/.test(s)) return 'cloudy';
  if (/partly cloudy|mostly sunny|mostly clear|few clouds/.test(s)) return 'partly';
  if (/cloud|overcast/.test(s)) return 'cloudy';
  if (/wind|breez|gust/.test(s)) return 'windy';
  return 'clear';
}

export function makeIconCanvas(size) {
  const cv = document.createElement('canvas');
  cv.width = 32; cv.height = 32; cv.className = 'icon';
  cv.style.width = cv.style.height = size + 'px';
  return cv;
}
