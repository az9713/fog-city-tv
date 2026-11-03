// Fog City Talk proxy for Cloudflare Workers.
// Holds the Claude API key as a secret so the public GitHub Pages site never sees it.
//
// Settings (Worker > Settings > Variables and Secrets):
//   ANTHROPIC_API_KEY  secret  your Claude API key
//   PASSCODE           secret  a passcode you type once on each device
//   ALLOWED_ORIGIN     text    e.g. https://az9713.github.io
//   DAILY_LIMIT        text    optional, Claude requests per day (default 200); needs the USAGE KV binding
// Optional KV namespace binding named USAGE enables the daily limit.
// Kept in step with server.py.

const API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-opus-5-5';
const MAX_TOKENS = 2048;
const EFFORT = 'low';
const BETAS = 'server-side-fallback-2026-07-01';
// Basic search: the dynamic-filtering variant (web_search_20260209) used ~2.7x the input tokens in a live test.
const WEB_SEARCH = { type: 'web_search_20250305', name: 'web_search', max_uses: 2 };
const MAX_BODY = 400000;

function buildRequest(body) {
  const msgs = body.messages;
  if (!Array.isArray(msgs) || !msgs.length || msgs.length > 80) throw new Error('messages must be a non-empty list');
  const system = body.system ?? '';
  if (typeof system !== 'string' || system.length > 12000) throw new Error('bad system prompt');
  const tools = [];
  for (const t of (body.tools || []).slice(0, 12)) {
    if (!t || typeof t !== 'object' || 'type' in t || !t.name || !t.input_schema) throw new Error('only custom tools are allowed');
    tools.push({ name: t.name, description: t.description, input_schema: t.input_schema });
  }
  if (body.web_search !== false) tools.push(WEB_SEARCH);
  return { model: MODEL, max_tokens: MAX_TOKENS, system, messages: msgs, tools, output_config: { effort: EFFORT }, fallbacks: 'default' };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const allowed = env.ALLOWED_ORIGIN || '';
    const cors = {
      'Access-Control-Allow-Origin': allowed,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, x-passcode',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    };
    const json = (code, obj) => new Response(JSON.stringify(obj), { status: code, headers: { ...cors, 'content-type': 'application/json' } });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (!allowed || origin !== allowed) return json(403, { error: 'origin', message: 'This proxy only serves its own site.' });
    if (!env.ANTHROPIC_API_KEY || !env.PASSCODE) return json(503, { error: 'no_key', message: 'Proxy is missing its secrets.' });
    if (request.headers.get('x-passcode') !== env.PASSCODE) return json(401, { error: 'passcode', message: 'Wrong passcode.' });
    if (request.method === 'GET') return json(200, { ok: true, model: MODEL });
    if (request.method !== 'POST') return json(405, { error: 'method' });

    const text = await request.text();
    if (!text || text.length > MAX_BODY) return json(413, { error: 'too_large' });
    let req;
    try { req = buildRequest(JSON.parse(text)); } catch (e) { return json(400, { error: 'bad_request', message: String(e.message || e) }); }

    if (env.USAGE) {
      const day = new Date().toISOString().slice(0, 10);
      const limit = parseInt(env.DAILY_LIMIT || '200', 10);
      const n = parseInt((await env.USAGE.get(day)) || '0', 10);
      if (n >= limit) return json(429, { error: 'daily_limit', message: `Daily limit of ${limit} requests reached.` });
      await env.USAGE.put(day, String(n + 1), { expirationTtl: 3 * 86400 });
    }

    const r = await fetch(API_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'anthropic-beta': BETAS },
      body: JSON.stringify(req),
    });
    return new Response(r.body, { status: r.status, headers: { ...cors, 'content-type': 'application/json' } });
  },
};
