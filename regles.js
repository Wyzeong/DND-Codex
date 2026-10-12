'use strict';
/* ============================================================
   Règles D&D 3.5 (SRD, Open Game License) utilisées par le Codex.
   Les textes sont des résumés ; la référence reste le Manuel des Joueurs.
   ============================================================ */

const R = {};

R.CARACS = [
  { k: 'for', l: 'FOR', n: 'Force' },
  { k: 'dex', l: 'DEX', n: 'Dextérité' },
  { k: 'con', l: 'CON', n: 'Constitution' },
  { k: 'int', l: 'INT', n: 'Intelligence' },
  { k: 'sag', l: 'SAG', n: 'Sagesse' },
  { k: 'cha', l: 'CHA', n: 'Charisme' },
];
R.mod = v => (v === '' || v == null || isNaN(Number(v))) ? 0 : Math.floor((Number(v) - 10) / 2);
R.signe = n => (n >= 0 ? '+' : '−') + Math.abs(n);

R.ALIGNEMENTS = ['Loyal bon', 'Neutre bon', 'Chaotique bon', 'Loyal neutre', 'Neutre strict', 'Chaotique neutre', 'Loyal mauvais', 'Neutre mauvais', 'Chaotique mauvais'];
R.DIVINITES = ['Aucune', 'Boccob', 'Corellon Larethian', 'Ehlonna', 'Erythnul', 'Fharlanghn', 'Garl Brilledor', 'Gruumsh', 'Heironeous', 'Hextor', 'Kord', 'Moradin', 'Nerull', 'Obad-Haï', 'Olidammara', 'Pelor', 'Saint Cuthbert', 'Vecna', 'Wee Jas', 'Yondalla'];
R.SEXES = ['Masculin', 'Féminin', 'Autre'];
R.LANGUES = ['Commun', 'Nain', 'Elfe', 'Gnome', 'Halfelin', 'Orque', 'Gobelin', 'Géant', 'Gnoll', 'Draconien', 'Sylvestre', 'Céleste', 'Infernal', 'Abyssal', 'Aquatique', 'Aérien', 'Igné', 'Terreux', 'Commun des profondeurs', 'Druidique'];

R.TAILLES = {
  P: { nom: 'Petite', ca: 1, lutte: -4 },
  M: { nom: 'Moyenne', ca: 0, lutte: 0 },
};

/* ---------- Races ---------- */
R.RACES = {
  humain: {
    nom: 'Humain', taille: 'M', vitesse: 9, ajust: 'Aucun', classeFav: 'Au choix (la plus élevée)',
    langues: 'Commun + langues supplémentaires au choix',
    donBonus: true, pcBonus: true, comp: {},
    traits: [
      ['Don supplémentaire', 'Un don en plus au niveau 1.'],
      ['Compétences supplémentaires', '4 points de compétence de plus au niveau 1, puis 1 de plus à chaque niveau.'],
    ],
  },
  nain: {
    nom: 'Nain', taille: 'M', vitesse: 6, ajust: '+2 Con, −2 Cha', classeFav: 'Guerrier', langues: 'Commun, nain',
    comp: {},
    traits: [
      ['Vitesse', '6 m, jamais réduite par une armure intermédiaire ou lourde, ni par une charge.'],
      ['Vision dans le noir', 'Voit dans le noir total jusqu\'à 18 m, en noir et blanc.'],
      ['Connaissance de la pierre', '+2 aux tests de Fouille pour repérer les travaux de maçonnerie inhabituels ; test automatique à 3 m.'],
      ['Familiarité avec les armes', 'Hache de guerre naine et ourgrosh nain traités comme des armes de guerre.'],
      ['Stabilité', '+4 aux tests pour résister à une bousculade ou un croc-en-jambe, s\'il se tient sur le sol.'],
      ['Résistance au poison', '+2 aux jets de sauvegarde contre le poison.'],
      ['Résistance aux sorts', '+2 aux jets de sauvegarde contre les sorts et pouvoirs magiques.'],
      ['Haine raciale', '+1 aux jets d\'attaque contre les orques et les gobelinoïdes.'],
      ['Entraînement défensif', '+4 d\'esquive à la CA contre les géants.'],
      ['Affinité avec la pierre et le métal', '+2 aux tests d\'Estimation et d\'Artisanat liés à la pierre ou au métal.'],
    ],
  },
  elfe: {
    nom: 'Elfe', taille: 'M', vitesse: 9, ajust: '+2 Dex, −2 Con', classeFav: 'Magicien', langues: 'Commun, elfe',
    comp: { 'perception': 2, 'fouille': 2, 'detection': 2 },
    traits: [
      ['Immunité', 'Immunisé contre le sommeil magique ; +2 aux jets contre les enchantements.'],
      ['Vision nocturne', 'Voit deux fois plus loin qu\'un humain en faible lumière.'],
      ['Armes', 'Maniement de l\'épée longue, de la rapière, de l\'arc long et de l\'arc court.'],
      ['Sens aiguisés', '+2 en Perception auditive, Fouille et Détection ; test de Fouille automatique à 1,5 m d\'une porte secrète.'],
    ],
  },
  gnome: {
    nom: 'Gnome', taille: 'P', vitesse: 6, ajust: '+2 Con, −2 For', classeFav: 'Barde', langues: 'Commun, gnome',
    comp: { 'perception': 2 },
    traits: [
      ['Petite taille', '+1 à la CA et aux jets d\'attaque, +4 en Discrétion, −4 en lutte.'],
      ['Vision nocturne', 'Voit deux fois plus loin qu\'un humain en faible lumière.'],
      ['Illusions', '+2 aux jets contre les illusions ; +1 au DD de ses propres illusions.'],
      ['Haine raciale', '+1 aux jets d\'attaque contre les kobolds et les gobelinoïdes.'],
      ['Entraînement défensif', '+4 d\'esquive à la CA contre les géants.'],
      ['Sens aiguisés', '+2 en Perception auditive et en Artisanat (alchimie).'],
      ['Pouvoirs magiques', 'Communication avec les animaux (mammifères fouisseurs) 1/jour ; avec Cha 10+ : Lumières dansantes, Son imaginaire et Prestidigitation 1/jour chacun.'],
    ],
  },
  'demi-elfe': {
    nom: 'Demi-elfe', taille: 'M', vitesse: 9, ajust: 'Aucun', classeFav: 'Au choix (la plus élevée)', langues: 'Commun, elfe',
    comp: { 'perception': 1, 'fouille': 1, 'detection': 1, 'diplomatie': 2, 'renseignements': 2 },
    traits: [
      ['Immunité', 'Immunisé contre le sommeil magique ; +2 aux jets contre les enchantements.'],
      ['Vision nocturne', 'Voit deux fois plus loin qu\'un humain en faible lumière.'],
      ['Sens aiguisés', '+1 en Perception auditive, Fouille et Détection ; +2 en Diplomatie et Renseignements.'],
      ['Sang elfe', 'Considéré comme un elfe pour les effets liés à la race.'],
    ],
  },
  'demi-orque': {
    nom: 'Demi-orque', taille: 'M', vitesse: 9, ajust: '+2 For, −2 Int, −2 Cha', classeFav: 'Barbare', langues: 'Commun, orque',
    comp: {},
    traits: [
      ['Vision dans le noir', 'Voit dans le noir total jusqu\'à 18 m, en noir et blanc.'],
      ['Sang orque', 'Considéré comme un orque pour les effets liés à la race.'],
    ],
  },
  halfelin: {
    nom: 'Halfelin', taille: 'P', vitesse: 6, ajust: '+2 Dex, −2 For', classeFav: 'Roublard', langues: 'Commun, halfelin',
    comp: { 'escalade': 2, 'saut': 2, 'deplacement-silencieux': 2, 'perception': 2 },
    traits: [
      ['Petite taille', '+1 à la CA et aux jets d\'attaque, +4 en Discrétion, −4 en lutte.'],
      ['Agile', '+2 en Escalade, Saut, Déplacement silencieux et Perception auditive.'],
      ['Chanceux', '+1 à tous les jets de sauvegarde.'],
      ['Courageux', '+2 de moral aux jets contre la terreur.'],
      ['Adresse', '+1 aux jets d\'attaque avec les armes de jet et la fronde.'],
    ],
  },

  /* ----- Races moins communes (Manuel des Monstres, Royaumes Oubliés) -----
     ajNiv : ajustement de niveau (le personnage compte comme plus haut niveau pour l'expérience).
     res, imm, jsc, rm : résistances, immunités, bonus de sauvegarde et résistance à la magie, repris dans la fiche. */
  drow: {
    nom: 'Drow (elfe noir)', rare: true, taille: 'M', vitesse: 9, ajust: '+2 Dex, −2 Con, +2 Int, +2 Cha', ajNiv: 2,
    classeFav: 'Magicienne (femme : Prêtresse)', langues: 'Commun, elfe, commun des profondeurs',
    comp: { perception: 2, fouille: 2, detection: 2 }, imm: ['sommeil'], jsc: { enchantements: 2, sorts: 2 }, rm: 'niv+11',
    traits: [
      ['Vision dans le noir', 'Voit dans le noir total jusqu\'à 36 m, en noir et blanc.'],
      ['Résistance à la magie', '11 + niveau de classe : un sort qui le vise doit d\'abord vaincre cette résistance (d20 + niveau du lanceur).'],
      ['Immunité', 'Immunisé contre le sommeil magique ; +2 aux jets contre les enchantements.'],
      ['Volonté de fer', '+2 aux jets de Volonté contre les sorts et pouvoirs magiques.'],
      ['Pouvoirs magiques', '1 fois par jour : lumières dansantes, ténèbres, lueur féerique (niveau de lanceur = niveau de classe).'],
      ['Aveuglé par la lumière', 'Une lumière vive soudaine (soleil, lumière du jour) l\'aveugle 1 round ; ensuite −1 aux attaques, sauvegardes et tests tant qu\'il reste en pleine lumière.'],
      ['Armes', 'Maîtrise l\'arbalète de poing, la rapière et l\'épée courte.'],
      ['Sens aiguisés', '+2 en Perception auditive, Fouille et Détection ; repère les portes secrètes en passant à 1,5 m.'],
      ['Ajustement de niveau +2', 'Compte comme 2 niveaux de plus pour l\'expérience (si votre MJ applique cette règle).'],
    ],
  },
  'elfe-sylvestre': {
    nom: 'Elfe sylvestre', rare: true, taille: 'M', vitesse: 9, ajust: '+2 For, +2 Dex, −2 Con, −2 Int', classeFav: 'Rôdeur', langues: 'Commun, elfe',
    comp: { perception: 2, fouille: 2, detection: 2 }, imm: ['sommeil'], jsc: { enchantements: 2 },
    traits: [
      ['Vision nocturne', 'Voit deux fois plus loin qu\'un humain sous la lune, les étoiles ou une torche.'],
      ['Immunité', 'Immunisé contre le sommeil magique ; +2 aux jets contre les enchantements.'],
      ['Armes', 'Maîtrise l\'épée longue, la rapière, l\'arc long et l\'arc court.'],
      ['Sens aiguisés', '+2 en Perception auditive, Fouille et Détection.'],
    ],
  },
  'elfe-gris': {
    nom: 'Elfe gris', rare: true, taille: 'M', vitesse: 9, ajust: '−2 For, +2 Dex, −2 Con, +2 Int', classeFav: 'Magicien', langues: 'Commun, elfe',
    comp: { perception: 2, fouille: 2, detection: 2 }, imm: ['sommeil'], jsc: { enchantements: 2 },
    traits: [
      ['Vision nocturne', 'Voit deux fois plus loin qu\'un humain par faible éclairage.'],
      ['Immunité', 'Immunisé contre le sommeil magique ; +2 aux jets contre les enchantements.'],
      ['Sens aiguisés', '+2 en Perception auditive, Fouille et Détection.'],
    ],
  },
  'elfe-aquatique': {
    nom: 'Elfe aquatique', rare: true, taille: 'M', vitesse: 9, ajust: '+2 Dex, −2 Int', classeFav: 'Guerrier', langues: 'Commun, elfe, aquatique',
    comp: { perception: 2, fouille: 2, detection: 2 }, imm: ['sommeil'], jsc: { enchantements: 2 },
    traits: [
      ['Nage', 'Vitesse de nage de 12 m ; respire sous l\'eau (amphibie).'],
      ['Vision dans l\'ombre', 'Vision nocturne ; vision dans le noir 18 m sous l\'eau.'],
      ['Immunité', 'Immunisé contre le sommeil magique ; +2 aux jets contre les enchantements.'],
    ],
  },
  duergar: {
    nom: 'Duergar (nain gris)', rare: true, taille: 'M', vitesse: 6, ajust: '+2 Con, −4 Cha', ajNiv: 1, classeFav: 'Guerrier', langues: 'Commun, nain, commun des profondeurs',
    comp: { 'deplacement-silencieux': 4, perception: 1, detection: 1 }, imm: ['paralysie', 'poison'], jsc: { sorts: 2 },
    traits: [
      ['Vision dans le noir', 'Jusqu\'à 36 m.'],
      ['Immunités', 'Immunisé contre la paralysie, les illusions de type fantasme et le poison.'],
      ['Résistance aux sorts', '+2 aux jets de sauvegarde contre les sorts et pouvoirs magiques.'],
      ['Pouvoirs magiques', '1 fois par jour : agrandissement et invisibilité (sur lui-même).'],
      ['Sensibilité à la lumière', '−2 aux jets d\'attaque en pleine lumière.'],
      ['Connaissance de la pierre', 'Comme les nains.'],
      ['Ajustement de niveau +1', 'Compte comme 1 niveau de plus pour l\'expérience.'],
    ],
  },
  svirfnebelin: {
    nom: 'Svirfnebelin (gnome des profondeurs)', rare: true, taille: 'P', vitesse: 6, ajust: '−2 For, +2 Dex, +2 Sag, −4 Cha', ajNiv: 3, classeFav: 'Roublard', langues: 'Commun, gnome, commun des profondeurs',
    comp: { discretion: 2, perception: 2 }, jsc: { sorts: 2 }, rm: 'niv+11',
    traits: [
      ['Vision dans le noir', 'Jusqu\'à 36 m.'],
      ['Résistance à la magie', '11 + niveau de classe.'],
      ['Esquive', '+4 d\'esquive à la CA contre toutes les attaques.'],
      ['Pouvoirs magiques', '1 fois par jour : cécité/surdité, flou, déguisement ; protégé en permanence par antidétection.'],
      ['Ajustement de niveau +3', 'Compte comme 3 niveaux de plus pour l\'expérience.'],
    ],
  },
  aasimar: {
    nom: 'Aasimar', rare: true, taille: 'M', vitesse: 9, ajust: '+2 Sag, +2 Cha', ajNiv: 1, classeFav: 'Paladin', langues: 'Commun, céleste',
    comp: { perception: 2, detection: 2 }, res: { acide: 5, froid: 5, electricite: 5 },
    traits: [
      ['Ascendance céleste', 'Un ancêtre venu des plans du Bien.'],
      ['Vision dans le noir', 'Jusqu\'à 18 m.'],
      ['Résistances', 'Résistance 5 à l\'acide, au froid et à l\'électricité.'],
      ['Pouvoir magique', '1 fois par jour : lumière du jour.'],
      ['Ajustement de niveau +1', 'Compte comme 1 niveau de plus pour l\'expérience.'],
    ],
  },
  tieffelin: {
    nom: 'Tieffelin', rare: true, taille: 'M', vitesse: 9, ajust: '+2 Dex, +2 Int, −2 Cha', ajNiv: 1, classeFav: 'Roublard', langues: 'Commun, infernal',
    comp: { bluff: 2, discretion: 2 }, res: { froid: 5, electricite: 5, feu: 5 },
    traits: [
      ['Ascendance infernale', 'Un ancêtre venu des plans du Mal.'],
      ['Vision dans le noir', 'Jusqu\'à 18 m.'],
      ['Résistances', 'Résistance 5 au froid, à l\'électricité et au feu.'],
      ['Pouvoir magique', '1 fois par jour : ténèbres.'],
      ['Ajustement de niveau +1', 'Compte comme 1 niveau de plus pour l\'expérience.'],
    ],
  },
  'genasi-air': {
    nom: 'Génasi de l\'air', rare: true, taille: 'M', vitesse: 9, ajust: '+2 Dex, +2 Int, −2 Sag, −2 Cha', ajNiv: 1, classeFav: 'Guerrier', langues: 'Commun, aérien',
    comp: {},
    traits: [['Vision dans le noir', 'Jusqu\'à 18 m.'], ['Souffle', 'N\'a pas besoin de respirer.'], ['Pouvoir magique', '1 fois par jour : lévitation.'], ['Ajustement de niveau +1', 'Compte comme 1 niveau de plus pour l\'expérience.']],
  },
  'genasi-terre': {
    nom: 'Génasi de la terre', rare: true, taille: 'M', vitesse: 9, ajust: '+2 For, +2 Con, −2 Sag, −2 Cha', ajNiv: 1, classeFav: 'Guerrier', langues: 'Commun, terreux',
    comp: {},
    traits: [['Vision dans le noir', 'Jusqu\'à 18 m.'], ['Pouvoir magique', '1 fois par jour : passage sans trace.'], ['Ajustement de niveau +1', 'Compte comme 1 niveau de plus pour l\'expérience.']],
  },
  'genasi-feu': {
    nom: 'Génasi du feu', rare: true, taille: 'M', vitesse: 9, ajust: '+2 Int, −2 Cha', ajNiv: 1, classeFav: 'Guerrier', langues: 'Commun, igné',
    comp: {}, res: { feu: 5 },
    traits: [['Vision dans le noir', 'Jusqu\'à 18 m.'], ['Résistance', 'Résistance 5 au feu.'], ['Pouvoir magique', '1 fois par jour : contrôle des flammes.'], ['Ajustement de niveau +1', 'Compte comme 1 niveau de plus pour l\'expérience.']],
  },
  'genasi-eau': {
    nom: 'Génasi de l\'eau', rare: true, taille: 'M', vitesse: 9, ajust: '+2 Con, −2 Cha', ajNiv: 1, classeFav: 'Guerrier', langues: 'Commun, aquatique',
    comp: {}, res: { acide: 5 },
    traits: [['Vision dans le noir', 'Jusqu\'à 18 m.'], ['Amphibie', 'Respire sous l\'eau ; vitesse de nage de 9 m.'], ['Pouvoir magique', '1 fois par jour : création d\'eau.'], ['Ajustement de niveau +1', 'Compte comme 1 niveau de plus pour l\'expérience.']],
  },
  hobgobelin: {
    nom: 'Hobgobelin', rare: true, taille: 'M', vitesse: 9, ajust: '+2 Dex, +2 Con', ajNiv: 1, classeFav: 'Guerrier', langues: 'Commun, gobelin',
    comp: { 'deplacement-silencieux': 4 },
    traits: [['Vision dans le noir', 'Jusqu\'à 18 m.'], ['Discret', '+4 en Déplacement silencieux.'], ['Ajustement de niveau +1', 'Compte comme 1 niveau de plus pour l\'expérience.']],
  },
  gobelin: {
    nom: 'Gobelin', rare: true, taille: 'P', vitesse: 9, ajust: '−2 For, +2 Dex, −2 Cha', classeFav: 'Roublard', langues: 'Gobelin, commun',
    comp: { 'deplacement-silencieux': 4, equitation: 4 },
    traits: [['Petite taille', '+1 à la CA et aux attaques, +4 en Discrétion, −4 en lutte.'], ['Vision dans le noir', 'Jusqu\'à 18 m.'], ['Discret', '+4 en Déplacement silencieux et en Équitation.']],
  },
  kobold: {
    nom: 'Kobold', rare: true, taille: 'P', vitesse: 9, ajust: '−4 For, +2 Dex, −2 Con', classeFav: 'Ensorceleur', langues: 'Draconien',
    comp: { artisanat: 2, fouille: 2 },
    traits: [['Petite taille', '+1 à la CA et aux attaques, +4 en Discrétion, −4 en lutte.'], ['Vision dans le noir', 'Jusqu\'à 18 m.'], ['Armure naturelle', '+1 à la CA (à ajouter dans les ajustements).'], ['Sensibilité à la lumière', 'Ébloui en pleine lumière : −1 aux attaques.'], ['Artisan', '+2 en Artisanat (pièges) et en Fouille.']],
  },
  orque: {
    nom: 'Orque', rare: true, taille: 'M', vitesse: 9, ajust: '+4 For, −2 Int, −2 Sag, −2 Cha', classeFav: 'Barbare', langues: 'Orque, commun',
    comp: {},
    traits: [['Vision dans le noir', 'Jusqu\'à 18 m.'], ['Sensibilité à la lumière', 'Ébloui en pleine lumière : −1 aux attaques.']],
  },
};

