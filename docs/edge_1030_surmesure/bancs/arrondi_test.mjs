// Contre-audit 30/10 (e) : l'acompte calculé par app.html (_lxSmCentimes + ligne d'acompte de _lxSmCalc, extraites du fichier)
// est-il IDENTIQUE à celui du serveur (lx_prive.demande_option_calculer) ? Grille de prix et de valeurs saisies.
import fs from "node:fs";
import { creerBase, commeRole } from "./base.mjs";
import { seed, S, jour } from "./seed.mjs";
import { appliquerV2 } from "./appliquer.mjs";
const app = fs.readFileSync("/sessions/quirky-affectionate-hypatia/wt-surmesure/app.html", "utf8");
const fC = /function _lxSmCentimes\(v\)\{.*\}\n/.exec(app)[0];
const ligne = /  if\(o\.acOn\)\{ var vc=_lxSmCentimes.*\n/.exec(app)[0];
const calcApp = new Function("prix", "o", fC + "var ac=0;\n" + ligne + "return ac;");
const { db } = await creerBase(); await seed(db); await appliquerV2(db);
const prixL = [22.5, 30, 0.99 + 1, 44, 80, 68.4, 150, 19.99, 33.33, 1234.56, 7.77];
const vals = { pct: ["30", "33.333", "33.335", "12.5", "100", "1", "66.67", "0.5", "99.99", "15,5"], montant: ["1", "10", "22.505", "7.499", "19.991", "0.999", "5,55", "12.345"] };
let n = 0, ko = 0; const ecarts = [];
for (const prix of prixL) {
  await db.query(`update services set prix=$1 where id=9006`, [prix]);
  for (const mode of ["pct", "montant"]) for (const v of vals[mode]) {
    const js = calcApp(prix, { acOn: true, acMode: mode, acVal: v });
    // la page envoie Number(valeur avec « . ») : même conversion que lxSmEnvoyer
    const envoye = Number(String(v).replace(",", "."));
    let sql = null;
    try { sql = Number((await db.query(`select lx_prive.demande_option_calculer($1,$2) r`, [S, JSON.stringify({ rang: 1, date: jour(50), heure: "10:00", items: [{ type: "service", id: 9006 }], acompte_mode: mode, acompte_valeur: envoye })])).rows[0].r.acompte_montant); }
    catch (e) { sql = "refus:" + (e.hint || e.message).slice(0, 30); }
    n++;
    const attendu = typeof sql === "number" ? sql : null;
    // l'app refuse avant l'envoi si l'acompte < 1 € ou > total : dans ce cas le serveur refuse aussi
    const appRefuse = !(js >= 1) || js > prix;
    const okk = attendu !== null ? (!appRefuse && js === attendu) : appRefuse;
    if (!okk) { ko++; ecarts.push({ prix, mode, v, js, sql }); }
  }
}
console.log(`arrondi app = serveur : ${n - ko}/${n} OK`);
if (ecarts.length) console.log(JSON.stringify(ecarts.slice(0, 20)));
process.exit(ko ? 1 : 0);
