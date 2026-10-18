// Shared by the server, the browser and the tests: ledger maths + a rule-based reader for plain shop talk.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Khata = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const JAMA = /\b(jama|diye|diya|de\s*gaye|de\s*gaya|dediye|wapas|chuka|chukaya|returned|repaid|paid|gave\s+back|cleared)\b/i;
  const UDHAAR = /\b(udhaar|udhar|uddhar|baki|baaki|credit|le\s*gaye|le\s*gaya|liya|lie|liye|owes?|borrowed|took)\b/i;
  const SALE = /\b(cash|nakad|nagad|sale|becha|bechi|sold)\b/i;
  const FILLER = new Set(('ne ko ka ki ke se pe par hai hain hue the tha thi aaj kal abhi bhi ek aur and of the a to for from on in ' +
    'udhaar udhar uddhar baki baaki credit liya lie liye diye diya de gaye gaya dediye wapas chuka chukaya jama paid returned repaid ' +
    'rupaye rupaya rupees rupee rupya rs inr cash nakad nagad sale becha bechi sold owes owe borrowed took gave back cleared kharcha samaan saman').split(' '));

  const money = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  const key = (name) => String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');

  // Rule-based reader. Deliberately simple: it handles "Sharma ji ne 500 udhaar liya, Gupta ji ne 200 diye".
  // Gemma is for the messy cases; this keeps the app useful with no model at all.
  function parseLocal(text) {
    const parts = String(text || '').split(/[\n;,]+|\s+(?:aur|and)\s+(?=\D*\d)/i).map((s) => s.trim()).filter(Boolean);
    const entries = [];
    for (const p of parts) {
      const m = p.match(/(?:₹|rs\.?|rupees?|inr)?\s*(\d+(?:\.\d+)?)\s*(?:rs\.?|rupaye|rupaya|rupees?|rupya|₹)?/i);
      if (!m) continue;
      const amount = Math.round(parseFloat(m[1]) * 100) / 100;
      if (!(amount > 0)) continue;
      const type = JAMA.test(p) ? 'jama' : SALE.test(p) && !UDHAAR.test(p) ? 'sale' : 'udhaar';
      const words = p.replace(m[0], ' ').replace(/[₹.:!?()"']/g, ' ').split(/\s+/).filter(Boolean);
      const name = words.filter((w) => !FILLER.has(w.toLowerCase())).slice(0, 3)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      if (type !== 'sale' && !name) continue;
      entries.push({ type, name, amount, note: '' });
    }
    return entries;
  }

  // balances per person: udhaar adds, jama subtracts. Cash sales never touch a person's balance.
  function balances(entries) {
    const by = new Map();
    for (const e of entries) {
      if (e.type === 'sale') continue;
      const k = key(e.name); if (!k) continue;
      const row = by.get(k) || { name: e.name, balance: 0, last: 0, count: 0 };
      row.balance += e.type === 'jama' ? -e.amount : e.amount;
      row.balance = Math.round(row.balance * 100) / 100;
      row.last = Math.max(row.last, e.ts || 0); row.count++;
      row.name = row.name.length >= e.name.length ? row.name : e.name;
      by.set(k, row);
    }
    return [...by.values()];
  }

  // Plain-text reminders for when no model is running. Gemma writes better ones; these are a safe floor.
  function reminderLocal({ name, balance, tone, lang, shop }) {
    const amt = money(balance), s = shop || 'hamari dukaan', who = name || 'ji';
    const T = {
      hinglish: {
        meethi: `Namaste ${who}! ${s} se yaad dilana tha ki ${amt} ka hisaab baaki hai. Jab bhi suvidha ho, de dijiye. Dhanyavaad 🙏`,
        seedhi: `${who}, ${s} ka ${amt} baaki hai. Kripya is hafte tak chuka dijiye. Dhanyavaad.`,
        mazaakiya: `${who}, aapke ${amt} hamare khate mein aaram se baithe hain, par unka bhi ghar jaane ka mann hai 😄 Jab ho sake, bhijwa dijiye!`,
      },
      en: {
        meethi: `Hello ${who}! A gentle reminder from ${s}: ${amt} is pending on your account. Whenever convenient, please settle it. Thank you 🙏`,
        seedhi: `${who}, ${amt} is outstanding at ${s}. Please clear it this week. Thank you.`,
        mazaakiya: `${who}, your ${amt} has been getting very comfortable in our ledger 😄 Please help it find its way home when you can!`,
      },
    };
    return (T[lang] || T.hinglish)[tone] || (T[lang] || T.hinglish).meethi;
  }

  return { parseLocal, balances, reminderLocal, money, key };
});
