import * as esbuild from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const plugin = { name: "esm-sh", setup(b) { b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: require.resolve("@supabase/supabase-js") })); } };
const base = "/sessions/quirky-affectionate-hypatia/wt-surmesure/docs/edge_1030_surmesure/";
for (const [f, out] of [["rdv-demande-propose", "edge_propose.mjs"], ["rdv-demande-proposal-action", "edge_action.mjs"], ["avant/rdv-demande-proposal-action", "edge_action_v13.mjs"]]) {
  await esbuild.build({ entryPoints: [base + f + "/index.ts"], bundle: true, format: "esm", platform: "node", outfile: "/tmp/sm/" + out, plugins: [plugin], logLevel: "error" });
}
console.log("edge bundles OK");
