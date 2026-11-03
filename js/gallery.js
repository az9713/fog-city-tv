// Fog City Art Gallery: public-domain paintings from the Art Institute of Chicago (CC0 images via IIIF),
// shown matted like a framed print, with categories, a seasonal mode, mat colors and sizes, and
// automatic dimming after sunset.
import { h, esc, store, getJSON, sunElevation } from './util.js';

const API = 'https://api.artic.edu/api/v1/artworks/search';
const IIIF = 'https://www.artic.edu/iiif/2';
const FIELDS = 'id,title,artist_title,date_display,image_id,classification_title,is_public_domain';

function seasonQuery(d = new Date()) {
  const m = d.getMonth();
  if (m === 11) return { label: 'Winter holidays', q: 'winter snow' };
  if (m <= 1) return { label: 'Winter', q: 'snow winter landscape' };
  if (m <= 4) return { label: 'Spring', q: 'spring garden blossoms' };
  if (m <= 7) return { label: 'Summer', q: 'summer beach' };
  return { label: 'Autumn', q: 'autumn harvest' };
}

const CATS = [
  { id: 'season', name: 'This Season', q: () => seasonQuery().q },
  { id: 'all', name: 'All Works', q: () => 'impressionism' },
  { id: 'landscapes', name: 'Landscapes', q: () => 'landscape' },
  { id: 'coastal', name: 'Coastal', q: () => 'sea coast' },
  { id: 'botanical', name: 'Botanical', q: () => 'flowers still life' },
  { id: 'city', name: 'City Life', q: () => 'city street paris' },
  { id: 'abstract', name: 'Abstract', q: () => 'abstraction' },
];
const MATS = [
  ['Gallery White', '#f3f0e8', null], ['Ivory', '#ece2cc', null], ['Linen', '#ddd5c3', null],
  ['Ivory & Gold', '#ece2cc', '#c9a24d'], ['Charcoal', '#2f2e2c', null], ['Black', '#111', null],
  ['Black & Gold', '#111', '#c9a24d'], ['Navy', '#1b2536', null], ['Sage', '#a7b09a', null],
];
const SIZES = [['No Mat', 0], ['Thin', 46], ['Classic', 96], ['Wide', 150], ['Museum', 210]];
const CHANGE = [['Off', 0], ['Every 5 min', 5], ['Every 15 min', 15], ['Hourly', 60], ['Daily', 1440]];
const ONOFF = [['On', true], ['Off', false]];

const FALLBACK = ['sunny', 'fog', 'night', 'storm', 'rain', 'overcast'].map(k => ({
  id: 'local-' + k, title: `San Francisco, ${k}`, artist_title: "Fog City Sky Cam", date_display: '2026', src: `assets/skycam/${k}.jpg`, thumb: `assets/skycam/${k}.jpg`,
}));

export class Gallery {
  constructor({ go, audio, osd }) {
    this.go = go; this.osd = osd;
    this.el = h('div', 'layer gal');
    this.s = Object.assign({ cat: 'season', mat: 0, size: 2, change: 3, dim: true, caption: true }, store.get('gallery', {}));
    this.works = []; this.idx = 0;
    this.menu = null;   // { side: i, pane: false, opt: j }
  }
  save() { store.set('gallery', this.s); }

  mount() {
    this.el.innerHTML = `<div class="wallpaper"></div><div class="art"></div><div class="status">Opening the collection&hellip;</div><div class="caption" style="opacity:0"></div><div class="night" style="opacity:0"></div>`;
    this.artEl = this.el.querySelector('.art');
    this.loadCat(this.s.cat);
    this.dimTimer = setInterval(() => this.applyDim(), 60000);
    this.applyDim();
  }
  unmount() { clearInterval(this.dimTimer); clearTimeout(this.changeTimer); clearTimeout(this.capTimer); }

  async fetchCat(cat) {
    const key = 'aic.' + cat.id + '.' + (cat.id === 'season' ? seasonQuery().label : '');
    const cached = store.get(key, null);
    if (cached && Date.now() - cached.at < 7 * 864e5 && cached.items.length) return cached.items;
    const url = `${API}?q=${encodeURIComponent(cat.q())}&query[term][is_public_domain]=true&fields=${FIELDS}&limit=60`;
    const j = await getJSON(url);
    const items = (j.data || []).filter(a => a.image_id && a.is_public_domain && /painting/i.test(a.classification_title || ''))
      .map(a => ({ id: a.id, title: a.title, artist_title: a.artist_title, date_display: a.date_display, src: `${IIIF}/${a.image_id}/full/1686,/0/default.jpg`, thumb: `${IIIF}/${a.image_id}/full/400,/0/default.jpg` }));
    if (items.length) store.set(key, { at: Date.now(), items });
    return items;
  }

