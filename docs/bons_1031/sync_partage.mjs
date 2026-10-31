// Copie EXACTE du bloc commun LXB-PARTAGE de lx-bon-cadeau.js dans l'edge gc-stripe-webhook (même rendu d'e-carte partout).
// node docs/bons_1031/sync_partage.mjs [--verifier]   (--verifier : échoue si l'edge n'est pas à jour)
import fs from "fs";
const racine = new URL("../../", import.meta.url).pathname;
const src = fs.readFileSync(racine + "lx-bon-cadeau.js", "utf8");
const edgeF = racine + "docs/edge_1031_bons/gc-stripe-webhook/index.ts";
const edge = fs.readFileSync(edgeF, "utf8");
const D = "  /*<<LXB-PARTAGE", F = "/*LXB-PARTAGE>>*/";
const bloc = src.slice(src.indexOf(D), src.indexOf(F) + F.length);
if (src.indexOf(D) < 0 || src.indexOf(F) < 0) throw new Error("bloc introuvable dans lx-bon-cadeau.js");
const i = edge.indexOf(D), j = edge.indexOf(F);
if (i < 0 || j < 0) throw new Error("marqueurs introuvables dans l'edge");
const nouveau = edge.slice(0, i) + bloc + edge.slice(j + F.length);
if (process.argv.includes("--verifier")) { if (nouveau !== edge) { console.error("EDGE PAS À JOUR"); process.exit(1); } console.log("bloc identique"); }
else { fs.writeFileSync(edgeF, nouveau); console.log("edge mis à jour (" + bloc.length + " car.)"); }