/* ---------- Compétences ---------- */
R.COMPETENCES = [
  ['acrobaties', 'Acrobaties', 'dex', true], ['art-magie', 'Art de la magie', 'int', true], ['artisanat', 'Artisanat', 'int'],
  ['bluff', 'Bluff', 'cha'], ['concentration', 'Concentration', 'con'],
  ['conn-mysteres', 'Connaissances (mystères)', 'int', true], ['conn-architecture', 'Connaissances (architecture et ingénierie)', 'int', true],
  ['conn-donjons', 'Connaissances (exploration souterraine)', 'int', true], ['conn-geographie', 'Connaissances (géographie)', 'int', true],
  ['conn-histoire', 'Connaissances (histoire)', 'int', true], ['conn-local', 'Connaissances (folklore local)', 'int', true],
  ['conn-nature', 'Connaissances (nature)', 'int', true], ['conn-noblesse', 'Connaissances (noblesse et royauté)', 'int', true],
  ['conn-religion', 'Connaissances (religion)', 'int', true], ['conn-plans', 'Connaissances (plans)', 'int', true],
  ['contrefacon', 'Contrefaçon', 'int'], ['crochetage', 'Crochetage', 'dex', true], ['decryptage', 'Décryptage', 'int', true],
  ['deguisement', 'Déguisement', 'cha'], ['deplacement-silencieux', 'Déplacement silencieux', 'dex'],
  ['desamorcage', 'Désamorçage/sabotage', 'int', true], ['detection', 'Détection', 'sag'], ['diplomatie', 'Diplomatie', 'cha'],
  ['discretion', 'Discrétion', 'dex'], ['dressage', 'Dressage', 'cha', true], ['equilibre', 'Équilibre', 'dex'],
  ['equitation', 'Équitation', 'dex'], ['escalade', 'Escalade', 'for'], ['escamotage', 'Escamotage', 'dex', true],
  ['estimation', 'Estimation', 'int'], ['evasion', 'Évasion', 'dex'], ['fouille', 'Fouille', 'int'],
  ['intimidation', 'Intimidation', 'cha'], ['langue', 'Langue', null, true], ['maitrise-cordes', 'Maîtrise des cordes', 'dex'],
  ['natation', 'Natation', 'for'], ['perception', 'Perception auditive', 'sag'], ['premiers-secours', 'Premiers secours', 'sag'],
  ['profession', 'Profession', 'sag', true], ['psychologie', 'Psychologie', 'sag'], ['renseignements', 'Renseignements', 'cha'],
  ['representation', 'Représentation', 'cha'], ['saut', 'Saut', 'for'], ['survie', 'Survie', 'sag'],
  ['utilisation-objets', 'Utilisation d\'objets magiques', 'cha', true],
].map(([id, nom, car, formation]) => ({ id, nom, car, formation: !!formation }));
const CONN = R.COMPETENCES.filter(c => c.id.startsWith('conn-')).map(c => c.id);

/* ---------- Outils de calcul ---------- */
R.bbaClasse = (type, n) => type === 'fort' ? n : type === 'moyen' ? Math.floor(n * 3 / 4) : Math.floor(n / 2);
R.jsClasse = (bon, n) => bon ? 2 + Math.floor(n / 2) : Math.floor(n / 3);
R.attaques = bba => {
  const a = [bba];
  for (let b = bba - 5; b > 0 && a.length < 4; b -= 5) a.push(b);
  return a;
};
R.attTxt = l => l.map(R.signe).join('/');
const pal = (n, liste) => { let v = liste[0][1]; for (const [seuil, val] of liste) if (n >= seuil) v = val; return v; };
R.palier = pal;

/* Sorts par jour (index = niveau de classe, valeurs = sorts de niveau 0, 1, 2…) */
const T_PLEIN = ['', '3 1', '4 2', '4 2 1', '4 3 2', '4 3 2 1', '4 3 3 2', '4 4 3 2 1', '4 4 3 3 2', '4 4 4 3 2 1', '4 4 4 3 3 2',
  '4 4 4 4 3 2 1', '4 4 4 4 3 3 2', '4 4 4 4 4 3 2 1', '4 4 4 4 4 3 3 2', '4 4 4 4 4 4 3 2 1', '4 4 4 4 4 4 3 3 2',
  '4 4 4 4 4 4 4 3 2 1', '4 4 4 4 4 4 4 3 3 2', '4 4 4 4 4 4 4 4 3 3', '4 4 4 4 4 4 4 4 4 4'];
const T_ENS = ['', '5 3', '6 4', '6 5', '6 6 3', '6 6 4', '6 6 5 3', '6 6 6 4', '6 6 6 5 3', '6 6 6 6 4', '6 6 6 6 5 3',
  '6 6 6 6 6 4', '6 6 6 6 6 5 3', '6 6 6 6 6 6 4', '6 6 6 6 6 6 5 3', '6 6 6 6 6 6 6 4', '6 6 6 6 6 6 6 5 3',
  '6 6 6 6 6 6 6 6 4', '6 6 6 6 6 6 6 6 5 3', '6 6 6 6 6 6 6 6 6 4', '6 6 6 6 6 6 6 6 6 6'];
const T_ENS_CONNUS = ['', '4 2', '5 2', '5 3', '6 3 1', '6 4 2', '7 4 2 1', '7 5 3 2', '8 5 3 2 1', '8 5 4 3 2', '9 5 4 3 2 1',
  '9 5 5 4 3 2', '9 5 5 4 3 2 1', '9 5 5 4 4 3 2', '9 5 5 4 4 3 2 1', '9 5 5 4 4 4 3 2', '9 5 5 4 4 4 3 2 1',
  '9 5 5 4 4 4 3 3 2', '9 5 5 4 4 4 3 3 2 1', '9 5 5 4 4 4 3 3 3 2', '9 5 5 4 4 4 3 3 3 3'];
const T_BRD = ['', '2', '3 0', '3 1', '3 2 0', '3 3 1', '3 3 2', '3 3 2 0', '3 3 3 1', '3 3 3 2', '3 3 3 2 0', '3 3 3 3 1',
  '3 3 3 3 2', '3 3 3 3 2 0', '4 3 3 3 3 1', '4 4 3 3 3 2', '4 4 4 3 3 2 0', '4 4 4 4 3 3 1', '4 4 4 4 4 3 2',
  '4 4 4 4 4 4 3', '4 4 4 4 4 4 4'];
