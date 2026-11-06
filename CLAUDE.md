# Luxyra — dépôt public (code en production)

Ce dépôt contient uniquement le code servi en production :
- le site et l'application (fichiers HTML/JS/CSS/images, publiés par GitHub Pages) ;
- le worker Cloudflare `docs/luxyra-router-worker.js` (déployé automatiquement par `.github/workflows/deploy-worker.yml` via `wrangler.toml`) ;
- les workflows GitHub (déploiement, sauvegarde de nuit, test de restauration).

## Documentation interne

Toute la documentation interne (notes de travail complètes, registre des interventions NF525, dossier technique,
dossiers de version, grille de classement, migrations SQL, sources des fonctions edge, bancs de tests,
procédures de l'éditeur) est dans le dépôt **privé** `Luxyra-fr/luxyra-docs` depuis le 06/11/2026.

Pour une session Claude : avant tout travail, cloner le dépôt privé à côté de celui-ci et lire son `CLAUDE.md` :

    git clone https://x-access-token:<JETON>@github.com/Luxyra-fr/luxyra-docs.git ../luxyra-docs

(jeton GitHub fourni par Alexandre ; ne jamais l'écrire dans un fichier, un commit ou une réponse).
Les nouveaux documents internes (registre, migrations, dossiers…) doivent être ajoutés dans `luxyra-docs`, jamais ici.
