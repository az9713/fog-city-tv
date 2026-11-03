// The Never-Ending Fireplace: a photoreal 10 s fire loop (first frame = last frame) played by two
// video elements that crossfade at the seam, plus a procedural crackle soundscape whose events
// follow a Poisson process, so picture and sound never repeat the same way.
import { h, store } from './util.js';

const FADE = 0.6; // seconds of crossfade at the loop point

function createCrackle(audio) {
  const ctx = audio.ctx;
  const out = ctx.createGain(); out.gain.value = 0;
  out.connect(audio.master);
  const sr = ctx.sampleRate;

  // noise buffers (lengths chosen so the roar and hiss beds are 23 s and 29 s: coprime, no audible loop)
  const mk = (sec, brown) => {
    const b = ctx.createBuffer(1, Math.floor(sr * sec), sr); const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w; }
    return b;
  };
  const brown = mk(23, true), white = mk(29, false), burst = mk(1, false);

  const roar = ctx.createBufferSource(); roar.buffer = brown; roar.loop = true;
  const roarLP = ctx.createBiquadFilter(); roarLP.type = 'lowpass'; roarLP.frequency.value = 380;
  const roarG = ctx.createGain(); roarG.gain.value = 0.55;
  roar.connect(roarLP).connect(roarG).connect(out);

  const hiss = ctx.createBufferSource(); hiss.buffer = white; hiss.loop = true;
  const hissHP = ctx.createBiquadFilter(); hissHP.type = 'highpass'; hissHP.frequency.value = 5200;
  const hissG = ctx.createGain(); hissG.gain.value = 0.012;
  hiss.connect(hissHP).connect(hissG).connect(out);
  roar.start(); hiss.start();

  function click(t, freq, amp, dur) {
    const s = ctx.createBufferSource(); s.buffer = burst;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 1.2 + Math.random() * 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(amp, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const p = ctx.createStereoPanner(); p.pan.value = (Math.random() - 0.5) * 0.9;
    s.connect(bp).connect(g).connect(p).connect(out);
    s.start(t, Math.random() * 0.9, dur + 0.02);
  }
  function settle(t) {   // a log shifts: low thump + crumbling embers + a burst of crackles
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(75, t); o.frequency.exponentialRampToValueAtTime(38, t + 0.35);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.5, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(out); o.start(t); o.stop(t + 0.6);
    const s = ctx.createBufferSource(); s.buffer = white;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400;
    const g2 = ctx.createGain(); g2.gain.setValueAtTime(0.0001, t); g2.gain.linearRampToValueAtTime(0.12, t + 0.05); g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    s.connect(lp).connect(g2).connect(out); s.start(t, Math.random() * 20, 1);
    for (let i = 0; i < 14; i++) click(t + 0.05 + Math.random() * 0.8, 1500 + Math.random() * 4000, 0.15 + Math.random() * 0.25, 0.006 + Math.random() * 0.01);
  }

  let next = ctx.currentTime + 0.2, nextPop = ctx.currentTime + 2, nextSettle = ctx.currentTime + 40 + Math.random() * 60;
  const exp = rate => -Math.log(1 - Math.random()) / rate;   // Poisson inter-arrival time
  const timer = setInterval(() => {
    const horizon = ctx.currentTime + 0.3;
    while (next < horizon) {
      const big = Math.random() < 0.12;
      click(next, 1800 + Math.random() * 5000, (big ? 0.25 : 0.06) * (0.4 + Math.random()), big ? 0.012 : 0.004 + Math.random() * 0.006);
      next += Math.random() < 0.18 ? 0.01 + Math.random() * 0.03 : exp(7);   // clusters + Poisson
    }
    while (nextPop < horizon) {
      click(nextPop, 700 + Math.random() * 1400, 0.45 + Math.random() * 0.35, 0.03 + Math.random() * 0.03);
      nextPop += exp(0.18);
    }
    if (nextSettle < horizon) { settle(nextSettle); nextSettle += 60 + Math.random() * 120; }
    // slow breathing of the roar
    roarG.gain.setTargetAtTime(0.4 + Math.random() * 0.3, ctx.currentTime, 1.5);
    roarLP.frequency.setTargetAtTime(300 + Math.random() * 180, ctx.currentTime, 2);
  }, 100);

  return {
    out,
    setLevel(v, time = 0.3) { out.gain.setTargetAtTime(v, ctx.currentTime, time); },
    stop() { clearInterval(timer); out.gain.setTargetAtTime(0, ctx.currentTime, 0.2); setTimeout(() => { try { roar.stop(); hiss.stop(); } catch { } out.disconnect(); }, 1200); },
  };
}

const TIMERS = [['Off', 0], ['30 min', 30], ['1 hr', 60], ['2 hr', 120]];

