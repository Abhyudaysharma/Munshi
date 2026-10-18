// Dependency-free tests against a fake Ollama.
const http = require('http');
const assert = require('assert');
const K = require('../public/khata.js');

const messy = { entries: [
  { type: 'udhaar', name: '**Sharma ji**', amount: '₹500', note: 'chawal' },
  { type: 'jama', name: 'Gupta ji', amount: 200 },
  { type: 'banana', name: 'X', amount: 5 },        // bad type: dropped
  { type: 'udhaar', name: 'Zero', amount: 0 },      // zero: dropped
  { type: 'udhaar', name: '', amount: 50 },         // no name: dropped
  { type: 'sale', name: '', amount: 90 },           // cash sale needs no name
  null,
] };
let last = null;
const fake = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c));
  req.on('end', () => {
    if (req.url === '/api/tags') return res.end(JSON.stringify({ models: [{ name: 'gemma3:4b' }] }));
    if (req.url === '/api/chat') {
      last = JSON.parse(b);
      const isRem = /payment reminders/.test(last.messages[0].content);
      const content = isRem ? 'Sure! ' + JSON.stringify({ message: 'Namaste **Sharma ji**, ₹500 baaki hai. Dhanyavaad' }) : JSON.stringify(messy);
      return res.end(JSON.stringify({ message: { content } }));
    }
    res.statusCode = 404; res.end();
  });
});

(async () => {
  // ── rule-based reader
  const p = K.parseLocal('Sharma ji ne 500 udhaar liya, Gupta ji ne 200 diye');
  assert.deepStrictEqual(p.map((e) => [e.type, e.name, e.amount]), [['udhaar', 'Sharma Ji', 500], ['jama', 'Gupta Ji', 200]]);
  const p2 = K.parseLocal('Rina didi ne ₹350 ka saman liya aur Pappu bhaiya ne Rs 60 de diye');
  assert.deepStrictEqual(p2.map((e) => [e.type, e.name, e.amount]), [['udhaar', 'Rina Didi', 350], ['jama', 'Pappu Bhaiya', 60]]);
  assert.strictEqual(K.parseLocal('aaj mausam accha hai').length, 0);       // no amount: nothing invented
  assert.strictEqual(K.parseLocal('cash sale 340')[0].type, 'sale');
  assert.strictEqual(K.parseLocal('Amit paid 100')[0].type, 'jama');

  // ── balances
  const es = [
    { type: 'udhaar', name: 'Sharma ji', amount: 800, ts: 1 }, { type: 'jama', name: 'sharma  JI', amount: 300, ts: 2 },
    { type: 'udhaar', name: 'Gupta ji', amount: 450, ts: 3 }, { type: 'jama', name: 'Gupta ji', amount: 450, ts: 4 },
    { type: 'sale', name: '', amount: 999, ts: 5 }, { type: 'udhaar', name: 'Dev', amount: 0.1, ts: 6 }, { type: 'udhaar', name: 'Dev', amount: 0.2, ts: 7 },
  ];
  const b = Object.fromEntries(K.balances(es).map((r) => [K.key(r.name), r.balance]));
  assert.strictEqual(b['sharma ji'], 500); assert.strictEqual(b['gupta ji'], 0); assert.strictEqual(b['dev'], 0.3);   // no float dust
  assert.strictEqual(Object.keys(b).length, 3);                                                                        // sale is not a person
  assert.strictEqual(K.money(1234567), '₹12,34,567');                                                                  // Indian digit grouping

  // ── templates
  for (const tone of ['meethi', 'seedhi', 'mazaakiya']) for (const lang of ['hinglish', 'en']) {
    const m = K.reminderLocal({ name: 'Sharma ji', balance: 500, tone, lang, shop: 'Gupta Store' });
    assert(m.includes('₹500') && m.includes('Sharma ji'), m);
  }

  // ── server
  await new Promise((r) => fake.listen(0, r));
  process.env.OLLAMA_URL = `http://127.0.0.1:${fake.address().port}`;
  const app = require('../server.js');
  await new Promise((r) => app.server.listen(0, r));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = (u, body) => fetch(base + u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

  assert.strictEqual(app.cleanEntries(messy).length, 3);
  let j = await (await fetch(base + '/api/models')).json();
  assert.deepStrictEqual([j.ok, j.default], [true, 'gemma3:4b']);

  let r = await post('/api/parse', { text: 'sharma ji ne 500 ka chawal liya', known: ['Sharma ji'] });
  j = await r.json(); assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(j.entries.map((e) => [e.type, e.name, e.amount]), [['udhaar', 'Sharma ji', 500], ['jama', 'Gupta ji', 200], ['sale', '', 90]]);
  assert(/Sharma ji/.test(last.messages[0].content) && last.format === 'json');                       // known names reach the prompt
  assert.strictEqual((await post('/api/parse', { text: '   ' })).status, 400);

  r = await post('/api/remind', { name: 'Sharma ji', balance: 500, tone: 'seedhi', lang: 'en', shop: 'Gupta Store' });
  j = await r.json(); assert.strictEqual(r.status, 200); assert(!/[*]/.test(j.message), j.message);   // tolerant JSON + markdown stripped
  assert(/₹500/.test(last.messages[1].content) && /firm/.test(last.messages[0].content));
  assert.strictEqual((await post('/api/remind', { name: 'A', balance: 0 })).status, 400);              // nothing pending: no reminder

  for (const f of ['/', '/app.js', '/khata.js', '/style.css', '/sw.js', '/manifest.webmanifest', '/icon.svg']) assert.strictEqual((await fetch(base + f)).status, 200, f);
  assert.strictEqual((await fetch(base + '/..%2Fserver.js')).status, 403);
  assert.strictEqual((await fetch(base + '/%E0%A4%A')).status, 400);

  fake.close();
  r = await post('/api/parse', { text: 'x 5' }); assert.strictEqual(r.status, 503);
  assert.strictEqual((await (await fetch(base + '/api/models')).json()).ok, false);
  console.log('all tests passed ✔'); process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
