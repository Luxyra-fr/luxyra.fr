import fs from "node:fs";
export const SQL_V2 = "/sessions/quirky-affectionate-hypatia/wt-surmesure/docs/migrations_1030_surmesure/surmesure_v2.sql";
export async function appliquerV2(db, fichier = SQL_V2) {
  let s = fs.readFileSync(fichier, "utf8");
  await db.exec("set search_path = public, extensions;");
  await db.exec(s);
}
