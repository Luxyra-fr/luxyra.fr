import fs from "node:fs";
import { creerBase } from "./base.mjs";
const { db } = await creerBase();
await db.query(`insert into support_bot_kb(cle,titre,contenu) values
 ('rdv_demande_modif_client','t','x\n- Proposition sur mesure dont le créneau a été pris avant que le client ne paie : ouvrir la demande › « 🕒 Proposer un autre horaire » (l''ancienne proposition n''est plus payable), puis envoyer la nouvelle proposition.'),
 ('cloche_notifications_1016','t','Types : « Demande sur mesure », « Proposition refusée », « Commande »'),
 ('accueil_ca_bandeaux_1016','t','- « ✨ N demande(s) sur mesure ».\nx'),
 ('site_reservation_reglages_1016','t','Carte « ✨ RDV sur mesure » : « Activer les RDV sur mesure » ajoute le bouton « Demander un RDV sur mesure » sur votre page ; vous répondez par une proposition.')`);
const sql = fs.readFileSync("/sessions/quirky-affectionate-hypatia/wt-surmesure/docs/migrations_1030_surmesure/bot_surmesure_v2.sql", "utf8");
let r = await db.exec(sql); console.log(JSON.stringify(r[r.length - 2].rows));
r = await db.exec(sql); console.log("rejeu", JSON.stringify(r[r.length - 2].rows), (await db.query("select count(*) n from support_bot_kb where cle='rdv_sur_mesure_v2_1030'")).rows[0].n);
