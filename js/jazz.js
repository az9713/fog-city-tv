// Generative smooth jazz in Web Audio: FM electric piano comping, walking bass, brushes, and a
// sparse lead line. Original music made from scratch; never loops the same way twice.

const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

// 8-bar progression in F: voicings (rootless, mid register), bass root, scale for melody
const PROG = [
  { v: [57, 60, 64, 67], root: 41, third: 45, fifth: 48 },  // Fmaj9
  { v: [53, 57, 60, 64], root: 38, third: 41, fifth: 45 },  // Dm9
  { v: [58, 62, 65, 69], root: 43, third: 46, fifth: 50 },  // Gm9
  { v: [58, 64, 69, 74], root: 36, third: 40, fifth: 43 },  // C13
  { v: [55, 60, 64, 69], root: 45, third: 48, fifth: 52 },  // Am7(11)
  { v: [54, 60, 65, 70], root: 38, third: 42, fifth: 45 },  // D7#9
  { v: [58, 62, 65, 69], root: 43, third: 46, fifth: 50 },  // Gm9
  { v: [58, 62, 65, 67], root: 36, third: 41, fifth: 43 },  // C9sus
];
const SCALE = [65, 67, 69, 72, 74, 77, 79, 81, 84]; // F major pentatonic, F4..C6