export class Fireplace {
  constructor({ go, audio, osd }) {
    this.go = go; this.audio = audio; this.osd = osd;
    this.el = h('div', 'layer fire');
    this.level = store.get('crackle', 0.8);
    this.menuOpen = false; this.menuIdx = 0; this.sleepAt = 0;
  }
  mount() {
    this.el.innerHTML = `
      <video class="va" src="assets/fireplace/fire.mp4" poster="assets/fireplace/poster.jpg" muted playsinline preload="auto"></video>
      <video class="vb" src="assets/fireplace/fire.mp4" muted playsinline preload="auto" style="opacity:0"></video>
      <div class="dim"></div>
      <div class="timer-chip hidden"></div>
      <div class="hint"><span>&#9650;</span><span>OK</span><span>&#9660;</span></div>`;
    this.vids = [...this.el.querySelectorAll('video')];
    this.active = 0;
    this.vids[0].play().catch(() => {});
    this.raf = requestAnimationFrame(this.tick = () => {
      const a = this.vids[this.active], b = this.vids[1 - this.active];
      if (a.duration && a.currentTime > a.duration - FADE && b.paused) {
        b.currentTime = 0; b.play().catch(() => {});
        b.style.transition = `opacity ${FADE}s linear`; b.style.opacity = 1;
        a.style.transition = `opacity ${FADE}s linear`;
        setTimeout(() => { a.pause(); a.style.opacity = 0; }, FADE * 1000 + 50);
        b.style.zIndex = 1; a.style.zIndex = 0;
        this.active = 1 - this.active;
      }
      this.checkSleep();
      this.raf = requestAnimationFrame(this.tick);
    });
    if (this.audio.ctx) { this.crackle = createCrackle(this.audio); this.crackle.setLevel(this.level, 1.2); }
    this.hintTimer = setTimeout(() => { const hEl = this.el.querySelector('.hint'); if (hEl) hEl.style.opacity = 0; }, 6000);
  }
  unmount() {
    cancelAnimationFrame(this.raf); clearTimeout(this.hintTimer);
    this.vids.forEach(v => { v.pause(); v.removeAttribute('src'); v.load(); });
    this.crackle?.stop();
  }
  checkSleep() {
    if (!this.sleepAt) return;
    const left = this.sleepAt - Date.now();
    const chip = this.el.querySelector('.timer-chip');
    chip.classList.remove('hidden');
    chip.textContent = `Sleep in ${Math.max(0, Math.ceil(left / 60000))} min`;
    const fadeWin = 60000;
    const f = left < fadeWin ? Math.max(0, left / fadeWin) : 1;
    this.el.querySelector('.dim').style.opacity = String(1 - f);
    this.crackle?.setLevel(this.level * f, 0.5);
    if (left <= 0) { this.sleepAt = 0; window.tvApp.handle('Power'); }
  }
  setSleep(mins, label = `${mins} min`) {
    this.sleepAt = mins ? Date.now() + mins * 60000 : 0;
    if (!mins) { this.el.querySelector('.timer-chip').classList.add('hidden'); this.el.querySelector('.dim').style.opacity = 0; this.crackle?.setLevel(this.level); }
    this.osd(mins ? `Fire fades out in ${label}` : 'Sleep timer off');
  }
  setLevel(d) {
    this.level = Math.max(0, Math.min(1, Math.round((this.level + d) * 10) / 10));
    store.set('crackle', this.level);
    this.crackle?.setLevel(this.level);
    this.osd(`Crackle ${Math.round(this.level * 100)}`, this.level);
  }
  renderMenu() {
    let m = this.el.querySelector('.menu');
    if (!this.menuOpen) { m?.remove(); return; }
    if (!m) { m = h('div', 'menu'); this.el.appendChild(m); }
    m.innerHTML = `<h4>Sleep timer</h4>${TIMERS.map(([n], i) => `<div class="${i === this.menuIdx ? 'sel' : ''}">${n}</div>`).join('')}`;
  }
  onKey(k) {
    if (this.menuOpen) {
      if (k === 'ArrowUp') { this.menuIdx = (this.menuIdx + TIMERS.length - 1) % TIMERS.length; this.renderMenu(); return true; }
      if (k === 'ArrowDown') { this.menuIdx = (this.menuIdx + 1) % TIMERS.length; this.renderMenu(); return true; }
      if (k === 'Enter') {
        this.setSleep(TIMERS[this.menuIdx][1], TIMERS[this.menuIdx][0]);
        this.menuOpen = false; this.renderMenu(); return true;
      }
      if (k === 'Back') { this.menuOpen = false; this.renderMenu(); return true; }
      return true;
    }
    if (k === 'ArrowUp') { this.setLevel(+0.1); return true; }
    if (k === 'ArrowDown') { this.setLevel(-0.1); return true; }
    if (k === 'Enter') { this.menuOpen = true; this.menuIdx = 0; this.renderMenu(); return true; }
    return false;
  }
}
