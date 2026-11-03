import { h, esc, store, fmtTime } from './util.js';

const APPS = [
  { id: 'weather', name: 'Weather Station', sub: 'San Francisco 24/7' },
  { id: 'gallery', name: 'Art Gallery', sub: 'Public-domain masters' },
  { id: 'fireplace', name: 'Fireplace', sub: 'Never-ending fire' },
];

export class Home {
  constructor({ go }) {
    this.go = go;
    this.el = h('div', 'layer home');
    this.idx = store.get('homeFocus', 0);
  }
  mount() {
    const wx = store.get('wxLast', null);
    const art = store.get('artLast', null);
    const sky = wx?.sky || 'sunny';
    this.el.innerHTML = `
      <div class="sky"></div><div class="sun"></div>
      <div class="ground"><div class="grid"></div></div><div class="horizon"></div>
      <div class="clock"></div><div class="date"></div>
      ${wx ? `<div class="wx-chip">${esc(wx.temp)}&deg;C &nbsp;<span style="opacity:.8;font-weight:500">${esc(wx.cond)}</span></div>` : ''}
      <div class="row-label">MY APPS</div>
      <div class="tiles">
        <div class="tile" data-id="weather"><img src="assets/skycam/${sky}.jpg" alt=""><div class="shade"></div><div class="sub">${APPS[0].sub}</div><div class="name">${APPS[0].name}</div></div>
        <div class="tile" data-id="gallery">${art?.thumb ? `<img src="${esc(art.thumb)}" alt="">` : '<div style="position:absolute;inset:0;background:linear-gradient(135deg,#6b4b2a,#c9a46a 50%,#3d2a18)"></div>'}<div class="shade"></div><div class="sub">${APPS[1].sub}</div><div class="name">${APPS[1].name}</div></div>
        <div class="tile" data-id="fireplace"><video src="assets/fireplace/fire.mp4" poster="assets/fireplace/poster.jpg" muted loop autoplay playsinline></video><div class="shade"></div><div class="sub">${APPS[2].sub}</div><div class="name">${APPS[2].name}</div></div>
      </div>
      <div class="footer">ARROWS TO MOVE &middot; OK TO OPEN &middot; F FULL SCREEN &middot; H HOME</div>`;
    this.tiles = [...this.el.querySelectorAll('.tile')];
    this.tick = () => {
      const now = new Date();
      this.el.querySelector('.clock').textContent = fmtTime(now, false).replace(/\s?[AP]M/, '');
      this.el.querySelector('.date').textContent = now.toLocaleDateString('en-US', { timeZone: 'America/Los_Angeles', weekday: 'long', month: 'long', day: 'numeric' });
    };
    this.tick();
    this.timer = setInterval(this.tick, 1000);
    this.paint();
  }
  paint() { this.tiles.forEach((t, i) => t.classList.toggle('focus', i === this.idx)); store.set('homeFocus', this.idx); }
  onKey(k) {
    if (k === 'ArrowLeft') { this.idx = (this.idx + this.tiles.length - 1) % this.tiles.length; this.paint(); return true; }
    if (k === 'ArrowRight') { this.idx = (this.idx + 1) % this.tiles.length; this.paint(); return true; }
    if (k === 'Enter') { this.go(APPS[this.idx].id); return true; }
    if (k === 'Back') return true;
    return false;
  }
  onClick(e) {
    const t = e.target.closest('.tile');
    if (!t) return;
    const i = this.tiles.indexOf(t);
    if (i === this.idx) this.go(APPS[i].id); else { this.idx = i; this.paint(); }
  }
  unmount() { clearInterval(this.timer); }
}
