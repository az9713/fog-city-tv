// Fog City TV: shell, router, remote/keyboard input, shared audio.
import { Home } from './home.js';
import { Weather } from './weather.js';
import { Fireplace } from './fireplace.js';
import { Gallery } from './gallery.js';
import { Talk, TalkChannel } from './talk.js';
import { store } from './util.js';

const stage = document.getElementById('stage');
const wrap = document.getElementById('screen-wrap');
const tvEl = document.getElementById('tv');
const powerScreen = document.getElementById('power-screen');
const crt = document.getElementById('crt-on');
const osdEl = document.getElementById('osd');

// ---------- scale the 1920x1080 stage to the window ----------
function fit() {
  const fs = document.body.classList.contains('fs');
  const remoteW = fs ? 0 : (window.innerWidth > 700 ? 180 : 0);
  const pad = fs ? 0 : 60;
  const availW = window.innerWidth - remoteW - pad - 28;
  const availH = window.innerHeight - pad - 28 - (window.innerWidth > 700 || fs ? 0 : 260);
  const s = Math.max(0.1, Math.min(availW / 1920, availH / 1080));
  wrap.style.width = `${1920 * s}px`;
  wrap.style.height = `${1080 * s}px`;
  stage.style.transform = `scale(${s})`;
}
window.addEventListener('resize', fit);
document.addEventListener('fullscreenchange', () => {
  document.body.classList.toggle('fs', !!document.fullscreenElement);
  fit();
});
fit();

// ---------- shared audio ----------
export const audio = {
  ctx: null,
  master: null,
  volume: store.get('volume', 0.7),
  muted: false,
  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 3;
    this.master.connect(comp).connect(this.ctx.destination);
  },
  apply() {
    if (!this.master) return;
    const v = this.muted ? 0 : this.volume;
    this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    document.querySelectorAll('video').forEach(v2 => { v2.muted = true; });
  },
  change(d) {
    this.volume = Math.max(0, Math.min(1, Math.round((this.volume + d) * 20) / 20));
    this.muted = false; this.apply(); store.set('volume', this.volume);
    osd(`Volume ${Math.round(this.volume * 100)}`, this.volume);
  },
  toggleMute() { this.muted = !this.muted; this.apply(); osd(this.muted ? 'Muted' : `Volume ${Math.round(this.volume * 100)}`, this.muted ? 0 : this.volume); },
};

// ---------- on-screen display ----------
let osdTimer;
export function osd(text, level) {
  osdEl.innerHTML = `<div>${text}</div>` + (level != null ? `<div class="bar"><i style="width:${Math.round(level * 100)}%"></i></div>` : '');
  osdEl.classList.remove('hidden');
  clearTimeout(osdTimer);
  osdTimer = setTimeout(() => osdEl.classList.add('hidden'), 1800);
}

// ---------- router ----------
let talk;   // Fog City Talk overlay, created below; it stays on screen across channel changes
const channels = { home: Home, weather: Weather, fireplace: Fireplace, gallery: Gallery, talk: TalkChannel };
let current = null; let currentName = null;
let on = false;

export function go(name) {
  if (current) { try { current.unmount(); } catch (e) { console.error(e); } current.el.remove(); }
  const C = channels[name];
  current = new C({ go, audio, osd, talk });
  currentName = name;
  stage.insertBefore(current.el, osdEl);
  current.mount();
  store.set('lastChannel', name);
}

function powerOn() {
  if (on) return;
  on = true;
  audio.init();
  tvEl.classList.add('on');
  powerScreen.classList.add('hidden');
  crt.classList.remove('run'); void crt.offsetWidth; crt.classList.add('run');
  const hash = location.hash.replace('#', '');
  go(channels[hash] ? hash : 'home');
}
function powerOff() {
  if (!on) return;
  on = false;
  if (current) { current.unmount(); current.el.remove(); current = null; }
  talk.close();
  tvEl.classList.remove('on');
  powerScreen.classList.remove('hidden');
  if (audio.ctx) audio.ctx.suspend();
}
export function sleepTv() { powerOff(); }

// ---------- input ----------
const keymap = {
  ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight',
  Enter: 'Enter', ' ': 'Enter', Escape: 'Back', Backspace: 'Back',
  h: 'Home', H: 'Home', m: 'Mute', M: 'Mute', '+': 'VolUp', '=': 'VolUp', '-': 'VolDown', _: 'VolDown',
  f: 'Fullscreen', F: 'Fullscreen', p: 'Power', P: 'Power', t: 'Talk', T: 'Talk',
};

function handle(key) {
  if (key === 'Fullscreen') {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.().catch(() => {});
    return;
  }
  if (key === 'Power') { on ? powerOff() : powerOn(); return; }
  if (!on) { powerOn(); return; }
  audio.init();
  if (talk.onKey(key)) return;                                   // talk overlay consumed it
  if (key === 'Talk') { talk.show(); return; }
  if (current && current.onKey && current.onKey(key)) return;   // channel consumed it
  if (key === 'VolUp') audio.change(+0.05);
  else if (key === 'VolDown') audio.change(-0.05);
  else if (key === 'Mute') audio.toggleMute();
  else if (key === 'Home' || key === 'Back') { if (currentName !== 'home') go('home'); }
}

window.addEventListener('keydown', e => {
  if (e.target.closest?.('input, textarea')) return;   // typing in the talk box
  const k = keymap[e.key];
  if (!k) return;
  e.preventDefault();
  handle(k);
});
document.getElementById('remote').addEventListener('click', e => {
  const b = e.target.closest('button[data-key]');
  if (b) handle(b.dataset.key);
});
powerScreen.addEventListener('click', () => handle('Enter'));
stage.addEventListener('click', e => {
  if (!on || !current?.onClick || e.target.closest('.talk')) return;
  current.onClick(e);
});

talk = new Talk({ go, audio, osd, state: () => ({ channel: currentName, current }) });
stage.insertBefore(talk.el, osdEl);

window.tvApp = { go, handle, audio, talk };