const T_BRD_CONNUS = ['', '4', '5 2', '6 3', '6 3 2', '6 4 3', '6 4 3', '6 4 4 2', '6 4 4 3', '6 4 4 3', '6 4 4 4 2', '6 4 4 4 3',
  '6 4 4 4 3', '6 4 4 4 4 2', '6 4 4 4 4 3', '6 4 4 4 4 3', '6 5 4 4 4 4 2', '6 5 5 4 4 4 3', '6 5 5 5 4 4 3',
  '6 5 5 5 5 4 4', '6 5 5 5 5 5 4'];
/* Paladin et rôdeur : sorts de niveau 1 à 4, à partir du niveau 4 (« 0 » = uniquement les sorts en bonus) */
const T_DEMI = ['', '', '', '', '0', '0', '1', '1', '1 0', '1 0', '1 1', '1 1 0', '1 1 1', '1 1 1', '2 1 1 0', '2 1 1 1',
  '2 2 1 1', '2 2 2 1', '3 2 2 1', '3 3 3 2', '3 3 3 3'];
R.sortsBonus = (modCar, nivSort) => nivSort === 0 || modCar < nivSort ? 0 : Math.floor((modCar - nivSort) / 4) + 1;

/* ---------- Classes ---------- */
const A = (niv, nom, texte) => ({ niv, nom, texte });
R.CLASSES = {
  barbare: {
    nom: 'Barbare', dv: 12, bba: 'fort', js: { vig: 1 }, pc: 4,
    comp: ['escalade', 'artisanat', 'dressage', 'intimidation', 'saut', 'perception', 'equitation', 'survie', 'natation'],
    maitrises: 'Armes courantes et de guerre, armures légères et intermédiaires, boucliers (sauf pavois).',
    aptitudes: [
      A(1, 'Déplacement accéléré', '+3 m à la vitesse de base, sans armure lourde ni charge lourde.'),
      A(1, 'Illettrisme', 'Ne sait ni lire ni écrire (2 points de compétence pour l\'apprendre).'),
      A(1, 'Rage', '+4 For, +4 Con, +2 aux jets de Volonté, −2 à la CA, pendant 3 + mod Con (nouveau) rounds. Fatigué ensuite.'),
      A(2, 'Esquive instinctive', 'Conserve son bonus de Dextérité à la CA quand il est pris au dépourvu.'),
      A(3, 'Sens des pièges', 'Bonus aux jets de Réflexes et à la CA contre les pièges.'),
      A(5, 'Esquive instinctive supérieure', 'Ne peut plus être pris en tenaille, sauf par un roublard de 4 niveaux de plus.'),
      A(7, 'Réduction des dégâts', 'Ignore une partie des dégâts de chaque attaque.'),
      A(11, 'Rage supérieure', 'La rage donne +6 For, +6 Con et +3 en Volonté.'),
      A(14, 'Volonté indomptable', '+4 aux jets de Volonté contre les enchantements pendant la rage.'),
      A(17, 'Rage sans fatigue', 'N\'est plus fatigué à la fin de la rage.'),
      A(20, 'Rage de maître', 'La rage donne +8 For, +8 Con et +4 en Volonté.'),
    ],
    valeurs: k => [
      ['Rages par jour', pal(k, [[1, 1], [4, 2], [8, 3], [12, 4], [16, 5], [20, 6]]) + '/jour'],
      ['Effet de la rage', pal(k, [[1, '+4 For, +4 Con, +2 Vol'], [11, '+6 For, +6 Con, +3 Vol'], [20, '+8 For, +8 Con, +4 Vol']])],
      ['Sens des pièges', k < 3 ? null : '+' + Math.floor(k / 3)],
      ['Réduction des dégâts', k < 7 ? null : (1 + Math.floor((k - 7) / 3)) + '/—'],
    ],
  },
  barde: {
    nom: 'Barde', dv: 6, bba: 'moyen', js: { ref: 1, vol: 1 }, pc: 6,
    comp: ['estimation', 'equilibre', 'bluff', 'escalade', 'concentration', 'artisanat', 'decryptage', 'diplomatie', 'deguisement', 'evasion', 'renseignements', 'discretion', 'saut', ...CONN, 'perception', 'deplacement-silencieux', 'representation', 'profession', 'psychologie', 'escamotage', 'langue', 'art-magie', 'natation', 'acrobaties', 'utilisation-objets'],
    maitrises: 'Armes courantes, épée longue, rapière, matraque, épée courte, arc court, fouet ; armures légères ; boucliers (sauf pavois). Peut lancer ses sorts en armure légère.',
    lanceur: { car: 'cha', parJour: T_BRD, connus: T_BRD_CONNUS, type: 'profane spontané' },
    aptitudes: [
      A(1, 'Musique de barde', 'Utilisations par jour égales au niveau de barde. Chaque effet demande un rang minimum en Représentation.'),
      A(1, 'Savoir bardique', 'Test de 1d20 + niveau de barde + mod Int pour connaître des informations sur des gens, lieux ou objets.'),
      A(1, 'Contre-chant', 'Représentation contre les effets sonores et de langage (3 rangs).'),
      A(1, 'Fascination', 'Fascine des créatures qui l\'écoutent (3 rangs).'),
      A(1, 'Inspiration vaillante', 'Bonus de moral aux jets contre le charme et la terreur, et aux jets d\'attaque et de dégâts des alliés (3 rangs).'),
      A(3, 'Inspiration talentueuse', '+2 à un test de compétence d\'un allié (6 rangs).'),
      A(6, 'Suggestion', 'Suggestion sur une créature fascinée (9 rangs).'),
      A(9, 'Inspiration héroïque', 'Alliés : +2 DV de d10, +2 aux attaques, +1 en Vigueur (12 rangs).'),
      A(12, 'Chant de liberté', 'Effet de Délivrance des enchantements après 1 minute de musique (15 rangs).'),
      A(15, 'Inspiration héroïque suprême', 'Un allié gagne +4 de moral aux jets de sauvegarde et +4 d\'esquive à la CA (18 rangs).'),
      A(18, 'Suggestion de groupe', 'Suggestion sur toutes les créatures fascinées (21 rangs).'),
    ],
    valeurs: k => [
      ['Musique de barde', k + '/jour'],
      ['Inspiration vaillante', '+' + pal(k, [[1, 1], [8, 2], [14, 3], [20, 4]])],
      ['Créatures fascinées', 1 + Math.floor((k - 1) / 3)],
      ['Inspiration héroïque (alliés)', k < 9 ? null : 1 + Math.floor((k - 9) / 3)],
    ],
  },
  pretre: {
    nom: 'Prêtre', dv: 8, bba: 'moyen', js: { vig: 1, vol: 1 }, pc: 2,
    comp: ['concentration', 'artisanat', 'diplomatie', 'premiers-secours', 'conn-mysteres', 'conn-histoire', 'conn-religion', 'conn-plans', 'profession', 'art-magie'],
    maitrises: 'Armes courantes, toutes les armures, boucliers (sauf pavois).',
    lanceur: { car: 'sag', parJour: T_PLEIN, domaine: true, type: 'divin préparé' },
    aptitudes: [
      A(1, 'Aura', 'Aura d\'alignement de sa divinité, détectable par la magie.'),
      A(1, 'Domaines', 'Deux domaines : un pouvoir accordé chacun et un sort de domaine par niveau de sort.'),
      A(1, 'Renvoi ou intimidation des morts-vivants', '3 + mod Cha fois par jour.'),
      A(1, 'Incantation spontanée', 'Peut convertir un sort préparé en sort de soins (ou de blessure s\'il est mauvais).'),
    ],
    valeurs: (k, e) => [['Renvois par jour', Math.max(0, 3 + e.mods.cha + (e.dons.has('renvoi-supplementaire') ? 4 : 0))]],
  },
  druide: {
    nom: 'Druide', dv: 8, bba: 'moyen', js: { vig: 1, vol: 1 }, pc: 4,
    comp: ['concentration', 'artisanat', 'diplomatie', 'dressage', 'premiers-secours', 'conn-nature', 'perception', 'profession', 'equitation', 'art-magie', 'detection', 'survie', 'natation'],
    maitrises: 'Gourdin, dague, fléchette, bâton, cimeterre, faucille, lance courte, fronde, lance ; armures légères et intermédiaires non métalliques ; boucliers de bois.',
    lanceur: { car: 'sag', parJour: T_PLEIN, type: 'divin préparé' },
    aptitudes: [
      A(1, 'Compagnon animal', 'Un animal fidèle qui progresse avec le druide.'),
      A(1, 'Instinct naturel', '+2 en Connaissances (nature) et Survie.'),
      A(1, 'Empathie sauvage', 'Influence l\'attitude des animaux (1d20 + niveau + mod Cha).'),
      A(2, 'Déplacement facilité', 'Traverse les broussailles naturelles sans être ralenti ni blessé.'),
      A(3, 'Absence de traces', 'Ne laisse aucune trace en milieu naturel.'),
      A(4, 'Résistance à l\'appel de la nature', '+4 aux jets contre les pouvoirs des fées.'),
      A(5, 'Forme animale', 'Se transforme en animal de taille P à M, une fois par jour au départ.'),
      A(9, 'Immunité contre le venin', 'Immunisé contre tous les poisons.'),
      A(13, 'Mille visages', 'Peut modifier son apparence à volonté, comme Modification d\'apparence.'),
      A(15, 'Jeunesse éternelle', 'Ne subit plus les malus de caractéristique dus à l\'âge.'),
      A(16, 'Forme élémentaire', 'Forme animale en élémentaire de taille P, M ou G.'),
    ],
    valeurs: k => [
      ['Forme animale', k < 5 ? null : pal(k, [[5, 1], [6, 2], [7, 3], [10, 4], [14, 5], [18, 6]]) + '/jour'],
      ['Tailles accessibles', k < 5 ? null : pal(k, [[5, 'P à M'], [8, 'P à G'], [11, 'TP à G'], [12, 'TP à G, plantes'], [15, 'TP à TG, plantes']])],
      ['Forme élémentaire', k < 16 ? null : pal(k, [[16, '1/jour'], [18, '2/jour'], [20, '3/jour (TG possible)']])],
    ],
  },
  guerrier: {
    nom: 'Guerrier', dv: 10, bba: 'fort', js: { vig: 1 }, pc: 2,
    comp: ['escalade', 'artisanat', 'dressage', 'intimidation', 'saut', 'equitation', 'natation'],
    maitrises: 'Toutes les armes courantes et de guerre, toutes les armures, tous les boucliers (pavois compris).',
    donsBonus: k => k === 1 || k % 2 === 0, donsBonusListe: 'combat',
    aptitudes: [A(1, 'Dons supplémentaires', 'Un don de combat supplémentaire au niveau 1, puis à chaque niveau pair.')],
    valeurs: k => [['Dons de combat supplémentaires obtenus', 1 + Math.floor(k / 2)]],
  },
  moine: {
    nom: 'Moine', dv: 8, bba: 'moyen', js: { vig: 1, ref: 1, vol: 1 }, pc: 4,
    comp: ['equilibre', 'escalade', 'concentration', 'artisanat', 'diplomatie', 'evasion', 'discretion', 'saut', 'conn-mysteres', 'conn-religion', 'perception', 'deplacement-silencieux', 'representation', 'profession', 'psychologie', 'detection', 'natation', 'acrobaties'],
    maitrises: 'Gourdin, arbalète légère et lourde, dague, hachette, javeline, kama, nunchaku, bâton, saï, shuriken, siangham, fronde. Aucune armure ni bouclier.',
    donsAuto: { 1: ['science-mains-nues'] },
    donsBonus: k => k === 1 || k === 2 || k === 6,
    donsBonusListe: k => ({ 1: ['science-lutte', 'coup-etourdissant'], 2: ['attaques-reflexes', 'parade-projectiles'], 6: ['science-desarmement', 'science-croc-en-jambe'] })[k],
    aptitudes: [
      A(1, 'Bonus à la CA', 'Ajoute son mod Sag (s\'il est positif) à la CA, plus un bonus selon le niveau. S\'applique aussi contre les attaques de contact et quand il est pris au dépourvu. Règle de la campagne : conservé avec une armure ou un bouclier.'),
      A(1, 'Déluge de coups', 'Attaque à outrance avec une attaque supplémentaire, au prix d\'un malus à toutes les attaques. À mains nues ou avec les armes spéciales de moine.'),
      A(1, 'Combat à mains nues', 'Science du combat à mains nues gratuite ; dégâts de mains nues selon le niveau ; coups considérés comme des armes naturelles ou manufacturées au choix.'),
      A(1, 'Don supplémentaire', 'Science de la lutte ou Coup étourdissant, sans prérequis.'),
      A(2, 'Don supplémentaire', 'Attaques réflexes ou Parade de projectiles, sans prérequis.'),
      A(2, 'Esquive totale', 'Aucun dégât en cas de jet de Réflexes réussi contre un effet qui permet un jet pour moitié (armure légère ou aucune).'),
      A(3, 'Déplacement accéléré', 'Bonus à la vitesse de base. Règle de la campagne : conservé avec une armure.'),
      A(3, 'Sérénité', '+2 aux jets de sauvegarde contre les enchantements.'),
      A(4, 'Frappe ki', 'Les attaques à mains nues sont considérées comme magiques pour franchir la réduction des dégâts.'),
      A(4, 'Chute ralentie', 'Ignore une partie de la hauteur de chute s\'il est à portée d\'un mur.'),
      A(5, 'Pureté physique', 'Immunisé contre toutes les maladies, sauf magiques ou surnaturelles.'),
      A(6, 'Don supplémentaire', 'Science du désarmement ou Science du croc-en-jambe, sans prérequis.'),
      A(7, 'Plénitude physique', 'Se soigne de 2 PV par niveau de moine par jour, à répartir.'),
      A(9, 'Esquive surnaturelle', 'Moitié des dégâts même en cas d\'échec au jet de Réflexes.'),
      A(10, 'Frappe ki (loyale)', 'Les attaques à mains nues comptent aussi comme loyales.'),
      A(11, 'Corps de diamant', 'Immunisé contre tous les poisons.'),
      A(11, 'Déluge de coups supérieur', 'Une seconde attaque supplémentaire lors du déluge de coups.'),
      A(12, 'Pas chassé', 'Se téléporte comme Porte dimensionnelle, une fois par jour.'),
      A(13, 'Âme de diamant', 'Résistance à la magie égale à 10 + niveau de moine.'),
      A(15, 'Paume vibratoire', 'Une fois par semaine : vibrations mortelles déclenchables ensuite (Vigueur pour annuler).'),
      A(16, 'Frappe ki (adamantium)', 'Les attaques à mains nues comptent aussi comme de l\'adamantium.'),
      A(17, 'Jeunesse éternelle', 'Ne subit plus les malus dus à l\'âge.'),
      A(17, 'Langue du soleil et de la lune', 'Peut parler avec toute créature vivante.'),
      A(19, 'Désertion de l\'âme', 'Devient éthéré pendant 1 round par niveau de moine, par jour.'),
      A(20, 'Perfection de l\'être', 'Devient un extérieur : RD 10/magie.'),
    ],
    valeurs: (k, e) => {
      const pen = k < 5 ? -2 : k < 9 ? -1 : 0;
      const base = R.attaques(e.bba).map(x => x + pen);
      const deluge = [base[0], ...base];
      if (k >= 11) deluge.unshift(base[0]);
      const petit = e.taille === 'P';
      const deg = pal(k, petit
        ? [[1, '1d4'], [4, '1d6'], [8, '1d8'], [12, '1d10'], [16, '2d6'], [20, '2d8']]
        : [[1, '1d6'], [4, '1d8'], [8, '1d10'], [12, '2d6'], [16, '2d8'], [20, '2d10']]);
      return [
        ['Déluge de coups', `${R.attTxt(deluge)} (malus ${pen === 0 ? 'aucun' : R.signe(pen)})`],
        ['Dégâts à mains nues', deg + (petit ? ' (taille P)' : '')],
        ['Bonus de CA du moine', `+${Math.floor(k / 5)} (+ mod Sag ${R.signe(Math.max(0, e.mods.sag))})`],
        ['Déplacement accéléré', k < 3 ? null : '+' + (3 * Math.floor(k / 3)) + ' m'],
        ['Chute ralentie', k < 4 ? null : k >= 20 ? 'Toute hauteur' : (6 + 3 * Math.floor((k - 4) / 2)) + ' m'],
        ['Frappe ki', k < 4 ? null : pal(k, [[4, 'Magique'], [10, 'Magique, loyale'], [16, 'Magique, loyale, adamantium']])],
        ['Plénitude physique', k < 7 ? null : (2 * k) + ' PV/jour'],
        ['Résistance à la magie', k < 13 ? null : 10 + k],
        ['Désertion de l\'âme', k < 19 ? null : k + ' rounds/jour'],
      ];
    },
  },
  paladin: {
    nom: 'Paladin', dv: 10, bba: 'fort', js: { vig: 1 }, pc: 2,
    comp: ['concentration', 'artisanat', 'diplomatie', 'dressage', 'premiers-secours', 'conn-noblesse', 'conn-religion', 'profession', 'equitation', 'psychologie'],
    maitrises: 'Armes courantes et de guerre, toutes les armures, boucliers (sauf pavois). Doit rester loyal bon.',
    lanceur: { car: 'sag', parJour: T_DEMI, debut: 4, decale: 1, type: 'divin préparé' },
    aptitudes: [
      A(1, 'Aura de Bien', 'Aura du Bien d\'une puissance égale à son niveau de paladin.'),
      A(1, 'Détection du Mal', 'À volonté, comme le sort.'),
      A(1, 'Châtiment du Mal', 'Contre une créature mauvaise : + mod Cha à l\'attaque, + niveau de paladin aux dégâts.'),
      A(2, 'Grâce divine', 'Ajoute son mod Cha à tous ses jets de sauvegarde.'),
      A(2, 'Imposition des mains', 'Soigne chaque jour un total de PV égal à niveau × mod Cha.'),
      A(3, 'Aura de bravoure', 'Immunisé contre la terreur ; alliés à 3 m : +4 contre la terreur.'),
      A(3, 'Santé divine', 'Immunisé contre toutes les maladies.'),
      A(4, 'Renvoi des morts-vivants', 'Comme un prêtre de 3 niveaux de moins.'),
      A(4, 'Sorts', 'Sorts divins de paladin, à partir du niveau 4.'),
      A(5, 'Monture spéciale', 'Appelle un destrier céleste fidèle.'),
      A(6, 'Guérison des maladies', 'Comme le sort, un certain nombre de fois par semaine.'),
    ],
    valeurs: (k, e) => [
      ['Châtiment du Mal', `${pal(k, [[1, 1], [5, 2], [10, 3], [15, 4], [20, 5]])}/jour (attaque ${R.signe(e.mods.cha)}, dégâts +${k})`],
      ['Imposition des mains', k < 2 ? null : Math.max(0, k * e.mods.cha) + ' PV/jour'],
      ['Grâce divine', k < 2 ? null : R.signe(e.mods.cha) + ' aux jets de sauvegarde'],
      ['Guérison des maladies', k < 6 ? null : pal(k, [[6, 1], [9, 2], [12, 3], [15, 4], [18, 5]]) + '/semaine'],
      ['Renvoi des morts-vivants', k < 4 ? null : `Comme un prêtre de niveau ${k - 3}`],
    ],
  },
  rodeur: {
    nom: 'Rôdeur', dv: 8, bba: 'fort', js: { vig: 1, ref: 1 }, pc: 6,
    comp: ['escalade', 'concentration', 'artisanat', 'dressage', 'premiers-secours', 'discretion', 'saut', 'conn-donjons', 'conn-geographie', 'conn-nature', 'perception', 'deplacement-silencieux', 'profession', 'equitation', 'fouille', 'detection', 'survie', 'natation', 'maitrise-cordes'],
    maitrises: 'Armes courantes et de guerre, armures légères, boucliers (sauf pavois).',
    lanceur: { car: 'sag', parJour: T_DEMI, debut: 4, decale: 1, type: 'divin préparé' },
    donsAuto: { 1: ['pistage'], 3: ['endurance'] },
    choix: { 2: { id: 'style', nom: 'Style de combat', options: { archerie: 'Archerie', 'deux-armes': 'Combat à deux armes' } } },
    donsStyle: { archerie: { 2: 'tir-rapide', 6: 'tir-multiple', 11: 'science-tir-precision' }, 'deux-armes': { 2: 'combat-deux-armes', 6: 'science-cda', 11: 'cda-superieur' } },
    aptitudes: [
      A(1, 'Ennemi juré', '+2 en Bluff, Perception auditive, Psychologie, Détection, Survie et aux dégâts contre le type choisi. Un nouvel ennemi tous les 5 niveaux, et +2 supplémentaires à répartir.'),
      A(1, 'Pistage', 'Don Pistage gratuit.'),
      A(1, 'Empathie sauvage', 'Influence l\'attitude des animaux (1d20 + niveau + mod Cha).'),
      A(2, 'Style de combat', 'Archerie (Tir rapide) ou combat à deux armes, sans prérequis, en armure légère ou sans armure.'),
      A(3, 'Endurance', 'Don Endurance gratuit.'),
      A(4, 'Compagnon animal', 'Comme un druide de la moitié de son niveau de rôdeur.'),
      A(4, 'Sorts', 'Sorts divins de rôdeur, à partir du niveau 4.'),
      A(6, 'Style de combat amélioré', 'Tir multiple ou Science du combat à deux armes.'),
      A(7, 'Déplacement facilité', 'Traverse les broussailles naturelles sans être ralenti.'),
      A(8, 'Pistage accéléré', 'Suit une piste à vitesse normale sans malus.'),
      A(9, 'Esquive totale', 'Aucun dégât en cas de jet de Réflexes réussi contre un effet permettant un jet pour moitié.'),
      A(11, 'Maîtrise du style de combat', 'Science du tir de précision ou Combat à deux armes supérieur.'),
      A(13, 'Camouflage', 'Peut utiliser Discrétion en milieu naturel sans abri.'),
      A(17, 'Discrétion totale', 'Peut utiliser Discrétion en milieu naturel même observé.'),
    ],
    valeurs: k => [
      ['Ennemis jurés', `${1 + Math.floor(k / 5)} (bonus total à répartir : +${2 * (1 + Math.floor(k / 5)) + 2 * Math.floor(k / 5)})`],
      ['Compagnon animal', k < 4 ? null : `Comme un druide de niveau ${Math.floor(k / 2)}`],
    ],
  },
  roublard: {
    nom: 'Roublard', dv: 6, bba: 'moyen', js: { ref: 1 }, pc: 8,
    comp: ['estimation', 'equilibre', 'bluff', 'escalade', 'artisanat', 'decryptage', 'diplomatie', 'desamorcage', 'deguisement', 'evasion', 'contrefacon', 'renseignements', 'discretion', 'intimidation', 'saut', 'conn-local', 'perception', 'deplacement-silencieux', 'crochetage', 'representation', 'profession', 'fouille', 'psychologie', 'escamotage', 'detection', 'natation', 'acrobaties', 'utilisation-objets', 'maitrise-cordes'],
    maitrises: 'Armes courantes, arbalète de poing, rapière, matraque, arc court, épée courte ; armures légères.',
    aptitudes: [
      A(1, 'Attaque sournoise', 'Dégâts supplémentaires contre un adversaire privé de son bonus de Dextérité ou pris en tenaille.'),
      A(1, 'Recherche des pièges', 'Peut trouver et désamorcer les pièges magiques (DD supérieur à 20).'),
      A(2, 'Esquive totale', 'Aucun dégât en cas de jet de Réflexes réussi contre un effet permettant un jet pour moitié.'),
      A(3, 'Sens des pièges', 'Bonus aux jets de Réflexes et à la CA contre les pièges.'),
      A(4, 'Esquive instinctive', 'Conserve son bonus de Dextérité à la CA quand il est pris au dépourvu.'),
      A(8, 'Esquive instinctive supérieure', 'Ne peut plus être pris en tenaille, sauf par un roublard de 4 niveaux de plus.'),
      A(10, 'Aptitude spéciale', 'Au choix : Roulé-boulé, Esprit fuyant, Opportunisme, Esquive surnaturelle, Maîtrise des compétences, Attaque sournoise handicapante, ou un don.'),
      A(13, 'Aptitude spéciale', 'Une nouvelle aptitude spéciale.'),
      A(16, 'Aptitude spéciale', 'Une nouvelle aptitude spéciale.'),
      A(19, 'Aptitude spéciale', 'Une nouvelle aptitude spéciale.'),
    ],
    valeurs: k => [
      ['Attaque sournoise', `+${Math.ceil(k / 2)}d6`],
      ['Sens des pièges', k < 3 ? null : '+' + Math.floor(k / 3)],
    ],
  },
  ensorceleur: {
    nom: 'Ensorceleur', dv: 4, bba: 'faible', js: { vol: 1 }, pc: 2,
    comp: ['bluff', 'concentration', 'artisanat', 'conn-mysteres', 'profession', 'art-magie'],
    maitrises: 'Armes courantes. Aucune armure ni bouclier.',
    lanceur: { car: 'cha', parJour: T_ENS, connus: T_ENS_CONNUS, type: 'profane spontané' },
    aptitudes: [A(1, 'Familier', 'Peut appeler un animal familier qui lui accorde des avantages.')],
    valeurs: () => [],
  },
  magicien: {
    nom: 'Magicien', dv: 4, bba: 'faible', js: { vol: 1 }, pc: 2,
    comp: ['concentration', 'artisanat', 'decryptage', ...CONN, 'profession', 'art-magie'],
    maitrises: 'Gourdin, dague, arbalète légère et lourde, bâton. Aucune armure ni bouclier.',
    lanceur: { car: 'int', parJour: T_PLEIN, type: 'profane préparé' },
    donsAuto: { 1: ['ecriture-parchemins'] },
    donsBonus: k => k > 0 && k % 5 === 0, donsBonusListe: 'magicien',
    aptitudes: [
      A(1, 'Familier', 'Peut appeler un animal familier qui lui accorde des avantages.'),
      A(1, 'Écriture de parchemins', 'Don gratuit.'),
      A(5, 'Don supplémentaire', 'Un don de métamagie, de création d\'objets ou Maîtrise des sorts.'),
      A(10, 'Don supplémentaire', 'Un don de métamagie, de création d\'objets ou Maîtrise des sorts.'),
      A(15, 'Don supplémentaire', 'Un don de métamagie, de création d\'objets ou Maîtrise des sorts.'),
      A(20, 'Don supplémentaire', 'Un don de métamagie, de création d\'objets ou Maîtrise des sorts.'),
    ],
    valeurs: () => [],
  },
};

