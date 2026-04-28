# Patch Cloudflare Worker `luxyra-router` — URLs propres `/<slug>`

## Objectif

Permettre à `https://luxyra.fr/excellence-coiffure` de servir la fiche du salon
`Excellence Coiffure` sans que l'utilisateur voie un `?s=...` ou `/site.html`.

## Comment ça marche

Aujourd'hui le Worker prend une requête sur `luxyra.fr/<chemin>` et fait un
`fetch` vers `https://luxyra-fr.github.io/<chemin>` puis renvoie la réponse
au navigateur. Pour qu'un slug fonctionne, on doit dire au Worker :

> Si le chemin est un slug valide (un seul segment, sans extension, qui
> ne fait pas partie des routes système connues), on **réécrit** l'URL en
> `https://luxyra-fr.github.io/site.html?slug=<segment>` avant de fetcher.

Le client final voit toujours `luxyra.fr/excellence-coiffure` dans la barre
d'adresse — le rewrite est transparent.

## Étape 1 — Patch à coller dans le Worker

Va sur `dash.cloudflare.com` → **Workers & Pages** → **luxyra-router** →
**Quick Edit**.

Dans le code du Worker, il y a déjà une fonction qui calcule l'URL à fetcher
sur GitHub Pages (probablement quelque chose comme
`const upstream = "https://luxyra-fr.github.io" + url.pathname + url.search;`).

**Au-dessus de ce calcul, ajoute :**

```js
// =====================================================================
// SLUG ROUTING : rewrite /<slug> -> /site.html?slug=<slug>
// =====================================================================
// Routes système qui ne sont PAS des slugs salon
const RESERVED_PATHS = new Set([
  '', 'index.html', 'pro', 'pro.html',
  'app', 'app.html', 'compte', 'compte.html',
  'recherche', 'recherche.html', 'inscription', 'inscription.html',
  'proposal', 'proposal.html',
  'admin', 'admin.html', 'site.html',
  'cgv', 'cgv.html', 'mentions-legales', 'mentions-legales.html',
  'politique-confidentialite', 'politique-confidentialite.html',
  'suppression-donnees', 'suppression-donnees.html',
  'reset-password', 'reset-password.html', 'dpa', 'dpa.html',
  'clear', 'clear.html', 'preview-email-confirmation', 'preview-email-confirmation.html',
  'sw.js', 'manifest.json', 'manifest-app.json', 'manifest-admin.json',
  'icon-192.png', 'icon-512.png', 'luxyra-logo.png', '.nojekyll',
  'README.md', 'CLAUDE.md',
  'bp-client.js', 'luxyra-supabase.js', 'supabase.min.js'
]);

const path = url.pathname.replace(/^\/+|\/+$/g, ''); // sans leading/trailing /
const isOneSegment = path && !path.includes('/');
const hasExtension = /\.[a-z0-9]+$/i.test(path);
const looksLikeSlug = isOneSegment
  && !hasExtension
  && /^[a-z0-9][a-z0-9-]{1,79}$/i.test(path)
  && !RESERVED_PATHS.has(path)
  && !RESERVED_PATHS.has(path + '.html');

if (looksLikeSlug) {
  // Réécrit la requête : on va fetcher /site.html?slug=<path> sur GitHub Pages
  url.pathname = '/site.html';
  url.searchParams.set('slug', path);
}
// =====================================================================
```

**Important** : la variable doit s'appeler `url` (objet `URL`). Si dans
ton Worker elle a un autre nom (ex: `reqUrl`, `u`), adapte le bloc.

## Étape 2 — Vérifier que les routes existantes marchent toujours

Avant de déployer, vérifie que ces URLs continuent de fonctionner :

- `https://luxyra.fr/` → home cliente
- `https://luxyra.fr/pro` → pitch pro
- `https://luxyra.fr/recherche` → carte salons
- `https://luxyra.fr/inscription` → form inscription
- `https://luxyra.fr/compte` → compte cliente
- `https://luxyra.fr/proposal.html?t=xxx` → page proposition RDV
- `https://luxyra.fr/site.html?s=<uuid>` → fiche salon (rétrocompat)

Et la nouvelle :

- `https://luxyra.fr/excellence-coiffure` → fiche Excellence Coiffure ✨

## Étape 3 — Activer le mode "URLs propres" dans le code front

Une fois le Worker patché et testé, il faut basculer le flag dans le repo :

Dans **`site.html`**, **`index.html`**, **`recherche.html`** :

```js
var LX_CLEAN_URLS=false;  // ← passer à true
```

→ devient :

```js
var LX_CLEAN_URLS=true;
```

Tous les générateurs de liens vont alors produire `/<slug>` au lieu de
`/site.html?slug=<slug>`. Et `site.html` redirigera automatiquement
`/site.html?s=<uuid>` vers `/<slug>` quand un slug existe.

## Plan de rollback

Si quelque chose casse :

1. Dans le Worker, supprimer le bloc ajouté → comportement d'avant.
2. Dans le code front, repasser `LX_CLEAN_URLS=false` (commit, push).
3. Les vieux liens `?s=<uuid>` continuent de marcher dans tous les cas
   (compatibilité descendante prévue dans `site.html`).

## Notes techniques

- La détection `looksLikeSlug` accepte `[a-z0-9][a-z0-9-]{1,79}` ce qui
  matche exactement le format produit par la fonction Postgres `slugify()`.
- `RESERVED_PATHS` doit être maintenu en miroir avec
  `is_reserved_slug()` côté DB (cf. migration `salon_slug_system`) et
  avec `LX_RESERVED_SLUGS` côté JS (`app.html → saveSlug`).
- Si un nouveau fichier statique est ajouté à la racine du repo
  (ex: `nouvelle-page.html`), il faut l'ajouter à `RESERVED_PATHS`
  pour ne pas qu'il soit interprété comme un slug salon.
