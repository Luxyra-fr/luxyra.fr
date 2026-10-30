// Données FICTIVES pour le banc (aucune donnée de production). Établissement inspiré du catalogue type d'un salon de coiffure.
export const S = "11111111-1111-4111-8111-111111111111";      // établissement A (Stripe actif)
export const S2 = "22222222-2222-4222-8222-222222222222";     // établissement B (sans Stripe)
export const U = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";       // propriétaire de A
export const U2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";      // propriétaire de B
export const CL = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";      // compte client Luxyra
export const C1 = 501, C2 = 502, C3 = 601; // C1, C2 : A ; C3 : B

const H = (o, c) => ({ o, c });
const sem = (o, c) => ({ "1": { o, c }, "2": { o, c }, "3": { o, c }, "4": { o, c }, "5": { o, c }, "6": { o, c } });

export async function seed(db, { modeCaisse = "reel", stripe = true } = {}) {
  await db.exec(`
  insert into auth.users(id, email) values ('${U}', 'pro-a@exemple.test'), ('${U2}', 'pro-b@exemple.test') on conflict do nothing;
  insert into app_config(id, config) values (1, '{"recettes_en_ligne_serveur": true, "recettes_en_ligne_serveur_depuis": "2026-10-28T05:23:18Z", "recettes_en_ligne_version_min": "0", "stripe_charges_directes": true, "bons_tva_v2": true}') on conflict (id) do update set config = excluded.config;
  `);
  await db.query(`insert into salons(id, user_id, nom, slug, status, plan, trial_end, siret, taux_tva, mode_caisse, stripe_connect_id, stripe_connect_status, email, tel, adresse, cp, ville)
    values ($1, $2, 'Salon Test A', 'salon-test-a', 'active', 'pro', now() + interval '300 days', '91092846400023', 20, $3, $4, $5, 'salon-a@exemple.test', '0102030405', '20 rue Test', '57200', 'Sarreguemines'),
           ($6, $7, 'Salon Test B', 'salon-test-b', 'active', 'pro', now() + interval '300 days', '91092846400023', 20, 'reel', null, 'not_started', 'salon-b@exemple.test', '0102030406', '1 rue Test', '57200', 'Sarreguemines')
    on conflict (id) do nothing`, [S, U, modeCaisse, stripe ? "acct_TESTA" : null, stripe ? "active" : "not_started", S2, U2]);
  const hs = JSON.stringify({ "0": null, "1": { o: "09:00", c: "19:00" }, "2": { o: "09:00", c: "19:00" }, "3": { o: "09:00", c: "19:00" }, "4": { o: "09:00", c: "19:00" }, "5": { o: "09:00", c: "19:00" }, "6": { o: "09:00", c: "19:00" } });
  for (const s of [S, S2]) {
    await db.query(`insert into site_config(salon_id, site_actif, reservation_active, accept_rdv_sur_mesure, delai_min_heures, delai_max_jours, horaires_salon, absences)
      values ($1, true, true, true, 2, 60, $2::jsonb, '[]'::jsonb) on conflict do nothing`, [s, hs]);
  }
  await db.query(`insert into collaborateurs(id, salon_id, nom, initiales, actif, inactif) values ($1,$4,'Amandine','AM',true,false), ($2,$4,'Manue','MA',true,false), ($3,$5,'Bea','BE',true,false) on conflict do nothing`, [C1, C2, C3, S, S2]);
  // prestations : phases (t='w' travail, t='p' pose)
  const svc = [
    [9001, S, "COUPE BRUSHING COURT", 30, [{ t: "w", d: 30 }], false, true, "COUPE"],
    [9002, S, "MECHES COUPE BRUSHING MI LONG", 80, [{ t: "w", d: 60 }, { t: "p", d: 65 }, { t: "w", d: 45 }], false, false, "MECHES & BALAYAGES"],
    [9003, S, "COULEUR COUPE MI LONG", 68, [{ t: "w", d: 30 }, { t: "p", d: 30 }, { t: "w", d: 30 }], false, false, "COLORATION"],
    [9004, S, "MECHES MI LONG", 44, [{ t: "w", d: 40 }], false, true, "MECHES & BALAYAGES"],
    [9005, S, "SOIN SUR DEVIS", 0, [{ t: "w", d: 45 }], true, false, "SOINS"],
    [9006, S, "BRUSHING MI LONG", 22.5, [{ t: "w", d: 30 }], false, true, "BRUSHING"],
    [9101, S2, "COUPE B", 25, [{ t: "w", d: 30 }], false, true, "COUPE"],
  ];
  for (const [id, sal, nom, prix, ph, devis, book, cat] of svc)
    await db.query(`insert into services(id, salon_id, nom, prix, phases, actif, prix_sur_devis, book_online, show_site, categorie) values ($1,$2,$3,$4,$5::jsonb,true,$6,$7,true,$8) on conflict do nothing`, [id, sal, nom, prix, JSON.stringify(ph), devis, book, cat]);
  await db.query(`insert into forfaits(id, salon_id, nom, prix, categorie, services, phases, prix_sur_devis) values
    (7001, $1, 'FORFAIT MARIEE', 150, 'FORFAITS', '[]', '[{"t":"w","d":60,"l":"ESSAI"},{"t":"p","d":20,"l":"Pause"},{"t":"w","d":40,"l":"CHIGNON"}]', false),
    (7002, $1, 'FORFAIT SUR DEVIS', 0, 'FORFAITS', '[]', '[{"t":"w","d":60}]', true),
    (7101, $2, 'FORFAIT B', 90, 'FORFAITS', '[]', '[{"t":"w","d":60}]', false) on conflict do nothing`, [S, S2]);
  await db.query(`insert into clients_luxyra(id, email, password_hash, nom, prenom, telephone) values ($1, 'julie@exemple.test', 'x', 'M.', 'Julie', '0600000000') on conflict do nothing`, [CL]);
}

// jour ouvré à venir (Paris) : n jours après aujourd'hui, en évitant le dimanche
export function jour(n) {
  const d = new Date(Date.now() + n * 864e5);
  if (d.getUTCDay() === 0) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
