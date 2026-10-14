# Captures du centre d'aide

Captures réelles de l'app en **mode démo** (données fictives), annotées automatiquement.

1. Servir le site : `python3 -m http.server 8765` à la racine du dépôt.
2. Chromium headless : `npm i @sparticuz/chromium puppeteer-core` dans un dossier de travail ; y copier `cap.mjs`, `anno.py`, `shots.json` et une image `bg.jpg` (fond d'écran par défaut de l'app, servi à la place d'Unsplash).
3. `node cap.mjs shots.json` → `raw/*.png` + `boxes.json` ; `python3 anno.py` → `out/*.webp` (pastilles numérotées).
4. `python3 docs/generateurs/aide_build.py <dossier>/out` → copie les images dans `aide/img/`, régénère `aide/*.html` et la section « Guides » de `aide.html`.

Le texte des guides est dans `docs/generateurs/aide_guides.py` : l'ordre des légendes = l'ordre des annotations (`ann`) du shot.

## Champs ajoutés le 15/10/2026 (cap.mjs)
- `page` : page à ouvrir (défaut `app.html`) ; `q` : paramètres (défaut `demo=coiffure`, `""` = aucun).
- `ls` : localStorage posé avant le chargement (ex. `lx_token` + `lx_account` fictifs pour `compte.html`).
- `mock` : sous-chaîne d'URL → réponse JSON pour les appels `/api/` et Supabase (tout le reste est bloqué : aucune requête ne part vers la production).
- `ready` : expression JS attendue avant les étapes (défaut : app pro chargée).
Exemples : `compte_verif`, `compte_rdv_statuts`… (espace client avec données fictives), `notifs_attente` (notification injectée dans les tables de démo), `z_bloquee` (file de secours simulée dans le localStorage de démo), `session_expiree`.
Le drapeau `_lxDemo` est remis en place juste après `lxSessionPerdue` ; en démo, `lx-demo.js` remplace le client Supabase et bloque tous les appels réseau sortants.