  async loadCat(id) {
    const cat = CATS.find(c => c.id === id) || CATS[0];
    this.s.cat = cat.id; this.save();
    const status = this.el.querySelector('.status');
    try {
      this.works = await this.fetchCat(cat);
      if (!this.works.length) throw new Error('empty');
      status.textContent = '';
    } catch (e) {
      console.warn('AIC fetch failed', e);
      this.works = FALLBACK;
      status.textContent = '';
      this.osd('Museum collection offline: showing local photos');
    }
    // shuffle so each visit differs
    for (let i = this.works.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [this.works[i], this.works[j]] = [this.works[j], this.works[i]]; }
    this.idx = 0;
    this.show();
  }

  show() {
    const w = this.works[this.idx]; if (!w) return;
    const [, matCol, gold] = MATS[this.s.mat];
    const pad = SIZES[this.s.size][1];
    const maxW = 1920 - 2 * pad - 160, maxH = 1080 - 2 * pad - 140;
    const frame = h('div', 'mat' + (pad === 0 ? ' nomat' : ''));
    frame.style.background = pad ? matCol : '#0d0d0d';
    frame.style.padding = (pad || 14) + 'px';
    const img = new Image();
    img.alt = w.title; img.style.maxWidth = maxW + 'px'; img.style.maxHeight = maxH + 'px';
    const bevel = h('div', 'bevel');
    if (gold && pad) bevel.style.outline = `5px solid ${gold}`, bevel.style.outlineOffset = '12px';
    bevel.appendChild(img); bevel.appendChild(h('div', 'canvas-tex'));
    frame.appendChild(bevel);
    const layer = h('div', 'art'); layer.style.opacity = 0; layer.appendChild(frame);
    img.onload = () => {
      const old = this.artEl;
      this.el.insertBefore(layer, this.el.querySelector('.status'));
      requestAnimationFrame(() => { layer.style.opacity = 1; old.style.opacity = 0; });
      setTimeout(() => old.remove(), 1300);
      this.artEl = layer;
      this.showCaption(w);
      store.set('artLast', { thumb: w.thumb });
    };
    img.onerror = () => { this.works.splice(this.idx, 1); if (this.works.length) { this.idx %= this.works.length; this.show(); } };
    img.src = w.src;
    clearTimeout(this.changeTimer);
    const mins = CHANGE[this.s.change][1];
    if (mins) this.changeTimer = setTimeout(() => this.step(1), mins * 60000);
  }

  showCaption(w) {
    const c = this.el.querySelector('.caption');
    if (!this.s.caption) { c.style.opacity = 0; return; }
    c.innerHTML = `<b>${esc(w.title)}</b><span>${esc(w.artist_title || 'Unknown artist')}${w.date_display ? ', ' + esc(w.date_display) : ''} · Art Institute of Chicago, public domain</span>`;
    if (w.id.toString().startsWith('local')) c.querySelector('span').textContent = "Fog City Sky Cam";
    c.style.opacity = 1;
    clearTimeout(this.capTimer);
    this.capTimer = setTimeout(() => { c.style.opacity = 0; }, 9000);
  }

  step(d) { if (!this.works.length) return; this.idx = (this.idx + d + this.works.length) % this.works.length; this.show(); }

  applyDim() {
    const n = this.el.querySelector('.night');
    if (!this.s.dim) { n.style.opacity = 0; return; }
    const e = sunElevation();
    n.style.opacity = e < -6 ? 0.5 : e < 0 ? 0.3 : 0;
  }

  // ---------- menu ----------
  sideItems() {
    return [
      ...CATS.map(c => ({ type: 'cat', id: c.id, label: c.name, value: c.id === 'season' ? seasonQuery().label : '' })),
      { type: 'sep' },
      { type: 'mat', label: 'Mat', value: MATS[this.s.mat][0] },
      { type: 'size', label: 'Mat Size', value: SIZES[this.s.size][0] },
      { type: 'change', label: 'Change Art', value: CHANGE[this.s.change][0] },
      { type: 'dim', label: 'Auto-Dim', value: this.s.dim ? 'On' : 'Off' },
      { type: 'caption', label: 'Captions', value: this.s.caption ? 'On' : 'Off' },
    ];
  }
  openMenu() { this.menu = { side: Math.max(0, CATS.findIndex(c => c.id === this.s.cat)), pane: false, opt: 0 }; this.renderMenu(); }
  closeMenu() { this.menu = null; this.el.querySelector('.menu')?.remove(); }

  paneOptions(item) {
    if (item.type === 'mat') return MATS.map(m => m[0]);
    if (item.type === 'size') return SIZES.map(s => s[0]);
    if (item.type === 'change') return CHANGE.map(c => c[0]);
    if (item.type === 'dim' || item.type === 'caption') return ONOFF.map(o => o[0]);
    return [];
  }
  curOpt(item) {
    return { mat: this.s.mat, size: this.s.size, change: this.s.change, dim: this.s.dim ? 0 : 1, caption: this.s.caption ? 0 : 1 }[item.type];
  }

