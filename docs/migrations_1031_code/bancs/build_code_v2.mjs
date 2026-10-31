import * as esbuild from "esbuild";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const plugin = { name: "remote", setup(b) {
  b.onResolve({ filter: /^https:\/\/esm\.sh\/@supabase\/supabase-js/ }, () => ({ path: require.resolve("@supabase/supabase-js") }));
  b.onResolve({ filter: /^https:\/\/deno\.land\/x\/djwt/ }, () => ({ path: "/tmp/em/djwt/mod.mjs" }));
} };
const W = "/sessions/quirky-affectionate-hypatia/wt-code2/";
await esbuild.build({ entryPoints: [W + "docs/edge_1014/lx-signup/index.ts"], bundle: true, format: "esm", platform: "node", outfile: "/tmp/em/edge_signup_code2.mjs", plugins: [plugin], logLevel: "error" });
await esbuild.build({ entryPoints: [W + "docs/luxyra-router-worker.js"], bundle: true, format: "esm", platform: "node", outfile: "/tmp/em/worker_bundle_code2.mjs", logLevel: "error" });
await esbuild.build({ entryPoints: [W + "docs/edge_1030_email/lx-profile/index.ts"], bundle: true, format: "esm", platform: "node", outfile: "/tmp/em/edge_profile_code2.mjs", plugins: [plugin], logLevel: "error" });
console.log("bundles OK");