export function createJazz(audio) {
  const ctx = audio.ctx;
  const out = ctx.createGain(); out.gain.value = 0;
  const duckGain = ctx.createGain(); duckGain.gain.value = 1;
  out.connect(duckGain).connect(audio.master);

  // reverb
  const verb = ctx.createConvolver();
  const len = ctx.sampleRate * 2.6;
  const ir = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = ir.getChannelData(ch);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
  }
  verb.buffer = ir;
  const verbGain = ctx.createGain(); verbGain.gain.value = 0.28;
  verb.connect(verbGain).connect(out);
  const dry = ctx.createGain(); dry.gain.value = 0.9; dry.connect(out);
  const bus = ctx.createGain(); bus.connect(dry); bus.connect(verb);

  // noise buffer for brushes
  const nb = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  { const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }

  function ep(time, midi, vel, dur) {
    const f = mtof(midi);
    const car = ctx.createOscillator(); car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.frequency.value = f;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(f * 2.2 * vel, time);
    modGain.gain.exponentialRampToValueAtTime(f * 0.15, time + 0.9);
    mod.connect(modGain).connect(car.frequency);
    const tine = ctx.createOscillator(); tine.frequency.value = f * 4.01;
    const tineG = ctx.createGain();
    tineG.gain.setValueAtTime(0.05 * vel, time); tineG.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);
    tine.connect(tineG);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.exponentialRampToValueAtTime(0.11 * vel, time + 0.006);
    amp.gain.exponentialRampToValueAtTime(0.04 * vel, time + 0.6);
    amp.gain.exponentialRampToValueAtTime(0.0001, time + dur + 0.8);
    const pan = ctx.createStereoPanner(); pan.pan.value = (midi - 62) / 30;
    car.connect(amp); tineG.connect(amp); amp.connect(pan).connect(bus);
    [car, mod, tine].forEach(o => { o.start(time); o.stop(time + dur + 1); });
  }
  function bass(time, midi, dur) {
    const f = mtof(midi);
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f / 2;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, time); lp.frequency.exponentialRampToValueAtTime(260, time + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(0.32, time + 0.012);
    g.gain.exponentialRampToValueAtTime(0.12, time + 0.2); g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    const g2 = ctx.createGain(); g2.gain.value = 0.35;
    o.connect(lp); o2.connect(g2).connect(lp); lp.connect(g).connect(dry);
    [o, o2].forEach(x => { x.start(time); x.stop(time + dur + 0.05); });
  }
  function brush(time, long, vel = 1) {
    const s = ctx.createBufferSource(); s.buffer = nb;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = long ? 3200 : 6500; bp.Q.value = 0.7;
    const g = ctx.createGain();
    const d = long ? 0.32 : 0.07;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.linearRampToValueAtTime((long ? 0.09 : 0.035) * vel, time + (long ? 0.06 : 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, time + d);
    s.connect(bp).connect(g).connect(bus);
    s.start(time, Math.random() * 0.5, d + 0.05);
  }
  function kick(time) {
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(90, time); o.frequency.exponentialRampToValueAtTime(45, time + 0.12);
    const g = ctx.createGain(); g.gain.setValueAtTime(0.25, time); g.gain.exponentialRampToValueAtTime(0.0001, time + 0.25);
    o.connect(g).connect(dry); o.start(time); o.stop(time + 0.3);
  }
  function lead(time, midi, dur) {
    const f = mtof(midi);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f;
    const vib = ctx.createOscillator(); vib.frequency.value = 5.2;
    const vg = ctx.createGain(); vg.gain.setValueAtTime(0, time); vg.gain.linearRampToValueAtTime(f * 0.012, time + dur * 0.8);
    vib.connect(vg).connect(o.frequency);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(700, time); lp.frequency.linearRampToValueAtTime(2200, time + 0.08); lp.frequency.linearRampToValueAtTime(1300, time + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, time); g.gain.exponentialRampToValueAtTime(0.06, time + 0.05);
    g.gain.setValueAtTime(0.06, time + dur * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, time + dur + 0.15);
    o.connect(lp).connect(g).connect(bus);
    o.start(time); vib.start(time); o.stop(time + dur + 0.2); vib.stop(time + dur + 0.2);
  }

  const bpm = 84, beat = 60 / bpm, swing = 0.64;
  let step = 0, nextTime = 0, timer = null, lastLead = 72;
  function stepTime(s) {  // 8th notes with swing
    const beatIdx = Math.floor(s / 2), off = s % 2;
    return beatIdx * beat + (off ? beat * swing : 0);
  }
  let origin = 0;
  function schedule() {
    while (origin + stepTime(step) < ctx.currentTime + 0.25) {
      const t = origin + stepTime(step) + (Math.random() - 0.5) * 0.008;
      const bar = Math.floor(step / 8), s8 = step % 8;
      const ch = PROG[bar % PROG.length], nx = PROG[(bar + 1) % PROG.length];
      // bass: walking quarter notes
      if (s8 % 2 === 0) {
        const q = s8 / 2;
        const notes = [ch.root, Math.random() < 0.5 ? ch.fifth : ch.third, Math.random() < 0.5 ? ch.third + 12 : ch.fifth, nx.root + (Math.random() < 0.5 ? -1 : 1)];
        bass(t, notes[q], beat * 0.95);
      }
      // comping: syncopated hits
      const comp = [0, 3, 5].includes(s8) ? (Math.random() < (s8 === 0 ? 0.85 : 0.45)) : Math.random() < 0.06;
      if (comp) ch.v.forEach((m, i) => ep(t + i * 0.012, m, 0.7 + Math.random() * 0.25, s8 === 0 ? beat * 1.6 : beat * 0.7));
      // drums
      if (s8 === 2 || s8 === 6) brush(t, true);
      if (s8 % 2 === 0 || Math.random() < 0.6) brush(t, false, s8 % 2 ? 0.6 : 1);
      if ((s8 === 0 || (s8 === 5 && Math.random() < 0.3)) && Math.random() < 0.8) kick(t);
      // lead: sparse phrases every other 2-bar block
      if (Math.floor(bar / 2) % 2 === 1 && Math.random() < 0.42) {
        let i = SCALE.indexOf(lastLead); if (i < 0) i = 3;
        i = Math.max(0, Math.min(SCALE.length - 1, i + Math.round((Math.random() - 0.5) * 4)));
        lastLead = SCALE[i];
        lead(t, lastLead, beat * (Math.random() < 0.3 ? 1.5 : 0.6));
      }
      step++;
    }
  }
  return {
    start() {
      origin = ctx.currentTime + 0.1; step = 0;
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setValueAtTime(0, ctx.currentTime);
      out.gain.linearRampToValueAtTime(0.9, ctx.currentTime + 2);
      timer = setInterval(schedule, 40); schedule();
    },
    stop() {
      clearInterval(timer);
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
      setTimeout(() => { out.disconnect(); duckGain.disconnect(); }, 1500);
    },
    duck(on) { duckGain.gain.setTargetAtTime(on ? 0.3 : 1, ctx.currentTime, 0.15); },
  };
}