  renderMenu() {
    let m = this.el.querySelector('.menu');
    if (!m) { m = h('div', 'menu'); this.el.appendChild(m); }
    const items = this.sideItems();
    const it = items[this.menu.side];
    const side = items.map((x, i) => x.type === 'sep' ? '<div class="sep"></div>'
      : `<div class="item ${i === this.menu.side && !this.menu.pane ? 'focus' : ''} ${x.type === 'cat' && x.id === this.s.cat ? 'cur' : ''}">${esc(x.label)}${x.value ? `<em>${esc(x.value)}</em>` : ''}</div>`).join('');
    let pane = '';
    const thumb = this.works[this.idx]?.thumb || '';
    if (it.type === 'cat') {
      pane = `<h3>${esc(it.label)}</h3><div class="note">Press OK to show this collection. Left and right on the remote change the painting.</div>`;
    } else if (it.type === 'mat' || it.type === 'size') {
      const opts = this.paneOptions(it);
      pane = `<h3>${esc(it.label)}</h3><div class="note">Previewed with the painting on the wall.</div><div class="opts">${opts.map((name, j) => {
        const [, col, gold] = it.type === 'mat' ? MATS[j] : MATS[this.s.mat];
        const p = (it.type === 'size' ? SIZES[j][1] : SIZES[this.s.size][1]) / 5;
        const style = `background:${p ? col : '#0d0d0d'};padding:${Math.max(p, 4)}px;`;
        const inner = gold && p ? `outline:2px solid ${gold};outline-offset:3px;` : '';
        return `<div class="opt ${this.menu.pane && j === this.menu.opt ? 'focus' : ''} ${j === this.curOpt(it) ? 'cur' : ''}" style="${style}"><img src="${esc(thumb)}" alt="" style="${inner}max-height:${200 - 2 * Math.max(p, 4)}px"><label>${esc(name)}</label></div>`;
      }).join('')}</div>`;
    } else {
      const opts = this.paneOptions(it);
      pane = `<h3>${esc(it.label)}</h3><div class="note">${it.type === 'dim' ? 'Dims the picture after sunset in San Francisco.' : it.type === 'change' ? 'How often a new painting is hung.' : 'Show title and artist for a few seconds after each change.'}</div>
        <div class="list-opts">${opts.map((o, j) => `<div class="${this.menu.pane && j === this.menu.opt ? 'focus' : ''} ${j === this.curOpt(it) ? 'cur' : ''}">${esc(o)}</div>`).join('')}</div>`;
    }
    m.innerHTML = `<div class="side"><h2>The Collection</h2>${side}</div><div class="pane">${pane}</div>`;
  }

  applyOpt(item, j) {
    if (item.type === 'mat') this.s.mat = j;
    if (item.type === 'size') this.s.size = j;
    if (item.type === 'change') this.s.change = j;
    if (item.type === 'dim') { this.s.dim = j === 0; this.applyDim(); }
    if (item.type === 'caption') this.s.caption = j === 0;
    this.save(); this.show();
  }

  onKey(k) {
    if (!this.menu) {
      if (k === 'Enter') { this.openMenu(); return true; }
      if (k === 'ArrowRight') { this.step(1); return true; }
      if (k === 'ArrowLeft') { this.step(-1); return true; }
      if (k === 'ArrowUp' || k === 'ArrowDown') { this.showCaption(this.works[this.idx] || {}); return true; }
      return false;
    }
    const items = this.sideItems();
    const it = items[this.menu.side];
    if (!this.menu.pane) {
      const move = d => { let i = this.menu.side; do { i = (i + d + items.length) % items.length; } while (items[i].type === 'sep'); this.menu.side = i; };
      if (k === 'ArrowUp') move(-1);
      else if (k === 'ArrowDown') move(1);
      else if (k === 'Back' || k === 'ArrowLeft') { this.closeMenu(); return true; }
      else if (k === 'Enter' || k === 'ArrowRight') {
        if (it.type === 'cat') { if (k === 'Enter') { this.closeMenu(); this.loadCat(it.id); return true; } }
        else { this.menu.pane = true; this.menu.opt = this.curOpt(it); }
      }
      this.renderMenu(); return true;
    }
    const n = this.paneOptions(it).length;
    const grid = it.type === 'mat' || it.type === 'size';
    if (k === 'Back') { this.menu.pane = false; }
    else if (k === 'ArrowLeft') { if (grid && this.menu.opt % 3) this.menu.opt--; else this.menu.pane = false; }
    else if (k === 'ArrowRight') { if (grid && this.menu.opt % 3 < 2 && this.menu.opt + 1 < n) this.menu.opt++; }
    else if (k === 'ArrowUp') { this.menu.opt = Math.max(0, this.menu.opt - (grid ? 3 : 1)); }
    else if (k === 'ArrowDown') { this.menu.opt = Math.min(n - 1, this.menu.opt + (grid ? 3 : 1)); }
    else if (k === 'Enter') { this.applyOpt(it, this.menu.opt); }
    this.renderMenu(); return true;
  }
}