/* ---------- Dons ---------- */
/* type : G général, C combat (accessible aux dons supplémentaires de guerrier), M métamagie, O création d'objets
   p : prérequis { car: {dex: 13}, bba: n, dons: [...], classe: {guerrier: 4}, lanceur: n, renvoi: true, rang: {equitation: 1} } */
const D = (id, nom, vo, type, p, texte, calc) => ({ id, nom, vo, type, p: p || {}, texte, calc });
R.DONS = [
  D('acrobate', 'Acrobate', 'Acrobatic', 'G', null, '+2 aux tests de Saut et d\'Acrobaties.'),
  D('agilite', 'Agilité', 'Agile', 'G', null, '+2 aux tests d\'Équilibre et d\'Évasion.'),
  D('vigilance', 'Vigilance', 'Alertness', 'G', null, '+2 aux tests de Perception auditive et de Détection.'),
  D('affinite-animaux', 'Affinité avec les animaux', 'Animal Affinity', 'G', null, '+2 aux tests de Dressage et d\'Équitation.'),
  D('port-armure-legere', 'Port des armures légères', 'Armor Proficiency (Light)', 'G', null, 'Le malus d\'armure aux tests ne s\'applique plus aux jets d\'attaque.'),
  D('port-armure-intermediaire', 'Port des armures intermédiaires', 'Armor Proficiency (Medium)', 'G', { dons: ['port-armure-legere'] }, 'Comme Port des armures légères, pour les armures intermédiaires.'),
  D('port-armure-lourde', 'Port des armures lourdes', 'Armor Proficiency (Heavy)', 'G', { dons: ['port-armure-legere', 'port-armure-intermediaire'] }, 'Comme Port des armures légères, pour les armures lourdes.'),
  D('athletisme', 'Athlétisme', 'Athletic', 'G', null, '+2 aux tests d\'Escalade et de Natation.'),
  D('convocation-amelioree', 'Convocation améliorée', 'Augment Summoning', 'G', { dons: ['ecole-renforcee'] }, 'Les créatures convoquées gagnent +4 en Force et +4 en Constitution. Nécessite École renforcée (Invocation).'),
  D('combat-aveugle', 'Combat en aveugle', 'Blind-Fight', 'C', null, 'Relance le jet de camouflage raté au corps à corps ; pas de malus de Dextérité contre les attaquants invisibles ; moitié moins ralenti dans le noir.'),
  D('preparation-potions', 'Préparation de potions', 'Brew Potion', 'O', { lanceur: 3 }, 'Permet de fabriquer des potions de sorts de niveau 3 ou moins.'),
  D('enchainement', 'Enchaînement', 'Cleave', 'C', { car: { for: 13 }, dons: ['attaque-puissance'] }, 'Après avoir abattu un adversaire, attaque immédiatement un autre adversaire adjacent (une fois par round).'),
  D('expertise-combat', 'Expertise du combat', 'Combat Expertise', 'C', { car: { int: 13 } }, 'Échange un malus aux jets d\'attaque contre un bonus d\'esquive à la CA, de même valeur.',
    e => `Jusqu'à ${R.signe(-Math.min(5, e.bba))} à l'attaque pour +${Math.min(5, e.bba)} à la CA.`),
  D('magie-guerre', 'Magie de guerre', 'Combat Casting', 'G', null, '+4 aux tests de Concentration pour lancer un sort sur la défensive ou en étant agrippé.'),
  D('attaques-reflexes', 'Attaques réflexes', 'Combat Reflexes', 'C', null, 'Attaques d\'opportunité supplémentaires par round égales au mod Dex ; possibles même pris au dépourvu.',
    e => `${1 + Math.max(0, e.mods.dex)} attaque(s) d'opportunité par round.`),
  D('creation-armes-armures', 'Création d\'armes et armures magiques', 'Craft Magic Arms and Armor', 'O', { lanceur: 5 }, 'Permet de fabriquer et d\'améliorer armes, armures et boucliers magiques.'),
  D('creation-sceptres', 'Création de sceptres magiques', 'Craft Rod', 'O', { lanceur: 9 }, 'Permet de fabriquer des sceptres magiques.'),
  D('creation-batons', 'Création de bâtons magiques', 'Craft Staff', 'O', { lanceur: 12 }, 'Permet de fabriquer des bâtons magiques.'),
  D('creation-baguettes', 'Création de baguettes magiques', 'Craft Wand', 'O', { lanceur: 5 }, 'Permet de fabriquer des baguettes de sorts de niveau 4 ou moins (50 charges).'),
  D('creation-objets-merveilleux', 'Création d\'objets merveilleux', 'Craft Wondrous Item', 'O', { lanceur: 3 }, 'Permet de fabriquer des objets merveilleux.'),
  D('creation-anneaux', 'Création d\'anneaux magiques', 'Forge Ring', 'O', { lanceur: 12 }, 'Permet de fabriquer des anneaux magiques.'),
  D('fourberie', 'Fourberie', 'Deceitful', 'G', null, '+2 aux tests de Déguisement et de Contrefaçon.'),
  D('parade-projectiles', 'Parade de projectiles', 'Deflect Arrows', 'C', { car: { dex: 13 }, dons: ['science-mains-nues'] }, 'Une main libre : dévie une attaque à distance par round (test de Réflexes DD 20, plus le bonus magique de l\'arme).'),
  D('doigts-agiles', 'Doigts agiles', 'Deft Hands', 'G', null, '+2 aux tests d\'Escamotage et de Maîtrise des cordes.'),
  D('dur-a-cuire', 'Dur à cuire', 'Diehard', 'G', { dons: ['endurance'] }, 'Se stabilise automatiquement entre −1 et −9 PV et peut continuer à agir (une action par round).'),
  D('assidu', 'Assidu', 'Diligent', 'G', null, '+2 aux tests d\'Estimation et de Décryptage.'),
  D('esquive', 'Esquive', 'Dodge', 'C', { car: { dex: 13 } }, '+1 d\'esquive à la CA contre un adversaire désigné chaque round.'),
  D('extension-effet', 'Extension d\'effet', 'Empower Spell', 'M', null, 'Les effets numériques variables du sort augmentent de moitié. Emplacement de 2 niveaux de plus.'),
  D('extension-portee', 'Extension de portée', 'Enlarge Spell', 'M', null, 'Double la portée du sort. Emplacement de 1 niveau de plus.'),
  D('endurance', 'Endurance', 'Endurance', 'G', null, '+4 aux tests et jets pour résister à la fatigue, à la faim, à la soif, au froid, à l\'asphyxie… Peut dormir en armure intermédiaire.'),
  D('dispense-composantes', 'Dispense de composantes matérielles', 'Eschew Materials', 'G', null, 'Lance les sorts sans les composantes matérielles d\'une valeur de 1 po ou moins.'),
  D('maniement-arme-exotique', 'Maniement d\'une arme exotique', 'Exotic Weapon Proficiency', 'C', { bba: 1 }, 'Utilise sans malus une arme exotique choisie.'),
  D('extension-duree', 'Extension de durée', 'Extend Spell', 'M', null, 'Double la durée du sort. Emplacement de 1 niveau de plus.'),
  D('renvoi-supplementaire', 'Renvoi supplémentaire', 'Extra Turning', 'G', { renvoi: true }, '4 tentatives de renvoi ou d\'intimidation supplémentaires par jour.'),
  D('grand-enchainement', 'Grand enchaînement', 'Great Cleave', 'C', { car: { for: 13 }, dons: ['attaque-puissance', 'enchainement'], bba: 4 }, 'Comme Enchaînement, sans limite d\'utilisations par round.'),
  D('vigueur-surhumaine', 'Vigueur surhumaine', 'Great Fortitude', 'G', null, '+2 aux jets de Vigueur.'),
  D('ecole-superieure', 'École supérieure', 'Greater Spell Focus', 'G', { dons: ['ecole-renforcee'] }, '+1 supplémentaire au DD des sorts de l\'école choisie (cumulable avec École renforcée).'),
  D('efficacite-sorts-superieure', 'Efficacité des sorts supérieure', 'Greater Spell Penetration', 'G', { dons: ['efficacite-sorts'] }, '+2 supplémentaires aux tests de niveau de lanceur pour vaincre la RM.'),
  D('cda-superieur', 'Combat à deux armes supérieur', 'Greater Two-Weapon Fighting', 'C', { car: { dex: 19 }, dons: ['combat-deux-armes', 'science-cda'], bba: 11 }, 'Une troisième attaque avec l\'arme secondaire, à −10.'),
  D('arme-predilection-superieure', 'Arme de prédilection supérieure', 'Greater Weapon Focus', 'C', { dons: ['arme-predilection'], classe: { guerrier: 8 } }, '+1 supplémentaire aux jets d\'attaque avec l\'arme choisie.'),
  D('specialisation-superieure', 'Spécialisation martiale supérieure', 'Greater Weapon Specialization', 'C', { dons: ['arme-predilection', 'arme-predilection-superieure', 'specialisation-martiale'], classe: { guerrier: 12 } }, '+2 supplémentaires aux dégâts avec l\'arme choisie.'),
  D('augmentation-intensite', 'Augmentation d\'intensité', 'Heighten Spell', 'M', null, 'Lance le sort comme s\'il était de niveau supérieur (DD et effets liés au niveau).'),
  D('science-bousculade', 'Science de la bousculade', 'Improved Bull Rush', 'C', { car: { for: 13 }, dons: ['attaque-puissance'] }, 'Bousculade sans attaque d\'opportunité, +4 au test de Force.'),
  D('science-contresort', 'Science du contresort', 'Improved Counterspell', 'G', null, 'Peut contrer un sort avec un sort de la même école et de niveau supérieur.'),
  D('science-critique', 'Science du critique', 'Improved Critical', 'C', { bba: 8 }, 'Double la zone de critique de l\'arme choisie.'),
  D('science-desarmement', 'Science du désarmement', 'Improved Disarm', 'C', { car: { int: 13 }, dons: ['expertise-combat'] }, 'Désarmement sans attaque d\'opportunité, +4 au test ; pas de contre-désarmement en cas d\'échec.'),
  D('science-feinte', 'Science de la feinte', 'Improved Feint', 'C', { car: { int: 13 }, dons: ['expertise-combat'] }, 'Feinte en combat par une action de mouvement.'),
  D('science-lutte', 'Science de la lutte', 'Improved Grapple', 'C', { car: { dex: 13 }, dons: ['science-mains-nues'] }, 'Lutte sans attaque d\'opportunité, +4 aux tests de lutte.'),
  D('science-initiative', 'Science de l\'initiative', 'Improved Initiative', 'C', null, '+4 aux tests d\'initiative.'),
  D('science-renversement', 'Science du renversement', 'Improved Overrun', 'C', { car: { for: 13 }, dons: ['attaque-puissance'] }, 'Renversement sans possibilité d\'évitement, +4 au test.'),
  D('science-tir-precision', 'Science du tir de précision', 'Improved Precise Shot', 'C', { car: { dex: 19 }, dons: ['tir-bout-portant', 'tir-precision'], bba: 11 }, 'Ignore l\'abri et le camouflage (sauf total) avec les attaques à distance.'),
  D('science-coup-bouclier', 'Science du coup de bouclier', 'Improved Shield Bash', 'C', { dons: ['maniement-boucliers'] }, 'Conserve le bonus de bouclier à la CA après un coup de bouclier.'),
  D('science-destruction', 'Science de la destruction', 'Improved Sunder', 'C', { car: { for: 13 }, dons: ['attaque-puissance'] }, 'Destruction d\'objet sans attaque d\'opportunité, +4 au test.'),
  D('science-croc-en-jambe', 'Science du croc-en-jambe', 'Improved Trip', 'C', { car: { int: 13 }, dons: ['expertise-combat'] }, 'Croc-en-jambe sans attaque d\'opportunité, +4 au test ; attaque gratuite en cas de réussite.'),
  D('science-renvoi', 'Science du renvoi', 'Improved Turning', 'G', { renvoi: true }, 'Renvoie les morts-vivants comme s\'il avait un niveau de plus.'),
  D('science-cda', 'Science du combat à deux armes', 'Improved Two-Weapon Fighting', 'C', { car: { dex: 17 }, dons: ['combat-deux-armes'], bba: 6 }, 'Une deuxième attaque avec l\'arme secondaire, à −5.'),
  D('science-mains-nues', 'Science du combat à mains nues', 'Improved Unarmed Strike', 'C', null, 'Attaques à mains nues sans attaque d\'opportunité ; dégâts létaux ou non létaux au choix.'),
  D('fin-limier', 'Fin limier', 'Investigator', 'G', null, '+2 aux tests de Renseignements et de Fouille.'),
  D('volonte-fer', 'Volonté de fer', 'Iron Will', 'G', null, '+2 aux jets de Volonté.'),
  D('prestige', 'Prestige', 'Leadership', 'G', { niveau: 6 }, 'Attire un compagnon d\'armes et des suivants, selon le score de prestige.',
    e => `Score de prestige de base : ${e.niveau + e.mods.cha} (niveau + mod Cha, avant réputation).`),
  D('reflexes-surhumains', 'Réflexes surhumains', 'Lightning Reflexes', 'G', null, '+2 aux jets de Réflexes.'),
  D('affinite-magique', 'Affinité magique', 'Magical Aptitude', 'G', null, '+2 aux tests d\'Art de la magie et d\'Utilisation d\'objets magiques.'),
  D('maniement-armes-guerre', 'Maniement d\'une arme de guerre', 'Martial Weapon Proficiency', 'G', null, 'Utilise sans malus une arme de guerre choisie.'),
  D('tir-multiple', 'Tir multiple', 'Manyshot', 'C', { car: { dex: 17 }, dons: ['tir-bout-portant', 'tir-rapide'], bba: 6 }, 'Tire plusieurs flèches en une seule attaque (action simple), dans un rayon de 9 m.',
    e => `Jusqu'à ${2 + (e.bba >= 11 ? 1 : 0) + (e.bba >= 16 ? 1 : 0)} flèches (malus −4 pour 2, −6 pour 3, −8 pour 4).`),
  D('quintessence-sorts', 'Quintessence des sorts', 'Maximize Spell', 'M', null, 'Les effets numériques variables du sort sont maximisés. Emplacement de 3 niveaux de plus.'),
  D('mobilite', 'Souplesse du serpent', 'Mobility', 'C', { car: { dex: 13 }, dons: ['esquive'] }, '+4 d\'esquive à la CA contre les attaques d\'opportunité provoquées par un déplacement.'),
  D('tir-monte', 'Tir monté', 'Mounted Archery', 'C', { rang: { equitation: 1 }, dons: ['combat-monte'] }, 'Malus divisés par deux pour les attaques à distance à cheval.'),
  D('combat-monte', 'Combat monté', 'Mounted Combat', 'C', { rang: { equitation: 1 } }, 'Une fois par round, un test d\'Équitation peut annuler une attaque qui touche la monture.'),
  D('incantation-animale', 'Incantation animale', 'Natural Spell', 'G', { car: { sag: 13 }, classe: { druide: 5 } }, 'Lance des sorts sous forme animale.'),
  D('negociation', 'Négociation', 'Negotiator', 'G', null, '+2 aux tests de Diplomatie et de Psychologie.'),
  D('doigts-de-fee', 'Doigts de fée', 'Nimble Fingers', 'G', null, '+2 aux tests de Désamorçage/sabotage et de Crochetage.'),
  D('persuasion', 'Persuasion', 'Persuasive', 'G', null, '+2 aux tests de Bluff et d\'Intimidation.'),
  D('tir-bout-portant', 'Tir à bout portant', 'Point Blank Shot', 'C', null, '+1 aux jets d\'attaque et de dégâts à distance contre une cible à 9 m ou moins.'),
  D('attaque-puissance', 'Attaque en puissance', 'Power Attack', 'C', { car: { for: 13 } }, 'Échange un malus aux jets d\'attaque au corps à corps contre un bonus aux dégâts (le double avec une arme à deux mains).',
    e => `Jusqu'à ${R.signe(-e.bba)} à l'attaque pour +${e.bba} aux dégâts (+${2 * e.bba} à deux mains).`),
  D('tir-precision', 'Tir de précision', 'Precise Shot', 'C', { dons: ['tir-bout-portant'] }, 'Plus de malus de −4 pour tirer sur un adversaire engagé au corps à corps.'),
  D('arme-en-main', 'Arme en main', 'Quick Draw', 'C', { bba: 1 }, 'Dégaine une arme par une action libre.'),
  D('incantation-rapide', 'Incantation rapide', 'Quicken Spell', 'M', null, 'Lance le sort par une action libre (un par round). Emplacement de 4 niveaux de plus.'),
  D('rechargement-rapide', 'Rechargement rapide', 'Rapid Reload', 'C', null, 'Recharge plus vite un type d\'arbalète choisi.'),
  D('tir-rapide', 'Tir rapide', 'Rapid Shot', 'C', { car: { dex: 13 }, dons: ['tir-bout-portant'] }, 'Une attaque à distance supplémentaire par round, avec −2 à toutes les attaques.'),
  D('attaque-galop', 'Attaque au galop', 'Ride-By Attack', 'C', { rang: { equitation: 1 }, dons: ['combat-monte'] }, 'En chargeant à cheval, peut continuer son déplacement après l\'attaque.'),
  D('course', 'Course', 'Run', 'G', null, 'Court à 5 fois sa vitesse ; +4 aux tests de Saut avec élan.'),
  D('ecriture-parchemins', 'Écriture de parchemins', 'Scribe Scroll', 'O', { lanceur: 1 }, 'Permet de fabriquer des parchemins.'),
  D('autonome', 'Autonome', 'Self-Sufficient', 'G', null, '+2 aux tests de Premiers secours et de Survie.'),
  D('maniement-boucliers', 'Maniement des boucliers', 'Shield Proficiency', 'G', null, 'Utilise les boucliers (sauf pavois) sans malus aux jets d\'attaque.'),
  D('tir-mouvement', 'Tir en mouvement', 'Shot on the Run', 'C', { car: { dex: 13 }, dons: ['esquive', 'mobilite', 'tir-bout-portant'], bba: 4 }, 'Peut se déplacer avant et après une attaque à distance.'),
  D('incantation-silencieuse', 'Incantation silencieuse', 'Silent Spell', 'M', null, 'Lance le sort sans composante verbale. Emplacement de 1 niveau de plus.'),
  D('armes-courantes', 'Maniement des armes courantes', 'Simple Weapon Proficiency', 'G', null, 'Utilise toutes les armes courantes sans malus.'),
  D('talent', 'Talent', 'Skill Focus', 'G', null, '+3 aux tests d\'une compétence choisie.'),
  D('saisie-projectiles', 'Saisie de projectiles', 'Snatch Arrows', 'C', { car: { dex: 15 }, dons: ['parade-projectiles', 'science-mains-nues'] }, 'Attrape les projectiles déviés et peut les relancer aussitôt.'),
  D('ecole-renforcee', 'École renforcée', 'Spell Focus', 'G', null, '+1 au DD des jets de sauvegarde contre les sorts de l\'école choisie.'),
  D('maitrise-sorts', 'Maîtrise des sorts', 'Spell Mastery', 'G', { classe: { magicien: 1 } }, 'Prépare sans grimoire un nombre de sorts égal au mod Int.',
    e => `${Math.max(0, e.mods.int)} sort(s) maîtrisé(s) par don.`),
  D('efficacite-sorts', 'Efficacité des sorts accrue', 'Spell Penetration', 'G', null, '+2 aux tests de niveau de lanceur pour vaincre la RM.'),
  D('charge-devastatrice', 'Charge dévastatrice', 'Spirited Charge', 'C', { rang: { equitation: 1 }, dons: ['combat-monte', 'attaque-galop'] }, 'En charge à cheval : double dégâts (triple avec une lance d\'arçon).'),
  D('attaque-eclair', 'Attaque éclair', 'Spring Attack', 'C', { car: { dex: 13 }, dons: ['esquive', 'mobilite'], bba: 4 }, 'Peut se déplacer avant et après une attaque au corps à corps, sans attaque d\'opportunité de la cible.'),
  D('discret', 'Discret', 'Stealthy', 'G', null, '+2 aux tests de Discrétion et de Déplacement silencieux.'),
  D('incantation-statique', 'Incantation statique', 'Still Spell', 'M', null, 'Lance le sort sans composante gestuelle. Emplacement de 1 niveau de plus.'),
  D('coup-etourdissant', 'Coup étourdissant', 'Stunning Fist', 'C', { car: { dex: 13, sag: 13 }, dons: ['science-mains-nues'], bba: 8 }, 'Une attaque à mains nues peut étourdir la cible pendant 1 round (Vigueur pour annuler). Une utilisation par round au maximum.',
    e => {
      const m = e.classes.moine || 0;
      const n = m ? m + Math.floor((e.niveau - m) / 4) : Math.floor(e.niveau / 4);
      return `${n} utilisation(s) par jour, DD ${10 + Math.floor(e.niveau / 2) + e.mods.sag} (10 + ½ niveau + mod Sag).`;
    }),
  D('maniement-pavois', 'Maniement du pavois', 'Tower Shield Proficiency', 'C', { dons: ['maniement-boucliers'] }, 'Utilise le pavois sans malus aux jets d\'attaque.'),
  D('robustesse', 'Robustesse', 'Toughness', 'G', null, '+3 points de vie.'),
  D('pistage', 'Pistage', 'Track', 'G', null, 'Utilise Survie pour suivre une piste.'),
  D('pietinement', 'Piétinement', 'Trample', 'C', { rang: { equitation: 1 }, dons: ['combat-monte'] }, 'Renversement à cheval : la cible ne peut pas l\'éviter, et la monture peut lui porter un coup de sabot.'),
  D('combat-deux-armes', 'Combat à deux armes', 'Two-Weapon Fighting', 'C', { car: { dex: 15 } }, 'Réduit les malus du combat à deux armes : −2/−2 avec une arme secondaire légère (au lieu de −4/−8).'),
  D('defense-deux-armes', 'Défense à deux armes', 'Two-Weapon Defense', 'C', { car: { dex: 15 }, dons: ['combat-deux-armes'] }, '+1 de bouclier à la CA en combattant avec deux armes (+2 sur la défensive).'),
  D('attaque-finesse', 'Attaque en finesse', 'Weapon Finesse', 'C', { bba: 1 }, 'Utilise le mod Dex au lieu du mod For aux jets d\'attaque avec les armes légères, la rapière, la chaîne cloutée et le fouet.'),
  D('arme-predilection', 'Arme de prédilection', 'Weapon Focus', 'C', { bba: 1 }, '+1 aux jets d\'attaque avec l\'arme choisie (« à mains nues » ou « lutte » possibles).'),
  D('specialisation-martiale', 'Spécialisation martiale', 'Weapon Specialization', 'C', { dons: ['arme-predilection'], classe: { guerrier: 4 } }, '+2 aux dégâts avec l\'arme choisie.'),
  D('attaque-tourbillonnante', 'Attaque tourbillonnante', 'Whirlwind Attack', 'C', { car: { dex: 13, int: 13 }, dons: ['expertise-combat', 'esquive', 'mobilite', 'attaque-eclair'], bba: 4 }, 'Une attaque contre chaque adversaire à portée, au prix de l\'attaque à outrance.'),
  D('extension-zone', 'Extension de zone', 'Widen Spell', 'M', null, 'Double la zone du sort. Emplacement de 3 niveaux de plus.'),
];
R.DON = Object.fromEntries(R.DONS.map(d => [d.id, d]));
R.TYPES_DONS = { G: 'Général', C: 'Combat', M: 'Métamagie', O: 'Création d\'objets' };
R.NIVEAUX_DONS = [1, 3, 6, 9, 12, 15, 18];

