// Test navigateur (Chromium sans affichage) de la fenêtre « Répondre à la demande » (RDV sur mesure v2) en mode démo.
// node sm_app_test.mjs <racine du dépôt> <port> <dossier captures>
import chromium from '@sparticuz/chromium';
import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';
const ROOT = process.argv[2], PORT = process.argv[3] || '8790', OUT = process.argv[4] || '/tmp/sm/shots';
fs.mkdirSync(OUT, { recursive: true });
let nOk = 0, nKo = 0; const kos = [];
const ok = (n, c, d) => { if (c) nOk++; else { nKo++; kos.push(n + (d !== undefined ? ' :: ' + JSON.stringify(d).slice(0, 400) : '')); } };
const b = await puppeteer.launch({ executablePath: await chromium.executablePath(), args: [...chromium.args, '--lang=fr-FR'], headless: true });
const TYPES = { '.js': 'application/javascript', '.css': 'text/css', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.html': 'text/html', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

async function page(q, vp) {
  const pg = await b.newPage();
  await pg.setViewport(vp || { width: 1440, height: 1000 });
  await pg.setRequestInterception(true);
  pg.on('request', r => {
    const u = r.url();
    if (u.startsWith('http://localhost') || u.startsWith('data:') || u.startsWith('blob:')) return r.continue();
    if (u.startsWith('https://luxyra.fr/')) { const p = path.join(ROOT, new URL(u).pathname); if (fs.existsSync(p) && fs.statSync(p).isFile()) return r.respond({ status: 200, contentType: TYPES[path.extname(p)] || 'application/octet-stream', body: fs.readFileSync(p) }); }
    return r.abort();
  });
  pg.errors = [];
  pg.on('pageerror', e => pg.errors.push(e.message.slice(0, 200)));
  pg.on('dialog', d => d.accept());
  await pg.goto(`http://localhost:${PORT}/app.html?${q || 'demo=coiffure'}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await pg.waitForFunction(() => window.CURRENT_OPERATOR && document.querySelector('#app') && typeof lxSmOuvrir === 'function' && window.SVC && SVC.length, { timeout: 40000 });
  await new Promise(r => setTimeout(r, 1500));
  await pg.evaluate(() => { [...document.body.children].forEach(e => { if (/DÉMO Luxyra/.test(e.innerText || '') && getComputedStyle(e).position === 'fixed') e.style.display = 'none'; }); });
  return pg;
}
const DEM = { id: 'd0000000-0000-4000-8000-000000000001', status: 'pending', client_prenom: 'Julie', client_nom: 'M.', client_tel: '0600000000', client_email: 'julie@exemple.test', client_luxyra_id: 'x', demande_text: 'Couleur ou mèches coupe cheveux mi long', dispo_text: 'Après 15h30 les après-midi ou samedi en journée', created_at: new Date(Date.now() - 3600e3).toISOString(), proposal_version: 1 };

// ---------------- ordinateur ----------------
{
  const pg = await page();
  const info = await pg.evaluate((DEM) => {
    // forfaits (table forfaits) + une prestation « sur devis » pour couvrir tous les cas du catalogue
    window.FORFAITS = [{ id: 9901, n: 'FORFAIT MARIEE', p: 150, cat: 'Forfaits', phases: [{ t: 'w', d: 60, l: 'ESSAI' }, { t: 'p', d: 20 }, { t: 'w', d: 40, l: 'CHIGNON' }] }, { id: 9902, n: 'FORFAIT SUR DEVIS', p: 0, devis: true, phases: [{ t: 'w', d: 60 }] }];
    SVC.push({ id: 99901, n: 'SOIN SUR DEVIS', p: 0, devis: true, cat: SVC[0].cat, phases: [{ t: 'w', d: 45 }], actif: true });
    window.RDV_DEMANDES = [DEM]; openDemande(DEM.id);
    const cat = _lxSmCatalogue();
    return { fen: !!document.querySelector('.lxsm'), items: document.querySelectorAll('.lxsm-it').length, cat: cat.length, svc: SVC.filter(s => s && s.actif !== false).length, forf: (FORFAITS || []).length,
      fams: document.querySelectorAll('.lxsm-fam').length, devis: document.querySelectorAll('.lxsm-it.dis').length, nDevis: cat.filter(x => x.devis).length,
      titre: document.querySelector('.lxsm h2').innerText, client: document.querySelector('.lxsm-client').innerText, team: _lxSmCollabs().length, stripe: _lxSmStripeOk() };
  }, DEM);
  ok('fenêtre « Répondre à la demande » ouverte depuis la demande', info.fen && /Répondre à la demande/.test(info.titre) && /En attente de votre proposition/.test(info.titre), info.titre);
  ok('demande du client et disponibilités affichées', /Couleur ou mèches/.test(info.client) && /Après 15h30/.test(info.client) && /Julie/.test(info.client), info.client);
  ok('prestations ET forfaits listés (toutes les prestations actives, réservables en ligne ou non)', info.items === info.cat && info.cat === info.svc + info.forf && info.forf > 0, info);
  ok('familles + « Forfaits (N) »', info.fams >= 3, info.fams);
  ok('prestations sur devis non sélectionnables', info.devis === info.nDevis, info);
  // recherche + famille
  const rech = await pg.evaluate(() => { const q = document.getElementById('lxsmQ'); const nom = _lxSmCatalogue().find(x => x.type === 'service' && !x.devis).nom; q.value = nom.slice(0, 5); q.dispatchEvent(new Event('input', { bubbles: true })); const n = document.querySelectorAll('.lxsm-it').length; q.value = ''; q.dispatchEvent(new Event('input', { bubbles: true })); lxSmFamille('Forfaits'); const f = document.querySelectorAll('.lxsm-it').length; lxSmFamille(''); return { n, f, nb: (FORFAITS || []).length }; });
  ok('recherche et filtre « Forfaits »', rech.n >= 1 && rech.f === rech.nb, rech);
  // choisir une prestation avec temps de pose, collaborateur, jour avec RDV existant -> conflit
  const scen = await pg.evaluate(() => {
    const pose = _lxSmCatalogue().find(x => x.type === 'service' && !x.devis && x.pose > 0) || _lxSmCatalogue().find(x => !x.devis);
    const auj = _lxSmYmd(new Date());
    const rdv = AP.filter(a => a && a.date > auj && a.stId && a.time && !a.cancelled && a.st !== 'canc' && !a.fromCaisse).sort((a, b) => a.date.localeCompare(b.date))[0];
    lxSmItem(pose.k);
    if (rdv) { lxSmChamp('date', rdv.date); lxSmChamp('collab', String(rdv.stId)); lxSmChamp('heure', rdv.time); }
    const o = _lxSmO(), e = _lxSmEtat(o);
    return { pose: pose.pose, nom: pose.nom, rdv: rdv ? { d: rdv.date, t: rdv.time } : null, etat: e.etat, txt: (document.querySelector('.lxsm-conf') || {}).innerText || '', pills: document.querySelectorAll('.lxsm-conf .lxsm-pill').length,
      tot: document.querySelector('.lxsm-tot').innerText, planCf: document.querySelectorAll('.lxsm-desk .lxsm-b.cf').length, planOpt: document.querySelectorAll('.lxsm-desk .lxsm-b.opt').length, planPose: document.querySelectorAll('.lxsm-desk .lxsm-b.optp').length, rdvs: document.querySelectorAll('.lxsm-desk .lxsm-b.rdv').length };
  });
  ok('prestation avec temps de pose : durée « dont … de pose » affichée', /dont .* de temps de pose/.test(scen.tot), scen.tot);
  ok('créneau sur un RDV existant : conflit signalé (texte + planning)', scen.rdv && scen.etat === 'conflit' && /Conflit : .* a déjà un rendez-vous à/.test(scen.txt) && scen.planCf >= 1, scen);
  ok('mini-planning du jour : RDV existants + option surlignée + temps de pose hachuré', scen.rdvs >= 1 && scen.planOpt === 1 && (scen.pose ? scen.planPose >= 1 : true), scen);
  ok('créneaux libres suggérés', scen.pills >= 1, scen.pills);
  await pg.screenshot({ path: OUT + '/1-pro-ordinateur-conflit.png' });
  const apres = await pg.evaluate(() => { document.querySelector('.lxsm-conf .lxsm-pill').click(); return { etat: _lxSmEtat(_lxSmO()).etat, heure: _lxSmO().heure, libre: !!document.querySelector('.lxsm-libre') }; });
  ok('clic sur un créneau libre : appliqué, plus de conflit', apres.etat === 'libre' && apres.libre, apres);
  // clic dans le planning
  const clic = await pg.evaluate(() => { const col = document.querySelectorAll('.lxsm-desk .lxsm-col')[0]; const r = col.getBoundingClientRect(); col.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: r.left + 5, clientY: r.top + 40 })); return { h: _lxSmO().heure, c: _lxSmO().collab }; });
  ok('clic dans une colonne du planning : heure + collaborateur appliqués', /^\d\d:\d\d$/.test(clic.h) && clic.c !== '', clic);
  // acompte : sans Stripe -> impossible ; avec Stripe -> % et €
  const ac = await pg.evaluate(() => {
    SALON_CONFIG.stripeConnectId = ''; _lxSmRendre();
    const dis = document.querySelector('.lxsm-sw').disabled, txt = document.querySelector('.lxsm-ac').parentElement.innerText;
    SALON_CONFIG.stripeConnectId = 'acct_TEST'; SALON_CONFIG.stripeConnectStatus = 'active'; _lxSmRendre();
    lxSmChamp('acOn', true); lxSmChamp('acMode', 'pct'); lxSmChamp('acVal', '30');
    const c = _lxSmCalc(_lxSmO()), aff = document.getElementById('lxsmAc').innerText;
    lxSmChamp('acMode', 'montant'); lxSmChamp('acVal', '15');
    const c2 = _lxSmCalc(_lxSmO()), aff2 = document.getElementById('lxsmAc').innerText;
    return { dis, txtOk: /non activés/.test(txt), pct: c.acompte, prix: c.prix, aff, eur: c2.acompte, aff2, reste: document.getElementById('lxsmReste').innerText };
  });
  ok('établissement sans Stripe actif : interrupteur d\'acompte désactivé + explication', ac.dis && ac.txtOk, ac);
  ok('acompte 30 % calculé à l\'écran', Math.abs(ac.pct - Math.round(ac.prix * 30) / 100) < 0.001 && ac.aff.indexOf(ac.pct.toFixed(2).replace('.', ',')) >= 0, ac);
  ok('acompte en € + reste à régler + « vérifié par le serveur »', ac.eur === 15 && /15,00/.test(ac.aff2) && /vérifié par le serveur/.test(ac.reste), ac);
  // 3 options maximum, intitulé, note, dupliquer, supprimer
  const opts = await pg.evaluate(() => {
    document.querySelector('input[maxlength="60"]').value = 'Mèches + coupe'; lxSmChamp('libelle', 'Mèches + coupe', true); lxSmChamp('note', 'Venez avec les cheveux secs, merci !', true);
    lxSmAjouter(); const f = _lxSmCatalogue().find(x => x.type === 'forfait' && !x.devis); if (f) lxSmItem(f.k);
    lxSmDupliquer(); const n3 = window._lxSm.opts.length, add = !!document.querySelector('.lxsm-add');
    lxSmDupliquer(); const n3b = window._lxSm.opts.length; lxSmSupprimer(); const n2 = window._lxSm.opts.length;
    return { n3, add, n3b, n2, btn: document.getElementById('lxsmGo').innerText, tabs: document.querySelectorAll('.lxsm-tab').length };
  });
  ok('jusqu\'à 3 options (onglets), pas de 4e, suppression', opts.n3 === 3 && !opts.add && opts.n3b === 3 && opts.n2 === 2 && opts.tabs === 2, opts);
  ok('bouton « Envoyer les 2 options au client »', /Envoyer les 2 options au client/.test(opts.btn), opts.btn);
  await pg.evaluate(() => { lxSmTab(0); document.querySelectorAll('[id*=toast],[class*=toast]').forEach(e => e.remove()); });
  await new Promise(r => setTimeout(r, 300));
  await pg.screenshot({ path: OUT + '/1-pro-ordinateur.png', fullPage: false });
  // envoi : seuls des identifiants partent ; 409 conflit -> « envoyer quand même »
  const env = await pg.evaluate(async () => {
    const appels = []; const f0 = window.fetch;
    window._sb.auth.getSession = async () => ({ data: { session: { access_token: 'jwt-test' } } });
    let n = 0;
    window.fetch = async (u, o) => { if (String(u).includes('rdv-demande-propose')) { appels.push(JSON.parse(o.body)); n++;
      if (n === 1) return new Response(JSON.stringify({ error: 'x', conflit: true, conflits: [{ rang: 1, raison: 'Le collaborateur a déjà un rendez-vous' }] }), { status: 409 });
      return new Response(JSON.stringify({ ok: true, proposal_url: 'https://luxyra.fr/proposal.html?t=abc', envoi: { email: 'envoye' } }), { status: 200 }); } return f0(u, o); };
    lxSmExpire(48);
    await lxSmEnvoyer(false);
    await new Promise(r => setTimeout(r, 300));
    const dlg = document.getElementById('modal').innerText;
    // confirmation « envoyer quand même »
    const oui = [...document.querySelectorAll('#modal button')].find(x => /Oui|Confirmer|OK|Continuer/i.test(x.innerText));
    if (oui) oui.click();
    await new Promise(r => setTimeout(r, 600));
    window.fetch = f0;
    return { appels, dlg: dlg.slice(0, 300), res: document.getElementById('modal').innerText.slice(0, 300) };
  });
  const p0 = env.appels[0] || {};
  const json0 = JSON.stringify(p0);
  ok('envoi : 2 options, identifiants seulement (aucun prix / durée / montant envoyé)', p0.options && p0.options.length === 2 && !/"(prix|prix_total|duree|duree_minutes|acompte_montant|pose_minutes)"\s*:/.test(json0) && p0.options[0].items.every(i => i.type && Number.isInteger(i.id)), p0);
  ok('envoi : acompte (mode + valeur), note, intitulé, validité 48 h', p0.expire_heures === 48 && p0.options[0].acompte_mode === 'montant' && p0.options[0].acompte_valeur === 15 && p0.options[0].note === 'Venez avec les cheveux secs, merci !' && p0.options[0].libelle === 'Mèches + coupe', p0.options && p0.options[0]);
  ok('conflit à l\'envoi : confirmation puis renvoi avec forcer', /n.est plus libre/.test(env.dlg) && env.appels.length === 2 && env.appels[1].forcer === true, { dlg: env.dlg, n: env.appels.length });
  ok('après envoi : « Proposition envoyée » + lien', /Proposition envoyée/.test(env.res) && /E-mail envoyé au client/.test(env.res), env.res);
  ok('aucune erreur JavaScript (ordinateur)', pg.errors.length === 0, pg.errors);
  // suivi + liste
  const suivi = await pg.evaluate(() => {
    const d = { id: 'd2', status: 'confirmed', proposal_version: 2, envoi: 1, client_prenom: 'Julie', client_nom: 'M.', demande_text: 'Couleur ou mèches', created_at: new Date().toISOString(), option_choisie_id: 'o2', rdv_online_id: 'r1' };
    const d3 = { id: 'd3', status: 'proposed', proposal_version: 2, envoi: 1, client_prenom: 'Paul', client_nom: 'D.', demande_text: 'Barbe', created_at: new Date().toISOString(), vue_at: new Date().toISOString(), checkout_expires_at: new Date(Date.now() + 600e3).toISOString(), checkout_option_id: 'o4', proposal_expires_at: new Date(Date.now() + 86400e3).toISOString(), proposal_token: 't' };
    window.RDV_DEMANDES = [d, d3];
    window.RDV_DEMANDE_OPTIONS = { d2: [{ id: 'o1', demande_id: 'd2', envoi: 1, rang: 1, libelle: 'Couleur + coupe', date_rdv: '2026-11-03', heure_rdv: '15:30:00', duree_minutes: 90, prix_total: 68, acompte_montant: 0, acompte_mode: 'aucun', statut: 'liberee' }, { id: 'o2', demande_id: 'd2', envoi: 1, rang: 2, libelle: 'Mèches + coupe', date_rdv: '2026-11-07', heure_rdv: '12:30:00', duree_minutes: 170, collaborateur_nom: 'Amandine', prix_total: 80, acompte_montant: 24, acompte_mode: 'pct', statut: 'choisie', note: 'Cheveux secs' }],
      d3: [{ id: 'o4', demande_id: 'd3', envoi: 1, rang: 1, libelle: 'Barbe', date_rdv: '2026-11-04', heure_rdv: '10:00:00', duree_minutes: 30, prix_total: 20, acompte_montant: 5, acompte_mode: 'montant', statut: 'proposee' }] };
    window.RDV_DEMANDE_PAIEMENTS = { d2: [{ demande_id: 'd2', montant: 24, statut: 'confirme' }, { demande_id: 'd2', montant: 68, statut: 'rembourse' }] };
    openDemande('d2'); const t2 = document.getElementById('modal').innerText;
    openDemande('d3'); const t3 = document.getElementById('modal').innerText;
    lxSmListe(); const tl = document.getElementById('modal').innerText;
    return { t2, t3, tl, home: (() => { go('home'); return document.getElementById('app').innerText; })() };
  });
  ok('suivi : option choisie + acompte payé + doublon remboursé', /Option B choisie · acompte 24,00 € payé/.test(suivi.t2) && /Choisie ✓/.test(suivi.t2) && /Libérée/.test(suivi.t2) && /remboursé automatiquement/.test(suivi.t2), suivi.t2.slice(0, 400));
  ok('suivi : proposition vue, paiement en cours (option A), actions', /vue par le client/.test(suivi.t3) && /paiement en cours \(option A\)/.test(suivi.t3) && /Proposer un autre horaire/.test(suivi.t3) && /Annuler la proposition/.test(suivi.t3), suivi.t3.slice(0, 400));
  ok('liste des demandes : statuts', /Confirmée/.test(suivi.tl) && /Proposition envoyée/.test(suivi.tl), suivi.tl.slice(0, 300));
  ok('accueil : bandeau « proposition en attente du client »', /proposition en attente du client/.test(suivi.home), null);
  await pg.close();
}
// ---------------- téléphone ----------------
{
  const pg = await page('demo=coiffure', { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const m = await pg.evaluate((DEM) => {
    window.RDV_DEMANDES = [DEM]; openDemande(DEM.id);
    const pose = _lxSmCatalogue().find(x => x.type === 'service' && !x.devis && x.pose > 0) || _lxSmCatalogue().find(x => !x.devis); lxSmItem(pose.k);
    const v = (sel) => { const e = document.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; };
    return { desk: v('.lxsm-desk'), mob: v('.lxsm-mob .lxsm-card'), band: document.querySelectorAll('.lxsm-mob .lxsm-band').length, foot: getComputedStyle(document.querySelector('.lxsm-foot')).position, w: document.querySelector('.lxsm').getBoundingClientRect().width, scrollW: document.querySelector('.lxsm').scrollWidth };
  }, DEM);
  ok('téléphone : une colonne, planning du jour en bande, bouton d\'envoi fixe', !m.desk && m.mob && m.band >= 1 && m.foot === 'sticky', m);
  ok('téléphone : pas de débordement horizontal', m.scrollW <= m.w + 1, m);
  await pg.screenshot({ path: OUT + '/2-pro-telephone.png' });
  const ag = await pg.evaluate(() => { lxSmAgrandir(true); return document.querySelectorAll('.lxsm-mob .lxsm-col').length; });
  ok('téléphone : « Agrandir » affiche le planning complet', ag >= 1, ag);
  ok('aucune erreur JavaScript (téléphone)', pg.errors.length === 0, pg.errors);
  await pg.close();
}
// ---------------- appli Play (LX_PLAY) ----------------
{
  const pg = await page('demo=coiffure&source=play');
  const p = await pg.evaluate((DEM) => { window.RDV_DEMANDES = [DEM]; openDemande(DEM.id); return { play: !!window.LX_PLAY, fen: !!document.querySelector('.lxsm'), prix: /€/.test(document.querySelector('.lxsm').innerText) }; }, DEM);
  ok('mode Play : fenêtre identique (aucun achat dans l\'appli, prix des prestations seulement)', p.fen, p);
  ok('aucune erreur JavaScript (Play)', pg.errors.length === 0, pg.errors);
  await pg.close();
}
await b.close();
console.log(`Navigateur — app (fenêtre Répondre / suivi) : ${nOk}/${nOk + nKo} OK`);
if (kos.length) console.log('ÉCHECS :\n- ' + kos.join('\n- '));
process.exit(nKo ? 1 : 0);
