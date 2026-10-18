// Dukaan Munshi: a local bahi-khata clerk. Zero dependencies. Talks to Ollama on localhost.
const http = require('http');
const fs = require('fs');
const path = require('path');
const Khata = require('./public/khata.js');

const PORT = process.env.PORT || 3000;
const OLLAMA = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const MODEL = process.env.MODEL || 'gemma3:4b';
const PUBLIC = path.join(__dirname, 'public');
const TYPES = ['udhaar', 'jama', 'sale'];

const PARSE_PROMPT = `You are Munshi, the bahi-khata clerk of an Indian neighbourhood shop.
The shopkeeper types or speaks quick notes in Hindi, Hinglish or English. Turn them into ledger entries.
Entry types:
- "udhaar": a customer took goods on credit, so they owe more.
- "jama": a customer paid money back, so they owe less.
- "sale": a plain cash sale with no customer to track.
Rules: copy the customer's name as written (keep "ji", "bhaiya" etc.). amount is a plain number in rupees. Never invent people or amounts. If a note has no amount, skip it. note is an optional short item description ("2 kg chawal"), else "".
Reply with JSON only: {"entries":[{"type":"udhaar","name":"Sharma ji","amount":500,"note":"chawal"}]}`;

const TONES = {
  meethi: 'warm, polite and soft, like a neighbour gently reminding',
  seedhi: 'polite but firm and direct, with a clear request to pay this week',
  mazaakiya: 'light, friendly and a little funny, never rude or shaming',
};
const LANGS = { hinglish: 'Hinglish (Hindi in Roman letters)', hi: 'Hindi in Devanagari', en: 'simple English' };

function extractJson(text) {
  try { return JSON.parse(text); } catch (_) {}
  const a = String(text).indexOf('{'), b = String(text).lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(text.slice(a, b + 1)); } catch (_) {} }
  return null;
}

// The model suggests; the server checks. Bad types, non-positive amounts and empty names are dropped,
// so a confused small model can never write a nonsense row into someone's khata.
function cleanEntries(raw) {
  const list = Array.isArray(raw && raw.entries) ? raw.entries : [];
  const out = [];
  for (const e of list.slice(0, 30)) {
    if (!e || typeof e !== 'object') continue;
    const type = TYPES.includes(e.type) ? e.type : null;
    const amount = Math.round(parseFloat(String(e.amount).replace(/[^\d.]/g, '')) * 100) / 100;
    const name = String(e.name || '').replace(/[*_`#]/g, '').trim().slice(0, 40);
    if (!type || !(amount > 0) || amount > 10000000) continue;
    if (type !== 'sale' && !name) continue;
    out.push({ type, name, amount, note: String(e.note || '').replace(/[*_`#]/g, '').trim().slice(0, 60) });
  }
  return out;
}

function cleanMessage(s) {
  return String(s || '').replace(/[*_`#]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 600);
}

async function chat(model, system, user) {
  const r = await fetch(OLLAMA + '/api/chat', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ model, stream: false, format: 'json', options: { temperature: 0.3 },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  if (!r.ok) throw new Error('ollama ' + r.status);
  return (await r.json()).message.content;
}

const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const readBody = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => ok(b)); });
const noModel = (res) => send(res, 503, { error: 'Ollama is not running. Start it with `ollama serve` and pull a Gemma model (ollama pull gemma3:4b).' });

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

const server = http.createServer(async (req, res) => {
  let url;
  try { url = decodeURIComponent(req.url.split('?')[0]); } catch (_) { res.writeHead(400); return res.end('bad url'); }

  if (url === '/api/models' && req.method === 'GET') {
    try {
      const r = await fetch(OLLAMA + '/api/tags');
      const models = (await r.json()).models.map((m) => m.name);
      return send(res, 200, { ok: true, models, default: models.includes(MODEL) ? MODEL : models[0] });
    } catch (_) { return send(res, 200, { ok: false, models: [], default: MODEL }); }
  }

  if (url === '/api/parse' && req.method === 'POST') {
    let body; try { body = JSON.parse(await readBody(req)); } catch (_) { return send(res, 400, { error: 'bad json' }); }
    const text = String(body.text || '').slice(0, 1500).trim();
    if (!text) return send(res, 400, { error: 'Say or type something first.' });
    try {
      const known = Array.isArray(body.known) ? body.known.slice(0, 60).map((n) => String(n).slice(0, 40)) : [];
      const sys = PARSE_PROMPT + (known.length ? `\nCustomers already in the khata (use these exact spellings when the note clearly means them): ${known.join(', ')}.` : '');
      const out = await chat(body.model || MODEL, sys, text);
      return send(res, 200, { entries: cleanEntries(extractJson(out)), via: 'gemma' });
    } catch (_) { return noModel(res); }
  }

  if (url === '/api/remind' && req.method === 'POST') {
    let body; try { body = JSON.parse(await readBody(req)); } catch (_) { return send(res, 400, { error: 'bad json' }); }
    const amt = Number(body.balance);
    if (!body.name || !(amt > 0)) return send(res, 400, { error: 'Nothing is pending for this customer.' });
    const tone = TONES[body.tone] ? body.tone : 'meethi', lang = LANGS[body.lang] ? body.lang : 'hinglish';
    const sys = `You write short WhatsApp payment reminders for a small Indian shop. Tone: ${TONES[tone]}. Language: ${LANGS[lang]}. ` +
      `Max 3 sentences. Mention the exact amount ${Khata.money(amt)} and the customer's name. Never threaten, never shame, never invent dates or items. ` +
      `Sign off with the shop name if given. Reply with JSON only: {"message":"..."}`;
    try {
      const out = await chat(body.model || MODEL, sys, `Customer: ${String(body.name).slice(0, 40)}\nPending: ${Khata.money(amt)}\nShop: ${String(body.shop || '').slice(0, 40) || '(none)'}`);
      const j = extractJson(out); const message = cleanMessage(j && j.message);
      if (!message) return send(res, 502, { error: 'The model returned nothing usable. Try again.' });
      return send(res, 200, { message, via: 'gemma' });
    } catch (_) { return noModel(res); }
  }

  const file = path.normalize(path.join(PUBLIC, url === '/' ? 'index.html' : url));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end('forbidden'); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }); res.end(data);
  });
});

if (require.main === module) server.listen(PORT, () => console.log(`Dukaan Munshi on http://localhost:${PORT}  (model: ${MODEL})`));
module.exports = { server, cleanEntries, cleanMessage, extractJson, PARSE_PROMPT };
