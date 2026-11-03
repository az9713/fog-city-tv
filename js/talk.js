// Fog City Talk: talk to Claude on the TV, by voice or keyboard.
// The page never holds an API key. Requests go to a small proxy (server.py on the laptop, or a
// Cloudflare Worker for the public site) that adds the key, fixes the model and caps spending.
// Claude can drive the TV through tools: switch channels, set the fireplace sleep timer, find
// paintings, change the volume and read the live forecast.
import { h, esc, store, getJSON, fmtTime, fmtDate, PLACE } from './util.js';
import { TALK } from './config.js';

const NWS = 'https://api.weather.gov';
const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY = 40;   // messages; past this a fresh conversation starts

const SUGGESTIONS = [
  'What should I wear today?',
  'Put on the fireplace with a 30 minute sleep timer',
  'Show me some Monet',
  'Read me the Fog City bulletin',
  'Where can I stream The Bear?',
];

const TOOLS = [
  { name: 'switch_channel', description: 'Change the TV channel. Use when the viewer asks to watch, open or go to something.',
    input_schema: { type: 'object', properties: { channel: { type: 'string', enum: ['home', 'weather', 'gallery', 'fireplace', 'talk'] } }, required: ['channel'], additionalProperties: false } },
  { name: 'set_sleep_timer', description: 'Turn on the fireplace and set its sleep timer: the fire fades out and the TV switches off after this many minutes. 0 cancels the timer.',
    input_schema: { type: 'object', properties: { minutes: { type: 'integer', minimum: 0, maximum: 240 } }, required: ['minutes'], additionalProperties: false } },
  { name: 'show_art', description: 'Open the art gallery on paintings matching a search, e.g. an artist ("Monet"), a subject ("harbor at night") or a movement ("cubism"). Returns the titles found.',
    input_schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'], additionalProperties: false } },
  { name: 'set_volume', description: 'Set the TV volume from 0 to 100, or mute and unmute.',
    input_schema: { type: 'object', properties: { level: { type: 'integer', minimum: 0, maximum: 100 }, mute: { type: 'boolean' } }, additionalProperties: false } },
  { name: 'get_forecast', description: 'Get the live National Weather Service forecast and any active alerts for San Francisco, in Celsius.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false } },
];

function systemPrompt(tv) {
  const wx = store.get('wxLast', null);
  const art = tv.channel === 'gallery' ? tv.current?.currentWork?.() : null;
  return `You are the host of Fog City Talk, a channel on Fog City TV, a retro smart TV in a San Francisco living room. The viewer talks to you with a remote and a microphone, and your replies are shown on screen and read aloud by a TV announcer voice.

How to answer:
- Speak like a warm, sharp late-night TV host. Keep most answers to two to four sentences. Go longer only when asked for detail or for the bulletin.
- Write plain sentences for the ear: no markdown, no bullet points, no headings, no URLs read aloud. If a link helps, say the site name.
- Use Celsius and the San Francisco time zone.
- You can control the TV with your tools. When the viewer asks for something the TV can do, do it, then say briefly what you did.
- For news, sports, showtimes or where a show is streaming, use web search, and say the source in a few words. Streaming apps can't be opened from this browser TV, so name the service instead.
- "The Fog City bulletin" means a 45 second spoken update: today's weather from get_forecast first, then two or three local or world headlines from a web search, then a friendly sign-off.

Right now: ${fmtDate()} ${fmtTime(new Date(), false)} in ${PLACE.name}. The TV is on the ${tv.channel} channel.${wx ? ` Last weather reading: ${wx.temp} degrees C, ${wx.cond}.` : ''}${art ? ` On screen in the gallery: "${art.title}" by ${art.artist_title || 'unknown artist'}${art.date_display ? ', ' + art.date_display : ''}, from the Art Institute of Chicago. If the viewer asks about "this painting", that is the one.` : ''}`;
}

// On the laptop (server.py) the local proxy wins, so the Worker is only used by the public site.
const isLocal = () => /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
function proxyUrl() {
  if (isLocal()) return '/api/claude';
  return TALK.proxy ? TALK.proxy.replace(/\/$/, '') : '';
}
const isRemote = () => !isLocal() && !!TALK.proxy;

function spokenText(s) {
  return s.replace(/https?:\/\/\S+/g, '').replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim();
}

export class Talk {
  constructor(tv) {
    this.tv = tv;           // { go, audio, osd, state() }
    this.messages = [];
    this.busy = false;
    this.open = false;
    this.el = h('div', 'talk hidden');
    this.el.innerHTML = `
      <div class="talk-head"><span class="talk-tag">FOG CITY TALK</span><span class="talk-status"></span><span class="talk-help">T OR ESC TO CLOSE</span></div>
      <div class="talk-log"></div>
      <div class="talk-bar">
        <button class="talk-mic" title="Speak"><svg viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor" aria-hidden="true"><rect x="8" y="2" width="8" height="13" rx="4"/><path d="M5 11a7 7 0 0 0 14 0h-2a5 5 0 0 1-10 0z"/><rect x="11" y="17" width="2" height="4"/><rect x="8" y="20" width="8" height="2" rx="1"/></svg> MIC</button>
        <input class="talk-input" type="text" autocomplete="off" spellcheck="false" placeholder="Ask anything, or tell the TV what to do...">
        <button class="talk-send">ASK</button>
        <button class="talk-new" title="New conversation">NEW</button>
      </div>`;
    this.log = this.el.querySelector('.talk-log');
    this.input = this.el.querySelector('.talk-input');
    this.status = this.el.querySelector('.talk-status');
    this.el.querySelector('.talk-send').addEventListener('click', () => this.submit());
    this.el.querySelector('.talk-mic').addEventListener('click', () => this.listen());
    this.el.querySelector('.talk-new').addEventListener('click', () => this.reset());
    this.input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); this.submit(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.close(); }
      e.stopPropagation();
    });
    this.reset(true);
  }

  // ---------- open / close ----------
  toggle() { this.open ? this.close() : this.show(); }
  show() {
    this.open = true;
    this.el.classList.remove('hidden');
    this.checkProxy();
    setTimeout(() => this.input.focus(), 50);
  }
  close() {
    this.open = false;
    this.el.classList.add('hidden');
    this.input.blur();
    this.rec?.abort();
    if ('speechSynthesis' in window) speechSynthesis.cancel();
  }
  setFull(full) { this.el.classList.toggle('full', full); }

  onKey(k) {
    if (!this.open) return false;
    if (k === 'Back') { this.close(); return true; }
    if (k === 'Enter') { this.input.focus(); return true; }
    if (k === 'Talk') { this.close(); return true; }
    return false;
  }

  reset(quiet) {
    this.messages = [];
    this.log.innerHTML = '';
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.add('host', 'Good evening, Fog City. Ask me anything, or tell the TV what to do.');
    const chips = h('div', 'talk-chips', SUGGESTIONS.map(s => `<button>${esc(s)}</button>`).join(''));
    chips.addEventListener('click', e => { const b = e.target.closest('button'); if (b) this.submit(b.textContent); });
    this.log.appendChild(chips);
    if (!quiet) this.input.focus();
  }

  add(who, text, cls = '') {
    const row = h('div', `talk-line ${who} ${cls}`, `<b>${who === 'you' ? 'YOU' : who === 'host' ? 'CLAUDE' : ''}</b><span>${esc(text)}</span>`);
    this.log.appendChild(row);
    this.log.scrollTop = this.log.scrollHeight;
    return row;
  }

  setStatus(t) { this.status.textContent = t; }

  async checkProxy() {
    const url = proxyUrl();
    if (!url) { this.offAir('This channel is off the air on this site. It needs a Claude proxy: see docs/CLAUDE-CHANNEL.md.'); return false; }
    if (this.proxyOk) return true;
    try {
      const r = await fetch(url, { headers: this.headers() });
      if (r.status === 401) { this.askPasscode(); return false; }
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        this.offAir(j.error === 'no_key' ? 'Off the air: the proxy has no API key yet. See docs/CLAUDE-CHANNEL.md.'
          : !isRemote() && (r.status === 404 || r.status === 501) ? 'Off the air: start the TV with start.bat (python server.py) to use this channel.'
          : `Off the air: proxy answered ${r.status}.`);
        return false;
      }
      this.proxyOk = true; this.el.classList.remove('offair'); this.setStatus('ON AIR');
      return true;
    } catch {
      this.offAir(isRemote() ? 'Off the air: cannot reach the Claude proxy.' : 'Off the air: start the TV with start.bat (python server.py) to use this channel.');
      return false;
    }
  }
  offAir(msg) {
    this.el.classList.add('offair'); this.setStatus('OFF THE AIR');
    if (this.lastOffAir !== msg) { this.add('sys', msg, 'note'); this.lastOffAir = msg; }
  }
  headers() {
    const hd = { 'content-type': 'application/json' };
    const p = store.get('talkPass', '');
    if (isRemote() && p) hd['x-passcode'] = p;
    return hd;
  }
  askPasscode() {
    this.setStatus('PASSCODE');
    this.add('sys', 'This channel is private. Type the passcode and press Enter.', 'note');
    this.input.type = 'password'; this.input.value = ''; this.input.placeholder = 'Passcode';
    this.wantPass = true;
  }

  // ---------- voice input ----------
  listen() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { this.add('sys', 'This browser has no speech recognition. Use Chrome or Edge, or type instead.', 'note'); return; }
    if (this.rec) { this.rec.stop(); return; }
    const rec = new SR();
    rec.lang = 'en-US'; rec.interimResults = true; rec.maxAlternatives = 1;
    let finalText = '';
    rec.onresult = e => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript; else interim += e.results[i][0].transcript;
      }
      this.input.value = (finalText + interim).trim();
    };
    rec.onerror = e => { if (e.error !== 'aborted' && e.error !== 'no-speech') this.add('sys', `Microphone: ${e.error}`, 'note'); };
    rec.onend = () => {
      this.rec = null; this.el.classList.remove('listening'); this.setStatus(this.proxyOk ? 'ON AIR' : '');
      if (finalText.trim()) this.submit(finalText.trim());
    };
    if ('speechSynthesis' in window) speechSynthesis.cancel();
    this.rec = rec; this.el.classList.add('listening'); this.setStatus('LISTENING');
    rec.start();
  }

  // ---------- voice output ----------
  speak(text) {
    if (!('speechSynthesis' in window) || this.tv.audio.muted) return;
    const u = new SpeechSynthesisUtterance(spokenText(text));
    const voices = speechSynthesis.getVoices();
    const pick = voices.find(v => /en-US/i.test(v.lang) && /(Guy|David|Mark|Daniel|Alex|Male|Christopher|Eric|Andrew)/i.test(v.name)) || voices.find(v => /en-US/i.test(v.lang)) || voices[0];
    if (pick) u.voice = pick;
    u.rate = 1.04; u.pitch = 0.95; u.volume = Math.min(1, this.tv.audio.volume * 1.2);
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  // ---------- conversation ----------
  async submit(text) {
    text = (text ?? this.input.value).trim();
    if (!text || this.busy) return;
    this.input.value = '';
    if (this.wantPass) {
      store.set('talkPass', text);
      this.wantPass = false; this.input.type = 'text'; this.input.placeholder = 'Ask anything, or tell the TV what to do...';
      this.proxyOk = false;
      if (await this.checkProxy()) this.add('sys', 'Passcode saved on this device. You are on the air.', 'note');
      return;
    }
    this.log.querySelector('.talk-chips')?.remove();
    if (!(await this.checkProxy())) return;
    if (this.messages.length > MAX_HISTORY) this.reset(true), this.log.querySelector('.talk-chips')?.remove();
    this.add('you', text);
    this.messages.push({ role: 'user', content: text });
    this.busy = true; this.el.classList.add('busy');
    const thinking = this.add('host', 'Thinking...', 'pending');
    try {
      const reply = await this.run(thinking);
      thinking.remove();
      if (reply) { this.add('host', reply.replace(/\*\*|__/g, '')); this.speak(reply); }
    } catch (e) {
      thinking.remove();
      console.warn('talk failed', e);
      this.add('sys', e.message || 'Something went wrong talking to Claude.', 'note');
      // Drop the unanswered question so the next one starts clean; a failure mid tool call starts over.
      const last = this.messages.at(-1);
      if (last?.role === 'user' && typeof last.content === 'string') this.messages.pop();
      else if (last) this.messages = [];
    } finally {
      this.busy = false; this.el.classList.remove('busy'); this.setStatus(this.proxyOk ? 'ON AIR' : '');
    }
  }

  async call() {
    const r = await fetch(proxyUrl(), {
      method: 'POST', headers: this.headers(),
      body: JSON.stringify({ system: systemPrompt(this.tv.state()), messages: this.messages, tools: TOOLS }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { this.proxyOk = false; this.askPasscode(); throw new Error('Passcode needed.'); }
    if (r.status === 429) throw new Error(j.message || j.error?.message || 'Too many requests: try again in a minute.');
    if (!r.ok) throw new Error(`Claude is unavailable (${r.status}): ${j.error?.message || j.message || 'unknown error'}`);
    return j;
  }

  async run(pendingRow) {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await this.call();
      if (res.stop_reason === 'refusal') {
        this.reset(true); this.log.querySelector('.talk-chips')?.remove();
        return "I can't help with that one. Let's try something else.";
      }
      // Append the whole response, thinking blocks included, so history stays append-only.
      this.messages.push({ role: 'assistant', content: res.content });
      const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('').trim();
      const uses = res.content.filter(b => b.type === 'tool_use');
      if (res.content.some(b => b.type === 'server_tool_use')) this.setStatus('SEARCHING');
      if (res.stop_reason === 'pause_turn') continue;
      if (res.stop_reason !== 'tool_use' || !uses.length) return text || '(no answer)';
      if (text) pendingRow.querySelector('span').textContent = text;
      const results = [];
      for (const u of uses) {
        let out, isErr = false;
        try { out = await this.runTool(u.name, u.input || {}); } catch (e) { out = String(e.message || e); isErr = true; }
        results.push({ type: 'tool_result', tool_use_id: u.id, content: typeof out === 'string' ? out : JSON.stringify(out), ...(isErr ? { is_error: true } : {}) });
      }
      this.messages.push({ role: 'user', content: results });
    }
    return 'That took more steps than I expected. Ask me again?';
  }

  // ---------- TV tools ----------
  async runTool(name, input) {
    const tv = this.tv;
    this.setStatus(name.replace(/_/g, ' ').toUpperCase());
    if (name === 'switch_channel') {
      const ch = input.channel;
      if (!['home', 'weather', 'gallery', 'fireplace', 'talk'].includes(ch)) throw new Error('unknown channel');
      if (tv.state().channel !== ch) tv.go(ch);
      return `Now on the ${ch} channel.`;
    }
    if (name === 'set_sleep_timer') {
      if (tv.state().channel !== 'fireplace') tv.go('fireplace');
      const mins = Math.max(0, Math.min(240, Math.round(input.minutes || 0)));
      tv.state().current.setSleep(mins);
      return mins ? `Fireplace on. It fades out and the TV turns off in ${mins} minutes.` : 'Fireplace on, sleep timer off.';
    }
    if (name === 'show_art') {
      if (tv.state().channel !== 'gallery') tv.go('gallery');
      const found = await tv.state().current.loadQuery(String(input.query || '').slice(0, 80));
      if (!found.length) return `No public-domain paintings found for "${input.query}". The gallery stayed on its current collection.`;
      return { showing_now: found[0], also_in_rotation: found.slice(1, 8), count: found.length };
    }
    if (name === 'set_volume') {
      const a = tv.audio;
      if (input.mute === true) { a.muted = true; a.apply(); return 'Muted.'; }
      if (input.level != null) { a.volume = Math.max(0, Math.min(1, input.level / 100)); a.muted = false; a.apply(); store.set('volume', a.volume); tv.osd(`Volume ${Math.round(a.volume * 100)}`, a.volume); return `Volume ${Math.round(a.volume * 100)}.`; }
      if (input.mute === false) { a.muted = false; a.apply(); return 'Unmuted.'; }
      return `Volume is ${Math.round(a.volume * 100)}${a.muted ? ', muted' : ''}.`;
    }
    if (name === 'get_forecast') return await getForecast();
    throw new Error(`unknown tool ${name}`);
  }
}

async function getForecast() {
  let meta = store.get('nwsMeta', null);
  if (!meta?.forecast) {
    const pts = await getJSON(`${NWS}/points/${PLACE.lat},${PLACE.lon}`);
    meta = { at: Date.now(), forecast: pts.properties.forecast, stations: [] };
  }
  const [fc, alerts] = await Promise.all([
    getJSON(meta.forecast + (meta.forecast.includes('?') ? '&' : '?') + 'units=si'),
    getJSON(`${NWS}/alerts/active?point=${PLACE.lat},${PLACE.lon}`).catch(() => ({ features: [] })),
  ]);
  const now = store.get('wxLast', null);
  return {
    source: 'National Weather Service',
    current: now ? `${now.temp} C, ${now.cond}` : 'not loaded',
    periods: fc.properties.periods.slice(0, 5).map(p => `${p.name}: ${p.detailedForecast}`),
    alerts: (alerts.features || []).map(f => f.properties.headline).slice(0, 3),
  };
}

// The Talk channel itself: a studio backdrop with the conversation full screen.
export class TalkChannel {
  constructor({ talk }) {
    this.talk = talk;
    this.el = h('div', 'layer talkch');
  }
  mount() {
    const sky = store.get('wxLast', null)?.sky || 'night';
    this.el.innerHTML = `<div class="studio" style="background-image:url(assets/skycam/${sky}.jpg)"></div><div class="studio-shade"></div>
      <div class="studio-title">FOG CITY <span>TALK</span></div><div class="studio-sub">Live from ${PLACE.name} &middot; powered by Claude</div>`;
    this.talk.setFull(true);
    this.talk.show();
  }
  unmount() { this.talk.setFull(false); }
  onKey(k) { if (k === 'Back' && this.talk.open) { this.talk.close(); return true; } return false; }
}
