import * as esbuild from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const plugin = { name: "remote", setup(b) {
  b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: require.resolve("@supabase/supabase-js") }));
  b.onResolve({ filter: /^https:\/\/deno\.land\/x\/djwt/ }, () => ({ path: "/tmp/em/djwt/mod.mjs" }));
} };
const base = "/sessions/quirky-affectionate-hypatia/luxyra.fr/docs/edge_1030_email/";
for (const [f, out] of [["lx-profile", "edge_profile.mjs"], ["avant/lx-profile", "edge_profile_avant.mjs"], ["lx-brevo-webhook", "edge_webhook.mjs"]]) {
  await esbuild.build({ entryPoints: [base + f + "/index.ts"], bundle: true, format: "esm", platform: "node", outfile: "/tmp/em/" + out, plugins: [plugin], logLevel: "error" });
}
await esbuild.build({ entryPoints: ["/sessions/quirky-affectionate-hypatia/luxyra.fr/docs/luxyra-router-worker.js"], bundle: true, format: "esm", platform: "node", outfile: "/tmp/em/worker_bundle.mjs", logLevel: "error" });
await esbuild.build({ entryPoints: ["/sessions/quirky-affectionate-hypatia/luxyra.fr/docs/edge_1014/lx-password-reset/index.ts"], bundle: true, format: "esm", platform: "node", outfile: "/tmp/em/edge_reset.mjs", plugins: [plugin], logLevel: "error" });
await esbuild.build({ entryPoints: ["/sessions/quirky-affectionate-hypatia/luxyra.fr/docs/edge_1014/lx-signup/index.ts"], bundle: true, format: "esm", platform: "node", outfile: "/tmp/em/edge_signup.mjs", plugins: [plugin], logLevel: "error" });
console.log("bundles OK");
await esbuild.build({ entryPoints: ["/sessions/quirky-affectionate-hypatia/luxyra.fr/docs/edge_1030_surmesure/rdv-demande-propose/index.ts"], bundle: true, format: "esm", platform: "node", outfile: "/tmp/em/edge_propose.mjs", plugins: [plugin], logLevel: "error" });
console.log("propose OK");
