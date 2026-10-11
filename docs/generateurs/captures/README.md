# Captures du centre d'aide

Captures réelles de l'app en **mode démo** (données fictives), annotées automatiquement.

1. Servir le site : `python3 -m http.server 8765` à la racine du dépôt.
2. Chromium headless : `npm i @sparticuz/chromium puppeteer-core` dans un dossier de travail ; y copier `cap.mjs`, `anno.py`, `shots.json` et une image `bg.jpg` (fond d'écran par défaut de l'app, servi à la place d'Unsplash).
3. `node cap.mjs shots.json` → `raw/*.png` + `boxes.json` ; `python3 anno.py` → `out/*.webp` (pastilles numérotées).
4. `python3 docs/generateurs/aide_build.py <dossier>/out` → copie les images dans `aide/img/`, régénère `aide/*.html` et la section « Guides » de `aide.html`.

Le texte des guides est dans `docs/generateurs/aide_guides.py` : l'ordre des légendes = l'ordre des annotations (`ann`) du shot.
