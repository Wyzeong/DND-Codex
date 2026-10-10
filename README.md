# Codex de campagne

PWA de suivi de campagne D&D 3.5 : fiches de personnages, grimoire et progression prévisionnelle.
Tout est stocké dans le navigateur de chaque joueur (localStorage). Le partage se fait par export/import de fichiers JSON.

## Fichiers
- `index.html`, `styles.css`, `app.js` : l'application
- `spells.json` : les 605 sorts du SRD 3.5 (Open Game License), descriptions résumées en français
- `manifest.json`, `sw.js`, `icons/` : installation et fonctionnement hors ligne

## Mise à jour
Après toute modification, incrémente `CACHE` dans `sw.js` (`codex-v1` → `codex-v2`) pour que les appareils récupèrent la nouvelle version.
Pour ajouter des sorts à `spells.json`, incrémente aussi son champ `version`. Au chargement suivant, chaque appareil ajoute les nouveaux sorts et met à jour ceux qui n'ont pas été modifiés à la main. Les sorts modifiés, supprimés ou ajoutés à la main ne sont pas touchés.