/* ---------- Armes (SRD 3.5) ----------
   cat : courante, guerre, exotique · prise : legere, une, deux, double, distance
   moine : arme spéciale de moine (déluge de coups possible) · finesse : utilisable avec Attaque en finesse
   lancer : arme de jet (la Force s'ajoute aux dégâts) */
const AR = (id, nom, cat, prise, deg, crit, portee = '', opts = {}) => ({ id, nom, cat, prise, deg, crit, portee, ...opts });
R.ARMES = [
  AR('dague', 'Dague', 'courante', 'legere', '1d4', '19-20/×2', '3 m', { lancer: true }),
  AR('gourdin', 'Gourdin', 'courante', 'une', '1d6', '×2', '3 m', { lancer: true }),
  AR('masse-legere', 'Masse d\'armes légère', 'courante', 'legere', '1d6', '×2'),
  AR('masse-lourde', 'Masse d\'armes lourde', 'courante', 'une', '1d8', '×2'),
  AR('morgenstern', 'Morgenstern', 'courante', 'une', '1d8', '×2'),
  AR('faucille', 'Faucille', 'courante', 'legere', '1d6', '×2'),
  AR('epieu', 'Épieu', 'courante', 'une', '1d6', '×2', '6 m', { lancer: true }),
  AR('lance', 'Lance', 'courante', 'deux', '1d8', '×3', '6 m', { lancer: true }),
  AR('pique', 'Pique', 'courante', 'deux', '1d8', '×3', '', { allonge: true }),
  AR('baton', 'Bâton', 'courante', 'double', '1d6', '×2', '', { moine: true, second: '1d6' }),
  AR('arbalete-legere', 'Arbalète légère', 'courante', 'distance', '1d8', '19-20/×2', '24 m'),
  AR('arbalete-lourde', 'Arbalète lourde', 'courante', 'distance', '1d10', '19-20/×2', '36 m'),
  AR('flechette', 'Fléchette', 'courante', 'distance', '1d4', '×2', '6 m', { lancer: true }),
  AR('fronde', 'Fronde', 'courante', 'distance', '1d4', '×2', '15 m', { lancer: true }),
  AR('javeline', 'Javeline', 'courante', 'distance', '1d6', '×2', '9 m', { lancer: true }),
  AR('hachette', 'Hachette', 'guerre', 'legere', '1d6', '×3', '3 m', { lancer: true }),
  AR('marteau-leger', 'Marteau léger', 'guerre', 'legere', '1d4', '×2', '6 m', { lancer: true }),
  AR('epee-courte', 'Épée courte', 'guerre', 'legere', '1d6', '19-20/×2'),
  AR('epee-longue', 'Épée longue', 'guerre', 'une', '1d8', '19-20/×2'),
  AR('rapiere', 'Rapière', 'guerre', 'une', '1d6', '18-20/×2', '', { finesse: true }),
  AR('cimeterre', 'Cimeterre', 'guerre', 'une', '1d6', '18-20/×2'),
  AR('hache-armes', 'Hache d\'armes', 'guerre', 'une', '1d8', '×3'),
  AR('marteau-guerre', 'Marteau de guerre', 'guerre', 'une', '1d8', '×3'),
  AR('fleau', 'Fléau d\'armes', 'guerre', 'une', '1d8', '×2'),
  AR('trident', 'Trident', 'guerre', 'une', '1d8', '×2', '3 m', { lancer: true }),
  AR('epee-deux-mains', 'Épée à deux mains', 'guerre', 'deux', '2d6', '19-20/×2'),
  AR('grande-hache', 'Grande hache', 'guerre', 'deux', '1d12', '×3'),
  AR('hallebarde', 'Hallebarde', 'guerre', 'deux', '1d10', '×3'),
  AR('coutille', 'Coutille', 'guerre', 'deux', '1d10', '×3', '', { allonge: true }),
  AR('cimeterre-deux-mains', 'Cimeterre à deux mains', 'guerre', 'deux', '2d4', '18-20/×2'),
  AR('arc-court', 'Arc court', 'guerre', 'distance', '1d6', '×3', '18 m'),
  AR('arc-long', 'Arc long', 'guerre', 'distance', '1d8', '×3', '30 m'),
  AR('kama', 'Kama', 'exotique', 'legere', '1d6', '×2', '', { moine: true }),
  AR('nunchaku', 'Nunchaku', 'exotique', 'legere', '1d6', '×2', '', { moine: true }),
  AR('sai', 'Saï', 'exotique', 'legere', '1d4', '×2', '3 m', { moine: true, lancer: true }),
  AR('siangham', 'Siangham', 'exotique', 'legere', '1d6', '×2', '', { moine: true }),
  AR('shuriken', 'Shuriken', 'exotique', 'distance', '1d2', '×2', '3 m', { moine: true, lancer: true }),
  AR('hache-naine', 'Hache de guerre naine', 'exotique', 'une', '1d10', '×3'),
  AR('ourgrosh', 'Ourgrosh nain', 'exotique', 'double', '1d8', '×3', '', { second: '1d6' }),
  AR('chaine-cloutee', 'Chaîne cloutée', 'exotique', 'deux', '2d4', '×2', '', { finesse: true, allonge: true }),
  AR('arbalete-poing', 'Arbalète de poing', 'exotique', 'distance', '1d4', '19-20/×2', '9 m'),
  AR('fouet', 'Fouet', 'exotique', 'une', '1d3', '×2', '', { finesse: true }),
];
R.ARME = Object.fromEntries(R.ARMES.map(a => [a.id, a]));
R.CATS_ARMES = { courante: 'Armes courantes', guerre: 'Armes de guerre', exotique: 'Armes exotiques' };
R.PRISES = { legere: 'Légère', une: 'À une main', deux: 'À deux mains', double: 'Arme double', distance: 'À distance' };
/* Dégâts pour une créature de taille P */
R.DEGATS_P = { '1d2': '1', '1d3': '1d2', '1d4': '1d3', '1d6': '1d4', '1d8': '1d6', '1d10': '1d8', '1d12': '1d10', '2d4': '1d6', '2d6': '1d10' };

