(function () {
  const $ = (id) => document.getElementById(id);
  const KEY = 'munshi.v1';
  const S = { shop: '', phones: {}, entries: [], pending: [], ok: false, model: '', remFor: null };
  const EXAMPLES = ['Sharma ji ne 500 udhaar liya', 'Gupta ji ne 200 diye', 'Rina didi ne 350 ka saman liya, Sharma ji ne 100 diye'];

  const load = () => { try { Object.assign(S, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (_) {} };
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ shop: S.shop, phones: S.phones, entries: S.entries })); } catch (_) {} };
  const say = (t, err) => { const m = $('msg'); m.textContent = t || ''; m.className = 'msg' + (err ? ' err' : ''); };
  const el = (tag, props, ...kids) => { const n = Object.assign(document.createElement(tag), props || {}); kids.forEach((k) => n.append(k)); return n; };
  const id = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const when = (ts) => { const d = Math.floor((Date.now() - ts) / 864e5); return d <= 0 ? 'aaj' : d === 1 ? 'kal' : d + ' din pehle'; };

  async function loadMeta() {
    try {
      const r = await fetch('api/models'); const j = await r.json();
      S.ok = !!j.ok; S.model = j.default || '';
    } catch (_) { S.ok = false; S.static = true; }
    const b = $('banner');
    if (S.ok) { b.hidden = false; b.textContent = `Gemma (${S.model}) is running on this machine and reads your notes. Nothing leaves it.`; }
    else { b.hidden = false; b.innerHTML = 'Demo mode: no local Gemma found, so Munshi uses simple rules. Plain notes like <i>"Sharma ji ne 500 udhaar liya"</i> work. Messier talk and nicer reminders need Gemma on your own machine ' +
      '(<a href="https://github.com/Abhyudaysharma/Dukaan-Munshi#run-it">three commands</a>).'; }
  }

  async function post(url, body) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const j = await r.json(); if (!r.ok) throw new Error(j.error || 'failed'); return j;
  }

  // ---- capture
  async function understand() {
    const text = $('say').value.trim();
    if (!text) return say('Pehle kuch bolo ya likho.', true);
    say('Munshi soch raha hai…'); $('go').disabled = true;
    let entries = [], via = 'rules';
    if (S.ok) {
      try { const j = await post('api/parse', { text, model: S.model, known: Khata.balances(S.entries).map((b) => b.name) }); entries = j.entries; via = 'gemma'; }
      catch (e) { S.ok = false; await loadMeta(); }
    }
    if (!entries.length && via === 'rules') entries = Khata.parseLocal(text);
    $('go').disabled = false;
    if (!entries.length) return say('Samajh nahi aaya. Naam aur rupaye likhiye, jaise "Sharma ji ne 500 udhaar liya".', true);
    S.pending = entries; renderReview(); say('');
  }

  function renderReview() {
    const box = $('reviewRows'); box.replaceChildren();
    S.pending.forEach((e, i) => {
      const t = el('select', { ariaLabel: 'Type' }, ...[['udhaar', 'Udhaar'], ['jama', 'Jama'], ['sale', 'Cash sale']].map(([v, l]) => el('option', { value: v, textContent: l })));
      t.value = e.type; t.onchange = () => { e.type = t.value; };
      const n = el('input', { value: e.name, placeholder: 'Naam', ariaLabel: 'Name' }); n.oninput = () => { e.name = n.value; };
      const a = el('input', { value: e.amount, inputMode: 'decimal', ariaLabel: 'Amount' }); a.oninput = () => { e.amount = parseFloat(a.value) || 0; };
      const x = el('button', { type: 'button', textContent: '✕', ariaLabel: 'Remove' }); x.onclick = () => { S.pending.splice(i, 1); S.pending.length ? renderReview() : ($('review').hidden = true); };
      box.append(el('div', { className: 'rrow' }, t, n, a, x));
    });
    $('review').hidden = false;
  }

  function savePending() {
    const rows = S.pending.filter((e) => e.amount > 0 && (e.type === 'sale' || e.name.trim()));
    rows.forEach((e) => S.entries.push({ id: id(), ts: Date.now(), type: e.type, name: e.name.trim(), amount: e.amount, note: e.note || '' }));
    S.pending = []; $('review').hidden = true; $('say').value = ''; persist(); render();
    say(rows.length ? `${rows.length} entry likh di ✅` : '');
  }

  // ---- khata
  function render() {
    const bals = Khata.balances(S.entries);
    const owing = bals.filter((b) => b.balance > 0).reduce((a, b) => a + b.balance, 0);
    $('total').textContent = Khata.money(owing);
    const q = $('find').value.trim().toLowerCase();
    const rows = bals.filter((b) => !q || b.name.toLowerCase().includes(q)).sort((a, b) => b.balance - a.balance);
    const list = $('list'); list.replaceChildren();
    $('empty').hidden = bals.length > 0;
    for (const b of rows) {
      const hist = el('ul', { className: 'hist', hidden: true });
      S.entries.filter((e) => e.type !== 'sale' && Khata.key(e.name) === Khata.key(b.name)).sort((x, y) => y.ts - x.ts).forEach((e) => {
        const del = el('button', { type: 'button', textContent: '✕', title: 'Delete this entry', ariaLabel: 'Delete entry' });
        del.onclick = () => { if (confirm('Yeh entry hata dein?')) { S.entries = S.entries.filter((z) => z.id !== e.id); persist(); render(); } };
        hist.append(el('li', {}, el('span', { className: e.type === 'jama' ? 'j' : 'u', textContent: `${e.type === 'jama' ? '− ' : '+ '}${Khata.money(e.amount)}${e.note ? ' · ' + e.note : ''}` }),
          el('span', { className: 'cmeta', textContent: when(e.ts) }), del));
      });
      const rem = el('button', { type: 'button', textContent: '💬 Remind' }); rem.disabled = !(b.balance > 0); rem.onclick = () => openReminder(b);
      const hb = el('button', { type: 'button', textContent: 'History' }); hb.onclick = () => { hist.hidden = !hist.hidden; };
      list.append(el('div', { className: 'cust' },
        el('div', { className: 'ctop' }, el('div', {}, el('div', { className: 'cname', textContent: b.name }), el('div', { className: 'cmeta', textContent: `${b.count} ${b.count === 1 ? "entry" : "entries"} · last ${when(b.last)}` })),
          el('div', { className: 'bal' + (b.balance <= 0 ? ' clear' : ''), textContent: b.balance > 0 ? Khata.money(b.balance) : b.balance < 0 ? 'Advance ' + Khata.money(-b.balance) : 'Chukta ✓' })),
        el('div', { className: 'cbtns' }, rem, hb), hist));
    }
  }

  // ---- reminders
  async function makeReminder() {
    const b = S.remFor; if (!b) return;
    const args = { name: b.name, balance: b.balance, tone: $('tone').value, lang: $('lang').value, shop: S.shop };
    $('remNote').textContent = 'Likh raha hai…';
    let via = 'rules', msg = '';
    if (S.ok) { try { const j = await post('api/remind', Object.assign({ model: S.model }, args)); msg = j.message; via = 'gemma'; } catch (_) {} }
    if (!msg) msg = Khata.reminderLocal(args.lang === 'hi' ? Object.assign({}, args, { lang: 'hinglish' }) : args);
    $('remMsg').value = msg;
    $('remNote').textContent = via === 'gemma' ? 'Written by Gemma on this machine. Edit freely before sending.' : (args.lang === 'hi' ? 'Hindi (Devanagari) needs Gemma; showing the Hinglish template. ' : 'Template message (no model running). ') + 'Edit freely before sending.';
    updateWa();
  }
  function updateWa() {
    const ph = $('phone').value.replace(/\D/g, '').replace(/^0+/, '');
    const num = ph.length === 10 ? '91' + ph : ph;
    $('wa').href = `https://wa.me/${num}?text=${encodeURIComponent($('remMsg').value)}`;
  }
  function openReminder(b) {
    S.remFor = b; $('dlgTitle').textContent = `Reminder: ${b.name} (${Khata.money(b.balance)})`;
    $('phone').value = S.phones[Khata.key(b.name)] || ''; $('dlg').showModal(); makeReminder();
  }

  // ---- misc
  function csv() {
    const rows = [['date', 'type', 'name', 'amount', 'note']].concat(S.entries.map((e) => [new Date(e.ts).toISOString().slice(0, 10), e.type, e.name, e.amount, e.note]));
    const text = rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([text], { type: 'text/csv' })), download: 'khata.csv' }); a.click();
  }
  function demo() {
    const D = 864e5, n = Date.now();
    const rows = [['udhaar', 'Sharma ji', 800, 'ration', 9], ['jama', 'Sharma ji', 300, '', 4], ['udhaar', 'Gupta ji', 450, 'doodh + atta', 12], ['udhaar', 'Rina didi', 1200, 'monthly saman', 20],
      ['jama', 'Rina didi', 1200, '', 2], ['udhaar', 'Pappu bhaiya', 260, 'chai patti', 6], ['sale', '', 340, '', 1]];
    S.entries = rows.map(([type, name, amount, note, ago]) => ({ id: id(), ts: n - ago * D, type, name, amount, note }));
    persist(); render(); say('Demo khata (made-up names) load ho gaya.');
  }

  function mic() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) return say('Voice typing is not available in this browser. Type instead.', true);
    const r = new SR(); r.lang = 'hi-IN'; r.interimResults = false;
    r.onresult = (ev) => { const t = ev.results[0][0].transcript; $('say').value = ($('say').value ? $('say').value + ', ' : '') + t; say(''); };
    r.onerror = () => say('Mic nahi chala. Type kar dijiye.', true); r.onend = () => { $('mic').textContent = '🎙️ Bolo'; };
    $('mic').textContent = '🎙️ Sun raha hoon…'; r.start();
  }

  function init() {
    load(); $('shop').value = S.shop || '';
    EXAMPLES.forEach((t) => { const b = el('button', { type: 'button', textContent: t }); b.onclick = () => { $('say').value = t; }; $('examples').append(b); });
    $('shop').oninput = () => { S.shop = $('shop').value; persist(); };
    $('go').onclick = understand; $('mic').onclick = mic; $('save').onclick = savePending;
    $('discard').onclick = () => { S.pending = []; $('review').hidden = true; };
    $('find').oninput = render; $('csv').onclick = csv; $('demo').onclick = demo;
    $('wipe').onclick = () => { if (confirm('Poora khata hamesha ke liye hata dein?')) { S.entries = []; S.phones = {}; persist(); render(); } };
    $('tone').onchange = $('lang').onchange = makeReminder; $('regen').onclick = makeReminder;
    $('remMsg').oninput = updateWa;
    $('phone').oninput = () => { if (S.remFor) { S.phones[Khata.key(S.remFor.name)] = $('phone').value; persist(); } updateWa(); };
    $('copy').onclick = () => { navigator.clipboard && navigator.clipboard.writeText($('remMsg').value); $('remNote').textContent = 'Copied.'; };
    render(); loadMeta();
    if ('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  init();
})();
