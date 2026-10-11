# L'Éveil du Givre Éternel : codex de campagne

PWA de suivi de campagne D&D 3.5 : fiches de personnages, grimoire et progression prévisionnelle.
Tout est stocké dans le navigateur de chaque joueur (localStorage). Le partage se fait par export/import de fichiers JSON.

## Fichiers
- `index.html`, `styles.css`, `app.js` : l'application
- `regles.js` : règles D&D 3.5 (races, classes, dons, compétences, sorts par jour) utilisées pour les calculs
- `spells.json` : les 605 sorts du SRD 3.5 (Open Game License), descriptions résumées en français
- `manifest.json`, `sw.js`, `icons/` : installation et fonctionnement hors ligne

## Mise à jour
Après toute modification, incrémente `CACHE` dans `sw.js` (`codex-v1` → `codex-v2`) pour que les appareils récupèrent la nouvelle version.
Pour ajouter des sorts à `spells.json`, incrémente aussi son champ `version`. Au chargement suivant, chaque appareil ajoute les nouveaux sorts et met à jour ceux qui n'ont pas été modifiés à la main. Les sorts modifiés, supprimés ou ajoutés à la main ne sont pas touchés.

## Récapitulatifs communs
Les récapitulatifs de session publiés sont dans `recaps.json`, à la racine du site. Ce fichier n'est jamais fourni dans les mises à jour de l'appli, pour ne pas écraser les récits déjà publiés. Pour publier : Journal, Récapitulatifs, « Exporter recaps.json », copier le fichier dans le dossier du dépôt, puis commit et push.
Les notes de session restent stockées uniquement sur l'appareil de chaque joueur.

## Base de données en ligne (Supabase)
Si `config.js` existe à la racine du site avec l'URL du projet Supabase et sa clé « publishable », les récapitulatifs sont lus et publiés en ligne (le fichier recaps.json n'est alors plus utilisé). La structure de la base est créée par `supabase.sql`, à exécuter une fois dans le SQL Editor de Supabase. `config.js` et `recaps.json` ne sont jamais fournis dans les mises à jour, pour ne pas écraser les réglages du site.

### Droits (base en ligne, script supabase-v2.sql)
- Récapitulatifs : lecture pour tous, écriture avec le code administrateur.
- Personnages : lecture pour tous, modification avec le code personnel du personnage (ou le code administrateur).
- Notes de session : rattachées à un personnage, lisibles et modifiables uniquement avec son code personnel.

### Espace MJ (script supabase-v5.sql)
- Code MJ distinct du code administrateur, stocké dans la base.
- Le MJ ajuste les PV des joueurs, consomme une ration pour tout le groupe et passe au jour suivant (PV, dés de vie, sorts et capacités rechargés).
- Personnages du MJ : version complète privée (table persos_mj), version publique filtrée selon ses réglages de visibilité (table persos).