/* ---------- Armures et boucliers (SRD 3.5) ----------
   ca : bonus d'armure ou de bouclier · dex : bonus de Dextérité maximal · malus : malus d'armure aux tests · echec : échec des sorts profanes */
const ARM = (id, nom, type, ca, dex, malus, echec) => ({ id, nom, type, ca, dex, malus, echec });
R.ARMURES = [
  ARM('matelassee', 'Armure matelassée', 'legere', 1, 8, 0, 5),
  ARM('cuir', 'Armure de cuir', 'legere', 2, 6, 0, 10),
  ARM('cuir-cloute', 'Armure de cuir clouté', 'legere', 3, 5, -1, 15),
  ARM('chemise-mailles', 'Chemise de mailles', 'legere', 4, 4, -2, 20),
  ARM('peau', 'Armure de peau', 'intermediaire', 3, 4, -3, 20),
  ARM('ecailles', 'Armure d\'écailles', 'intermediaire', 4, 3, -4, 25),
  ARM('cotte-mailles', 'Cotte de mailles', 'intermediaire', 5, 2, -5, 30),
  ARM('cuirasse', 'Cuirasse', 'intermediaire', 5, 3, -4, 25),
  ARM('clibanion', 'Clibanion', 'lourde', 6, 0, -7, 40),
  ARM('bandes', 'Armure à bandes', 'lourde', 6, 1, -6, 35),
  ARM('demi-plate', 'Demi-plate', 'lourde', 7, 0, -7, 40),
  ARM('harnois', 'Harnois', 'lourde', 8, 1, -6, 35),
  ARM('targe', 'Targe', 'bouclier', 1, null, -1, 5),
  ARM('ecu-leger', 'Écu léger', 'bouclier', 1, null, -1, 5),
  ARM('ecu-lourd', 'Écu lourd', 'bouclier', 2, null, -2, 15),
  ARM('pavois', 'Pavois', 'bouclier', 4, 2, -10, 50),
];
R.ARMURE = Object.fromEntries(R.ARMURES.map(a => [a.id, a]));
R.TYPES_ARMURES = { legere: 'Armures légères', intermediaire: 'Armures intermédiaires', lourde: 'Armures lourdes' };

