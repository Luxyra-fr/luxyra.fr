// Banc : envois d'e-mails en série (app.html _lxEmailPost / sendEmail / sendEmailViaWorker) contre un faux worker qui
// applique 20 envois/minute (429 au-delà) et un plafond du jour. Temps accéléré (1 « seconde » = 1 ms).
import fs from 'fs'; import vm from 'vm';
const app = fs.readFileSync(process.argv[2] || 'app.html', 'utf8');
function extraire(debut) { const i = app.indexOf(debut); if (i < 0) throw new Error('absent: ' + debut); let p = app.indexOf('{', i), d = 0, j = p; for (; j < app.length; j++) { if (app[j] === '{') d++; else if (app[j] === '}') { d--; if (!d) break; } } return app.slice(i, j + 1); }
const code = ['var _LX_EMAIL_ECART_MS=3100;', extraire('function _lxPause('), extraire('async function _lxEmailPost('), extraire('async function sendEmailViaWorker('), extraire('async function sendEmail(')].join('\n');
let ok = 0, ko = 0; const t = (n, c, d) => { if (c) ok++; else { ko++; console.log('KO', n, d ?? ''); } };
async function scenario({ n, plafond, parallele }) {
  let horloge = 0; const envois = []; const recus = [];
  const ctx = { window: {}, console: { log() {}, warn() {} }, SALON_CONFIG: { nom: 'S', email: 'e@x.fr' }, _salonId: 'sid', auditLog() {}, lxEmailSalonTexte: (b) => b, JSON, Number, String, Math, Promise, isFinite,
    setTimeout: (f, ms) => { horloge += ms; return setImmediate(f); } };
  ctx.Date = { now: () => horloge };
  ctx.fetch = async (url, o) => { const b = JSON.parse(o.body); const fen = envois.filter(x => x > horloge - 60000).length;
    const h = { get: () => null };
    if (fen >= 20) return { status: 429, headers: h, json: async () => ({ error: 'Trop de requêtes' }) };
    envois.push(horloge);
    if (recus.length >= plafond) return { status: 429, headers: h, json: async () => ({ success: false, code: 'quota_jour', error: 'Limite du jour atteinte' }) };
    recus.push(b.to); return { status: 200, headers: h, json: async () => ({ success: true, journalise: true }) }; };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const res = [];
  if (parallele) await Promise.all(Array.from({ length: n }, (_, i) => ctx.sendEmailViaWorker('c' + i + '@x.fr', 'C', 'Sujet', '<p>x</p>').then(r => res.push(r))));
  else for (let i = 0; i < n; i++) res.push(await ctx.sendEmail('c' + i + '@x.fr', 'Sujet', 'corps', 'C', 'marketing'));
  return { res, recus, horloge };
}
{ const { res, recus, horloge } = await scenario({ n: 60, plafond: 500 });
  t('60 destinataires en série : 60 envoyés', res.filter(r => r.ok).length === 60 && recus.length === 60, res.filter(r => !r.ok).length);
  t('aucun 429 compté en erreur', res.every(r => r.ok));
  t('durée ≈ 60 × 3,1 s sans aucun 429 (espacement)', horloge >= 59 * 3100 && horloge < 60 * 3100 + 5000, horloge); }
{ const { res, recus } = await scenario({ n: 40, plafond: 500, parallele: true });
  t('40 envois lancés EN PARALLÈLE (forEach sans await) : tous envoyés', res.filter(r => r.ok).length === 40 && recus.length === 40, res.filter(r => !r.ok).length); }
{ const { res, recus } = await scenario({ n: 60, plafond: 25 });
  t('plafond du jour à 25 : 25 envoyés', recus.length === 25 && res.filter(r => r.ok).length === 25);
  t('les 35 suivants rendent code quota_jour (pas de nouvelle tentative)', res.filter(r => !r.ok && r.code === 'quota_jour').length === 35); }
{ // vrai 429 « trop de requêtes » sans espacement possible (worker plus strict : 5/min) -> nouvelle tentative
  let horloge = 0; const envois = []; let n429 = 0;
  const ctx = { window: {}, console: { log() {} }, SALON_CONFIG: { nom: 'S' }, _salonId: 'sid', auditLog() {}, lxEmailSalonTexte: b => b, JSON, Number, String, Math, Promise, isFinite, setTimeout: (f, ms) => { horloge += ms; return setImmediate(f); } };
  ctx.Date = { now: () => horloge };
  ctx.fetch = async () => { const h = { get: () => '10' }; if (envois.filter(x => x > horloge - 60000).length >= 5) { n429++; return { status: 429, headers: h, json: async () => ({ error: 'Trop' }) }; } envois.push(horloge); return { status: 200, headers: h, json: async () => ({ success: true }) }; };
  vm.createContext(ctx); vm.runInContext(code, ctx);
  const r = []; for (let i = 0; i < 12; i++) r.push(await ctx.sendEmail('a' + i + '@x.fr', 's', 'b'));
  t('worker strict (5/min, Retry-After 10 s) : 429 réessayés', n429 > 0, n429);
  t('worker strict : au plus 3 nouvelles tentatives par e-mail (échec propre au-delà)', r.length === 12, r.length); }
console.log(`Campagne : ${ok}/${ok + ko} OK`); process.exit(ko ? 1 : 0);