/* ---------- Classes de prestige (Guide du Maître, contenu libre SRD 3.5) ----------
   prerequis : [texte, test(ctx)] où ctx = { e, p, rangs(id), don(id), sorts(type, niveau) }.
   sortsPlus : niveaux de la classe de prestige qui donnent +1 niveau de lanceur à une classe déjà possédée.
   cumulMoine : ses niveaux s'ajoutent à ceux de moine pour la CA, les mains nues, le déluge et la vitesse. */
const PR = o => ({ prestige: true, max: 10, maitrises: 'Aucune nouvelle maîtrise d\'arme ou d\'armure.', valeurs: () => [], ...o });
const tousDons = (...ids) => c => ids.every(id => c.don(id));
Object.assign(R.CLASSES, {
  'defenseur-nain': PR({
    nom: 'Défenseur nain', dv: 12, bba: 'fort', js: { vig: 1, vol: 1 }, pc: 2,
    comp: ['artisanat', 'perception', 'psychologie', 'detection'],
    prerequis: [
      ['Race : nain', c => c.p.race === 'nain'],
      ['Bonus de base à l\'attaque +7', c => c.e.bba >= 7],
      ['Dons : Esquive, Endurance, Robustesse', tousDons('esquive', 'endurance', 'robustesse')],
      ['Alignement loyal', c => /^Loyal/.test(c.p.alignement || '')],
    ],
    aptitudes: [
      A(1, 'Bonus à la CA', '+1 d\'esquive à la CA, puis +1 aux niveaux 4, 7 et 10.'),
      A(1, 'Position défensive', 'Il s\'ancre au sol : +2 For, +4 Con, +2 à tous les jets de sauvegarde et +4 d\'esquive à la CA, mais il ne peut plus se déplacer. Dure 3 + mod Con rounds, puis fatigue.'),
      A(2, 'Esquive instinctive', 'Garde son bonus de Dextérité à la CA quand il est pris au dépourvu.'),
      A(4, 'Sens des pièges', '+1 aux jets de Réflexes et à la CA contre les pièges (+2 au niveau 8).'),
      A(6, 'Réduction des dégâts', 'Ignore 3 points de dégâts de chaque attaque (6 au niveau 10).'),
      A(6, 'Esquive instinctive supérieure', 'Ne peut plus être pris en tenaille.'),
      A(8, 'Défense mobile', 'Peut faire un pas de 1,5 m par round sans perdre sa position défensive.'),
    ],
    valeurs: k => [
      ['Bonus de CA', '+' + Math.floor((k + 2) / 3)],
      ['Positions défensives', (1 + Math.floor((k - 1) / 2)) + '/jour'],
      ['Sens des pièges', k < 4 ? null : '+' + (k < 8 ? 1 : 2)],
      ['Réduction des dégâts', k < 6 ? null : (k < 10 ? 3 : 6) + '/—'],
    ],
  }),
  'danseur-ombre': PR({
    nom: 'Danseur de l\'ombre', dv: 8, bba: 'moyen', js: { ref: 1 }, pc: 6,
    comp: ['equilibre', 'bluff', 'decryptage', 'diplomatie', 'deguisement', 'evasion', 'discretion', 'saut', 'perception', 'deplacement-silencieux', 'representation', 'profession', 'fouille', 'escamotage', 'detection', 'acrobaties', 'maitrise-cordes'],
    prerequis: [
      ['Déplacement silencieux : 8 rangs', c => c.rangs('deplacement-silencieux') >= 8],
      ['Discrétion : 10 rangs', c => c.rangs('discretion') >= 10],
      ['Représentation (danse) : 5 rangs', c => c.rangs('representation') >= 5],
      ['Dons : Attaques réflexes, Esquive, Souplesse du serpent', tousDons('attaques-reflexes', 'esquive', 'mobilite')],
    ],
    aptitudes: [
      A(1, 'Camouflage', 'Peut se cacher même observé, tant qu\'il se trouve à moins de 3 m d\'une ombre.'),
      A(2, 'Esquive totale', 'Aucun dégât sur un jet de Réflexes réussi contre un effet de zone.'),
      A(2, 'Vision dans le noir', 'Voit dans le noir jusqu\'à 18 m.'),
      A(2, 'Esquive instinctive', 'Garde son bonus de Dextérité quand il est pris au dépourvu.'),
      A(3, 'Illusion d\'ombre', 'Image silencieuse 1 fois par jour.'),
      A(3, 'Convocation d\'ombre', 'Une ombre l\'accompagne et le sert.'),
      A(3, 'Saut d\'ombre', 'Passe d\'une ombre à une autre (12 m par jour, doublé aux niveaux 6, 8 et 10).'),
      A(4, 'Roulade défensive', 'Une fois par jour, réduit de moitié les dégâts d\'un coup qui l\'aurait mis hors de combat.'),
      A(5, 'Esquive instinctive supérieure', 'Ne peut plus être pris en tenaille.'),
      A(7, 'Esprit fuyant', 'Deuxième jet de sauvegarde contre les enchantements.'),
      A(10, 'Esquive surnaturelle', 'Moitié des dégâts même en cas d\'échec au jet de Réflexes.'),
    ],
  }),
  duelliste: PR({
    nom: 'Duelliste', dv: 10, bba: 'fort', js: { ref: 1 }, pc: 4,
    comp: ['equilibre', 'bluff', 'evasion', 'saut', 'perception', 'representation', 'psychologie', 'detection', 'acrobaties'],
    prerequis: [
      ['Bonus de base à l\'attaque +6', c => c.e.bba >= 6],
      ['Représentation : 3 rangs', c => c.rangs('representation') >= 3],
      ['Acrobaties : 5 rangs', c => c.rangs('acrobaties') >= 5],
      ['Dons : Esquive, Souplesse du serpent, Attaque en finesse', tousDons('esquive', 'mobilite', 'attaque-finesse')],
    ],
    aptitudes: [
      A(1, 'Défense intelligente', 'Sans armure ni bouclier, ajoute son mod d\'Intelligence (au plus son niveau de duelliste) à la CA.'),
      A(2, 'Réaction améliorée', '+2 en initiative (+4 au niveau 8).'),
      A(3, 'Mobilité accrue', '+4 à la CA supplémentaire contre les attaques d\'opportunité dues à ses déplacements.'),
      A(4, 'Grâce', '+2 aux jets de Réflexes, sans armure ni bouclier.'),
      A(5, 'Frappe précise', '+1d6 dégâts avec une arme perforante légère tenue d\'une main (+2d6 au niveau 10).'),
      A(6, 'Charge acrobatique', 'Peut charger sur un terrain difficile.'),
      A(7, 'Parade élaborée', 'En combat sur la défensive, ajoute la moitié de son niveau à la CA.'),
      A(9, 'Parade de projectiles', 'Comme le don du même nom.'),
    ],
    valeurs: k => [['Réaction améliorée', k < 2 ? null : '+' + (k < 8 ? 2 : 4)], ['Frappe précise', k < 5 ? null : (k < 10 ? '+1d6' : '+2d6')]],
  }),
  'theurge-mystique': PR({
    nom: 'Théurge mystique', dv: 4, bba: 'faible', js: { vol: 1 }, pc: 2,
    comp: ['concentration', 'artisanat', 'decryptage', 'conn-mysteres', 'conn-religion', 'profession', 'psychologie', 'art-magie'],
    prerequis: [
      ['Connaissances (mystères) : 6 rangs', c => c.rangs('conn-mysteres') >= 6],
      ['Connaissances (religion) : 6 rangs', c => c.rangs('conn-religion') >= 6],
      ['Sorts profanes de niveau 2', c => c.sorts('profane', 2)],
      ['Sorts divins de niveau 2', c => c.sorts('divin', 2)],
    ],
    sortsPlus: { type: 'les deux', niveaux: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] },
    aptitudes: [A(1, 'Lanceur double', 'Chaque niveau compte comme un niveau de plus pour une classe de lanceur profane ET pour une classe de lanceur divin.')],
  }),
  'chevalier-occulte': PR({
    nom: 'Chevalier occulte', dv: 6, bba: 'fort', js: { vig: 1 }, pc: 2,
    comp: ['concentration', 'artisanat', 'decryptage', 'saut', 'conn-mysteres', 'conn-noblesse', 'equitation', 'psychologie', 'art-magie', 'natation'],
    prerequis: [
      ['Maîtrise de toutes les armes de guerre', c => Object.keys(c.e.classes).some(id => /guerrier|paladin|rodeur|barbare/.test(id)) || c.don('maniement-armes-guerre')],
      ['Sorts profanes de niveau 3', c => c.sorts('profane', 3)],
    ],
    sortsPlus: { type: 'profane', niveaux: [2, 3, 4, 5, 6, 7, 8, 9, 10] },
    aptitudes: [
      A(1, 'Don supplémentaire', 'Un don de guerrier au choix.'),
      A(2, 'Progression des sorts', 'Du niveau 2 au niveau 10 : +1 niveau de lanceur dans sa classe profane.'),
    ],
  }),
  'archer-mage': PR({
    nom: 'Archer-mage', dv: 8, bba: 'fort', js: { vig: 1, ref: 1 }, pc: 4,
    comp: ['artisanat', 'discretion', 'perception', 'deplacement-silencieux', 'equitation', 'detection', 'survie', 'maitrise-cordes'],
    prerequis: [
      ['Race : elfe ou demi-elfe', c => /elfe|drow/.test(c.p.race || '')],
      ['Bonus de base à l\'attaque +6', c => c.e.bba >= 6],
      ['Dons : Tir à bout portant, Tir de précision, Arme de prédilection (arc)', tousDons('tir-bout-portant', 'tir-precision', 'arme-predilection')],
      ['Sorts profanes de niveau 1', c => c.sorts('profane', 1)],
    ],
    aptitudes: [
      A(1, 'Flèches magiques', 'Ses flèches deviennent magiques : +1 (+1 aux niveaux 3, 5, 7 et 9).'),
      A(2, 'Flèche à sort', 'Peut placer un sort de zone dans une flèche.'),
      A(4, 'Flèche chercheuse', '1 fois par jour, une flèche contourne les obstacles vers une cible connue.'),
      A(6, 'Flèche fantôme', '1 fois par jour, une flèche traverse les obstacles.'),
      A(8, 'Pluie de flèches', '1 fois par jour, une flèche par niveau, sur autant de cibles.'),
      A(10, 'Flèche de mort', '1 fois par jour, la cible touchée doit réussir un jet de Vigueur DD 20 ou mourir.'),
    ],
    valeurs: k => [['Bonus des flèches', '+' + Math.ceil(k / 2)]],
  }),
});
R.PRESTIGES = Object.keys(R.CLASSES).filter(id => R.CLASSES[id].prestige);

/* Classe de prestige saisie par le joueur (livre hors SRD : Poing sacré, etc.) */
R.classePerso = d => PR({
  nom: d.nom || 'Classe de prestige', perso: true, dv: num0(d.dv) || 8, bba: d.bba || 'moyen',
  js: { vig: d.vig ? 1 : 0, ref: d.ref ? 1 : 0, vol: d.vol ? 1 : 0 }, pc: num0(d.pc) || 2, max: num0(d.max) || 10,
  comp: d.comp || [], cumulMoine: !d.cumul && !!d.cumulMoine, cumul: d.cumul || null,
  prerequis: d.prerequis ? String(d.prerequis).split('\n').filter(Boolean).map(t => [t.trim(), null]) : [],
  sortsPlus: d.sortsType ? { type: d.sortsType, niveaux: String(d.sortsNiveaux || '').split(/[,; ]+/).map(Number).filter(Boolean) } : null,
  aptitudes: (d.aptitudes || []).filter(a => a.nom).map(a => A(num0(a.niv) || 1, a.nom, a.texte || '')),
  /* « 1:1, 5:2, 10:3 » : valeur selon le niveau dans la classe */
  caPaliers: R.paliers(d.caPaliers), vitPaliers: R.paliers(d.vitPaliers),
  ressourcesPerso: (d.ressources || []).filter(r => r.nom).map(r => ({ nom: r.nom, texte: r.texte || '', action: r.action || '', paliers: R.paliers(r.paliers) })),
});
R.paliers = txt => String(txt || '').split(/[,;]+/).map(x => x.split(':').map(y => num0(y))).filter(x => x.length === 2 && x[0] > 0).sort((a, b) => a[0] - b[0]);
R.valeurPalier = (paliers, k) => (paliers || []).reduce((v, [n, x]) => k >= n ? x : v, 0);
const num0 = v => Number(String(v ?? '').replace(',', '.')) || 0;

/* Autres noms des dons (traductions non officielles, noms anglais francisés, noms de jeux vidéo)
   pour les retrouver quelle que soit la façon dont on les cherche. */
R.ALIAS_DONS = {
  'efficacite-sorts': 'pénétration des sorts, pénétration magique, surpassement magique, percée magique',
  'efficacite-sorts-superieure': 'pénétration des sorts supérieure, pénétration magique supérieure, surpassement magique supérieur',
  'ecole-renforcee': 'focalisation de sort, spécialisation dans une école, focus de sort',
  'ecole-superieure': 'focalisation de sort supérieure, focus de sort supérieur',
  'attaques-reflexes': 'réflexes de combat',
  'mobilite': 'mobilité',
  'science-mains-nues': 'combat à mains nues amélioré, frappe à mains nues',
  'coup-etourdissant': 'poing étourdissant, frappe étourdissante',
  'attaque-finesse': 'arme en finesse, finesse',
  'arme-predilection': 'focalisation martiale, focalisation d\'arme',
  'tir-precision': 'tir précis',
  'robustesse': 'résistance, ténacité',
  'talent': 'science des compétences, focalisation de compétence, spécialisation de compétence',
};

/* ---------- Domaines du prêtre (Manuel des Joueurs 3.5, SRD) ----------
   sorts : noms anglais des sorts de domaine du niveau 1 au niveau 9 (retrouvés dans le grimoire par leur nom VO).
   comp : compétences qui deviennent des compétences de classe.
   usage : pouvoir à utilisation quotidienne (compteur dans « En combat »). */
const DOM = (id, nom, pouvoir, sorts, extra = {}) => ({ id, nom, pouvoir, sorts: sorts.split('|'), ...extra });
R.DOMAINES = Object.fromEntries([
  DOM('air', 'Air', 'Renvoie ou détruit les créatures de la terre, intimide ou contrôle celles de l\'air.', 'Obscuring Mist|Wind Wall|Gaseous Form|Air Walk|Control Winds|Chain Lightning|Control Weather|Whirlwind|Elemental Swarm'),
  DOM('animal', 'Animaux', 'Communication avec les animaux 1 fois par jour. Connaissances (nature) devient une compétence de classe.', 'Calm Animals|Hold Animal|Dominate Animal|Summon Nature\'s Ally IV|Commune with Nature|Antilife Shell|Animal Shapes|Summon Nature\'s Ally VIII|Shapechange', { comp: ['conn-nature'] }),
  DOM('chaos', 'Chaos', 'Lance les sorts du Chaos avec +1 niveau de lanceur.', 'Protection from Law|Shatter|Magic Circle against Law|Chaos Hammer|Dispel Law|Animate Objects|Word of Chaos|Cloak of Chaos|Summon Monster IX'),
  DOM('mort', 'Mort', 'Contact mortel 1 fois par jour : toucher, lancer 1d6 par niveau de prêtre ; si le total dépasse les PV actuels de la cible, elle meurt.', 'Cause Fear|Death Knell|Animate Dead|Death Ward|Slay Living|Create Undead|Destruction|Create Greater Undead|Wail of the Banshee', { usage: { nom: 'Contact mortel', action: 'Action simple' } }),
  DOM('destruction', 'Destruction', 'Châtiment 1 fois par jour : +4 au jet d\'attaque et + niveau de prêtre aux dégâts d\'une attaque au corps à corps.', 'Inflict Light Wounds|Shatter|Contagion|Inflict Critical Wounds|Mass Inflict Light Wounds|Harm|Disintegrate|Earthquake|Implosion', { usage: { nom: 'Châtiment (Destruction)', action: 'À annoncer avant l\'attaque' } }),
  DOM('terre', 'Terre', 'Renvoie ou détruit les créatures de l\'air, intimide ou contrôle celles de la terre.', 'Magic Stone|Soften Earth and Stone|Stone Shape|Spike Stones|Wall of Stone|Stoneskin|Earthquake|Iron Body|Elemental Swarm'),
  DOM('mal', 'Mal', 'Lance les sorts du Mal avec +1 niveau de lanceur.', 'Protection from Good|Desecrate|Magic Circle against Good|Unholy Blight|Dispel Good|Create Undead|Blasphemy|Unholy Aura|Summon Monster IX'),
  DOM('feu', 'Feu', 'Renvoie ou détruit les créatures de l\'eau, intimide ou contrôle celles du feu.', 'Burning Hands|Produce Flame|Resist Energy|Wall of Fire|Fire Shield|Fire Seeds|Fire Storm|Incendiary Cloud|Elemental Swarm'),
  DOM('bien', 'Bien', 'Lance les sorts du Bien avec +1 niveau de lanceur.', 'Protection from Evil|Aid|Magic Circle against Evil|Holy Smite|Dispel Evil|Blade Barrier|Holy Word|Holy Aura|Summon Monster IX'),
  DOM('guerison', 'Guérison', 'Lance les sorts de guérison avec +1 niveau de lanceur.', 'Cure Light Wounds|Cure Moderate Wounds|Cure Serious Wounds|Cure Critical Wounds|Mass Cure Light Wounds|Heal|Regenerate|Mass Cure Critical Wounds|Mass Heal'),
  DOM('connaissance', 'Connaissance', 'Toutes les Connaissances deviennent des compétences de classe ; lance les divinations avec +1 niveau de lanceur.', 'Detect Secret Doors|Detect Thoughts|Clairaudience/Clairvoyance|Divination|True Seeing|Find the Path|Legend Lore|Discern Location|Foresight', { comp: ['conn-mysteres', 'conn-architecture', 'conn-donjons', 'conn-geographie', 'conn-histoire', 'conn-local', 'conn-nature', 'conn-noblesse', 'conn-plans', 'conn-religion'] }),
  DOM('loi', 'Loi', 'Lance les sorts de la Loi avec +1 niveau de lanceur.', 'Protection from Chaos|Calm Emotions|Magic Circle against Chaos|Order\'s Wrath|Dispel Chaos|Hold Monster|Dictum|Shield of Law|Summon Monster IX'),
  DOM('chance', 'Chance', 'Bonne fortune 1 fois par jour : relance un jet qui vient d\'être fait et garde le second résultat.', 'Entropic Shield|Aid|Protection from Energy|Freedom of Movement|Break Enchantment|Mislead|Spell Turning|Moment of Prescience|Miracle', { usage: { nom: 'Bonne fortune', action: 'Action libre' } }),
  DOM('magie', 'Magie', 'Utilise les parchemins, baguettes et objets à fin d\'incantation comme un magicien de la moitié de son niveau de prêtre.', 'Magic Aura|Identify|Dispel Magic|Imbue with Spell Ability|Spell Resistance|Antimagic Field|Spell Turning|Protection from Spells|Mage\'s Disjunction'),
  DOM('vegetation', 'Végétation', 'Intimide ou contrôle les créatures végétales. Connaissances (nature) devient une compétence de classe.', 'Entangle|Barkskin|Plant Growth|Command Plants|Wall of Thorns|Repel Wood|Animate Plants|Control Plants|Shambler', { comp: ['conn-nature'] }),
  DOM('protection', 'Protection', 'Garde protectrice 1 fois par jour : une créature touchée gagne un bonus de résistance égal au niveau de prêtre sur son prochain jet de sauvegarde (pendant 1 heure).', 'Sanctuary|Shield Other|Protection from Energy|Spell Immunity|Spell Resistance|Antimagic Field|Repulsion|Mind Blank|Prismatic Sphere', { usage: { nom: 'Garde protectrice', action: 'Action simple', duree: '600' } }),
  DOM('force', 'Force', 'Prouesse de force 1 fois par jour : bonus d\'altération en Force égal au niveau de prêtre, pendant 1 round.', 'Enlarge Person|Bull\'s Strength|Magic Vestment|Spell Immunity|Righteous Might|Stoneskin|Grasping Hand|Clenched Fist|Crushing Hand', { usage: { nom: 'Prouesse de force', action: 'Action libre', duree: '1' } }),
  DOM('soleil', 'Soleil', 'Renvoi suprême 1 fois par jour : un renvoi des morts-vivants qui détruit au lieu de faire fuir.', 'Endure Elements|Heat Metal|Searing Light|Fire Shield|Flame Strike|Fire Seeds|Sunbeam|Sunburst|Prismatic Sphere', { usage: { nom: 'Renvoi suprême', action: 'Action simple' } }),
  DOM('voyage', 'Voyage', 'Liberté de mouvement pendant 1 round par niveau de prêtre chaque jour. Survie devient une compétence de classe.', 'Longstrider|Locate Object|Fly|Dimension Door|Teleport|Find the Path|Greater Teleport|Phase Door|Astral Projection', { comp: ['survie'] }),
  DOM('duperie', 'Duperie', 'Bluff, Déguisement et Discrétion deviennent des compétences de classe.', 'Disguise Self|Invisibility|Nondetection|Confusion|False Vision|Mislead|Screen|Polymorph Any Object|Time Stop', { comp: ['bluff', 'deguisement', 'discretion'] }),
  DOM('guerre', 'Guerre', 'Maniement et Arme de prédilection gratuits avec l\'arme de prédilection de sa divinité.', 'Magic Weapon|Spiritual Weapon|Magic Vestment|Divine Power|Flame Strike|Blade Barrier|Power Word Blind|Power Word Stun|Power Word Kill'),
  DOM('eau', 'Eau', 'Renvoie ou détruit les créatures du feu, intimide ou contrôle celles de l\'eau.', 'Obscuring Mist|Fog Cloud|Water Breathing|Control Water|Ice Storm|Cone of Cold|Acid Fog|Horrid Wilting|Elemental Swarm'),
].map(d => [d.id, d]));
