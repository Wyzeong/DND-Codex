'use strict';

/* ============================================================
   Codex de campagne : fiches, grimoire et progression (D&D 3.5)
   Données stockées dans le navigateur (IndexedDB).
   ============================================================ */

const STORE_KEY = 'codex-dd35-v1';
const APP_VERSION = 1;

const ECOLES = ['Abjuration', 'Divination', 'Enchantement', 'Évocation', 'Illusion', 'Invocation', 'Nécromancie', 'Transmutation', 'Universel'];
const CLASSES_ABR = {
  'Brd': 'Barde', 'Dru': 'Druide', 'Ens/Mag': 'Ensorceleur / Magicien',
  'Pal': 'Paladin', 'Prê': 'Prêtre', 'Rôd': 'Rôdeur',
};
const STATUTS = ['Connu', 'Préparé', 'Parchemin', 'Baguette', 'Autre'];

/* ---------- Outils ---------- */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const norm = s => String(s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const slug = s => norm(s).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'sans-nom';
const byNom = (a, b) => String(a.nom).localeCompare(String(b.nom), 'fr');
const getP = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
function setP(o, p, v) {
  const ks = p.split('.');
  let a = o;
  for (let i = 0; i < ks.length - 1; i++) {
    if (a[ks[i]] == null) a[ks[i]] = {};
    a = a[ks[i]];
  }
  a[ks[ks.length - 1]] = v;
}
const ecoleClass = e => 'ecole-' + norm(e || 'universel').split(/\s/)[0];

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), 2200);
}

/* ---------- Stockage ---------- */
let db = { version: APP_VERSION, personnages: [], sorts: [], sessions: [], sortsInitialises: false };

/* Les données de l'appareil sont rangées dans IndexedDB (des centaines de Mo possibles),
   et non plus dans localStorage, limité à environ 5 Mo. Les anciennes données y sont reprises une fois. */
const IDB = {
  ouvrir() {
    if (this._p) return this._p;
    this._p = new Promise((ok, ko) => {
      const r = indexedDB.open('codex-campagne', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => ok(r.result);
      r.onerror = () => ko(r.error);
    });
    return this._p;
  },
  async lire(cle) {
    const d = await this.ouvrir();
    return new Promise((ok, ko) => { const t = d.transaction('kv').objectStore('kv').get(cle); t.onsuccess = () => ok(t.result); t.onerror = () => ko(t.error); });
  },
  async ecrire(cle, val) {
    const d = await this.ouvrir();
    return new Promise((ok, ko) => { const t = d.transaction('kv', 'readwrite'); t.objectStore('kv').put(val, cle); t.oncomplete = () => ok(); t.onerror = () => ko(t.error); t.onabort = () => ko(t.error); });
  },
};
async function load() {
  /* Des données encore présentes dans localStorage sont toujours les plus récentes :
     la nouvelle version les supprime dès qu'elles sont copiées, et n'y écrit qu'en dernier recours. */
  let raw = null;
  try { raw = localStorage.getItem(STORE_KEY); } catch (e) { /* */ }
  if (!raw) { try { raw = await IDB.lire(STORE_KEY); } catch (e) { console.warn('IndexedDB indisponible', e); } }
  try { if (raw) db = Object.assign(db, JSON.parse(raw)); }
  catch (e) { console.error(e); toast('Lecture des données impossible : ' + e.message); }
  /* Reprise des anciennes données : on libère localStorage une fois la copie faite */
  try {
    if (localStorage.getItem(STORE_KEY)) { delete db.versions; await IDB.ecrire(STORE_KEY, JSON.stringify(db)); localStorage.removeItem(STORE_KEY); }
  } catch (e) { /* on réessaiera au prochain démarrage */ }
  try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* */ }
}
let ecritureEnCours = Promise.resolve();
function ecrireDb() {
  const json = JSON.stringify(db);
  ecritureEnCours = ecritureEnCours.then(() => IDB.ecrire(STORE_KEY, json)).catch(e => {
    /* dernier recours : localStorage */
    try { localStorage.setItem(STORE_KEY, json); } catch (e2) { alert('Enregistrement impossible sur cet appareil : ' + (e.message || e2.message)); }
  });
  return ecritureEnCours;
}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
  signalerModif(state.ctx);
}
/* Une fiche ou une session modifiée part en ligne (si la base est configurée) */
function signalerModif(o) {
  if (!o) return;
  if (db.personnages.includes(o)) { o.maj = Date.now(); persoModifie(o); }
  else if ((db.sessions || []).includes(o)) { o.maj = Date.now(); notesModifiees(o.persoId); }
}
function saveNow() {
  try {
    ecrireDb();
    const s = $('#status');
    s.textContent = 'Enregistré';
    s.classList.add('on');
    clearTimeout(saveNow._t);
    saveNow._t = setTimeout(() => s.classList.remove('on'), 1500);
  } catch (e) {
    alert('Enregistrement impossible : ' + e.message);
  }
}

async function chargerSortsSRD() {
  const res = await fetch('spells.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('spells.json introuvable');
  return res.json();
}
/* Ajoute les sorts d'une nouvelle version de spells.json sans toucher
   aux sorts modifiés à la main, aux sorts maison ni aux sorts supprimés. */
async function initSorts() {
  try {
    const data = await chargerSortsSRD();
    const version = data.version || 1;
    if (db.sortsInitialises && db.sortsVersion === version) return;
    const premiereFois = !db.sortsInitialises;
    const supprimes = new Set(db.sortsSupprimes || []);
    const parId = new Map(db.sorts.map(s => [s.id, s]));
    let ajoutes = 0;
    for (const s of data.sorts || []) {
      const cur = parId.get(s.id);
      if (!cur) {
        if (!supprimes.has(s.id)) { db.sorts.push(s); ajoutes++; }
      } else if (cur.source === 'SRD' && !cur.modifie) {
        Object.assign(cur, s);
      }
    }
    db.sortsVersion = version;
    db.sortsInitialises = true;
    saveNow();
    if (!premiereFois && ajoutes) toast(`Grimoire mis à jour : ${ajoutes} nouveaux sorts`);
  } catch (e) {
    console.error(e);
    toast('Liste de sorts non chargée. Vérifie ta connexion puis recharge la page.');
  }
}

function parseNiveaux(txt) {
  return String(txt || '').split(',').map(x => x.trim()).filter(Boolean).map(x => {
    const m = x.match(/^(.+?)\s+(\d+)$/);
    return m ? { classe: m[1].trim(), niveau: Number(m[2]) } : null;
  }).filter(Boolean);
}
const niveauxTxt = s => (s.niveaux || []).map(n => `${n.classe} ${n.niveau}`).join(', ');
const findSort = id => db.sorts.find(s => s.id === id);
const findPerso = id => db.personnages.find(p => p.id === id);

/* ---------- État d'affichage ---------- */
const state = {
  ctx: null,             // objet en cours d'édition (personnage)
  filtres: { q: '', ecole: '', classe: '', niveau: '', usage: '' },
  draft: null,           // sort en cours d'édition
  pickQ: '',
  ouverts: new Set(),    // niveaux dépliés dans la progression
  fermes: new Set(),     // niveaux repliés volontairement
  imgType: null,
  jq: '',               // recherche dans le journal
  typeNote: 'note',     // type de la prochaine note
  editNote: null,       // note en cours de modification
  editRecap: null,      // récapitulatif en cours de modification
  editFiche: null,      // fiche d'encyclopédie en cours de modification
  eq: '',               // recherche dans l'encyclopédie
  ftype: '',            // filtre par type de fiche
};

/* ---------- Visuels de la marque ---------- */
const LOGO_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true">
  <defs>
    <linearGradient id="lg-bronze" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#E2C690"/><stop offset=".55" stop-color="#B7935A"/><stop offset="1" stop-color="#7C6238"/></linearGradient>
    <radialGradient id="lg-halo"><stop offset="0" stop-color="#9FD4F0" stop-opacity=".9"/><stop offset="1" stop-color="#5E9ED6" stop-opacity="0"/></radialGradient>
  </defs>
  <circle cx="50" cy="50" r="38" fill="none" stroke="url(#lg-bronze)" stroke-width="2"/>
  <circle cx="50" cy="50" r="32" fill="none" stroke="#B7935A" stroke-width=".7" opacity=".7"/>
  <g fill="url(#lg-bronze)">
    <path d="M50 3 L54.5 45.5 L50 50 L45.5 45.5Z"/><path d="M50 97 L54.5 54.5 L50 50 L45.5 54.5Z"/>
    <path d="M3 50 L45.5 45.5 L50 50 L45.5 54.5Z"/><path d="M97 50 L54.5 45.5 L50 50 L54.5 54.5Z"/>
    <path d="M24 24 L48 46 L50 50 L46 48Z" opacity=".75"/><path d="M76 76 L52 54 L50 50 L54 52Z" opacity=".75"/>
    <path d="M76 24 L54 48 L50 50 L52 46Z" opacity=".75"/><path d="M24 76 L46 52 L50 50 L48 54Z" opacity=".75"/>
  </g>
  <path d="M50 3 L50 97 M3 50 L97 50" stroke="#0B1E2D" stroke-width=".6" opacity=".6"/>
  <line x1="22" y1="84" x2="67" y2="33" stroke="#6B4E2C" stroke-width="4.2" stroke-linecap="round"/>
  <line x1="22" y1="84" x2="67" y2="33" stroke="#B7935A" stroke-width="1.2" stroke-linecap="round" stroke-dasharray="3 5"/>
  <circle cx="71" cy="28" r="13" fill="url(#lg-halo)"/>
  <path d="M71 13 L77 27 L71 42 L65 27Z" fill="#5E9ED6" transform="rotate(41 71 27.5)"/>
  <path d="M71 13 L77 27 L71 27Z" fill="#CFEAF8" transform="rotate(41 71 27.5)"/>
</svg>`;
const SILHOUETTE_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="36" r="17" fill="currentColor"/><path d="M14 98c2-24 17-36 36-36s34 12 36 36Z" fill="currentColor"/></svg>`;

/* ---------- Modèles ---------- */
function nouveauPerso() {
  return {
    schema: 2, id: uid(), nom: 'Nouveau personnage', joueur: '',
    race: '', raceAutre: '', alignement: '', divinite: '', diviniteAutre: '', sexe: '', age: '', taillePoids: '',
    langues: [], languesAutres: '', apparence: '', portrait: '', embleme: '',
    caracs: Object.fromEntries(R.CARACS.map(c => [c.k, { val: '' }])),
    pvMax: '', ajust: {}, comp: {}, attaques: '',
    donsSupp: [], dons: [], capacites: [], equipement: [],
    argent: { pp: '', po: '', pa: '', pc: '' }, notes: '',
    sorts: [], progression: [], maj: Date.now(),
  };
}
/* Ce qu'un objet équipé peut améliorer */
/* Résistances et protections */
const ENERGIES = [['acide', 'à l\'acide'], ['electricite', 'à l\'électricité'], ['feu', 'au feu'], ['froid', 'au froid'], ['son', 'au son'], ['negatif', 'à l\'énergie négative']];
const IMMUNITES = [['poison', 'poison'], ['maladie', 'maladies'], ['sommeil', 'sommeil magique'], ['peur', 'terreur'], ['mental', 'effets mentaux'], ['paralysie', 'paralysie'], ['petrification', 'pétrification'], ['feu', 'feu'], ['froid', 'froid'], ['electricite', 'électricité'], ['acide', 'acide']];
const JS_CONTRE = [['poison', 'le poison'], ['sorts', 'les sorts'], ['enchantements', 'les enchantements'], ['peur', 'la terreur'], ['illusions', 'les illusions'], ['maladies', 'les maladies']];

const CIBLES_BONUS = [
  ['Caractéristiques', R.CARACS.map(c => [c.k, c.n])],
  ['Défense', [['caArmure', 'CA (armure, bouclier, naturelle)'], ['caParade', 'CA (parade, divers : aussi au contact)']]],
  ['Jets de sauvegarde', [['js', 'Tous les jets de sauvegarde'], ['vig', 'Vigueur'], ['ref', 'Réflexes'], ['vol', 'Volonté']]],
  ['Combat', [['attaque', 'Jets d\'attaque'], ['degats', 'Dégâts'], ['init', 'Initiative'], ['vitesse', 'Vitesse (m)']]],
  ['Résistances (valeur = points ignorés)', ENERGIES.map(([k, l]) => ['res:' + k, 'Résistance ' + l])],
  ['Dégâts reçus divisés par 2 (valeur : 1)', ENERGIES.map(([k, l]) => ['moitie:' + k, 'Moitié des dégâts ' + l.replace(/^(à l'|au |à la )/, m => ({ "à l'": "d'", 'au ': 'de ', 'à la ': 'de ' })[m])])],
  ['Protections', [['rm', 'Résistance à la magie'], ['rd', 'Réduction des dégâts'], ...IMMUNITES.map(([k, l]) => ['imm:' + k, 'Immunité : ' + l]), ...JS_CONTRE.map(([k, l]) => ['jsc:' + k, 'Jets de sauvegarde contre ' + l])]],
  ['Compétences', R.COMPETENCES.map(c => ['comp:' + c.id, c.nom])],
];
const NOM_CIBLE = Object.fromEntries(CIBLES_BONUS.flatMap(([, l]) => l));
/* Somme des bonus des objets équipés, par cible, avec le détail des objets */
function bonusObjets(p) {
  const tot = {}, detail = {}, cond = {};
  const ajouter = (b, source) => {
    const v = num(b.val);
    if (!b.cible || !v) return;
    if (b.cond) { (cond[b.cible] = cond[b.cible] || []).push({ val: v, quand: b.quand || 'sous condition', source }); return; }
    tot[b.cible] = (tot[b.cible] || 0) + v;
    (detail[b.cible] = detail[b.cible] || []).push(`${source} ${R.signe(v)}`);
  };
  let maxDex = null, acp = 0, echec = 0;
  for (const it of p.equipement || []) {
    if (it.equipe === false) continue;
    if (it.cat === 'armure' || it.cat === 'bouclier') {
      const ref = R.ARMURE[it.armureType];
      const ca = (ref ? ref.ca : num(it.caBase)) + num(it.alteration);
      if (ca) {
        tot.caArmure = (tot.caArmure || 0) + ca;
        (detail.caArmure = detail.caArmure || []).push(`${it.nom || ref?.nom || 'Armure'} ${R.signe(ca)}`);
      }
      const dexMax = ref ? ref.dex : (it.dexMax === '' || it.dexMax == null ? null : num(it.dexMax));
      if (dexMax != null) maxDex = maxDex == null ? dexMax : Math.min(maxDex, dexMax);
      /* une armure de maître réduit le malus de 1 */
      acp += Math.min(0, (ref ? ref.malus : num(it.malus)) + (it.maitre ? 1 : 0));
      echec += ref ? ref.echec : num(it.echec);
    }
    for (const b of it.bonus || []) ajouter(b, it.nom || 'Objet');
  }
  for (const et of p.etats || []) {
    if (et.actif === false) continue;
    for (const b of et.bonus || []) ajouter(b, et.nom || 'État');
  }
  for (const am of p.ameliorations || []) ajouter(am, 'Amélioration temporaire' + (am.note ? ` (${am.note})` : ''));
  return { tot, detail, cond, maxDex, acp, echec };
}

const LIST_TEMPLATES = {
  dons: () => ({ nom: '', description: '' }),
  capacites: () => ({ nom: '', description: '' }),
  equipement: () => ({ id: uid(), nom: '', qte: '', poids: '', notes: '', cat: '' }),
};
function nouveauNiveau(n, classe = '') {
  return { niveau: n, classe, atteint: false, don: '', donRace: '', donsBonus: [], augment: '', pv: '', choix: {}, notes: '' };
}

/* Reprend les fiches créées avec la première version */
function migrer(p) {
  if (p.schema >= 2) return;
  const trouve = (liste, v) => liste.find(x => norm(x) === norm(v));
  const notes = [];
  if (p.race && !R.RACES[p.race]) {
    const id = Object.keys(R.RACES).find(k => norm(R.RACES[k].nom) === norm(p.race));
    if (id) p.race = id; else { p.raceAutre = p.race; p.race = 'autre'; }
  }
  if (p.alignement && !R.ALIGNEMENTS.includes(p.alignement)) {
    const a = trouve(R.ALIGNEMENTS, p.alignement);
    if (a) p.alignement = a; else { notes.push('Alignement : ' + p.alignement); p.alignement = ''; }
  }
  if (p.divinite && !R.DIVINITES.includes(p.divinite)) {
    const d = trouve(R.DIVINITES, p.divinite);
    if (d) p.divinite = d; else { p.diviniteAutre = p.divinite; p.divinite = 'Autre'; }
  }
  if (p.sexe && !R.SEXES.includes(p.sexe)) {
    const sx = trouve(R.SEXES, p.sexe) || ({ m: 'Masculin', h: 'Masculin', f: 'Féminin' })[norm(p.sexe)[0]];
    p.sexe = sx || '';
  }
  if (typeof p.langues === 'string') {
    const brut = p.langues.split(/[,;/]+/).map(x => x.trim()).filter(Boolean);
    p.langues = brut.map(l => trouve(R.LANGUES, l)).filter(Boolean);
    p.languesAutres = brut.filter(l => !trouve(R.LANGUES, l)).join(', ');
  }
  if ((p.competences || []).some(c => c.nom)) {
    notes.push('Compétences (ancienne saisie) : ' + p.competences.filter(c => c.nom).map(c => `${c.nom} ${c.total}`.trim()).join(', '));
  }
  if (p.classes) notes.push('Classes (ancienne saisie) : ' + p.classes);
  for (const l of p.progression || []) {
    const id = Object.keys(R.CLASSES).find(k => norm(l.classe || '').startsWith(norm(R.CLASSES[k].nom)));
    const vieux = [['Classe', id ? '' : l.classe], ['Capacités', l.capacites], ['Dons', l.dons], ['Compétences', l.competences], ['Sorts', l.sorts], ['Caractéristiques', l.carac]]
      .filter(([, v]) => v && String(v).trim()).map(([k, v]) => `${k} : ${v}`);
    Object.assign(l, { classe: id || '', don: '', donRace: '', donsBonus: [], augment: '', pv: l.pv || '', choix: l.choix || {} });
    delete l.capacites; delete l.dons; delete l.competences; delete l.sorts; delete l.carac;
    if (vieux.length) l.notes = [vieux.join('\n'), l.notes].filter(Boolean).join('\n');
  }
  if (notes.length) p.notes = [p.notes, notes.join('\n')].filter(Boolean).join('\n\n');
  delete p.competences; delete p.classes; delete p.niveau; delete p.xp; delete p.taille;
  p.ajust = p.ajust || {}; p.comp = p.comp || {}; p.donsSupp = p.donsSupp || [];
  p.langues = Array.isArray(p.langues) ? p.langues : [];
  p.schema = 2;
}

/* ---------- Moteur de calcul ---------- */
const niveauActuel = p => (p.progression || []).filter(l => l.atteint && R.CLASSES[l.classe]).length;
const num = v => (v === '' || v == null || isNaN(Number(v))) ? 0 : Number(v);

/* État du personnage au niveau n.
   prevus = true : compte aussi les niveaux planifiés (pour la progression).
   sauf = { niveau, champ } : ignore le don d'un emplacement (vérification de ses propres prérequis). */
function appliquerAugment(p, l) {
  if (!l) return;
  const voulu = l.atteint && l.augment ? l.augment : null;
  const fait = l.augmentApplique || null;
  if (voulu === fait) return;
  const ajuste = (k, d) => {
    const c = (p.caracs = p.caracs || {})[k] = p.caracs[k] || {};
    if (c.val === '' || c.val == null) return false;
    c.val = String(num(c.val) + d);
    return true;
  };
  if (fait) ajuste(fait, -1);
  l.augmentApplique = voulu && ajuste(voulu, 1) ? voulu : null;
  if (l.augmentApplique) toast(`+1 ${R.CARACS.find(c => c.k === voulu).n} reporté sur la fiche`);
}
/* ===== Classes de prestige saisies depuis un livre : communes à toute la campagne ===== */
const classesCommunes = () => (db.classesPerso = db.classesPerso || []);
function enregistrerClassesCommunes() {
  for (const d of classesCommunes()) R.CLASSES['pp-' + d.id] = R.classePerso(d);
}
function enregistrerPrestigesPerso(p) {
  enregistrerClassesCommunes();
  /* anciennes classes rangées dans une fiche (avant qu'elles deviennent communes) */
  for (const d of p.prestigePerso || []) if (!R.CLASSES['pp-' + d.id]) R.CLASSES['pp-' + d.id] = R.classePerso(d);
}
const classesAttente = new Set();
let classesTimer;
/* Qui signe l'enregistrement : la fiche ouverte (code personnel), sinon le MJ ou l'administrateur */
function signataireClasses() {
  const p = state.ctx && db.personnages.includes(state.ctx) ? state.ctx : null;
  if (p && peutModifier(p) && !p.pnjMJ && codePour(p)) return { p_perso: p.id, p_code: codePour(p) };
  if (db.codeMJ) return { p_perso: null, p_code: db.codeMJ };
  if (db.codeCampagne) return { p_perso: null, p_code: db.codeCampagne };
  const mien = db.personnages.find(x => (db.cles || {})[x.id]);
  return mien ? { p_perso: mien.id, p_code: db.cles[mien.id] } : null;
}
const peutModifierClasses = () => !enLigne() || !!signataireClasses();
function sauverClasse(d) {
  enregistrerClassesCommunes();
  saveNow();
  if (!enLigne()) return;
  classesAttente.add(d.id);
  clearTimeout(classesTimer);
  classesTimer = setTimeout(envoyerClasses, 800);
}
async function envoyerClasses() {
  const sig = signataireClasses();
  if (!sig) return;
  for (const id of [...classesAttente]) {
    const d = classesCommunes().find(x => x.id === id);
    try {
      if (d) await rpc('sauver_classe_prestige', { ...sig, p_id: id, p_data: d });
      else await rpc('supprimer_classe_prestige', { ...sig, p_id: id });
      classesAttente.delete(id);
    } catch (e) { statutSync('Classe de prestige non enregistrée (base en v9 ?) : ' + e.message, true); return; }
  }
}
async function chargerClasses() {
  if (!enLigne()) return;
  try {
    const ch = await lignesChangees('classes_prestige', 'classes', 'id,data,maj', id => classesCommunes().some(d => d.id === id));
    const parId = new Map(classesCommunes().map(d => [d.id, d]));
    for (const l of ch.lignes) if (!classesAttente.has(l.id)) parId.set(l.id, { ...l.data, id: l.id });
    db.classesPerso = [...parId.values()].filter(d => ch.tous.has(d.id) || classesAttente.has(d.id));
    ch.valider();
    enregistrerClassesCommunes();
    saveNow();
  } catch (e) { console.warn('Classes de prestige communes indisponibles (base pas encore en v9 ?)', e); }
}
/* Reprise des classes créées dans une fiche avant cette version */
function migrerClassesDesFiches() {
  let n = 0;
  for (const p of db.personnages) {
    if (!(p.prestigePerso || []).length || p._public) continue;
    for (const d of p.prestigePerso) {
      if (!classesCommunes().some(x => x.id === d.id)) { classesCommunes().push({ ...d }); classesAttente.add(d.id); n++; }
    }
    if (peutModifier(p)) { p.prestigePerso = []; p.maj = Date.now(); persoModifie(p); }
  }
  if (n) { saveNow(); enregistrerClassesCommunes(); if (enLigne()) envoyerClasses(); }
}
function etat(p, n, prevus = false, sauf = null) {
  enregistrerPrestigesPerso(p);
  const tous = [...(p.progression || [])].sort((a, b) => a.niveau - b.niveau);
  const lv = tous.filter(l => R.CLASSES[l.classe] && (prevus || l.atteint)).slice(0, n ?? Infinity);
  const race = R.RACES[p.race] || null;
  const e = { niveau: lv.length, classes: {}, etapes: [], bba: 0, js: { vig: 0, ref: 0, vol: 0 }, dons: new Set(), donsListe: [], race, taille: race ? race.taille : 'M' };
  e.car = {};
  e.objets = bonusObjets(p);
  for (const c of R.CARACS) {
    const base = p.caracs?.[c.k]?.val === '' || p.caracs?.[c.k]?.val == null ? null : num(p.caracs[c.k].val);
    e.car[c.k] = base == null ? null : base + (e.objets.tot[c.k] || 0);
  }
  const ajoute = (id, source, niveau, libre = false) => {
    if (!id || !R.DON[id]) return;
    e.dons.add(id);
    e.donsListe.push({ id, source, niveau, libre });
  };
  for (const l of lv) {
    const cl = R.CLASSES[l.classe];
    const k = (e.classes[l.classe] || 0) + 1;
    e.classes[l.classe] = k;
    e.etapes.push({ l, cl, id: l.classe, k });
    if (prevus && !l.atteint && l.augment && !l.augmentApplique && e.car[l.augment] != null) e.car[l.augment] += 1;
    const ignore = champ => sauf && sauf.niveau === l.niveau && sauf.champ === champ;
    if (!ignore('don')) ajoute(l.don, `Niveau ${l.niveau}`, l.niveau);
    if (!ignore('donRace')) ajoute(l.donRace, `${race ? race.nom : 'Race'} (don supplémentaire)`, l.niveau);
    (l.donsBonus || []).forEach((d, i) => { if (!ignore('bonus' + i)) ajoute(d, `${cl.nom} ${k} (don supplémentaire)`, l.niveau, typeof cl.donsBonusListe === 'function'); });
    for (const d of cl.donsAuto?.[k] || []) ajoute(d, `${cl.nom} ${k} (automatique)`, l.niveau, true);
    if (cl.donsStyle) {
      const style = (tous.find(x => x.classe === l.classe && x.choix?.style) || {}).choix?.style;
      const d = style && cl.donsStyle[style]?.[k];
      if (d) ajoute(d, `${cl.nom} ${k} (style de combat)`, l.niveau, true);
    }
  }
  for (const d of p.donsSupp || []) ajoute(d, 'Accordé hors progression', 0);
  e.mods = Object.fromEntries(R.CARACS.map(c => [c.k, e.car[c.k] == null ? 0 : R.mod(e.car[c.k])]));
  for (const [id, k] of Object.entries(e.classes)) {
    const cl = R.CLASSES[id];
    e.bba += R.bbaClasse(cl.bba, k);
    for (const s of ['vig', 'ref', 'vol']) e.js[s] += R.jsClasse(cl.js[s], k);
  }
  /* Moine : les classes de prestige qui « cumulent » ajoutent leurs niveaux pour la CA, les mains nues, le déluge et la vitesse */
  const cumul = cle => (e.classes.moine || 0) + Object.entries(e.classes)
    .filter(([id]) => { const c = R.CLASSES[id]; return c.cumulMoine === true || !!c.cumul?.[cle]; })
    .reduce((t, [, k]) => t + k, 0);
  e.domaines = e.classes.pretre ? domainesDe(p) : [];
  e.moineCumul = { mn: cumul('mn'), ca: cumul('ca'), deluge: cumul('deluge'), vitesse: cumul('vitesse') };
  e.moineEff = Math.max(...Object.values(e.moineCumul));
  /* Progression des sorts apportée par les classes de prestige */
  e.lanceurBonus = {};
  for (const [id, k] of Object.entries(e.classes)) {
    const sp = R.CLASSES[id].sortsPlus;
    if (!sp) continue;
    const nb = sp.niveaux.filter(x => x <= k).length;
    const cible = type => Object.keys(e.classes).find(c => R.CLASSES[c].lanceur?.type?.startsWith(type));
    for (const type of sp.type === 'les deux' ? ['profane', 'divin'] : [sp.type]) {
      const c = cible(type);
      if (c) e.lanceurBonus[c] = (e.lanceurBonus[c] || 0) + nb;
    }
  }
  e.lanceur = Math.max(0, ...Object.entries(e.classes).map(([id, k]) => {
    const lc = R.CLASSES[id].lanceur;
    if (!lc) return 0;
    return lc.debut ? (k >= lc.debut ? Math.floor(k / 2) : 0) : k;
  }));
  return e;
}

function prerequisPrestige(cl, e, p) {
  const ctx = {
    e, p,
    rangs: id => num(p.comp?.[id]?.rangs),
    don: id => e.dons.has(id),
    sorts: (type, niv) => Object.entries(e.classes).some(([id, k]) => {
      const lc = R.CLASSES[id].lanceur;
      if (!lc || !lc.type.startsWith(type)) return false;
      const sp = sortsParJour(id, k, e);
      return !!sp && sp.parJour.some(x => x.niv >= niv);
    }),
  };
  return (cl.prerequis || []).map(([texte, test]) => ({ texte, ok: test ? !!test(ctx) : null }));
}

function prerequis(don, e, p) {
  const q = don.p, manque = [], txt = [];
  for (const [k, v] of Object.entries(q.car || {})) {
    const c = R.CARACS.find(x => x.k === k);
    txt.push(`${c.n} ${v}`);
    if ((e.car[k] ?? 0) < v) manque.push(`${c.n} ${v}`);
  }
  if (q.bba) { txt.push(`BBA +${q.bba}`); if (e.bba < q.bba) manque.push(`BBA +${q.bba}`); }
  for (const d of q.dons || []) { txt.push(R.DON[d].nom); if (!e.dons.has(d)) manque.push(R.DON[d].nom); }
  for (const [c, v] of Object.entries(q.classe || {})) { const t = `${R.CLASSES[c].nom} niveau ${v}`; txt.push(t); if ((e.classes[c] || 0) < v) manque.push(t); }
  if (q.lanceur) { const t = `Niveau de lanceur ${q.lanceur}`; txt.push(t); if (e.lanceur < q.lanceur) manque.push(t); }
  if (q.niveau) { const t = `Niveau ${q.niveau}`; txt.push(t); if (e.niveau < q.niveau) manque.push(t); }
  if (q.renvoi) { txt.push('Pouvoir de renvoi'); if (!e.classes.pretre && (e.classes.paladin || 0) < 4) manque.push('Pouvoir de renvoi'); }
  for (const [c, v] of Object.entries(q.rang || {})) {
    const nom = R.COMPETENCES.find(x => x.id === c).nom;
    txt.push(`${nom} ${v} rang`);
    if (num(p.comp?.[c]?.rangs) < v) manque.push(`${nom} ${v} rang`);
  }
  return { ok: !manque.length, manque, txt: txt.join(', ') || 'Aucun' };
}

function valeursClasse(id, k, e) {
  return k > 0 ? R.CLASSES[id].valeurs(k, e).filter(([, v]) => v != null && v !== '') : [];
}

function sortsParJour(id, k, e) {
  const lc = R.CLASSES[id].lanceur;
  if (!lc) return null;
  k = Math.min(20, k + (e.lanceurBonus?.[id] || 0));
  const ligne = lc.parJour[k];
  if (ligne === undefined || ligne === '') return null;
  const base = ligne.split(' ').map(Number);
  const debut = lc.debut ? 1 : 0;
  const m = e.mods[lc.car];
  const parJour = base.map((v, i) => {
    const niv = i + debut;
    const bonus = R.sortsBonus(m, niv);
    return { niv, txt: `${v + bonus}${lc.domaine && niv > 0 ? ' +1' : ''}` };
  });
  const connus = lc.connus ? lc.connus[k].split(' ').map((v, i) => ({ niv: i, txt: v })) : null;
  return { parJour, connus, lc };
}

const BONUS_DONS_COMP = {
  acrobate: ['saut', 'acrobaties'], agilite: ['equilibre', 'evasion'], vigilance: ['perception', 'detection'],
  'affinite-animaux': ['dressage', 'equitation'], athletisme: ['escalade', 'natation'], fourberie: ['deguisement', 'contrefacon'],
  'doigts-agiles': ['escamotage', 'maitrise-cordes'], assidu: ['estimation', 'decryptage'], 'fin-limier': ['renseignements', 'fouille'],
  'affinite-magique': ['art-magie', 'utilisation-objets'], negociation: ['diplomatie', 'psychologie'], 'doigts-de-fee': ['desamorcage', 'crochetage'],
  persuasion: ['bluff', 'intimidation'], autonome: ['premiers-secours', 'survie'], discret: ['discretion', 'deplacement-silencieux'],
};
function bonusComp(id, e) {
  let b = e.race?.comp?.[id] || 0;
  for (const [d, l] of Object.entries(BONUS_DONS_COMP)) if (e.dons.has(d) && l.includes(id)) b += 2;
  if (e.classes.druide && (id === 'conn-nature' || id === 'survie')) b += 2;
  if (id === 'discretion' && e.taille === 'P') b += 4;
  return b;
}
const compDeClasse = e => new Set([...Object.keys(e.classes).flatMap(id => R.CLASSES[id].comp), ...(e.domaines || []).flatMap(d => R.DOMAINES[d]?.comp || [])]);
/* Domaines : choisis au niveau 1 de prêtre, dans la Progression */
const domainesDe = p => { const l = (p.progression || []).find(x => x.classe === 'pretre'); return l ? [l.domaine1, l.domaine2].filter(d => R.DOMAINES[d]) : []; };
const cleVO = t => String(t || '').toLowerCase().replace(/[^a-z0-9' ]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
let indexVO = null, indexVOtaille = -1;
const sortVO = nomVO => {
  if (!indexVO || indexVOtaille !== db.sorts.length) { indexVO = new Map(db.sorts.map(x => [cleVO(x.nomVO), x])); indexVOtaille = db.sorts.length; }
  return indexVO.get(cleVO(nomVO));
};
function sortDomaineHTML(nomVO) {
  const sp = sortVO(nomVO);
  return sp ? `<a href="#/sort/${sp.id}">${esc(sp.nom)}</a>` : esc(nomVO);
}

function pointsComp(p, e) {
  let total = 0;
  e.etapes.forEach((s, i) => {
    let pts = Math.max(1, s.cl.pc + e.mods.int);
    if (e.race?.pcBonus) pts += 1;
    total += i === 0 ? pts * 4 : pts;
  });
  return total;
}

/* Valeurs calculées pour la fiche */
function stats(p, e) {
  const a = p.ajust || {}, t = R.TAILLES[e.taille] || R.TAILLES.M;
  const moine = e.classes.moine || 0, mCA = e.moineCumul.ca, mVit = e.moineCumul.vitesse;
  const js = { ...e.js };
  js.vig += e.mods.con + (e.dons.has('vigueur-surhumaine') ? 2 : 0);
  js.ref += e.mods.dex + (e.dons.has('reflexes-surhumains') ? 2 : 0);
  js.vol += e.mods.sag + (e.dons.has('volonte-fer') ? 2 : 0);
  const notesJs = [];
  if (p.race === 'halfelin') { js.vig++; js.ref++; js.vol++; notesJs.push('+1 halfelin inclus'); }
  if ((e.classes.paladin || 0) >= 2) { js.vig += e.mods.cha; js.ref += e.mods.cha; js.vol += e.mods.cha; notesJs.push('Grâce divine incluse'); }
  const ob = e.objets.tot;
  for (const s of ['vig', 'ref', 'vol']) js[s] += num(a[s]) + (ob[s] || 0) + (ob.js || 0);
  const bonusMoine = mCA ? Math.max(0, e.mods.sag) + Math.floor(mCA / 5) : 0;
  const armure = num(a.armure), bouclier = num(a.bouclier), nat = num(a.naturelle), parade = num(a.parade), div = num(a.caDivers);
  const dexCA = e.objets.maxDex == null ? e.mods.dex : Math.min(e.mods.dex, e.objets.maxDex);
  const caPrestige = Object.entries(e.classes).reduce((tt, [id, k]) => tt + R.valeurPalier(R.CLASSES[id].caPaliers, k), 0);
  const ca = 10 + dexCA + t.ca + armure + bouclier + nat + parade + div + bonusMoine + caPrestige + (ob.caArmure || 0) + (ob.caParade || 0);
  const contact = 10 + dexCA + t.ca + parade + div + bonusMoine + caPrestige + (ob.caParade || 0);
  const esquiveInst = (e.classes.barbare || 0) >= 2 || (e.classes.roublard || 0) >= 4;
  const depourvu = esquiveInst ? ca : ca - Math.max(0, dexCA);
  let vitesse = e.race ? e.race.vitesse : 9;
  const notesVit = [];
  /* Déplacement accéléré du moine et bonus de vitesse des classes de prestige : bonus d'altération,
     ils ne s'additionnent pas, on garde le meilleur */
  const vitMoine = mVit >= 3 ? 3 * Math.floor(mVit / 3) : 0;
  const vitPrestige = Object.entries(e.classes).map(([id, k]) => [R.CLASSES[id].nom, R.valeurPalier(R.CLASSES[id].vitPaliers, k)]).filter(([, v]) => v).sort((x, y) => y[1] - x[1])[0];
  if (vitPrestige && vitPrestige[1] > vitMoine) { vitesse += vitPrestige[1]; notesVit.push(`bonus de vitesse de ${vitPrestige[0].toLowerCase()} inclus (il ne s'ajoute pas à celui du moine : le meilleur est retenu)`); }
  else if (vitMoine) { vitesse += vitMoine; notesVit.push(`déplacement accéléré du moine inclus${vitPrestige ? ' (meilleur que le bonus de ' + vitPrestige[0].toLowerCase() + ', qui ne s\'y ajoute pas)' : ''}`); }
  if (e.classes.barbare) { vitesse += 3; notesVit.push('déplacement accéléré du barbare inclus'); }
  vitesse += num(a.vitesse) + (ob.vitesse || 0);
  const bba = e.bba + num(a.bba) + (ob.attaque || 0);
  const pvDes = e.etapes.map(s => num(s.l.pv));
  const pvCalc = pvDes.reduce((x, y) => x + y, 0) + e.niveau * e.mods.con + (e.dons.has('robustesse') ? 3 : 0);
  const pvComplets = e.etapes.length > 0 && e.etapes.every(s => s.l.pv !== '' && s.l.pv != null);
  const rm = moine >= 13 ? 10 + moine : null;
  const rd = [];
  if ((e.classes.barbare || 0) >= 7) rd.push((1 + Math.floor((e.classes.barbare - 7) / 3)) + '/—');
  if (moine >= 20) rd.push('10/magie');
  return {
    bba, att: R.attaques(Math.max(0, bba)),
    cac: bba + e.mods.for + t.ca, dist: bba + e.mods.dex + t.ca, lutte: bba + e.mods.for + t.lutte,
    js, notesJs, init: e.mods.dex + (e.dons.has('science-initiative') ? 4 : 0) + num(a.init) + (ob.init || 0),
    ca, contact, depourvu, esquiveInst, vitesse, notesVit, pvCalc, pvComplets, rm, rd,
  };
}

/* ---------- Champs ---------- */
function fi(o, path, label, opt = {}) {
  return `<label class="f${opt.span ? ' span2' : ''}"><span>${esc(label)}</span>
    <input type="${opt.type || 'text'}" data-bind="${path}" value="${esc(getP(o, path))}" placeholder="${esc(opt.ph || '')}"${opt.recalc ? ' data-recalc' : ''}${opt.type === 'number' ? ' inputmode="numeric"' : ''}></label>`;
}
function ta(o, path, label, opt = {}) {
  return `<label class="f"><span>${esc(label)}</span>
    <textarea data-bind="${path}" rows="${opt.rows || 3}" placeholder="${esc(opt.ph || '')}">${esc(getP(o, path))}</textarea></label>`;
}
function sel(o, path, label, options, opt = {}) {
  const cur = getP(o, path) ?? '';
  const une = ([v, l]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`;
  /* Une entrée [titre, [options…]] devient un groupe d'options */
  const html = options.map(x => Array.isArray(x) && Array.isArray(x[1])
    ? `<optgroup label="${esc(x[0])}">${x[1].map(y => une(Array.isArray(y) ? y : [y, y])).join('')}</optgroup>`
    : une(Array.isArray(x) ? x : [x, x])).join('');
  return `<label class="f${opt.span ? ' span2' : ''}"><span>${esc(label)}</span>
    <select data-bind="${path}" data-rerender>
      <option value="">${esc(opt.vide || '— Choisir —')}</option>
      ${html}
    </select></label>`;
}
function liste(o, key, fields, addLabel) {
  const items = o[key] || [];
  const stack = fields.some(f => f.type === 'area');
  const rows = items.map((it, i) => {
    const inputs = fields.map(f => f.type === 'area'
      ? `<textarea data-bind="${key}.${i}.${f.k}" rows="2" placeholder="${esc(f.l)}" aria-label="${esc(f.l)}">${esc(it[f.k])}</textarea>`
      : `<input type="text" class="${f.w || ''}" data-bind="${key}.${i}.${f.k}" value="${esc(it[f.k])}" placeholder="${esc(f.l)}" aria-label="${esc(f.l)}">`
    ).join('');
    const del = `<button class="icon" data-action="del-item" data-list="${key}" data-idx="${i}" aria-label="Supprimer la ligne">✕</button>`;
    return stack
      ? `<div class="row stack"><div class="stackfields">${inputs}</div>${del}</div>`
      : `<div class="row">${inputs}${del}</div>`;
  }).join('');
  return `<div class="list">${rows || '<p class="empty">Aucune entrée.</p>'}</div>
    <button class="btn ghost" data-action="add-item" data-list="${key}">+ ${esc(addLabel)}</button>`;
}
const classesTxt = e => Object.entries(e.classes).map(([id, k]) => `${R.CLASSES[id].nom} ${k}`).join(' / ');
const raceNom = p => p.race === 'autre' ? (p.raceAutre || 'Autre race') : (R.RACES[p.race]?.nom || '');

/* ---------- Pages ---------- */
function pagePersos() {
  const ps = [...db.personnages].sort(byNom);
  const bannieres = ps.map(p => {
    const e = etat(p);
    return `
    <a class="banniere" href="#/perso/${p.id}/fiche" aria-label="${esc(p.nom || 'Sans nom')}">
      <div class="banniere-in">
        <div class="banniere-img">${p.portrait
          ? `<img class="fond" src="${p.portrait}" alt=""><img class="photo" src="${p.portrait}" alt="">`
          : `<div class="silhouette">${SILHOUETTE_SVG}</div>`}
          ${(() => { const et = (p.etats || []).filter(x => x.actif !== false); return et.length ? `<span class="pastille-etat" title="${esc(et.map(x => x.nom).join(', '))}">⚠ ${et.length > 1 ? et.length : esc(et[0].nom)}</span>` : ''; })()}
          ${bc().porteur_id === p.id ? '<span class="pastille-coffre" title="Porte le coffre commun">💰</span>' : ''}
        </div>
        ${p.embleme ? `<img class="embleme-banniere" src="${p.embleme}" alt="Emblème">` : '<span class="sans-embleme" aria-hidden="true"></span>'}
        <h2>${esc(p.nom || 'Sans nom')}</h2>
        <p class="ligne-1">${esc([raceNom(p), classesTxt(e)].filter(Boolean).join(', ') || 'À compléter')}</p>
        ${p.pnjMJ ? `<p class="ligne-1 tag-pnj">${p.membreGroupe ? 'Joué par le MJ' : 'Personnage du MJ'}</p>` : p.joueur ? `<p class="ligne-1">${esc(p.joueur)}</p>` : ''}
        <span class="losange" aria-hidden="true"></span>
      </div>
    </a>`;
  }).join('');
  const ajout = `<button class="banniere ajout" data-action="new-perso" aria-label="Créer un personnage">
      <div class="banniere-in"><span class="plus" aria-hidden="true">+</span><h2>Nouveau</h2><p>Créer un personnage</p><span class="losange" aria-hidden="true"></span></div>
    </button>`;
  return `
    ${carteConteur(false)}
    <div class="compagnie-tete">
      <h2 class="titre-section">La compagnie</h2>
      <div class="compagnie-outils">
        ${enLigne() ? `<button class="lien" data-action="actualiser">↻ Actualiser</button>${state.persosCharges ? ` <small>à ${new Date(state.persosCharges).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</small>` : ''}` : ''}
        <button class="btn ghost petit" data-action="new-perso">+ Nouveau personnage</button>
      </div>
    </div>
    <div class="persos">${bannieres}</div>
    ${carteBourseCommune()}
    <p class="hint centre">Pour importer une fiche reçue d'un autre joueur : onglet Partage.</p>`;
}

function pagePerso(id, tab) {
  const p = findPerso(id);
  if (!p) return `<p>Personnage introuvable. <a href="#/persos">Retour à la liste</a></p>`;
  if (p.pnjMJ && !peutModifier(p)) { state.ctx = null; return pagePersoPublic(p); }
  state.ctx = p;
  if (!p.pnjMJ && (!enLigne() || (db.cles || {})[p.id]) && db.monPerso !== p.id) { db.monPerso = p.id; saveNow(); }
  if (state.effetForm && state.effetForm.persoId === p.id) return formEffet() + pagePersoSuite(p, tab);
  return pagePersoSuite(p, tab);
}
function pagePersoSuite(p, tab) {
  tab = tab || 'fiche';
  const e = etat(p);
  const tabs = [['fiche', 'Fiche'], ['inventaire', 'Inventaire'], ['sorts', 'Sorts'], ['progression', 'Progression']]
    .map(([k, l]) => `<a href="#/perso/${p.id}/${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('');
  const contenu = tab === 'sorts' ? ongletSorts(p) : tab === 'progression' ? ongletProgression(p) : tab === 'inventaire' ? ongletInventaire(p, e) : ongletFiche(p, e);
  const lecture = !peutModifier(p);
  const body = lecture ? `<fieldset class="lecture" disabled>${contenu}</fieldset>` : contenu;
  return `
    <div class="pagehead">
      <div class="titre-perso">
        <div class="avatar">${p.portrait ? `<img src="${p.portrait}" alt="Portrait">` : '<span class="vide"></span>'}${p.embleme ? `<img class="embleme-avatar" src="${p.embleme}" alt="Emblème">` : ''}</div>
        <div><h1 id="ptitle">${esc(p.nom || 'Sans nom')}</h1>
        <p class="sub">${esc([raceNom(p), classesTxt(e) || 'aucun niveau atteint'].filter(Boolean).join(', '))}${p.joueur ? ', joué par ' + esc(p.joueur) : ''}</p></div>
      </div>
      <div class="btns">
        <button class="btn ghost" data-action="export-perso">Exporter la fiche</button>
        ${peutModifier(p) ? '<button class="btn danger" data-action="del-perso">Supprimer</button>' : ''}
      </div>
    </div>
    ${encartDroits(p)}
    ${recap(p, e)}
    ${puceEtats(p)}
    <nav class="tabs" aria-label="Sections du personnage">${tabs}</nav>
    ${body}`;
}

function recap(p, e) {
  if (!e.niveau && !e.race) return '';
  const s = stats(p, e);
  const pv = num(p.pvMax) ? `${pvActuels(p)}/${num(p.pvMax)}` : '—';
  return `<div class="recap"><span>PV<b>${esc(pv)}</b></span><span>CA<b>${s.ca}</b></span><span>Initiative<b>${R.signe(s.init)}</b></span><span>Vitesse<b>${s.vitesse} m</b></span><span>BBA<b>${R.attTxt(s.att)}</b></span></div>`;
}

function blocImages(p) {
  const img = (type, label, cls) => {
    const src = p[type];
    return `<div class="image-bloc ${cls}">
      <button class="image-cadre" data-action="img-choisir" data-type="${type}" aria-label="${src ? 'Changer' : 'Ajouter'} : ${label}">
        ${src ? `<img src="${src}" alt="${label}">` : `<span>${type === 'portrait' ? 'Ajouter un portrait' : 'Ajouter un emblème'}</span>`}
      </button>
      ${src ? `<button class="lien" data-action="img-retirer" data-type="${type}">Retirer</button>` : ''}
    </div>`;
  };
  return `<div class="images">${img('portrait', 'Portrait', 'portrait')}${img('embleme', 'Emblème', 'embleme')}</div>`;
}

/* Transforme les sections titrées de la fiche en blocs repliables (état mémorisé sur l'appareil) */
function repliable(html) {
  return html.replace(/<section class="card([^"]*)"><h3>(.*?)<\/h3>([\s\S]*?)<\/section>/g, (m, classes, titre, corps) => {
    const id = slug(titre.replace(/<[^>]+>/g, ''));
    const ferme = (db.replis || {})[id];
    return `<details class="card repli${classes}" data-section="${id}"${ferme ? '' : ' open'}><summary><h3>${titre}</h3></summary>${corps}</details>`;
  });
}
const outilsReplis = () => `<div class="replis-outils"><button class="lien" data-action="replis-tout" data-ouvrir="0">Tout replier</button><button class="lien" data-action="replis-tout" data-ouvrir="1">Tout déplier</button></div>`;

function ongletFiche(p, e) {
  return outilsReplis() + repliable(ongletFicheBrut(p, e));
}
function ongletFicheBrut(p, e) {
  if (p.languesAutres && peutModifier(p)) {
    p.langues = [...new Set([...(p.langues || []), ...p.languesAutres.split(/[,;]+/).map(x => x.trim()).filter(Boolean)])];
    p.languesAutres = ''; save();
  }
  const s = stats(p, e);
  const race = e.race;
  const raceOpts = [
    ['Races courantes', Object.entries(R.RACES).filter(([, r]) => !r.rare).map(([k, r]) => [k, r.nom])],
    ['Races moins communes', Object.entries(R.RACES).filter(([, r]) => r.rare).map(([k, r]) => [k, r.nom])],
    ['Autre', [['autre', 'Autre race (campagne)']]],
  ];
  const nivTxt = e.niveau ? `Niveau ${e.niveau} : ${classesTxt(e)}` : 'Aucun niveau atteint. Ajoute et coche tes niveaux dans l\'onglet Progression.';
  const stat = (label, val, note) => `<div class="stat"><span>${label}</span><b>${val}</b>${note ? `<small>${note}</small>` : ''}</div>`;
  const aj = (path, label) => `<label class="aj"><span>${label}</span><input type="text" inputmode="numeric" data-bind="ajust.${path}" data-recalc value="${esc(getP(p, 'ajust.' + path))}" placeholder="0"></label>`;
  const valsClasses = Object.entries(e.classes).map(([id, k]) => ({ id, k, vals: valeursClasse(id, k, e) })).filter(x => x.vals.length);
  const deluge = valsClasses.find(x => x.id === 'moine')?.vals.find(v => v[0] === 'Déluge de coups');
  return `
  ${p.pnjMJ && peutModifier(p) ? carteVisibilite(p) : ''}
  ${carteVitalite(p)}
  <div class="fiche-haut">
  <section class="card carte-identite"><h3>Identité</h3>
    <div class="identite">
      ${blocImages(p)}
      <div class="grid">
        ${fi(p, 'nom', 'Nom')}${fi(p, 'joueur', 'Joueur')}
        ${sel(p, 'race', 'Race', raceOpts)}
        ${R.RACES[p.race]?.ajNiv ? `<p class="hint ligne-entiere">${esc(R.RACES[p.race].nom)} : ${esc(R.RACES[p.race].ajust)} · ajustement de niveau +${R.RACES[p.race].ajNiv}.</p>` : ''}
        ${p.race === 'autre' ? fi(p, 'raceAutre', 'Nom de la race') : ''}
        ${sel(p, 'alignement', 'Alignement', R.ALIGNEMENTS)}
        ${sel(p, 'divinite', 'Divinité', [['Aucune', [['Aucune', 'Aucune']]], ...['Royaumes Oubliés', 'Panthéon nain', 'Panthéon drow', 'Manuel des Joueurs'].map(g => [g, R.DIVINITES_INFO.filter(d => d.groupe === g).map(d => [d.nom, `${d.nom} (${d.align})`])]), ['Autre', [['Autre', 'Autre divinité']]]])}
        ${R.DIVINITE[p.divinite] ? (d => `<p class="hint ligne-entiere">${esc(d.nom)} · ${esc(d.sujet)} · domaines : ${esc([...d.domaines.map(x => R.DOMAINES[x].nom), ...d.autres].join(', '))} · arme de prédilection : ${esc(d.arme)}</p>`)(R.DIVINITE[p.divinite]) : ''}
        ${p.divinite === 'Autre' ? fi(p, 'diviniteAutre', 'Nom de la divinité') : ''}
        ${sel(p, 'sexe', 'Sexe', R.SEXES)}
        ${fi(p, 'age', 'Âge', { type: 'number' })}${fi(p, 'taillePoids', 'Taille et poids', { ph: '1,30 m, 75 kg' })}
      </div>
    </div>
    <p class="niveau-ligne">${esc(nivTxt)}</p>
    ${race ? `<p class="hint">Catégorie de taille ${R.TAILLES[race.taille].nom.toLowerCase()}, vitesse de base ${race.vitesse} m. Ajustements raciaux : ${race.ajust}. Classe de prédilection : ${race.classeFav}.</p>` : ''}
    ${blocLangues(p)}
    ${ta(p, 'apparence', 'Apparence et historique')}
  </section>
  <div class="col-reliques">${carteBaguette(p)}${carteFocalisateur(p)}</div>
  </div>

  <section class="card"><h3>Caractéristiques</h3>
    <div class="caracs">
      ${R.CARACS.map(c => {
        const bo = e.objets.tot[c.k] || 0;
        return `<div class="carac ${bo ? 'avec-bonus' : ''}"><b title="${c.n}">${c.l}</b>
        <input type="text" inputmode="numeric" data-bind="caracs.${c.k}.val" data-recalc value="${esc(getP(p, `caracs.${c.k}.val`))}" aria-label="${c.n} (valeur de base)">
        ${bo ? `<span class="bonus-objet ${bo < 0 ? 'malus' : ''}" title="${esc(e.objets.detail[c.k].join(', '))}">${R.signe(bo)}${e.car[c.k] != null ? ` <small>= ${e.car[c.k]}</small>` : ''}</span>` : ''}
        ${(e.objets.cond[c.k] || []).length ? `<span class="carac-cond" title="${esc(e.objets.cond[c.k].map(x => `${R.signe(x.val)} ${x.quand} (${x.source})`).join(' ; '))}">${R.signe(e.objets.cond[c.k].reduce((t, x) => t + x.val, 0))}*</span>` : ''}
        <span class="mod" id="mod-${c.k}" data-bonus="${bo}">${e.car[c.k] == null ? '—' : R.signe(e.mods[c.k])}</span>
      </div>`;
      }).join('')}
    </div>
    <p class="hint aide">Saisis les valeurs de base (ajustements raciaux compris, sans les objets). Les bonus des objets équipés s'ajoutent <span class="bonus-objet">en couleur</span>, et les modificateurs se calculent seuls.</p>
  </section>

  ${(p.etats || []).some(x => x.actif !== false) ? ficheEtats(p) : ''}
  ${ficheAmeliorations(p)}
  ${(() => { const q = fichesToutes().filter(f => porteeQuete(f) === 'personnelle' && f.extra?.persoId === p.id); return q.length ? `<section class="card"><h3>Quêtes personnelles</h3><div class="fiches">${q.map(carteFiche).join('')}</div></section>` : ''; })()}
  ${ficheCombat(p, e)}

  <section class="card"><h3>Défense et statistiques</h3>
    <div class="stats">
      ${stat('Classe d\'armure', s.ca)}${stat('Contact', s.contact)}${stat('Pris au dépourvu', s.depourvu, s.esquiveInst ? 'Esquive instinctive' : '')}
      ${stat('Initiative', R.signe(s.init))}${stat('Vitesse', s.vitesse + ' m')}
      ${stat('Vigueur', R.signe(s.js.vig))}${stat('Réflexes', R.signe(s.js.ref))}${stat('Volonté', R.signe(s.js.vol))}
      ${stat('BBA', R.attTxt(s.att))}${stat('Corps à corps', R.signe(s.cac))}${stat('Distance', R.signe(s.dist))}${stat('Lutte', R.signe(s.lutte))}

    </div>

    ${blocProtections(p, e, s)}
    ${e.objets.maxDex != null && e.mods.dex > e.objets.maxDex ? `<p class="hint">Ton armure limite ta Dextérité à ${R.signe(e.objets.maxDex)} pour la CA.</p>` : ''}
    ${e.objets.acp ? `<p class="hint">Malus d'armure ${e.objets.acp} appliqué aux compétences marquées ◘.</p>` : ''}
    ${Object.keys(e.objets.tot).some(k => !R.CARACS.some(c => c.k === k)) ? `<p class="hint"><b>Objets et états inclus :</b> ${esc(Object.entries(e.objets.detail).filter(([k]) => !R.CARACS.some(c => c.k === k)).map(([k, l]) => `${NOM_CIBLE[k]} (${l.join(', ')})`).join(' ; '))}</p>` : ''}
    ${[...s.notesJs, ...s.notesVit].length ? `<p class="hint">${esc((t => t[0].toUpperCase() + t.slice(1))([...s.notesJs, ...s.notesVit].join(' ; ')))}.</p>` : ''}
    <div class="grid" style="margin-top:.8rem">
      <p class="hint" style="grid-column:1/-1">Points de vie et dés de vie : voir la section Vitalité en haut de la fiche.</p>
    </div>
    ${Object.keys(e.objets.cond).length ? `<h4>Bonus conditionnels <small class="hint">(non comptés dans les totaux)</small></h4>
      <ul class="liste-cond">${Object.entries(e.objets.cond).flatMap(([k, l]) => l.map(x => `<li><span class="bonus-cond">${R.signe(x.val)} ${esc(NOM_CIBLE[k] || k)}</span> ${esc(x.quand)} <small>(${esc(x.source)})</small></li>`)).join('')}</ul>` : ''}
    ${Object.entries(p.ajust || {}).some(([, v]) => v !== '' && v != null && v !== 0 && v !== '0') ? `<p class="hint ancien-ajust">D'anciens ajustements manuels sont encore comptés (${esc(Object.entries(p.ajust).filter(([, v]) => v !== '' && v != null && v !== '0' && v !== 0).map(([k, v]) => `${k} ${v}`).join(', '))}). Ces bonus se gèrent désormais avec les objets et les états. <button class="lien" data-action="ajust-effacer">Les effacer</button></p>` : ''}
    ${p.attaques ? `<p class="hint ancien-ajust">Ancienne note d'attaques : ${esc(p.attaques)} <button class="lien" data-action="attaques-effacer">Effacer</button></p>` : ''}
  </section>

  ${ficheCompetences(p, e)}
  ${(p.etats || []).some(x => x.actif !== false) ? '' : ficheEtats(p)}
  ${ficheDons(p, e)}
  ${ficheCapacitesLisible(p, e, valsClasses)}

  <section class="card"><h3>Équipement</h3>
    ${resumeEquipement(p)}
  </section>

  <section class="card"><h3>Notes</h3>
    ${ta(p, 'notes', 'Notes libres', { rows: 5 })}
  </section>`;
}

/* Ordre d'affichage des catégories dans l'inventaire */
const GROUPES_INV = [
  ['Armes', ['arme']],
  ['Armures et boucliers', ['armure', 'bouclier']],
  ['Vêtements', ['vetement']],
  ['Objets magiques', ['magique']],
  ['Munitions', ['munition']],
  ['Rations', ['ration']],
  ['Potions et élixirs', ['consommable']],
  ['Fournitures (torches, encens, bandages…)', ['fourniture']],
  ['Trésors', ['tresor']],
  ['Babioles', ['babiole']],
  ['Objets', ['']],
];
function groupesInventaire(items) {
  const avecIdx = items.map((it, i) => ({ it, i }));
  return [['✦ Focalisateur', avecIdx.filter(({ it }) => it.focalisateur)],
    ...GROUPES_INV.map(([titre, cats]) => [titre, avecIdx.filter(({ it }) => !it.focalisateur && cats.includes(it.cat || ''))])]
    .filter(([, l]) => l.length);
}
/* Poids saisi librement : « 500 g », « 2 kg », « 1,5kg », « 3 lb ». Sans unité, on compte en kg. */
function poidsKg(txt) {
  const t = String(txt || '').toLowerCase().replace(',', '.').trim();
  const m = t.match(/(\d+(?:\.\d+)?)\s*(kg|kilo|g\b|gr|gramme|lb|livre)?/);
  if (!m) return 0;
  const v = parseFloat(m[1]);
  const u = m[2] || 'kg';
  if (u.startsWith('kg') || u.startsWith('kilo')) return v;
  if (u.startsWith('g')) return v / 1000;
  if (u.startsWith('lb') || u.startsWith('livre')) return v * 0.4536;
  return v;
}
const poidsTxt = kg => kg < 1 ? `${Math.round(kg * 1000)} g` : `${String(Math.round(kg * 100) / 100).replace('.', ',')} kg`;
const valeurObjet = it => enPo(it.valeur, it.valeurUnite) * (num(it.qte) || 1);
const poTxt = v => `${String(Math.round(v * 100) / 100).replace('.', ',')} po`;

/* ===== États et blessures ===== */
const B = (cible, val) => ({ cible, val: String(val) });
const ETATS_PREDEFINIS = {
  secoue: { nom: 'Secoué', texte: '−2 aux jets d\'attaque, de sauvegarde, de compétence et de caractéristique.', bonus: [B('attaque', -2), B('js', -2)] },
  effraye: { nom: 'Effrayé', texte: 'Comme secoué, et doit fuir la source de sa peur s\'il le peut.', bonus: [B('attaque', -2), B('js', -2)] },
  panique: { nom: 'Paniqué', texte: 'Lâche ce qu\'il tient et fuit au hasard ; −2 aux jets de sauvegarde et aux tests.', bonus: [B('js', -2)] },
  fievreux: { nom: 'Fiévreux', texte: '−2 aux jets d\'attaque, de dégâts, de sauvegarde, de compétence et de caractéristique.', bonus: [B('attaque', -2), B('js', -2)] },
  nauseeux: { nom: 'Nauséeux', texte: 'Ne peut faire qu\'une action de mouvement par tour : ni attaque, ni sort, ni concentration.', bonus: [] },
  fatigue: { nom: 'Fatigué', texte: '−2 en Force et en Dextérité ; ne peut ni courir ni charger.', bonus: [B('for', -2), B('dex', -2)] },
  epuise: { nom: 'Épuisé', texte: '−6 en Force et en Dextérité ; se déplace à demi-vitesse.', bonus: [B('for', -6), B('dex', -6)] },
  aveugle: { nom: 'Aveuglé', texte: '−2 à la CA, perd son bonus de Dextérité à la CA, 50 % de chances de rater ; −4 aux tests basés sur la Force et la Dextérité.', bonus: [B('caParade', -2)] },
  assourdi: { nom: 'Assourdi', texte: '−4 en initiative ; 20 % d\'échec pour les sorts à composante verbale.', bonus: [B('init', -4)] },
  etourdi: { nom: 'Étourdi', texte: 'Lâche ce qu\'il tient, ne peut pas agir ; −2 à la CA et perd son bonus de Dextérité.', bonus: [B('caParade', -2)] },
  hebete: { nom: 'Hébété', texte: 'Ne peut pas agir, mais garde sa CA normale.', bonus: [] },
  enchevetre: { nom: 'Enchevêtré', texte: '−2 aux jets d\'attaque, −4 en Dextérité, se déplace à demi-vitesse.', bonus: [B('attaque', -2), B('dex', -4)] },
  agrippe: { nom: 'Agrippé', texte: 'Pris dans une lutte : ne peut pas se déplacer librement et perd son bonus de Dextérité contre ceux qui ne luttent pas.', bonus: [] },
  a_terre: { nom: 'À terre', texte: '−4 aux attaques au corps à corps ; +4 à la CA contre les attaques à distance, −4 contre celles au corps à corps.', bonus: [] },
  paralyse: { nom: 'Paralysé', texte: 'Ne peut ni bouger ni agir. Sans défense.', bonus: [] },
  inconscient: { nom: 'Inconscient', texte: 'Sans défense, ne perçoit rien.', bonus: [] },
  mourant: { nom: 'Mourant', texte: 'Entre −1 et −9 PV : perd 1 PV par round tant qu\'il n\'est pas stabilisé.', bonus: [] },
  empoisonne: { nom: 'Empoisonné', texte: 'Selon le poison : affaiblissement de caractéristique, effets secondaires…', bonus: [] },
  malade: { nom: 'Malade', texte: 'Selon la maladie : affaiblissement de caractéristique chaque jour, jusqu\'à guérison.', bonus: [] },
};
const gravite = et => et.duree === 'permanent' ? 'permanent' : 'temporaire';
function puceEtats(p, max = 6) {
  const l = (p.etats || []).filter(x => x.actif !== false);
  if (!l.length) return '';
  return `<div class="etats-puces">${l.slice(0, max).map(x => `<span class="etat-puce ${gravite(x)}" title="${esc(x.description || '')}">${esc(x.nom)}</span>`).join('')}${l.length > max ? `<span class="etat-puce">+${l.length - max}</span>` : ''}</div>`;
}
/* Bonus et malus : +4 CA, −2 For… temporaires ou permanents, comptés dans toute la fiche.
   Ceux accordés par le MJ ne peuvent être modifiés ou retirés que par lui. */
function ficheAmeliorations(p) {
  const mod = peutModifier(p);
  const mj = estMJ() || !enLigne();
  const l = p.ameliorations || [];
  if (!l.length && !mod) return '';
  const opts = cur => CIBLES_BONUS.map(([g, li]) => `<optgroup label="${g}">${li.map(([v, t]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>`).join('');
  const lecture = am => `<p class="am-lecture"><span class="${num(am.val) < 0 ? 'malus-etat' : 'bonus-objet'}">${R.signe(num(am.val))} ${esc(NOM_CIBLE[am.cible] || am.cible)}</span>
    <span class="tag-cat">${am.permanent ? 'Permanent' : 'Temporaire'}</span>${am.parMJ ? '<span class="tag-cat tag-mj">accordé par le MJ</span>' : ''}${am.note ? ` <small>${esc(am.note)}</small>` : ''}</p>`;
  return `<section class="card ameliorations"><h3>Bonus et malus</h3>
    ${l.length ? `<div class="am-liste">${l.map((am, i) => mod && (mj || !am.parMJ) ? `<div class="am-ligne ${num(am.val) < 0 ? 'malus' : ''}">
        <input type="text" inputmode="numeric" class="s" data-bind="ameliorations.${i}.val" data-recalc value="${esc(am.val)}" placeholder="+2 / −2" aria-label="Valeur (négative pour un malus)">
        <select data-bind="ameliorations.${i}.cible" data-rerender aria-label="Ce qui est modifié"><option value="">— Choisir —</option>${opts(am.cible)}</select>
        <select data-bind="ameliorations.${i}.permanent" data-rerender aria-label="Durée"><option value="" ${am.permanent ? '' : 'selected'}>Temporaire</option><option value="1" ${am.permanent ? 'selected' : ''}>Permanent</option></select>
        <input type="text" data-bind="ameliorations.${i}.note" value="${esc(am.note)}" placeholder="Origine (sort, malédiction, récompense…)" aria-label="Origine">
        <button class="icon" data-action="am-suppr" data-idx="${i}" aria-label="Retirer">✕</button>
      </div>` : lecture(am)).join('')}</div>` : '<p class="hint">Aucun. Ajoute ici un bonus ou un malus (« +4 CA », « −2 Force »…) : il est compté partout sur la fiche tant qu\'il est là.</p>'}
    ${mod ? `<div class="btns"><button class="btn ghost petit" data-action="am-ajout">+ Bonus</button><button class="btn ghost petit" data-action="am-ajout" data-malus="1">+ Malus</button></div>
      <p class="hint">Une valeur négative est un malus.${estMJ() && enLigne() ? ' Ceux que tu ajoutes sont « accordés par le MJ » : le joueur les voit mais ne peut ni les modifier ni les retirer.' : ''}</p>` : ''}
  </section>`;
}
function ficheEtats(p) {
  const mod = peutModifier(p);
  const etats = p.etats || [];
  const opts = cur => CIBLES_BONUS.map(([g, l]) => `<optgroup label="${g}">${l.map(([v, t]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>`).join('');
  const cartes = etats.map((et, i) => {
    if (mod && state.editEtat === et.id) {
      return `<div class="etat en-edition">
        <div class="grid">
          ${fi(et, 'nom', 'Nom', { span: true }).replace('data-bind="nom"', `data-bind="etats.${i}.nom"`)}
          <label class="f"><span>Durée</span><select data-bind="etats.${i}.duree" data-rerender>
            <option value="">Temporaire</option><option value="permanent" ${et.duree === 'permanent' ? 'selected' : ''}>Permanent</option></select></label>
          <label class="f"><span>Depuis</span><input type="text" data-bind="etats.${i}.depuis" value="${esc(et.depuis)}" placeholder="Ex. : session 6"></label>
        </div>
        <label class="f"><span>Description et conséquences</span><textarea data-bind="etats.${i}.description" rows="3" placeholder="Ex. : bras gauche arraché par l'élémental. Impossible de tenir un bouclier ou une arme à deux mains.">${esc(et.description)}</textarea></label>
        <p class="lbl">Effets chiffrés (optionnels, appliqués à la fiche)</p>
        ${(et.bonus || []).map((b, j) => `<div class="bonus-ligne">
          <select data-bind="etats.${i}.bonus.${j}.cible" data-rerender aria-label="Ce que l'état modifie"><option value="">— Ce que l'état modifie —</option>${opts(b.cible)}</select>
          <input type="text" inputmode="numeric" class="bonus-val" data-bind="etats.${i}.bonus.${j}.val" data-recalc value="${esc(b.val)}" aria-label="Valeur">
          <button class="icon" data-action="etat-del-bonus" data-idx="${i}" data-j="${j}" aria-label="Retirer cet effet">✕</button>
          <label class="check cond-case"><input type="checkbox" data-bind="etats.${i}.bonus.${j}.cond" data-rerender ${b.cond ? 'checked' : ''}> Conditionnel</label>
          ${b.cond ? `<input type="text" class="cond-quand" data-bind="etats.${i}.bonus.${j}.quand" data-recalc value="${esc(b.quand)}" placeholder="Quand ?" aria-label="Condition">` : ''}
        </div>`).join('')}
        <div class="btns"><button class="lien" data-action="etat-add-bonus" data-idx="${i}">+ Effet chiffré (ex. −4 attaque)</button></div>
        <div class="btns"><button class="btn" data-action="etat-fin">Terminé</button><button class="btn danger" data-action="etat-suppr" data-idx="${i}">Supprimer</button></div>
      </div>`;
    }
    const effets = (et.bonus || []).filter(b => b.cible && num(b.val));
    return `<div class="etat ${gravite(et)} ${et.actif === false ? 'gueri' : ''}">
      <div class="etat-tete"><b>${esc(et.nom || 'État')}</b>
        <span class="etat-duree">${et.duree === 'permanent' ? 'Permanent' : 'Temporaire'}</span>
        ${et.actif === false ? '<span class="etat-duree">guéri</span>' : ''}
        ${mod ? `<button class="lien" data-action="etat-edit" data-id="${et.id}">Modifier</button>` : ''}</div>
      ${et.description ? `<p>${esc(et.description)}</p>` : ''}
      ${effets.length ? `<p class="objet-bonus">${effets.map(b => `<span class="malus-etat">${R.signe(num(b.val))} ${esc(NOM_CIBLE[b.cible] || b.cible)}</span>`).join('')}</p>` : ''}
      ${et.depuis ? `<p class="hint">Depuis : ${esc(et.depuis)}</p>` : ''}
      ${mod ? `<div class="btns">${et.actif === false
        ? `<button class="btn ghost" data-action="etat-actif" data-idx="${i}">Réactiver</button><button class="btn danger" data-action="etat-suppr" data-idx="${i}">Supprimer</button>`
        : `<button class="btn ghost" data-action="etat-actif" data-idx="${i}">${et.duree === 'permanent' ? 'Marquer comme guéri' : 'Terminé, retirer'}</button>`}</div>` : ''}
    </div>`;
  }).join('');
  return `<section class="card"><h3>États et blessures</h3>
    ${cartes ? `<div class="etats">${cartes}</div>` : '<p class="empty">Aucun état en cours. Tout va bien… pour l\'instant.</p>'}
    ${mod ? `<div class="row etat-ajout">
      <select id="etat-choix" aria-label="État à ajouter">
        <option value="perso">Blessure ou état personnalisé…</option>
        <optgroup label="États des règles">${Object.entries(ETATS_PREDEFINIS).map(([k, v]) => `<option value="${k}">${esc(v.nom)}</option>`).join('')}</optgroup>
      </select>
      <button class="btn ghost" data-action="etat-add">Ajouter</button>
    </div>
    <p class="hint aide">Les états actifs apparaissent en haut de la fiche, sur l'accueil et dans l'espace MJ. Leurs effets chiffrés s'appliquent aux statistiques.</p>` : ''}
  </section>`;
}

/* Toutes les résistances et protections : race, classe, objets, états, saisie manuelle */
function protections(p, e, st) {
  const ob = e.objets.tot, a = p.ajust || {};
  const c = e.classes, moine = c.moine || 0;
  const res = Object.fromEntries(ENERGIES.map(([k]) => [k, (ob['res:' + k] || 0) + num(a['res_' + k])]));
  const imm = new Set(IMMUNITES.filter(([k]) => ob['imm:' + k]).map(([k]) => k));
  const jsc = Object.fromEntries(JS_CONTRE.map(([k]) => [k, ob['jsc:' + k] || 0]));
  const sources = [];
  const rc = R.RACES[p.race];
  if (rc) {
    for (const [k, v] of Object.entries(rc.res || {})) res[k] = (res[k] || 0) + v;
    for (const k of rc.imm || []) imm.add(k);
    for (const [k, v] of Object.entries(rc.jsc || {})) jsc[k] = (jsc[k] || 0) + v;
  }
  if (p.race === 'nain') { jsc.poison += 2; jsc.sorts += 2; sources.push('nain : +2 contre le poison et les sorts'); }
  if (p.race === 'elfe' || p.race === 'demi-elfe') { imm.add('sommeil'); jsc.enchantements += 2; sources.push('sang elfe : immunité au sommeil magique, +2 contre les enchantements'); }
  if (p.race === 'gnome') { jsc.illusions += 2; }
  if (p.race === 'halfelin') { jsc.peur += 2; }
  if (moine >= 3) jsc.enchantements += 2;
  if (moine >= 5) imm.add('maladie');
  if (moine >= 11) imm.add('poison');
  if ((c.paladin || 0) >= 3) { imm.add('maladie'); imm.add('peur'); }
  if ((c.druide || 0) >= 9) imm.add('poison');
  const rmRace = rc && rc.rm === 'niv+11' ? 11 + (e.niveau || 0) : num(rc?.rm);
  const rm = Math.max(st.rm || 0, ob.rm || 0, num(a.rm), rmRace);
  const rd = [...st.rd, ...(ob.rd ? [`${ob.rd}/—`] : []), ...(a.rd ? [a.rd] : [])];
  const moitie = new Set(ENERGIES.filter(([k]) => ob['moitie:' + k] > 0).map(([k]) => k));
  return { res, imm: [...imm], jsc, rm, rd, sources, moitie };
}
function blocProtections(p, e, st) {
  const pr = protections(p, e, st);
  const nomE = Object.fromEntries(ENERGIES), nomI = Object.fromEntries(IMMUNITES), nomJ = Object.fromEntries(JS_CONTRE);
  return `<h4>Résistances et protections</h4>
    <div class="stats resistances">
      ${ENERGIES.map(([k, l]) => `<div class="stat ${pr.imm.includes(k) ? 'immun' : pr.res[k] || pr.moitie.has(k) ? 'actif' : 'vide'}"><span>${l.replace(/^(à l'|au |à la )/, '').replace(/^./, x => x.toUpperCase())}</span><b>${pr.imm.includes(k) ? 'Immunité' : [pr.moitie.has(k) ? '½ dégâts' : '', pr.res[k] ? pr.res[k] : ''].filter(Boolean).join(' + ') || '—'}</b></div>`).join('')}
      <div class="stat ${pr.rm ? 'actif' : 'vide'}"><span>Résistance à la magie</span><b>${pr.rm || '—'}</b></div>
      <div class="stat ${pr.rd.length ? 'actif' : 'vide'}"><span>Réduction des dégâts</span><b>${esc(pr.rd.join(', ') || '—')}</b></div>
    </div>
    ${pr.imm.filter(k => !ENERGIES.some(([x]) => x === k)).length ? `<p class="protections"><b>Immunités :</b> ${pr.imm.filter(k => !ENERGIES.some(([x]) => x === k)).map(k => `<span class="tag-protec">${esc(nomI[k])}</span>`).join('')}</p>` : ''}
    ${Object.entries(pr.jsc).some(([, v]) => v) ? `<p class="protections"><b>Jets de sauvegarde contre :</b> ${Object.entries(pr.jsc).filter(([, v]) => v).map(([k, v]) => `<span class="tag-protec">${esc(nomJ[k])} ${R.signe(v)}</span>`).join('')}</p>` : ''}`;
}

function bourseTxt(p) {
  const a = p.argent || {};
  return [['pp', 'pp'], ['po', 'po'], ['pa', 'pa'], ['pc', 'pc']].filter(([k]) => num(a[k])).map(([k, l]) => `${num(a[k])} ${l}`).join(', ') || 'vide';
}
function detailsObjet(it, items) {
  const bits = [];
  if (it.cat === 'arme') bits.push([R.ARME[it.armeType] && R.ARME[it.armeType].nom !== it.nom ? R.ARME[it.armeType].nom : '', it.mode === 'distance' ? 'Distance' : 'Corps à corps', R.ARME[it.armeType]?.moine ? 'arme de moine' : '', it.degats && `dégâts ${it.degats}`, it.critique && `critique ${it.critique}`, it.portee && `portée ${it.portee}`].filter(Boolean).join(', '));
  if (it.cat === 'munition') { const a = items.find(x => x.id === it.lien); bits.push([a && `pour ${a.nom}`, it.effet].filter(Boolean).join(' : ')); }
  if (it.cat === 'consommable' && it.effet) bits.push(it.effet);
  if (it.cat === 'armure' || it.cat === 'bouclier') {
    const a = R.ARMURE[it.armureType];
    const ca = (a ? a.ca : num(it.caBase)) + num(it.alteration);
    bits.push([a && a.nom !== it.nom ? a.nom : '', `CA ${R.signe(ca)}${num(it.alteration) ? ` (dont +${num(it.alteration)} d'altération)` : ''}`,
      (a ? a.dex : it.dexMax) != null && (a ? a.dex : it.dexMax) !== '' ? `Dex max +${a ? a.dex : it.dexMax}` : '',
      `malus ${R.signe(Math.min(0, (a ? a.malus : num(it.malus)) + (it.maitre ? 1 : 0)))}`, it.equipe === false ? 'pas portée' : 'portée'].filter(Boolean).join(', '));
  }
  return bits.filter(Boolean).join(' ; ');
}
function ligneObjetVue(it, i, items, modifiable) {
  const bonus = (it.bonus || []).filter(b => b.cible && num(b.val));
  const det = detailsObjet(it, items);
  const chipBonus = b => b.cond
    ? `<span class="bonus-cond" title="${esc(b.quand || 'sous condition')}">${R.signe(num(b.val))} ${esc(NOM_CIBLE[b.cible] || b.cible)}* <small>(${esc(b.quand || 'sous condition')})</small></span>`
    : `<span class="${num(b.val) < 0 ? 'malus-etat' : 'bonus-objet'}">${R.signe(num(b.val))} ${esc(NOM_CIBLE[b.cible] || b.cible)}</span>`;
  return `<div class="objet-vue ${bonus.length && it.equipe === false ? 'range' : ''} ${it.focalisateur ? 'focalisateur' : ''} ${it.image ? 'avec-image' : ''}">
    ${it.image ? `<button class="vignette" data-action="img-zoom" data-src="${it.image}" aria-label="Agrandir l'image de ${esc(it.nom || 'l\'objet')}"><img src="${it.image}" alt=""></button>` : ''}
    <div class="objet-vue-tete">
      <b>${esc(it.nom || 'Objet sans nom')}</b>${num(it.qte) > 1 || it.cat === 'munition' || it.cat === 'consommable' ? ` <span class="qte">× ${esc(it.qte || 0)}</span>` : ''}
      ${it.cat ? `<span class="tag-cat cat-${it.cat}">${CATS_OBJET[it.cat]}</span>` : ''}
      ${it.focalisateur ? '<span class="tag-cat focal">✦ focalisateur</span>' : ''}
      ${['vetement', 'magique', 'armure', 'bouclier', 'babiole'].includes(it.cat) && it.equipe !== false ? '<span class="tag-cat porte">porté</span>' : ''}
      ${it.cat === 'ration' && state.ctx && rationDefaut(state.ctx)?.id === it.id ? '<span class="tag-cat defaut">★ par défaut</span>' : ''}
      ${it.visibleJoueurs && state.ctx?.pnjMJ && peutModifier(state.ctx) ? '<span class="tag-cat">visible des joueurs</span>' : ''}
      ${modifiable && it.cat === 'ration' && rationDefaut(state.ctx)?.id !== it.id ? `<button class="lien" data-action="ration-defaut" data-id="${it.id}">Consommer par défaut</button>` : ''}
      ${modifiable ? `<button class="lien objet-modif" data-action="objet-edit" data-id="${it.id}">Modifier</button>` : ''}
    </div>
    ${det ? `<p class="objet-det">${esc(det)}</p>` : ''}
    ${bonus.length ? `<p class="objet-bonus">${bonus.map(chipBonus).join('')}${it.equipe === false ? '<span class="range-tag">rangé</span>' : ''}</p>` : ''}
    ${it.notes || it.poids || valeurObjet(it) ? `<p class="objet-det">${esc([it.poids && `${it.poids}`, nombre(it.valeur) ? `valeur ${prixTxt(it.valeur, it.valeurUnite)}${num(it.qte) > 1 ? ' pièce' : ''}` : '', it.notes].filter(Boolean).join(' · '))}</p>` : ''}
  </div>`;
}
function resumeEquipement(p) {
  const items = p.equipement || [];
  const lignes = groupesInventaire(items).map(([titre, l]) => `<h4 class="groupe-inv">${titre} <small>${l.length}</small></h4>
    <div class="objets">${l.map(({ it, i }) => ligneObjetVue(it, i, items, false)).join('')}</div>`).join('');
  return `${lignes || '<p class="empty">Aucun objet.</p>'}
    <p class="hint">Bourse : ${esc(bourseTxt(p))}.</p>
    ${peutModifier(p) ? `<a class="btn ghost" href="#/perso/${p.id}/inventaire">Gérer l'inventaire</a>` : ''}`;
}
/* Groupes de l'inventaire : repliés par défaut, ouverts pendant une recherche ou une modification */
function groupesInvHTML(p, items, mod) {
  const q = norm(state.invQ || '').trim();
  const filtreCat = state.invCat || '';
  const correspond = it => {
    if (filtreCat && (it.cat || 'objet') !== filtreCat && !(filtreCat === 'armure' && it.cat === 'bouclier')) return false;
    if (!q) return true;
    return [it.nom, it.notes, it.effet, CATS_OBJET[it.cat || ''], R.ARME[it.armeType]?.nom, R.ARMURE[it.armureType]?.nom, ...(it.bonus || []).map(b => NOM_CIBLE[b.cible])].some(v => norm(v).includes(q));
  };
  const ouverts = db.invOuverts || {};
  const html = groupesInventaire(items).map(([titre, l]) => {
    const vis = l.filter(({ it }) => correspond(it));
    if (!vis.length) return '';
    const cle = slug(titre);
    const ouvert = q || filtreCat || ouverts[cle] || vis.some(({ it }) => it.id === state.editObjet);
    return `<details class="groupe-inv-d" data-groupe="${cle}" ${ouvert ? 'open' : ''}>
      <summary class="groupe-inv">${titre} <small>${vis.length}${vis.length !== l.length ? ' / ' + l.length : ''}</small>${l.some(({ it }) => valeurObjet(it)) ? `<span class="valeur-groupe">${poTxt(l.reduce((t, { it }) => t + valeurObjet(it), 0))}</span>` : ''}</summary>
      <div class="objets">${vis.map(({ it, i }) => mod && state.editObjet === it.id ? ligneObjetEdition(p, it, i) : ligneObjetVue(it, i, items, mod)).join('')}</div>
    </details>`;
  }).join('');
  return html || (items.length ? '<p class="empty">Aucun objet ne correspond.</p>' : '<p class="empty">Aucun objet.</p>');
}

/* La bourse : seul le MJ la modifie (le marché et le coffre commun la font aussi évoluer) */
/* Les 10 derniers mouvements, tenus par la base (achats, coffre commun, MJ) */
const deltaTxt = d => Object.entries(d || {}).filter(([, v]) => num(v)).map(([k, v]) => `${num(v) > 0 ? '+' : ''}${num(v)} ${k}`).join(', ');
function historiqueBourse(p, n = 10) {
  const h = (p.histoBourse || []).slice(0, n);
  if (!h.length) return '';
  return `<ul class="histo-bourse">${h.map(x => {
    const negatif = Object.values(x.delta || {}).reduce((t, v) => t + num(v), 0) < 0;
    return `<li><span class="quand">${new Date(num(x.quand)).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
      <span class="quoi">${esc(x.quoi || '')}</span>
      <b class="${negatif ? 'neg' : 'pos'}">${esc(deltaTxt(x.delta))}</b>
      ${x.solde ? `<small>reste ${esc(piecesTxt(x.solde))}</small>` : ''}</li>`;
  }).join('')}</ul>`;
}
function carteBourse(p) {
  const libre = !enLigne() || estMJ();
  return `<section class="card bourse-perso"><h3>Bourse</h3>
    ${libre ? `<div class="grid">
      ${fi(p, 'argent.pp', 'Pièces de platine', { type: 'number' })}${fi(p, 'argent.po', 'Pièces d\'or', { type: 'number' })}
      ${fi(p, 'argent.pa', 'Pièces d\'argent', { type: 'number' })}${fi(p, 'argent.pc', 'Pièces de cuivre', { type: 'number' })}
    </div>` : `<div class="pieces-lecture">${[['pp', 'platine'], ['po', 'or'], ['pa', 'argent'], ['pc', 'cuivre']].map(([k, l]) => `<span><b>${num((p.argent || {})[k])}</b> ${k} <small>${l}</small></span>`).join('')}</div>
      <p class="hint">Seul le MJ modifie la bourse. Elle évolue aussi avec les achats au marché et le coffre commun.</p>`}
    ${(p.histoBourse || []).length ? `<h4>Derniers mouvements</h4>${historiqueBourse(p)}` : enLigne() ? '<p class="hint">Les prochains mouvements (achats, coffre commun, pièces du MJ) s\'afficheront ici.</p>' : ''}
  </section>`;
}

function ongletInventaire(p, e) {
  const items = p.equipement || [];
  for (const it of items) if (!it.id) it.id = uid();
  const poids = items.reduce((t, it) => t + poidsKg(it.poids) * (num(it.qte) || 1), 0);
  const mod = peutModifier(p);
  const valeur = items.reduce((t, it) => t + valeurObjet(it), 0);
  const lignes = `<div class="inv-outils">
      <input type="search" id="invq" value="${esc(state.invQ || '')}" placeholder="Chercher un objet : nom, type d'arme, effet…" aria-label="Chercher dans l'inventaire">
      <div class="chips">${[['', 'Tout'], ...GROUPES_INV.map(([t, c]) => [c[0] || 'objet', t.replace(/ \(.*\)$/, '')])].filter(([k]) => !k || items.some(it => (it.cat || 'objet') === k || (k === 'armure' && it.cat === 'bouclier'))).map(([k, l]) => `<button class="chip ${(state.invCat || '') === k ? 'on' : ''}" data-action="inv-cat" data-c="${k}">${esc(l)}</button>`).join('')}</div>
    </div>
    <div id="inv-groupes">${groupesInvHTML(p, items, mod)}</div>`;
  return carteBourse(p) + `<section class="card"><h3>Inventaire et équipement</h3>
    <div class="inv-resume">
      <span>Objets<b>${items.length}</b></span>
      ${poids ? `<span>Poids total<b>${poidsTxt(poids)}</b></span>` : ''}
      <span>Valeur totale<b>${poTxt(valeur)}</b></span>
      <span>Bourse<b>${esc(bourseTxt(p))}</b></span>
    </div>
    ${lignes}
    ${mod ? `<button class="btn" data-action="add-item" data-list="equipement">+ Ajouter un objet</button>${estMJ() ? blocAjoutRapide('perso') : ''}` : ''}
    <p class="hint aide">Type « Arme » : elle apparaît dans « En combat » avec ses jets calculés. « Armure » et « Bouclier » : la CA, la Dextérité maximale et le malus aux compétences se calculent seuls. « Munition » : reliée à une arme, avec son effet et un compteur. « Consommable » : potion, parchemin… Un objet équipé avec un bonus (ex. un anneau +1 en Intelligence) met à jour la fiche tout seul. Décoche « Équipé » s'il est rangé dans le sac.</p>
  </section>
  </section>`;
}
function ligneObjetEdition(p, it, i) {
  const items = p.equipement || [];
  const opts = cur => CIBLES_BONUS.map(([g, l]) => `<optgroup label="${g}">${l.map(([v, t]) => `<option value="${v}" ${cur === v ? 'selected' : ''}>${esc(t)}</option>`).join('')}</optgroup>`).join('');
  const armes = items.filter(x => x.cat === 'arme');
  {
    const bonus = it.bonus || [];
    const ref = R.ARME[it.armeType];
    const e = etat(p);
    const champCat = it.cat === 'arme' ? `<div class="objet-cat">
        <label class="f arme-type"><span>Type d'arme</span><select data-bind="equipement.${i}.armeType" data-rerender aria-label="Type d'arme">
          <option value="">Autre (à remplir à la main)</option>
          ${Object.entries(R.CATS_ARMES).map(([c, l]) => `<optgroup label="${l}">${R.ARMES.filter(a => a.cat === c).map(a => `<option value="${a.id}" ${it.armeType === a.id ? 'selected' : ''}>${esc(a.nom)}${a.moine ? ' (moine)' : ''}</option>`).join('')}</optgroup>`).join('')}
        </select></label>
        <label class="f"><span>Caractéristique aux dégâts</span><select data-bind="equipement.${i}.carDegats" data-rerender>${[['', 'Force (normal)'], ['sag', 'Sagesse'], ['dex', 'Dextérité'], ['con', 'Constitution'], ['int', 'Intelligence'], ['cha', 'Charisme'], ['aucune', 'Aucune']].map(([v, l]) => `<option value="${v}" ${(it.carDegats || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="check ligne-entiere"><input type="checkbox" data-bind="equipement.${i}.membre" data-rerender ${it.membre ? 'checked' : ''}> Fait partie du corps (prothèse, griffes…) : frappe comme à mains nues et compte pour le déluge de coups</label>
        ${ref ? `<p class="hint arme-ref">${R.PRISES[ref.prise]}, ${({ courante: 'arme courante', guerre: 'arme de guerre', exotique: 'arme exotique' })[ref.cat]}${ref.moine ? ', <b>arme spéciale de moine</b> : déluge de coups possible' : ''}${ref.finesse || ref.prise === 'legere' ? ', compatible Attaque en finesse' : ''}.</p>` : ''}
        <select data-bind="equipement.${i}.mode" data-rerender aria-label="Type d'attaque"><option value="">Corps à corps</option><option value="distance" ${it.mode === 'distance' ? 'selected' : ''}>Distance</option></select>
        <input type="text" data-bind="equipement.${i}.degats" data-recalc value="${esc(it.degats)}" placeholder="Dégâts (1d8)" aria-label="Dégâts">
        <input type="text" data-bind="equipement.${i}.critique" value="${esc(it.critique)}" placeholder="Critique (19-20/×2)" aria-label="Critique">
        <input type="text" data-bind="equipement.${i}.portee" value="${esc(it.portee)}" placeholder="Portée (24 m)" aria-label="Portée">
        ${e.dons.has('arme-predilection') ? `<label class="check"><input type="checkbox" data-bind="equipement.${i}.predilection" data-rerender ${it.predilection ? 'checked' : ''}> Arme de prédilection</label>` : ''}
        ${e.dons.has('specialisation-martiale') ? `<label class="check"><input type="checkbox" data-bind="equipement.${i}.specialisation" data-rerender ${it.specialisation ? 'checked' : ''}> Spécialisation martiale</label>` : ''}
      </div>` : it.cat === 'armure' || it.cat === 'bouclier' ? (() => {
        const refA = R.ARMURE[it.armureType];
        const liste = it.cat === 'bouclier'
          ? `<optgroup label="Boucliers">${R.ARMURES.filter(a => a.type === 'bouclier').map(a => `<option value="${a.id}" ${it.armureType === a.id ? 'selected' : ''}>${esc(a.nom)} (CA +${a.ca})</option>`).join('')}</optgroup>`
          : Object.entries(R.TYPES_ARMURES).map(([t, l]) => `<optgroup label="${l}">${R.ARMURES.filter(a => a.type === t).map(a => `<option value="${a.id}" ${it.armureType === a.id ? 'selected' : ''}>${esc(a.nom)} (CA +${a.ca})</option>`).join('')}</optgroup>`).join('');
        return `<div class="objet-cat">
        <label class="f arme-type"><span>Type ${it.cat === 'bouclier' ? 'de bouclier' : 'd\'armure'}</span><select data-bind="equipement.${i}.armureType" data-rerender>
          <option value="">Autre (à remplir à la main)</option>${liste}</select></label>
        ${refA ? `<p class="hint arme-ref">CA +${refA.ca}${refA.dex != null ? `, Dextérité max +${refA.dex}` : ''}, malus aux tests ${R.signe(refA.malus)}${it.maitre ? ' (−1 de moins : de maître)' : ''}, échec des sorts profanes ${refA.echec} %.</p>`
          : `<input type="text" inputmode="numeric" data-bind="equipement.${i}.caBase" data-recalc value="${esc(it.caBase)}" placeholder="Bonus de CA" aria-label="Bonus de CA">
             <input type="text" inputmode="numeric" data-bind="equipement.${i}.dexMax" data-recalc value="${esc(it.dexMax)}" placeholder="Dex max" aria-label="Dextérité maximale">
             <input type="text" inputmode="numeric" data-bind="equipement.${i}.malus" data-recalc value="${esc(it.malus)}" placeholder="Malus (−2)" aria-label="Malus d'armure">`}
        <label class="f aj"><span>Altération (+1, +2…)</span><input type="text" inputmode="numeric" data-bind="equipement.${i}.alteration" data-recalc value="${esc(it.alteration)}" placeholder="0"></label>
        <label class="check"><input type="checkbox" data-bind="equipement.${i}.maitre" data-rerender ${it.maitre ? 'checked' : ''}> De maître (malus réduit de 1)</label>
        <label class="check"><input type="checkbox" data-bind="equipement.${i}.equipe" data-rerender ${it.equipe === false ? '' : 'checked'}> Porté${it.cat === 'bouclier' ? ' au bras' : ''}</label>
      </div>`;
      })() : it.cat === 'munition' ? `<div class="objet-cat">
        <select data-bind="equipement.${i}.lien" data-rerender aria-label="Arme associée"><option value="">— Pour quelle arme ? —</option>${armes.map(a => `<option value="${a.id}" ${it.lien === a.id ? 'selected' : ''}>${esc(a.nom || 'Arme')}</option>`).join('')}</select>
        <input type="text" data-bind="equipement.${i}.effet" value="${esc(it.effet)}" placeholder="Effet (ex. +1d6 de feu)" aria-label="Effet">
      </div>` : it.cat === 'consommable' ? `<div class="objet-cat">
        <input type="text" data-bind="equipement.${i}.effet" value="${esc(it.effet)}" placeholder="Effet (ex. soigne 1d8+1 PV)" aria-label="Effet">
      </div>` : '';
    return `<div class="objet en-edition">
      <div class="row">
        <input type="text" data-bind="equipement.${i}.nom" value="${esc(it.nom)}" placeholder="Objet" aria-label="Objet">
        <input type="text" class="s" data-bind="equipement.${i}.qte" value="${esc(it.qte)}" placeholder="Qté" aria-label="Quantité">
        <input type="text" class="s" data-bind="equipement.${i}.poids" value="${esc(it.poids)}" placeholder="Poids (500 g, 2 kg)" aria-label="Poids, en g ou en kg">
        <input type="text" inputmode="decimal" class="s" data-bind="equipement.${i}.valeur" value="${esc(it.valeur)}" placeholder="Valeur" aria-label="Valeur à l'unité">
        ${selUnite(`data-bind="equipement.${i}.valeurUnite" data-recalc`, it.valeurUnite)}
        <button class="icon" data-action="del-item" data-list="equipement" data-idx="${i}" aria-label="Supprimer l'objet">✕</button>
      </div>
      <div class="objet-image">
        <button class="image-cadre petite" data-action="img-choisir" data-type="objet" data-id="${it.id}" aria-label="${it.image ? 'Changer' : 'Ajouter'} l'image">${it.image ? `<img src="${it.image}" alt="">` : '<span>+ Image</span>'}</button>
        ${it.image ? `<button class="lien" data-action="img-retirer" data-type="objet" data-id="${it.id}">Retirer l'image</button>` : ''}
      </div>
      <div class="row objet-type">
        <select data-bind="equipement.${i}.cat" data-rerender aria-label="Type d'objet">${Object.entries(CATS_OBJET).map(([k, l]) => `<option value="${k}" ${(it.cat || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input type="text" data-bind="equipement.${i}.notes" value="${esc(it.notes)}" placeholder="Notes" aria-label="Notes" class="objet-notes">
      </div>
      ${champCat}
      ${it.cat === 'magique' ? `<label class="check focal-case"><input type="checkbox" data-bind="equipement.${i}.focalisateur" data-rerender ${it.focalisateur ? 'checked' : ''}> ✦ Focalisateur (mis en avant sur la fiche)</label>` : ''}
      ${it.cat === 'ration' ? '<p class="hint">Indique le type dans le nom (ration de voyage, de survie…) et la quantité. Le MJ en retire une à chaque « Ration consommée ».</p>' : ''}
      ${p.pnjMJ ? `<label class="check"><input type="checkbox" data-bind="equipement.${i}.visibleJoueurs" data-rerender ${it.visibleJoueurs ? 'checked' : ''}> Visible des joueurs</label>` : ''}
      ${bonus.map((b, j) => `<div class="bonus-ligne ${b.cond ? 'conditionnel' : ''}">
        <select data-bind="equipement.${i}.bonus.${j}.cible" data-rerender aria-label="Ce que l'objet améliore"><option value="">— Ce que l'objet améliore —</option>${opts(b.cible)}</select>
        <input type="text" inputmode="numeric" class="bonus-val" data-bind="equipement.${i}.bonus.${j}.val" data-recalc value="${esc(b.val)}" aria-label="Valeur du bonus">
        <button class="icon" data-action="del-bonus" data-idx="${i}" data-j="${j}" aria-label="Retirer ce bonus">✕</button>
        <label class="check cond-case"><input type="checkbox" data-bind="equipement.${i}.bonus.${j}.cond" data-rerender ${b.cond ? 'checked' : ''}> Conditionnel</label>
        ${b.cond ? `<input type="text" class="cond-quand" data-bind="equipement.${i}.bonus.${j}.quand" data-recalc value="${esc(b.quand)}" placeholder="Quand ? (ex. uniquement la nuit)" aria-label="Condition">` : ''}
      </div>`).join('')}
      <div class="objet-pied">
        <button class="lien" data-action="add-bonus" data-idx="${i}">+ Bonus ou malus</button><span class="hint"> (valeur négative pour un malus)</span>
        ${(bonus.length || ['vetement', 'magique', 'babiole'].includes(it.cat)) && it.cat !== 'armure' && it.cat !== 'bouclier' ? `<label class="check"><input type="checkbox" data-bind="equipement.${i}.equipe" data-rerender ${it.equipe === false ? '' : 'checked'}> ${['vetement', 'magique', 'babiole'].includes(it.cat) ? 'Porté' : 'Équipé'}</label>` : ''}
      </div>
      <button class="btn" data-action="objet-fin">Terminé</button>
    </div>`;
  }
}

/* Compétences soumises au malus d'armure (◘ sur la feuille papier) */
const c2id = c => c.id;
const MALUS_ARMURE = new Set(['acrobaties', 'deplacement-silencieux', 'discretion', 'equilibre', 'escalade', 'escamotage', 'evasion', 'saut', 'natation']);
const nomCourt = n => n.replace(/^Connaissances \((.*)\)$/, 'Conn. ($1)').replace(' et ingénierie', '').replace('exploration souterraine', 'souterrains').replace(' et royauté', '').replace("Utilisation d'objets magiques", "Util. d'objets magiques");

function ligneComp(e, c, v, base, opts) {
  const { classe, deClasse, perso, i } = opts;
  const rangs = num(v.rangs);
  const mod = c.car ? e.mods[c.car] : 0;
  const malusArm = !perso && MALUS_ARMURE.has(c.id) ? (e.objets.acp || 0) * (c.id === 'natation' ? 2 : 1) : 0;
  const bonusObjet = perso ? 0 : (e.objets.tot['comp:' + c.id] || 0);
  const bonus = (perso ? 0 : bonusComp(c.id, e)) + malusArm + bonusObjet;
  const total = rangs + mod + bonus + num(v.divers);
  const inutilisable = c.formation && rangs === 0;
  const spe = !perso && ['artisanat', 'profession', 'representation', 'langue'].includes(c.id);
  const car = R.CARACS.find(x => x.k === c.car);
  const cle = perso ? `compPerso.${i}` : `comp.${c.id}`;
  return `<div class="cl ${classe ? 'de-classe' : ''} ${inutilisable ? 'formation' : ''}">
    <button class="cl-case ${classe ? 'on' : ''}" data-action="comp-classe" data-cle="${perso ? 'perso:' + i : c.id}" title="${classe ? 'Compétence de classe' : 'Hors classe'}${perso ? '' : deClasse ? ' (selon ta classe)' : ''}" aria-pressed="${classe}" aria-label="Compétence de classe">${classe ? '✱' : ''}</button>
    <div class="cl-nom">
      ${perso ? `<input type="text" class="cl-nom-perso" data-bind="${cle}.nom" value="${esc(v.nom)}" placeholder="Nom de la compétence" aria-label="Nom de la compétence">`
        : `<span class="cl-libelle" title="${esc(c.nom)}">${esc(nomCourt(c.nom))}</span>`}
      <span class="cl-marques">${c.formation ? '' : '<span title="Utilisable non entraîné">*</span>'}${MALUS_ARMURE.has(c.id) ? '<span title="Pénalité d\'armure ou d\'encombrement">◘</span>' : ''}</span>
      ${spe ? `<input type="text" class="spe" data-bind="${cle}.spe" value="${esc(v.spe)}" placeholder="Spécialité" aria-label="Spécialité">` : ''}
    </div>
    <b class="cl-val ${total < 0 ? 'neg' : ''}" title="Bonus à ajouter au d20">${inutilisable ? '—' : R.signe(total)}${(() => { const cc = perso ? null : e.objets.cond['comp:' + c.id]; return cc && !inutilisable ? `<small class="cl-cond" title="${esc(cc.map(x => `${R.signe(x.val)} ${x.quand} (${x.source})`).join(' ; '))}">${R.signe(cc.reduce((t, x) => t + x.val, 0))}*</small>` : ''; })()}</b>
    <input type="text" inputmode="decimal" class="cl-in" data-bind="${cle}.rangs" data-recalc value="${esc(v.rangs)}" placeholder="0" aria-label="Rangs">
    <span class="cl-car">${perso
      ? `<select class="cl-car-sel" data-bind="${cle}.car" data-rerender aria-label="Caractéristique">${R.CARACS.map(x => `<option value="${x.k}" ${v.car === x.k ? 'selected' : ''}>${x.l.charAt(0) + x.l.slice(1).toLowerCase()}</option>`).join('')}</select>`
      : `<small>${car ? car.l.charAt(0) + car.l.slice(1).toLowerCase() : '—'}</small>`}<b>${R.signe(mod)}</b></span>
    <span class="cl-div">
      <input type="text" inputmode="numeric" class="cl-in" data-bind="${cle}.divers" data-recalc value="${esc(v.divers)}" placeholder="0" aria-label="Bonus divers">
      ${bonus ? `<small class="cl-auto ${bonus < 0 ? 'neg' : ''}" title="${malusArm ? `Dont malus d'armure ${malusArm}. ` : ''}Bonus racial, de don ou d'armure, déjà compté">${R.signe(bonus)}</small>` : ''}
    </span>
    ${perso ? `<button class="icon cl-suppr" data-action="del-comp-perso" data-idx="${i}" aria-label="Supprimer cette compétence">✕</button>` : ''}
  </div>`;
}

/* ===== Usage des sorts (pour choisir plus facilement) ===== */
const USAGES_SORT = {
  offensif: 'Offensif', controle: 'Contrôle', protection: 'Protection', soin: 'Soin', amelioration: 'Amélioration',
  deplacement: 'Déplacement', information: 'Information', convocation: 'Convocation', utilitaire: 'Utilitaire',
};
function usagesSort(s) {
  if (Array.isArray(s.usages) && s.usages.length) return s.usages;
  if (s._usages) return s._usages;
  const t = norm(`${s.nom} ${s.description}`), n = norm(s.nom), dsc = norm(s.description), u = [];
  const a = (k, re, txt = t) => { if (re.test(txt) && !u.includes(k)) u.push(k); };
  a('soin', /^(soins|guerison|restauration|rappel a la vie|resurrection|regeneration|delivrance|neutralisation|baies|festin|aide$|guerison)/, n);
  a('soin', /^soigne/, dsc);
  if (!u.includes('soin')) a('offensif', /inflige \d|\d+d\d+ (points de )?degats|degats d.(acide|electricite)|degats de (feu|froid|force|son)|\btue\b|desintegr|explose|\d+d\d+ par niveau/);
  a('controle', /immobilise|paralys|plonge .*sommeil|sommeil magique|charme|considere le lanceur comme|controle|domin|confusion|hebete|etourdi|enchevetr|agripp|toiles|glissant|suggestion|est ralenti|sont ralenti|aveugle |nauseeu|fascine|paniqu|effraye|petrif|labyrinthe|emprisonne|cage de force|renvoie une|bannit|fou rire|danse frenetique|injonction|desespoir/);
  a('protection', /classe d.armure|bonus d.armure|a la ca|protection contre|resistance de|resistance a la magie egale|bonus de resistance|bouclier|immunis|reduction des degats|camouflage|invisible|antidetection|globe|50 % d.echec/);
  a('amelioration', /bonus d.alteration de \+\d en|bonus de moral|bonus d.aptitude|bonus d.intuition|gagne \+|gagnent \+|passe a la categorie de taille superieure|attaque supplementaire/);
  a('deplacement', /se teleporte|teleporte instantanement|transporte instantanement|vitesse de base|vitesse de vol|peut voler|levitation|forme gazeuse|passe-muraille|ouvre un passage|voyage par|voyagent|escalade les murs|ralentit la chute|marche sur|liberte de mouvement|devient ethere|tests de saut|monte ou descend|transporte les cibles/);
  if (s.ecole === 'Divination') u.push('information');
  else a('information', /detecte|localisation|scrutation|identifi|comprehension|communication avec|mythes|revele les|connait|savoir/);
  if (/Convocation/.test(s.sousEcole || '')) u.push('convocation');
  if (!u.length) u.push('utilitaire');
  s._usages = u;
  return u;
}
const tagsUsages = s => usagesSort(s).map(k => `<span class="usage usage-${k}">${USAGES_SORT[k]}</span>`).join('');

/* ===== En combat : actions, armes, sorts et capacités avec compteurs ===== */
const CATS_OBJET = { '': 'Objet', arme: 'Arme', armure: 'Armure', bouclier: 'Bouclier', vetement: 'Vêtement', magique: 'Objet magique', munition: 'Munition', consommable: 'Potion / élixir', fourniture: 'Fourniture', ration: 'Ration', tresor: 'Trésor', babiole: 'Babiole' };

function infosMainsNues(p, e, st) {
  const moine = e.moineCumul.mn || 0, mDel = e.classes.moine ? e.moineCumul.deluge : 0;
  if (!moine && !e.dons.has('science-mains-nues')) return null;
  const petit = e.taille === 'P';
  const de = moine ? R.palier(moine, petit
    ? [[1, '1d4'], [4, '1d6'], [8, '1d8'], [12, '1d10'], [16, '2d6'], [20, '2d8']]
    : [[1, '1d6'], [4, '1d8'], [8, '1d10'], [12, '2d6'], [16, '2d8'], [20, '2d10']]) : (petit ? '1d2' : '1d3');
  const fo = e.mods.for;
  const bonD = fo + (e.objets.tot.degats || 0);
  const degats = `${de}${bonD ? R.signe(bonD) : ''}`;
  const prediMN = p.predMainsNues && e.dons.has('arme-predilection') ? 1 + (e.dons.has('arme-predilection-superieure') ? 1 : 0) : 0;
  const toucher = R.attaques(Math.max(0, st.bba)).map(x => x + e.mods.for + (R.TAILLES[e.taille]?.ca || 0) + prediMN);
  let deluge = null;
  if (mDel) {
    const pen = mDel < 5 ? -2 : mDel < 9 ? -1 : 0;
    const base = toucher.map(x => x + pen);
    const liste = [base[0], ...base];
    if (mDel >= 11) liste.unshift(base[0]);
    deluge = { liste, pen };
  }
  return { de, degats, toucher, deluge };
}

/* Ressources qui se rechargent chaque nuit */
function ressources(p, e) {
  const res = [];
  const c = e.classes, niv = e.niveau;
  for (const id of e.domaines || []) {
    const u = R.DOMAINES[id].usage;
    if (u) res.push({ id: 'dom-' + id, nom: u.nom, max: 1, unite: 'fois', action: `${u.action} · domaine ${R.DOMAINES[id].nom}`, texte: R.DOMAINES[id].pouvoir.replace(/(niveau de prêtre)/g, `$1 (${c.pretre})`), duree: u.duree || '' });
  }
  for (const [id, k] of Object.entries(c)) {
    (R.CLASSES[id].ressourcesPerso || []).forEach((r, j) => {
      const max = R.valeurPalier(r.paliers, k);
      if (max > 0) res.push({ id: `${id}-${j}`, nom: r.nom, max, unite: 'fois', action: r.action || R.CLASSES[id].nom, texte: r.texte || '', duree: dureeCapacite(r.duree, e, k) });
    });
  }
  const moine = c.moine || 0;
  if (e.dons.has('coup-etourdissant')) {
    const n = moine ? moine + Math.floor((niv - moine) / 4) : Math.floor(niv / 4);
    const dd = 10 + Math.floor(niv / 2) + e.mods.sag;
    res.push({ id: 'coup-etourdissant', nom: 'Coup étourdissant', max: n, unite: 'fois', action: 'À annoncer avant ton jet d\'attaque',
      texte: `Annonce-le avant de frapper à mains nues. Si tu touches, la cible fait un jet de Vigueur DD ${dd}. Si elle le rate, elle est étourdie pendant 1 round : elle ne peut pas agir, lâche ce qu'elle tient et perd son bonus de Dextérité à la CA. Une fois par round au maximum. Si ton attaque rate, l'utilisation est perdue.` });
  }
  if (moine >= 7) res.push({ id: 'plenitude', nom: 'Plénitude physique', max: 2 * moine, unite: 'PV', pool: true, action: 'Action simple',
    texte: `Tu te soignes toi-même. Tu as ${2 * moine} PV à répartir dans la journée, en une ou plusieurs fois.` });
  if (moine >= 12) res.push({ id: 'pas-chasse', nom: 'Pas chassé', max: 1, unite: 'fois', action: 'Action de mouvement',
    texte: 'Tu te téléportes à une distance de 120 m + 12 m par niveau de moine, comme Porte dimensionnelle.' });
  if (c.barbare) {
    const n = R.palier(c.barbare, [[1, 1], [4, 2], [8, 3], [12, 4], [16, 5], [20, 6]]);
    res.push({ id: 'rage', nom: 'Rage', max: n, unite: 'fois', action: 'Action libre',
      texte: `Pendant ${3 + e.mods.con + 2} rounds environ : +4 en Force et en Constitution (donc plus de PV et de dégâts), +2 aux jets de Volonté, mais −2 à la CA. Tu es fatigué ensuite.` });
  }
  if (c.paladin) {
    res.push({ id: 'chatiment', nom: 'Châtiment du Mal', max: R.palier(c.paladin, [[1, 1], [5, 2], [10, 3], [15, 4], [20, 5]]), unite: 'fois', action: 'À annoncer avant ton jet d\'attaque',
      texte: `Contre une créature mauvaise : ${R.signe(e.mods.cha)} au jet d'attaque et +${c.paladin} aux dégâts. Si la cible n'est pas mauvaise, l'utilisation est perdue.` });
    if (c.paladin >= 2) res.push({ id: 'imposition', nom: 'Imposition des mains', max: Math.max(0, c.paladin * e.mods.cha), unite: 'PV', pool: true, action: 'Action simple',
      texte: 'Tu soignes en touchant (toi ou un allié). Les PV se répartissent comme tu veux dans la journée.' });
  }
  if (c.barde) res.push({ id: 'musique', nom: 'Musique de barde', max: c.barde, unite: 'fois', action: 'Action simple',
    texte: 'Inspiration vaillante, fascination, contre-chant… Chaque morceau compte une utilisation.' });
  if (c.pretre || (c.paladin || 0) >= 4) res.push({ id: 'renvoi', nom: 'Renvoi des morts-vivants', max: Math.max(0, 3 + e.mods.cha + (e.dons.has('renvoi-supplementaire') ? 4 : 0)), unite: 'fois', action: 'Action simple',
    texte: 'Tu présentes ton symbole sacré : les morts-vivants proches fuient, ou sont détruits s\'ils sont faibles.' });
  if ((c.druide || 0) >= 5) res.push({ id: 'forme-animale', nom: 'Forme animale', max: R.palier(c.druide, [[5, 1], [6, 2], [7, 3], [10, 4], [14, 5], [18, 6]]), unite: 'fois', action: 'Action simple',
    texte: 'Tu te transformes en animal pendant 1 heure par niveau de druide.' });
  return res;
}

function compteur(p, r) {
  const utilise = num((p.compteurs || {})[r.id]);
  const reste = Math.max(0, r.max - utilise);
  const pips = !r.pool && r.max <= 12
    ? `<span class="pips" aria-label="${reste} sur ${r.max}">${Array.from({ length: r.max }, (_, i) => `<span class="pip-u ${i < reste ? 'on' : ''}"></span>`).join('')}</span>`
    : '';
  return `<div class="ressource ${reste ? '' : 'epuisee'}">
    <div class="ressource-tete">
      <b>${esc(r.nom)}</b>
      <span class="reste">${reste} / ${r.max} ${esc(r.unite)}</span>
    </div>
    ${pips}
    <p class="ressource-action">${esc(r.action)}</p>
    <details class="effet"><summary>Ce que ça fait</summary><p>${esc(r.texte)}</p></details>
    <div class="btns">
      ${r.pool
        ? `<button class="btn" data-action="cpt-pv" data-id="${r.id}" ${reste ? '' : 'disabled'}>Dépenser des PV</button>`
        : `<button class="btn" data-action="cpt-use" data-id="${r.id}" ${reste ? '' : 'disabled'}>Utiliser</button>`}
      ${utilise ? `<button class="lien" data-action="cpt-annuler" data-id="${r.id}">Annuler la dernière</button>` : ''}
    </div>
  </div>`;
}

const titreArme = (it, ref, dist) => { const t = ref ? ref.nom : (dist ? 'Arme à distance' : 'Arme'); return it.membre ? (it.nom || 'Membre') : it.nom && norm(it.nom) !== norm(t) ? `${t} : ${it.nom}` : t; };
/* Une arme dans « En combat » : jets calculés et capacités qui s'y appliquent */
function carteArmeCombat(p, e, st, it, munitions, sortie = {}) {
  const ref = R.ARME[it.armeType] || null;
  const prise = ref ? ref.prise : (it.mode === 'distance' ? 'distance' : 'une');
  const dist = it.mode === 'distance' || prise === 'distance';
  const taille = R.TAILLES[e.taille]?.ca || 0;
  const finessable = !dist && (prise === 'legere' || ref?.finesse);
  const finesse = finessable && e.dons.has('attaque-finesse') && e.mods.dex > e.mods.for;
  const carAtt = dist || finesse ? 'dex' : 'for';
  const predi = (it.predilection || (it.membre && p.predMainsNues)) && e.dons.has('arme-predilection') ? 1 + (e.dons.has('arme-predilection-superieure') ? 1 : 0) : 0;
  const spe = it.specialisation && e.dons.has('specialisation-martiale') ? 2 + (e.dons.has('specialisation-superieure') ? 2 : 0) : 0;
  const tou = R.attaques(Math.max(0, st.bba)).map(x => x + e.mods[carAtt] + taille + predi);
  /* Force aux dégâts : ×1,5 à deux mains, normale au corps à corps et pour les armes de jet */
  const carDeg = it.carDegats || 'for';
  const fo = carDeg === 'aucune' ? 0 : e.mods[carDeg] ?? e.mods.for;
  const bonusFo = carDeg !== 'for' ? fo : dist && !ref?.lancer ? Math.min(0, fo) : (prise === 'deux' || prise === 'double') && fo > 0 ? Math.floor(fo * 1.5) : fo;
  const bonusDeg = bonusFo + spe + (e.objets.tot.degats || 0);
  const de = it.degats || ref?.deg || '?';
  /* « 1d6+1 » saisi sur l'objet + bonus calculés = « 1d6+7 », et non « 1d6+1+6 » */
  const mDe = String(de).replace(/\s+/g, '').match(/^(\d+d\d+)([+-]\d+)?$/i);
  const deg = mDe ? `${mDe[1]}${(num(mDe[2]) + bonusDeg) ? R.signe(num(mDe[2]) + bonusDeg) : ''}` : `${de}${bonusDeg ? R.signe(bonusDeg) : ''}`;
  const moine = e.classes.moine ? e.moineCumul.deluge : 0;
  const liees = [];
  if (moine && (ref?.moine || it.membre) && !dist) {
    const pen = moine < 5 ? -2 : moine < 9 ? -1 : 0;
    const base = tou.map(x => x + pen);
    const liste = [base[0], ...base];
    if (moine >= 11) liste.unshift(base[0]);
    (sortie.deluge = sortie.deluge || []).push({ nom: titreArme(it, ref, dist), liste, deg, pen, note: it.membre ? 'fait partie de ton corps' : 'arme spéciale de moine', noteDeg: carDeg !== 'for' ? ({ sag: 'Sagesse', dex: 'Dextérité', con: 'Constitution', int: 'Intelligence', cha: 'Charisme', aucune: 'sans caractéristique' })[carDeg] : '' });
  }
  if (finesse) liees.push(`<p class="liee"><b>Attaque en finesse</b> : ta Dextérité (${R.signe(e.mods.dex)}) remplace ta Force pour toucher.</p>`);
  if (dist && e.dons.has('tir-bout-portant')) liees.push('<p class="liee"><b>Tir à bout portant</b> : +1 pour toucher et aux dégâts si la cible est à 9 m ou moins.</p>');
  if (dist && e.dons.has('tir-rapide')) liees.push(`<p class="liee"><b>Tir rapide</b> : en attaque à outrance, une attaque de plus, toutes à −2 : ${R.attTxt([tou[0] - 2, ...tou.map(x => x - 2)])}.</p>`);
  if (!dist && e.dons.has('attaque-puissance')) liees.push(`<p class="liee"><b>Attaque en puissance</b> : retire jusqu'à ${st.bba} à ton jet pour toucher et ajoute-le aux dégâts${prise === 'deux' ? ' (le double avec cette arme à deux mains)' : ''}.</p>`);
  if (prise === 'double') liees.push(`<p class="liee"><b>Arme double</b> : tu peux frapper avec les deux extrémités (${esc(ref?.second || de)} pour la seconde), comme avec deux armes${e.dons.has('combat-deux-armes') ? ' : −2/−2 grâce à Combat à deux armes' : ' : −4/−8 sans le don Combat à deux armes'}.</p>`);
  if (predi) liees.push(`<p class="liee"><b>Arme de prédilection</b> : +${predi} pour toucher, déjà inclus.</p>`);
  if (spe) liees.push(`<p class="liee"><b>Spécialisation martiale</b> : +${spe} aux dégâts, déjà inclus.</p>`);
  if (ref?.allonge) liees.push('<p class="liee"><b>Allonge</b> : tu frappes à 3 m, mais pas un ennemi collé à toi.</p>');
  const mun = munitions.filter(m => m.it.lien === it.id);
  const typeNom = ref ? ref.nom : (dist ? 'Arme à distance' : 'Arme');
  const titre = it.membre ? (it.nom || 'Membre') : it.nom && norm(it.nom) !== norm(typeNom) ? `${typeNom} : ${it.nom}` : typeNom;
  const recharge = /arbalete-(legere|poing)/.test(it.armeType || '') ? 'action de mouvement' : it.armeType === 'arbalete-lourde' ? 'action complexe' : '';
  if (tou.length > 1) (sortie.outrance = sortie.outrance || []).push({ nom: titreArme(it, ref, dist), liste: tou, deg });
  const noteDeg = carDeg !== 'for' ? ` <small>(${carDeg === 'aucune' ? 'sans caractéristique' : 'avec ' + ({ sag: 'Sagesse', dex: 'Dextérité', con: 'Constitution', int: 'Intelligence', cha: 'Charisme' })[carDeg]})</small>` : '';
  return `<div class="arme ${it.membre ? 'membre' : ''}">
    ${recharge ? `<p class="action-type">recharger : ${recharge}</p>` : ''}
    <div class="arme-tete"><b>${esc(titre)}</b><span class="tag-mode">${it.membre ? 'Corps à corps · comme à mains nues' : `${dist ? 'Distance' : R.PRISES[prise] || 'Corps à corps'}${ref?.moine ? ' · moine' : ''}`}</span></div>
    <dl class="arme-stats">
      <dt>Pour toucher</dt><dd><span class="gros">${R.signe(tou[0])}</span>${tou.length > 1 ? ` <small>(attaque à outrance : ${R.attTxt(tou)})</small>` : ''}</dd>
      <dt>Dégâts</dt><dd><span class="gros">${esc(deg)}</span>${noteDeg}${it.critique || ref?.crit || it.membre ? ` <small>critique ${esc(it.critique || ref?.crit || '20/×2')}</small>` : ''}</dd>
      ${it.portee || (dist && ref?.portee) ? `<dt>Portée</dt><dd>${esc(it.portee || ref.portee)}</dd>` : ''}
    </dl>
    ${liees.length ? `<details class="arme-plus"><summary>${liees.length} règle${liees.length > 1 ? 's' : ''} liée${liees.length > 1 ? 's' : ''}</summary>${liees.join('')}</details>` : ''}
    ${mun.map(({ it: m, i }) => `<div class="munition">
      <span><b>${esc(m.nom || 'Munition')}</b> <small>× ${esc(m.qte || 0)}</small>${m.effet ? `<br><small>${esc(m.effet)}</small>` : ''}</span>
      <button class="btn ghost" data-action="objet-use" data-idx="${i}" ${num(m.qte) > 0 ? '' : 'disabled'}>Tirer</button>
    </div>`).join('')}
  </div>`;
}

function ficheCombat(p, e) {
  const st = stats(p, e);
  const mn = infosMainsNues(p, e, st);
  const armes = (p.equipement || []).filter(it => it.cat === 'arme');
  const munitions = (p.equipement || []).map((it, i) => ({ it, i })).filter(x => x.it.cat === 'munition');
  const consommables = (p.equipement || []).map((it, i) => ({ it, i })).filter(x => x.it.cat === 'consommable' || x.it.cat === 'fourniture');
  const res = ressources(p, e);
  const taille = R.TAILLES[e.taille]?.ca || 0;

  const sortie = {};
  const carteArme = it => carteArmeCombat(p, e, st, it, munitions, sortie);
  const typeRes = r => /libre|annonce|avant l'attaque/i.test(r.action || '') ? 'libre' : /complexe/i.test(r.action || '') ? 'complexe' : /simple|standard/i.test(r.action || '') ? 'simple' : 'autre';
  const resPar = t => res.filter(r => typeRes(r) === t);

  const sorts = (p.sorts || []).map((x, i) => ({ x, i, s: findSort(x.id) })).filter(o => o.s);
  return `<section class="card combat"><h3>En combat</h3>
    <div class="combat-tete">
      <details class="tour"><summary>Que puis-je faire à mon tour ?</summary>
        <ul>
          <li><b>1 action simple</b> (attaquer une fois, lancer un sort, utiliser un objet) <b>et 1 action de mouvement</b> (te déplacer de ${st.vitesse} m, dégainer, te relever) ;</li>
          <li><b>ou 1 action complexe</b> : l'attaque à outrance (toutes tes attaques${mn?.deluge ? ', dont le déluge de coups' : ''}), en restant sur place ou en faisant un pas de 1,5 m ;</li>
          <li>plus des <b>actions libres</b> : parler, lâcher un objet.</li>
        </ul>
        <p class="hint">Initiative ${R.signe(st.init)} : c'est ce que tu ajoutes au d20 au début du combat pour savoir quand tu joues.</p>
      </details>

    </div>

    ${blocEffets(p)}
    ${resPar('libre').length ? `<h4 class="type-action">Actions libres</h4><div class="ressources">${resPar('libre').map(r => compteur(p, r)).join('')}</div>` : ''}
    <h4 class="type-action">Actions simples <small>une attaque</small></h4>
    <div class="armes">
      ${(() => {
        /* Cartes d'attaque dans l'ordre choisi par le joueur (flèches ↑ ↓) */
        const cartes = [];
        const htmlMN = mn ? `<div class="arme">
        <div class="arme-tete"><b>Combat à mains nues</b><span class="tag-mode">Corps à corps</span></div>
        <dl class="arme-stats">
          <dt>Pour toucher</dt><dd><span class="gros">${R.signe(mn.toucher[0])}</span>${mn.toucher.length > 1 ? ` <small>(attaque à outrance : ${R.attTxt(mn.toucher)})</small>` : ''}</dd>
          <dt>Dégâts</dt><dd><span class="gros">${esc(mn.degats)}</span> <small>critique 20/×2</small></dd>
        </dl>
        ${e.dons.has('arme-predilection') && peutModifier(p) ? `<details class="arme-plus"><summary>Réglages</summary><label class="check petit-check"><input type="checkbox" data-bind="predMainsNues" data-rerender ${p.predMainsNues ? 'checked' : ''}> Mon Arme de prédilection porte sur le combat à mains nues (s'applique aussi aux membres du corps)</label></details>` : ''}

        ${res.some(r => r.id === 'coup-etourdissant') ? (r => `<p class="liee"><b>Coup étourdissant</b> : uniquement à mains nues. Il t'en reste ${Math.max(0, r.max - num((p.compteurs || {})[r.id]))} sur ${r.max} (compteur plus bas).</p>`)(res.find(r => r.id === 'coup-etourdissant')) : ''}
      </div>` : '';
        if (htmlMN) cartes.push({ id: 'mn', html: htmlMN });
        for (const it of armes) cartes.push({ id: it.id, html: carteArme(it) });
        const ordre = p.ordreArmes || [];
        const rang = id => { const i = ordre.indexOf(id); return i < 0 ? 999 + cartes.findIndex(c => c.id === id) : i; };
        cartes.sort((x, y) => rang(x.id) - rang(y.id));
        const mod = peutModifier(p) && cartes.length > 1;
        return cartes.map((c, i) => mod ? c.html.replace('<div class="arme', `<div data-carte="${c.id}" class="arme`).replace(/<div class="arme-tete">/, `<div class="ordre-arme"><button class="icon" data-action="arme-ordre" data-id="${c.id}" data-sens="-1" ${i ? '' : 'disabled'} aria-label="Monter">↑</button><button class="icon" data-action="arme-ordre" data-id="${c.id}" data-sens="1" ${i < cartes.length - 1 ? '' : 'disabled'} aria-label="Descendre">↓</button></div><div class="arme-tete">`) : c.html).join('');
      })()}
      ${!mn && !armes.length ? '<p class="empty">Aucune arme. Dans l\'onglet Inventaire, choisis le type « Arme » pour un objet.</p>' : ''}
    </div>
    ${resPar('simple').length ? `<div class="ressources">${resPar('simple').map(r => compteur(p, r)).join('')}</div>` : ''}
    ${(() => {
      const del = [...(mn?.deluge ? [{ nom: 'Combat à mains nues', liste: mn.deluge.liste, deg: mn.degats, pen: mn.deluge.pen, note: 'tes poings, pieds, coudes…' }] : []), ...(sortie.deluge || [])];
      const out = [...(mn && mn.toucher.length > 1 ? [{ nom: 'Combat à mains nues', liste: mn.toucher, deg: mn.degats }] : []), ...(sortie.outrance || [])];
      const blocs = [];
      if (del.length) blocs.push(`<details class="action-complexe deluge-bloc"><summary><b>Déluge de coups</b> <span class="gros">${R.attTxt(del[0].liste)}</span> <small>${del[0].liste.length} attaques</small></summary>
        <p class="hint">Tout ton tour (tu peux faire un pas de 1,5 m). Chaque attaque se fait avec l'une des options ci-dessous, au choix, en les mélangeant si tu veux. Le malus de ${R.signe(del[0].pen)} est déjà inclus${del[0].pen ? '' : ' (il a disparu à ton niveau)'}. Impossible en armure ou avec un bouclier.</p>
        <table class="table-deluge"><thead><tr><th>Avec</th><th>Pour toucher</th><th>Dégâts</th></tr></thead>
        <tbody>${del.map(d => `<tr><th>${esc(d.nom)}<br><small>${esc(d.note || '')}</small></th><td><b>${R.attTxt(d.liste)}</b></td><td><b>${esc(d.deg)}</b>${d.noteDeg ? ` <small>(${esc(d.noteDeg)})</small>` : ''}</td></tr>`).join('')}</tbody></table>
        ${res.some(r => r.id === 'coup-etourdissant') ? '<p class="liee"><b>Coup étourdissant</b> : utilisable sur l\'une de ces attaques, à mains nues (à annoncer avant le jet).</p>' : ''}
      </details>`);
      if (out.length) blocs.push(`<details class="action-complexe"><summary><b>Attaque à outrance</b> <small>toutes tes attaques avec une arme</small></summary>
        <table class="table-deluge"><thead><tr><th>Avec</th><th>Pour toucher</th><th>Dégâts</th></tr></thead>
        <tbody>${out.map(d => `<tr><th>${esc(d.nom)}</th><td><b>${R.attTxt(d.liste)}</b></td><td><b>${esc(d.deg)}</b></td></tr>`).join('')}</tbody></table></details>`);
      blocs.push(...resPar('complexe').map(r => compteur(p, r)));
      return blocs.length ? `<h4 class="type-action">Actions complexes <small>tout le tour</small></h4><div class="actions-complexes">${blocs.join('')}</div>` : '';
    })()}

    <h4>Lancer un sort</h4>
    ${sorts.length ? `<div class="sorts-combat">${sorts.map(({ x, i, s }) => {
      const infini = !!x.illimite, max = infini ? 0 : num(x.max), reste = Math.max(0, max - num(x.utilises));
      const ef = etatFocal(p, x);
      return `<div class="sort-c ${ecoleClass(s.ecole)} ${ef !== 'ok' ? 'bloque' : ''}">
        ${ef === 'ok' ? `<p class="focal-sort">✦ ${esc(nomFocal(p, x))}</p>` : `<p class="focal-alerte">${ef === 'absent' ? `⚠ ${esc(nomFocal(p, x))} absent : sort inutilisable` : '⚠ Relie ce sort à un focalisateur (onglet Sorts)'}</p>`}
        <div class="sort-c-tete"><b>${esc(s.nom)}</b>
          ${infini ? '<span class="reste">∞ à volonté</span>' : max ? `<span class="reste">${reste} / ${max}</span>` : ''}</div>
        <p class="usages">${tagsUsages(s)}</p>
        <details class="effet"><summary>${esc(s.ecole)}${s.portee ? ', ' + esc(s.portee.split(' (')[0]) : ''} : voir l'effet</summary>
          <p>${esc(s.description || '')}</p>
          <dl class="fiche-sort">${[['Temps', s.incantation], ['Portée', s.portee], ['Cible', s.cible], ['Durée', s.duree], ['Jet de sauvegarde', s.sauvegarde], ['Résistance à la magie', s.rm]].filter(([, v]) => v).map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>
        </details>
        <div class="sort-c-pied">
          ${infini ? '' : `<label class="mini">Par jour <input type="text" inputmode="numeric" data-bind="sorts.${i}.max" data-recalc value="${esc(x.max)}" placeholder="—"></label>`}
          <button class="chip ${infini ? 'on' : ''}" data-action="sort-infini" data-idx="${i}" title="Utilisable sans limite" aria-pressed="${infini}">∞</button>
          ${max ? `<button class="btn" data-action="sort-use" data-idx="${i}" ${reste && ef === 'ok' ? '' : 'disabled'}>Lancer</button>${num(x.utilises) ? `<button class="lien" data-action="sort-annuler" data-idx="${i}">Annuler</button>` : ''}` : ''}
        </div>
      </div>`;
    }).join('')}</div>` : '<p class="empty">Aucun sort. Ajoute ceux de ta baguette dans l\'onglet Sorts.</p>'}

    ${(() => {
      /* Ce qui joue en permanence : pouvoirs de domaine sans compteur, incantation spontanée du prêtre… */
      const passifs = [];
      for (const d of e.domaines || []) { const dm = R.DOMAINES[d]; if (dm && !dm.usage) passifs.push([`Domaine ${dm.nom}`, dm.pouvoir]); }
      if (e.classes.pretre) passifs.push(['Incantation spontanée', `Tu peux sacrifier un sort préparé (hors domaine) pour lancer à la place un sort de soins du même niveau${(p.alignement || '').toLowerCase().includes('mauvais') ? ' (ou de blessure)' : ''}.`]);
      if (e.classes.moine) passifs.push(['Esquive totale', e.classes.moine >= 2 ? 'Aucun dégât si tu réussis un jet de Réflexes contre un effet qui en inflige la moitié.' : '']);
      const l = passifs.filter(x => x[1]);
      return l.length ? `<h4 class="type-action">Toujours actif <small>sans action</small></h4><div class="passifs">${l.map(([n, t]) => `<details class="passif"><summary>${esc(n)}</summary><p>${esc(t)}</p></details>`).join('')}</div>` : '';
    })()}
    ${resPar('autre').length ? `<h4>Autres capacités</h4><div class="ressources">${resPar('autre').map(r => compteur(p, r)).join('')}</div>` : ''}

    ${consommables.length ? `<h4>Consommables</h4><div class="consos">${consommables.map(({ it, i }) => `<div class="munition">
      <span><b>${esc(it.nom || 'Objet')}</b> <small>× ${esc(it.qte || 0)}</small>${it.effet ? `<br><small>${esc(it.effet)}</small>` : ''}</span>
      <button class="btn ghost" data-action="objet-use" data-idx="${i}" ${num(it.qte) > 0 ? '' : 'disabled'}>Utiliser</button></div>`).join('')}</div>` : ''}
  </section>`;
}

/* ===== Capacités expliquées concrètement ===== */
function explications(p, e) {
  const st = stats(p, e);
  const mn = infosMainsNues(p, e, st);
  const moine = e.moineCumul.ca || 0;
  return {
    'Bonus à la CA': `Sans rien faire, tu ajoutes ta Sagesse (${R.signe(Math.max(0, e.mods.sag))}) et ton bonus de moine (+${Math.floor(moine / 5)}) à ta CA. C'est déjà compté : ta CA est de ${st.ca}.`,
    'Déluge de coups': mn?.deluge ? `Au lieu d'attaquer une fois, tu frappes ${mn.deluge.liste.length} fois dans le même tour : jets pour toucher à ${R.attTxt(mn.deluge.liste)}, et ${mn.degats} dégâts par coup qui touche. Le malus${mn.deluge.pen ? ` de ${R.signe(mn.deluge.pen)}` : ''} est déjà inclus dans ces chiffres. Ça prend tout ton tour : tu restes sur place ou fais un pas de 1,5 m.` : null,
    'Combat à mains nues': mn ? `Tes poings et tes pieds sont des armes : ${R.signe(mn.toucher[0])} pour toucher, ${mn.degats} dégâts. Frapper sans arme ne provoque pas d'attaque d'opportunité.` : null,
    'Esquive totale': 'Quand un effet de zone (boule de feu, souffle…) permet un jet de Réflexes pour réduire les dégâts de moitié, et que tu le réussis, tu ne subis aucun dégât.',
    'Déplacement accéléré': `Tu cours plus vite : ta vitesse est de ${st.vitesse} m par action de mouvement (bonus compris).`,
    'Sérénité': '+2 à tes jets de sauvegarde contre les sorts qui jouent sur l\'esprit : charme, sommeil, peur…',
    'Frappe ki': 'Tes coups comptent comme des armes magiques : ils blessent normalement les créatures qui ne craignent que la magie.',
    'Chute ralentie': 'Si un mur est à portée de main pendant que tu tombes, une partie de la chute ne compte pas pour les dégâts.',
    'Pureté physique': 'Tu ne tombes plus malade (maladies normales).',
    'Plénitude physique': `Tu peux te soigner toi-même de ${2 * moine} PV par jour, en une ou plusieurs fois (compteur dans « En combat »).`,
    'Esquive surnaturelle': 'Même si tu rates ton jet de Réflexes contre un effet de zone, tu ne subis que la moitié des dégâts.',
    'Rage': 'Tu entres en fureur : plus fort et plus résistant, mais moins prudent (compteur dans « En combat »).',
    'Attaque sournoise': 'Quand l\'ennemi est pris en tenaille ou ne peut pas se défendre, tes attaques font des dégâts en plus.',
  };
}

function blocDomaines(e, sp) {
  if (!(e.domaines || []).length) return '<p class="hint">Domaines : à choisir dans la Progression, au niveau 1 de prêtre.</p>';
  const nivMax = sp ? Math.max(...sp.parJour.map(x => x.niv)) : 0;
  return `<div class="domaines-fiche">${e.domaines.map(id => { const d = R.DOMAINES[id]; return `<div class="domaine-carte">
    <div class="cap-tete"><b>Domaine : ${esc(d.nom)}</b></div>
    <p>${esc(d.pouvoir)}</p>
    <ol class="sorts-domaine">${d.sorts.map((x, n) => `<li class="${n + 1 <= nivMax ? 'accessible' : ''}">${sortDomaineHTML(x)}</li>`).join('')}</ol>
  </div>`; }).join('')}
  <p class="hint">Chaque jour, un sort de domaine en plus par niveau de sort accessible (en clair ci-dessus), choisi dans l'un des deux domaines.</p></div>`;
}

function ficheCapacitesLisible(p, e, valsClasses) {
  const race = e.race;
  const ex = explications(p, e);
  const raceBloc = race ? `<details class="cap-groupe cap-race"><summary><h4>Traits ${/^[AEIOUÉH]/.test(race.nom) ? 'd\'' : 'de '}${esc(race.nom.toLowerCase())} (${race.traits.length})</h4></summary>
    <div class="cap-cartes">${race.traits.map(([n, t]) => `<div class="cap-carte"><b>${esc(n)}</b><p>${esc(t)}</p></div>`).join('')}</div></details>` : '';
  const classes = Object.entries(e.classes).map(([id, k]) => {
    const cl = R.CLASSES[id];
    const vals = Object.fromEntries((valsClasses.find(x => x.id === id)?.vals || []));
    const apt = cl.aptitudes.filter(a => a.niv <= k && !/^Don supplémentaire$/.test(a.nom));
    const sp = sortsParJour(id, k, e);
    const vus = new Set();
    const cartes = apt.map(a => {
      const concret = ex[a.nom];
      const v = vals[a.nom] ?? (a.nom === 'Bonus à la CA' ? vals['Bonus de CA du moine'] : a.nom === 'Combat à mains nues' ? vals['Dégâts à mains nues'] : undefined);
      vus.add(a.nom); if (a.nom === 'Bonus à la CA') vus.add('Bonus de CA du moine'); if (a.nom === 'Combat à mains nues') vus.add('Dégâts à mains nues');
      return `<div class="cap-carte">
        <div class="cap-tete"><b>${esc(a.nom)}</b><small>niveau ${a.niv}</small></div>
        <p>${esc(concret || a.texte)}</p>
        ${concret ? `<details class="effet"><summary>Règle complète</summary><p>${esc(a.texte)}</p></details>` : ''}
        ${v != null && !concret ? `<p class="cap-valeur">Pour toi : <b>${esc(v)}</b></p>` : ''}
      </div>`;
    }).join('');
    const autres = Object.entries(vals).filter(([n]) => !vus.has(n) && n !== 'Déluge de coups');
    return `<div class="cap-groupe"><h4>${esc(cl.nom)} ${k}</h4>
      <div class="cap-cartes">${cartes}</div>
      ${autres.length ? `<dl class="valeurs">${autres.map(([n, v]) => `<dt>${esc(n)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${id === 'pretre' ? blocDomaines(e, sp) : ''}
      ${sp ? tableSorts(sp) : ''}
      <p class="hint">Maîtrises : ${esc(cl.maitrises)}</p>
    </div>`;
  }).join('');
  return `<section class="card"><h3>Capacités spéciales</h3>
    ${classes}${raceBloc}
    ${!race && !classes ? '<p class="empty">Choisis une race et coche tes niveaux pour voir les capacités apparaître ici.</p>' : ''}
    <h4>Autres capacités</h4>
    ${liste(p, 'capacites', [{ k: 'nom', l: 'Capacité' }, { k: 'description', l: 'Effet', type: 'area' }], 'Ajouter une capacité')}
  </section>`;
}

/* ===== Langues : seulement celles connues, avec un « + » ===== */
function blocLangues(p) {
  const mes = p.langues || [];
  const reste = R.LANGUES.filter(l => !mes.includes(l));
  return `<div class="f"><span class="lbl">Langues</span>
    <div class="chips">
      ${mes.map(l => `<span class="chip on">${esc(l)}<button class="chip-x" data-action="lang-del" data-l="${esc(l)}" aria-label="Retirer ${esc(l)}">✕</button></span>`).join('')}
      <button class="chip ajout" data-action="lang-plus" aria-expanded="${state.langPanel ? 'true' : 'false'}" aria-label="Ajouter une langue">+</button>
    </div>
    ${state.langPanel ? `<div class="lang-panel">
      <div class="chips">${reste.map(l => `<button class="chip" data-action="lang-add" data-l="${esc(l)}">${esc(l)}</button>`).join('')}</div>
      <div class="row"><input type="text" id="lang-autre" placeholder="Autre langue (campagne)" aria-label="Autre langue"><button class="btn ghost" data-action="lang-add-autre">Ajouter</button></div>
    </div>` : ''}
  </div>`;
}

/* ===== Espace MJ (données fictives pour l'instant) ===== */
const CODE_MJ_DEMO = 'givre-mj';
const DEMO_MJ = {
  initiative: [
    { nom: 'Élémental du sable', init: 17, pv: 26, pvMax: 26, ennemi: true },
    { nom: 'Régihus (éclaireur)', init: 12, pv: 11, pvMax: 11, ennemi: true },
    { nom: 'Régihus (archer)', init: 8, pv: 9, pvMax: 9, ennemi: true },
  ],
  rencontres: [
    { nom: 'Patrouille de Régihus aux portes de Marsember', fp: 3, notes: '4 Régihus (guerriers 1), 1 sergent (guerrier 3). Fouillent les sacs : toute baguette trouvée est confisquée.' },
    { nom: 'Le retour de l\'élémental', fp: 4, notes: 'Surgit du sable sur le passage des contrebandiers. Se souvient de Phyrra.' },
    { nom: 'Gideon Vane, l\'Herboriste Pâle', fp: 2, notes: 'Refuse de parler du poison tant que Pelagia ne nomme pas le commanditaire.' },
  ],
  butin: ['Potion de soins légers × 2', 'Carreaux d\'arbalète en argent × 10', '320 pièces d\'or', 'Lettre scellée aux armes des Régihus'],
  notes: 'La broche Blackthorn a été volée à la mère de Lyra il y a vingt ans. Les clous de girofle servent de monnaie d\'échange aux contrebandiers de Marsember.',
};
const XP_NIVEAU = n => n * (n - 1) / 2 * 1000;

function pageMJ() {
  if (false) {
    return `<div class="pagehead"><div><h1>Espace MJ</h1><p class="sub">Réservé au maître du jeu</p></div></div>
    <section class="card intro"><h3>Accès MJ</h3>
      <p>Saisis le code MJ pour accéder au tableau de bord : statistiques de tous les personnages, initiative, rencontres, notes secrètes.</p>
      <div class="row"><input type="password" id="code-mj" autocomplete="off" placeholder="Code MJ" aria-label="Code MJ"><button class="btn" data-action="mj-entrer">Entrer</button></div>
    </section>`;
  }
  const persos = db.personnages.filter(x => !enLigne() || x.publie);
  const cartes = persos.map(x => {
    const e = etat(x), st = stats(x, e);
    const comp = id => { const c = R.COMPETENCES.find(y => y.id === id); const v = x.comp?.[id] || {}; return num(v.rangs) + (c.car ? e.mods[c.car] : 0) + bonusComp(id, e) + num(v.divers); };
    return `<div class="mj-perso">
      <div class="mj-perso-tete">${x.portrait ? `<img src="${x.portrait}" alt="">` : '<span class="vide"></span>'}
        <div><b>${esc(x.nom)}</b><small>${esc([x.joueur, raceNom(x), classesTxt(e)].filter(Boolean).join(', '))}</small></div></div>
      <div class="mj-stats">
        <span>PV<b>${esc(x.pvMax || '—')}</b></span><span>CA<b>${st.ca}</b></span><span>Contact<b>${st.contact}</b></span><span>Dépourvu<b>${st.depourvu}</b></span>
        <span>Init<b>${R.signe(st.init)}</b></span><span>Vig<b>${R.signe(st.js.vig)}</b></span><span>Réf<b>${R.signe(st.js.ref)}</b></span><span>Vol<b>${R.signe(st.js.vol)}</b></span>
        <span>Détection<b>${R.signe(comp('detection'))}</b></span><span>Perception<b>${R.signe(comp('perception'))}</b></span><span>Psychologie<b>${R.signe(comp('psychologie'))}</b></span><span>Vitesse<b>${st.vitesse} m</b></span>
      </div>
      ${(x.etats || []).filter(et => et.actif !== false).length ? `<div class="mj-etats">${(x.etats || []).filter(et => et.actif !== false).map(et => `<div class="mj-etat ${gravite(et)}"><b>${esc(et.nom)}</b>${et.duree === 'permanent' ? ' <small>permanent</small>' : ''}${et.description ? `<p>${esc(et.description)}</p>` : ''}</div>`).join('')}</div>` : ''}
      ${(x.langues || []).length ? `<p class="hint">Langues : ${esc(x.langues.join(', '))}</p>` : ''}
    </div>`;
  }).join('');
  const ini = state.mjInit || (state.mjInit = [
    ...DEMO_MJ.initiative.map(c => ({ ...c })),
    ...persos.map(x => { const e = etat(x); return { nom: x.nom, init: 10 + stats(x, e).init, pv: num(x.pvMax), pvMax: num(x.pvMax), ennemi: false }; }),
  ].sort((a, b) => b.init - a.init));
  const tour = state.mjTour || 0;
  return `<div class="pagehead"><div><h1>Espace MJ</h1><p class="sub">Tableau de bord du maître du jeu</p></div>
    <button class="btn danger" data-action="mj-sortir">Quitter le mode MJ</button></div>

  <section class="card"><h3>Le groupe</h3>
    <p class="hint aide">Données réelles des fiches : idéal pour les jets secrets (Détection, Perception auditive, Psychologie) sans demander aux joueurs.</p>
    <div class="mj-persos">${cartes || '<p class="empty">Aucun personnage.</p>'}</div>
  </section>

  <section class="card"><h3>Combat en cours <span class="demo">exemple</span></h3>
    <ol class="mj-init">${ini.map((c, i) => `<li class="${i === tour % ini.length ? 'actif' : ''} ${c.ennemi ? 'ennemi' : ''}">
      <span class="mj-init-val">${c.init}</span><b>${esc(c.nom)}</b>
      <span class="mj-pv">${c.pvMax ? `<button class="icon" data-action="mj-pv" data-idx="${i}" data-d="-1" aria-label="Retirer 1 PV">−</button>${c.pv}/${c.pvMax}<button class="icon" data-action="mj-pv" data-idx="${i}" data-d="1" aria-label="Ajouter 1 PV">+</button>` : ''}</span>
    </li>`).join('')}</ol>
    <div class="btns"><button class="btn" data-action="mj-suivant">Tour suivant</button><span class="hint">Round ${Math.floor(tour / ini.length) + 1}</span></div>
  </section>

  <section class="card"><h3>Expérience <span class="demo">exemple</span></h3>
    <div class="mj-xp">${persos.map((x, i) => {
      const e = etat(x), niv = Math.max(1, e.niveau || 1), xp = XP_NIVEAU(niv) + (i * 370 + 450) % 1000 * niv;
      const prochain = XP_NIVEAU(niv + 1), pct = Math.min(100, Math.round((xp - XP_NIVEAU(niv)) / (prochain - XP_NIVEAU(niv)) * 100));
      return `<div><span>${esc(x.nom)} <small>niveau ${niv}</small></span><div class="barre"><span style="width:${pct}%"></span></div><small>${xp} / ${prochain} XP</small></div>`;
    }).join('') || '<p class="empty">Aucun personnage.</p>'}</div>
  </section>

  <section class="card"><h3>Rencontres préparées <span class="demo">exemple</span></h3>
    <div class="cap-cartes">${DEMO_MJ.rencontres.map(r => `<div class="cap-carte"><div class="cap-tete"><b>${esc(r.nom)}</b><small>FP ${r.fp}</small></div><p>${esc(r.notes)}</p></div>`).join('')}</div>
  </section>

  <section class="card"><h3>Butin à distribuer <span class="demo">exemple</span></h3>
    <ul class="changes">${DEMO_MJ.butin.map(b => `<li>${esc(b)}</li>`).join('')}</ul>
  </section>

  <section class="card"><h3>Notes secrètes <span class="demo">exemple</span></h3>
    <p>${esc(DEMO_MJ.notes)}</p>
  </section>`;
}

/* ===== La baguette du personnage ===== */
const BAGUETTE_SVG = `<svg viewBox="0 0 100 100" aria-hidden="true"><line x1="18" y1="86" x2="74" y2="26" stroke="#6B4E2C" stroke-width="5" stroke-linecap="round"/><line x1="18" y1="86" x2="74" y2="26" stroke="#B7935A" stroke-width="1.4" stroke-dasharray="3 6" stroke-linecap="round"/><path d="M78 10 L84 24 L78 40 L72 24Z" fill="#5E9ED6" transform="rotate(42 78 25)"/><circle cx="78" cy="23" r="13" fill="#9FD4F0" opacity=".18"/></svg>`;
function ficheEncycloBaguette(p) {
  return fichesToutes().find(f => f.type === 'objet' && norm(f.role) === norm('Baguette de ' + p.nom));
}
function carteBaguette(p) {
  const b = p.baguette || {};
  const mod = peutModifier(p);
  if (mod && state.editBaguette === p.id) {
    state.ctx = p;
    const options = (p.sorts || []).map(x => findSort(x.id)).filter(Boolean);
    const fe = ficheEncycloBaguette(p);
    return `<section class="card baguette en-edition"><h3>Baguette</h3>
      <div class="baguette-photo paysage">
        <button class="image-cadre" data-action="img-choisir" data-type="baguette" aria-label="${b.photo ? 'Changer' : 'Ajouter'} la photo de la baguette">${b.photo ? `<img src="${b.photo}" alt="">` : '<span>Ajouter une photo (format paysage)</span>'}</button>
        ${b.photo ? '<button class="lien" data-action="img-retirer" data-type="baguette">Retirer la photo</button>' : ''}
      </div>
      <div>
        <div class="grid">
          ${fi(p, 'baguette.nom', 'Nom de la baguette', { span: true, ph: 'Ex. : Brise-Roc' })}
          ${fi(p, 'baguette.longueur', 'Taille', { ph: '32 cm' })}${fi(p, 'baguette.poids', 'Poids', { ph: '120 g' })}
          ${fi(p, 'baguette.bois', 'Bois ou matière', { span: true, ph: 'Chaîne séculaire' })}
          ${fi(p, 'baguette.coeur', 'Cœur', { span: true, ph: 'Crin de licorne…' })}
          <label class="f span2"><span>Sort ancré en ce moment</span><select data-bind="baguette.sortAncre" data-rerender><option value="">— Aucun —</option>${options.map(s => `<option value="${s.id}" ${b.sortAncre === s.id ? 'selected' : ''}>${esc(s.nom)}</option>`).join('')}</select></label>
        </div>
      </div>
      ${ta(p, 'baguette.description', 'Description', { rows: 4, ph: 'Aspect, couleur, sensations quand on la tient…' })}
      ${ta(p, 'baguette.histoire', 'Histoire et légende', { rows: 5, ph: 'D\'où vient-elle ? Qui l\'a fabriquée ? Que raconte-t-on à son sujet ?' })}
      <label class="check"><input type="checkbox" data-bind="baguette.possedee" data-rerender ${b.possedee === false ? '' : 'checked'}> En sa possession (décoche si elle est perdue ou confisquée : ses sorts deviennent inutilisables)</label>
      <div class="btns">
        <button class="btn" data-action="baguette-fin">Terminé</button>
        ${fe ? `<button class="btn ghost" data-action="baguette-encyclo">Reprendre la fiche « ${esc(fe.nom)} » de l'encyclopédie</button>` : ''}
      </div>
    </section>`;
  }
  const sortA = b.sortAncre && findSort(b.sortAncre);
  const meta = [['Taille', b.longueur], ['Poids', b.poids], ['Bois', b.bois], ['Cœur', b.coeur]].filter(([, v]) => v);
  const vide = !b.nom && !b.description && !b.photo;
  return `<section class="card baguette"><h3>Baguette</h3>
    <div class="baguette-titre">
      <p class="recit-num">Relique de l'ancien monde</p>
      <h2 class="baguette-nom">${esc(b.nom || 'Baguette sans nom')}</h2>
      <div class="ornement" aria-hidden="true"><span></span></div>
    </div>
    <div class="baguette-photo paysage">${b.photo ? `<img src="${b.photo}" alt="Baguette ${esc(b.nom || '')}">` : `<div class="baguette-vide">${BAGUETTE_SVG}</div>`}</div>
    ${meta.length || sortA ? `<div class="baguette-infos">
      ${meta.length ? `<dl class="baguette-meta">${meta.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>` : ''}
      ${sortA ? `<p class="baguette-sort">Sort ancré : <a href="#/sort/${sortA.id}">${esc(sortA.nom)}</a></p>` : ''}
    </div>` : ''}
    ${b.possedee === false ? '<p class="focal-alerte centre">⚠ Baguette perdue : les sorts qui lui sont reliés sont inutilisables.</p>' : ''}
    ${b.description ? `<div class="recit-texte baguette-texte">${formaterRecit(b.description)}</div>` : ''}
    ${b.histoire ? `<details class="effet baguette-histoire" open><summary>Histoire et légende</summary><div class="recit-texte">${formaterRecit(b.histoire)}</div></details>` : ''}
    ${vide ? '<p class="empty">Décris ici ta baguette : son nom, sa photo, sa taille, son histoire.</p>' : ''}
    ${mod ? '<button class="btn ghost" data-action="baguette-edit">Modifier la baguette</button>' : ''}
  </section>`;
}

/* ===== Vitalité : PV actuels, dés de vie, rations ===== */
/* « 2d8 » ou « 1d8+2d10 » → nombre de dés */
const nbDesVie = txt => (String(txt || '').match(/(\d+)\s*d\s*\d+/gi) || []).reduce((t, m) => t + parseInt(m, 10), 0);
const pvActuels = p => (p.pvActuels === '' || p.pvActuels == null) ? num(p.pvMax) : num(p.pvActuels);
const rationDefaut = p => (p.equipement || []).find(it => it.id === p.rationDefaut && it.cat === 'ration')
  || (p.equipement || []).find(it => it.cat === 'ration');
const nbRations = p => (p.equipement || []).filter(it => it.cat === 'ration').reduce((t, it) => t + num(it.qte), 0);

function barrePV(p) {
  const max = num(p.pvMax), act = pvActuels(p);
  const pct = max ? Math.max(0, Math.min(100, Math.round(act / max * 100))) : 0;
  const etat = act <= 0 ? 'ko' : pct <= 25 ? 'critique' : pct <= 50 ? 'blesse' : 'ok';
  return { max, act, pct, etat };
}

function carteVitalite(p) {
  const mod = peutModifier(p);
  const { max, act, pct, etat } = barrePV(p);
  const nbDv = nbDesVie(p.dv), dvRestants = Math.max(0, nbDv - num(p.dvUtilises));
  const r = rationDefaut(p), total = nbRations(p);
  return `<section class="card vitalite"><h3>Vitalité</h3>
    ${!p.dv ? `<p class="alerte-obligatoire">À remplir : tes <b>dés de vie</b> (ex. 2d8 pour un moine de niveau 2).</p>` : ''}
    ${!max ? '<p class="alerte-obligatoire">À remplir : tes <b>points de vie max</b>, donnés par le MJ.</p>' : ''}
    <div class="pv-bloc pv-${etat}">
      ${mod ? '<button class="pv-btn" data-action="pv-delta" data-d="-1" aria-label="Perdre 1 PV">−</button>' : ''}
      <button class="pv-val" ${mod ? 'data-action="pv-saisir"' : 'disabled'} aria-label="Points de vie actuels">
        <b>${max || act ? act : '—'}</b><span>/ ${max || '—'} PV</span>
      </button>
      ${mod ? '<button class="pv-btn" data-action="pv-delta" data-d="1" aria-label="Récupérer 1 PV">+</button>' : ''}
    </div>
    <div class="pv-barre"><span style="width:${pct}%"></span></div>
    ${act <= 0 && max ? `<p class="alerte-obligatoire">${act <= -10 ? 'Mort.' : act < 0 ? 'Mourant : perd 1 PV par round tant qu\'il n\'est pas stabilisé.' : 'Hors de combat : une seule action par tour.'}</p>` : ''}
    <div class="vit-grille">
      ${fi(p, 'pvMax', 'PV max', { type: 'number', recalc: true })}
      ${fi(p, 'dv', 'Dés de vie', { ph: '2d8', recalc: true })}
      <div class="f"><span>Dés de vie disponibles</span>
        <div class="dv-ligne"><b>${nbDv ? `${dvRestants} / ${nbDv}` : '—'}</b>
        ${mod && dvRestants ? '<button class="btn ghost" data-action="dv-utiliser">Utiliser un dé</button>' : ''}</div></div>
      <div class="f"><span>Rations</span>
        <div class="dv-ligne"><b>${total}</b><small>${r ? `par défaut : ${esc(r.nom || 'ration')}` : 'aucune : ajoute-les dans l\'Inventaire'}</small></div></div>
    </div>
    <p class="hint aide">Les PV et les dés de vie sont rechargés par le MJ avec « Jour suivant ». Il voit tes PV en direct et peut les ajuster.</p>
  </section>`;
}

/* ===== Personnages du MJ : version publique filtrée =====
   « Membre du groupe » : joué par le MJ comme un personnage joueur (rations, jour suivant,
   combats, bourse, marché), mais avec une fiche en partie secrète. */
const estMembre = x => !!x && (!x.pnjMJ || !!x.membreGroupe);
const pnjComplet = x => x.pnjMJ && !x._public;
const VISIBILITE_SECTIONS = [
  ['portrait', 'Portrait et emblème'], ['classes', 'Race et classe'], ['niveau', 'Niveau'], ['apparence', 'Apparence et historique'],
  ['etats', 'États et blessures'], ['pv', 'Points de vie'], ['caracs', 'Caractéristiques'], ['combat', 'Défense et attaques'],
  ['competences', 'Compétences'], ['dons', 'Dons et capacités'], ['sorts', 'Sorts'], ['baguette', 'Baguette'],
  ['langues', 'Langues'], ['bourse', 'Bourse'],
];
function projectionPublique(p) {
  const v = p.visibilite || {};
  const pub = { id: p.id, nom: p.nom, pnjMJ: true, visibilite: v, joueur: 'MJ', publie: true, schema: 2, maj: p.maj };
  if (v.portrait !== false) { pub.portrait = p.portrait; pub.embleme = p.embleme; }
  if (v.classes) { pub.race = p.race; pub.raceAutre = p.raceAutre; pub.alignement = p.alignement; pub.classesNoms = Object.keys(etat(p).classes).map(id => R.CLASSES[id].nom); }
  if (v.niveau) pub.progression = p.progression;
  if (v.apparence) pub.apparence = p.apparence;
  if (v.etats) pub.etats = p.etats;
  if (v.pv) { pub.pvMax = p.pvMax; pub.pvActuels = p.pvActuels; }
  if (v.caracs || v.combat || v.competences) pub.caracs = p.caracs;
  if (v.combat) { pub.ajust = p.ajust; pub.progression = p.progression; pub.race = p.race; }
  if (v.competences) { pub.comp = p.comp; pub.compPerso = p.compPerso; }
  if (v.dons) { pub.progression = p.progression; pub.donsSupp = p.donsSupp; pub.dons = p.dons; pub.capacites = p.capacites; }
  if (v.sorts) pub.sorts = p.sorts;
  if (v.baguette) pub.baguette = p.baguette;
  if (v.langues) pub.langues = p.langues;
  if (v.bourse) pub.argent = p.argent;
  pub.membreGroupe = !!p.membreGroupe;
  pub.equipement = (p.equipement || []).filter(it => it.visibleJoueurs);
  return pub;
}

function carteVisibilite(p) {
  const v = p.visibilite || {};
  return `<section class="card visibilite"><h3>Visible des joueurs</h3>
    <p class="hint aide">Personnage du MJ : les joueurs ne voient que ce qui est coché ici, plus les objets marqués « visible » dans l'inventaire. Le reste n'est jamais envoyé à leurs appareils.</p>
    <label class="check membre"><input type="checkbox" data-bind="membreGroupe" data-rerender ${p.membreGroupe ? 'checked' : ''}> <span><b>Membre du groupe</b> : joué par le MJ comme un personnage joueur (rations, jour suivant, combats, coffre commun, marché)</span></label>
    ${p.membreGroupe ? '' : fi(p, 'xp', 'Expérience de ce personnage (visible du MJ seulement)', { type: 'number' })}
    <div class="vis-grille">${VISIBILITE_SECTIONS.map(([k, l]) => `<label class="check"><input type="checkbox" data-bind="visibilite.${k}" data-rerender ${(k === 'portrait' ? v[k] !== false : v[k]) ? 'checked' : ''}> ${l}</label>`).join('')}</div>
  </section>`;
}

/* Ce que voit un joueur d'un personnage du MJ */
function pagePersoPublic(p) {
  const v = p.visibilite || {};
  const e = etat(p), st = stats(p, e);
  const items = p.equipement || [];
  const sorts = (p.sorts || []).map(x => findSort(x.id)).filter(Boolean);
  const bloc = (titre, html) => html ? `<section class="card"><h3>${titre}</h3>${html}</section>` : '';
  return `
    <div class="pagehead"><div class="titre-perso">
      <div class="avatar">${p.portrait ? `<img src="${p.portrait}" alt="Portrait">` : '<span class="vide"></span>'}${p.embleme ? `<img class="embleme-avatar" src="${p.embleme}" alt="">` : ''}</div>
      <div><h1>${esc(p.nom || 'Inconnu')}</h1><p class="sub">${esc([v.classes ? raceNom(p) : '', v.classes ? (v.niveau ? classesTxt(e) : (p.classesNoms || []).join(' / ')) : (v.niveau && e.niveau ? 'Niveau ' + e.niveau : '')].filter(Boolean).join(', ') || 'Personnage du MJ')}</p></div>
    </div></div>
    ${v.etats ? puceEtats(p) : ''}
    <p class="hint confidentiel">Fiche confidentielle : le MJ ne montre qu'une partie des informations.</p>
    ${v.pv ? (b => `<section class="card"><h3>Points de vie</h3><p class="pv-public pv-${b.etat}"><b>${b.act}</b> / ${b.max || '—'} PV</p><div class="pv-barre"><span style="width:${b.pct}%"></span></div></section>`)(barrePV(p)) : ''}
    ${bloc('Apparence et historique', v.apparence && p.apparence ? `<div class="recit-texte">${formaterRecit(p.apparence)}</div>` : '')}
    ${v.caracs ? bloc('Caractéristiques', `<div class="caracs">${R.CARACS.map(c => `<div class="carac"><b>${c.l}</b><span class="val-pub">${e.car[c.k] ?? '—'}</span><span class="mod">${e.car[c.k] == null ? '—' : R.signe(e.mods[c.k])}</span></div>`).join('')}</div>`) : ''}
    ${v.combat ? bloc('Défense et attaques', `<div class="stats">${[['CA', st.ca], ['Contact', st.contact], ['Pris au dépourvu', st.depourvu], ['Initiative', R.signe(st.init)], ['Vigueur', R.signe(st.js.vig)], ['Réflexes', R.signe(st.js.ref)], ['Volonté', R.signe(st.js.vol)], ['BBA', R.attTxt(st.att)]].map(([l, x]) => `<div class="stat"><span>${l}</span><b>${x}</b></div>`).join('')}</div>`) : ''}
    ${v.etats && (p.etats || []).length ? bloc('États et blessures', (p.etats || []).filter(x => x.actif !== false).map(x => `<div class="etat ${gravite(x)}"><div class="etat-tete"><b>${esc(x.nom)}</b></div>${x.description ? `<p>${esc(x.description)}</p>` : ''}</div>`).join('')) : ''}
    ${v.baguette && p.baguette ? bloc('Baguette', `<p class="baguette-nom">${esc(p.baguette.nom || '')}</p>${p.baguette.photo ? `<img class="photo-apercu" src="${p.baguette.photo}" alt="">` : ''}${p.baguette.description ? `<div class="recit-texte">${formaterRecit(p.baguette.description)}</div>` : ''}`) : ''}
    ${v.sorts && sorts.length ? bloc('Sorts connus', `<ul class="changes">${sorts.map(s => `<li><a href="#/sort/${s.id}">${esc(s.nom)}</a></li>`).join('')}</ul>`) : ''}
    ${v.dons ? bloc('Dons', e.donsListe.map(x => `<p><b>${esc(R.DON[x.id].nom)}</b></p>`).join('') || '<p class="empty">Aucun.</p>') : ''}
    ${v.langues && (p.langues || []).length ? bloc('Langues', `<p>${esc(p.langues.join(', '))}</p>`) : ''}
    ${bloc('Ce que l\'on voit de son équipement', items.length ? `<div class="objets">${items.map((it, i) => ligneObjetVue(it, i, items, false)).join('')}</div>` : '<p class="empty">Rien de visible.</p>')}
    ${v.bourse ? bloc('Bourse', `<p>${esc(bourseTxt(p))}</p>`) : ''}`;
}

/* ===== Espace MJ réel ===== */
const estMJ = () => !!db.codeMJ;

async function chargerPersosMJ() {
  if (!enLigne() || !estMJ()) return;
  try {
    let liste;
    let vers = null;
    try { vers = (await rpc('mj_versions', { p_code: db.codeMJ }))?.persos_mj; } catch (e) { /* base pas encore en v8 */ }
    if (vers) {
      const connus = versions('persosMJcomplets');
      const ids = Object.keys(vers).filter(id => { const l = findPerso(id); return connus[id] !== vers[id] || !l || l._public; });
      liste = ids.length ? await rpc('lire_persos_mj_ids', { p_code: db.codeMJ, p_ids: ids }) || [] : [];
      db.versions.persosMJcomplets = { ...vers };
    } else liste = await rpc('lire_persos_mj', { p_code: db.codeMJ }) || [];
    const attente = new Set(db.enAttente || []);
    for (const d of liste) {
      if (attente.has(d.id)) continue;
      const i = db.personnages.findIndex(x => x.id === d.id);
      /* La version complète remplace entièrement la version publique reçue avant */
      const complet = { ...d, pnjMJ: true, publie: true, _public: false };
      if (i >= 0) { const o = db.personnages[i]; for (const k of Object.keys(o)) delete o[k]; Object.assign(o, complet); }
      else db.personnages.push(complet);
    }
    saveNow();
  } catch (e) {
    console.warn('Personnages du MJ indisponibles', e);
  }
}

/* Repport des valeurs changées par le MJ (PV, rations, jour suivant) dans une fiche modifiée localement */
function fusionMJ(local, srv) {
  local.pvActuels = srv.pvActuels;
  local.dvUtilises = srv.dvUtilises;
  local.compteurs = srv.compteurs || {};
  for (const s of local.sorts || []) {
    const t = (srv.sorts || []).find(x => x.id === s.id);
    if (t) s.utilises = t.utilises;
  }
  for (const it of local.equipement || []) {
    if (it.cat !== 'ration') continue;
    const t = (srv.equipement || []).find(x => x.id === it.id);
    if (t) it.qte = t.qte;
  }
  if (srv.argent) local.argent = srv.argent;
  /* Objets donnés par le MJ depuis la dernière synchronisation */
  const ids = new Set((local.equipement || []).map(x => x.id));
  const recus = (srv.equipement || []).filter(x => x.donMJ && num(x.donMJ) > num(local.mjMaj) && !ids.has(x.id));
  if (recus.length) local.equipement = [...(local.equipement || []), ...recus];
  /* Champs modifiés par le MJ depuis la dernière synchronisation (CA, Constitution, niveaux…) */
  for (const [chemin, t] of Object.entries(srv.mjChamps || {})) {
    if (num(t) > num((local.mjChamps || {})[chemin])) { try { setP(local, chemin, getP(srv, chemin)); } catch (e) { /* chemin disparu */ } }
  }
  local.mjChamps = { ...(local.mjChamps || {}), ...(srv.mjChamps || {}) };
  if (srv.progression) for (const l of local.progression || []) { const t = srv.progression.find(x => x.niveau === l.niveau); if (t) { l.atteint = t.atteint; l.augmentApplique = t.augmentApplique; } }
  local.mjMaj = srv.mjMaj;
}

function majLocaleJourSuivant(p) {
  p.compteurs = {};
  (p.sorts || []).forEach(x => { x.utilises = 0; });
  p.pvActuels = p.pvMax;
  p.dvUtilises = 0;
}
function majLocaleRation(p) {
  const r = rationDefaut(p);
  if (r && num(r.qte) > 0) { r.qte = String(num(r.qte) - 1); return true; }
  return false;
}

function pageMJReelle() {
  if (!estMJ()) {
    return `<div class="pagehead"><div><h1>Espace MJ</h1><p class="sub">Réservé au maître du jeu</p></div></div>
    <section class="card intro"><h3>Accès MJ</h3>
      <p>Saisis le code MJ pour accéder au tableau de bord : points de vie et statistiques de tous les personnages, rations, jour suivant, personnages du MJ.</p>
      <div class="row"><input type="password" id="code-mj" autocomplete="off" placeholder="Code MJ" aria-label="Code MJ"><button class="btn" data-action="mj-entrer">Entrer</button></div>
    </section>`;
  }
  const joueurs = db.personnages.filter(x => estMembre(x) && !x._public && (!enLigne() || x.publie));
  const pnj = db.personnages.filter(x => pnjComplet(x) && !x.membreGroupe);
  /* Le groupe : les personnages des joueurs, puis ceux du MJ (version complète) */
  const cartes = [...joueurs, ...pnj].map(x => {
    const e = etat(x), st = stats(x, e), b = barrePV(x);
    const comp = id => { const c = R.COMPETENCES.find(y => y.id === id); const v = x.comp?.[id] || {}; return num(v.rangs) + (c.car ? e.mods[c.car] : 0) + bonusComp(id, e) + num(v.divers); };
    const r = rationDefaut(x), nbDv = nbDesVie(x.dv);
    return `<div class="mj-perso">
      <div class="mj-perso-tete">${x.portrait ? `<img src="${x.portrait}" alt="">` : '<span class="vide"></span>'}
        <div><b>${esc(x.nom)}</b><small>${esc([x.pnjMJ ? '' : x.joueur, raceNom(x), classesTxt(e)].filter(Boolean).join(', '))}</small></div>
        ${x.pnjMJ ? `<a class="tag-cat tag-mj" href="#/perso/${x.id}/fiche">${x.membreGroupe ? 'Joué par le MJ' : 'Personnage du MJ'}</a>` : ''}
        <a class="btn ghost tiroir-btn" href="#/perso/${x.id}/fiche" aria-label="Fiche de ${esc(x.nom)}" title="Ouvrir la fiche">📜</a>
        <button class="btn ghost tiroir-btn" data-action="mj-tiroir" data-id="${x.id}" aria-label="Équipement porté par ${esc(x.nom)}">🎒</button></div>
      <div class="mj-pv pv-${b.etat}">
        <button class="pv-btn" data-action="mj-pvj" data-id="${x.id}" data-d="-5" aria-label="−5 PV">−5</button>
        <button class="pv-btn" data-action="mj-pvj" data-id="${x.id}" data-d="-1" aria-label="−1 PV">−1</button>
        <span class="mj-pv-val"><b>${b.max || b.act ? b.act : '—'}</b> / ${b.max || '—'} PV</span>
        <button class="pv-btn" data-action="mj-pvj" data-id="${x.id}" data-d="1" aria-label="+1 PV">+1</button>
        <button class="pv-btn" data-action="mj-pvj" data-id="${x.id}" data-d="5" aria-label="+5 PV">+5</button>
      </div>
      <div class="pv-barre"><span style="width:${b.pct}%"></span></div>
      <div class="mj-stats">
        <span>CA<b>${st.ca}</b></span><span>Contact<b>${st.contact}</b></span><span>Dépourvu<b>${st.depourvu}</b></span><span>Init<b>${R.signe(st.init)}</b></span>
        <span>Vig<b>${R.signe(st.js.vig)}</b></span><span>Réf<b>${R.signe(st.js.ref)}</b></span><span>Vol<b>${R.signe(st.js.vol)}</b></span><span>Vitesse<b>${st.vitesse} m</b></span>
        <span>Détection<b>${R.signe(comp('detection'))}</b></span><span>Perception<b>${R.signe(comp('perception'))}</b></span><span>Psychologie<b>${R.signe(comp('psychologie'))}</b></span>
        <span>Dés de vie<b>${nbDv ? `${Math.max(0, nbDv - num(x.dvUtilises))}/${nbDv}` : '<i class="manque">?</i>'}</b></span>
      </div>
      ${!estMembre(x) ? '' : `<p class="hint mj-rations">Rations : <b>${nbRations(x)}</b>${r ? ` (par défaut : ${esc(r.nom || 'ration')} × ${esc(r.qte || 0)})` : ' <span class="manque">aucune ration par défaut</span>'}</p>`}
      ${(x.etats || []).filter(et => et.actif !== false).length ? `<div class="mj-etats">${(x.etats || []).filter(et => et.actif !== false).map(et => `<div class="mj-etat ${gravite(et)}"><b>${esc(et.nom)}</b>${et.duree === 'permanent' ? ' <small>permanent</small>' : ''}${et.description ? `<p>${esc(et.description)}</p>` : ''}</div>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
  return `<div class="pagehead"><div><h1>Espace MJ</h1><p class="sub">Jour ${esc(db.jour || 1)} de l'aventure${state.persosCharges ? `, mis à jour à ${new Date(state.persosCharges).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</p></div>
    <button class="btn danger" data-action="mj-sortir">Quitter le mode MJ</button></div>

  <section class="card mj-actions"><h3>Actions de groupe</h3>
    <div class="btns">
      <button class="btn" data-action="mj-ration">🍞 Ration consommée</button>
      <button class="btn" data-action="mj-jour">☀ Jour suivant</button>
    </div>
    <p class="hint aide"><b>Ration consommée</b> retire une ration (celle choisie par défaut) à chaque joueur. <b>Jour suivant</b> rend à tous leurs PV max, leurs dés de vie, leurs sorts et leurs capacités du jour.</p>
  </section>

  <section class="card"><h3>Le groupe</h3>
    <p class="hint aide">Points de vie en direct (actualisés toutes les 15 secondes), personnages des joueurs puis personnages du MJ. Les boutons modifient directement la fiche.</p>
    <div class="mj-persos">${cartes || '<p class="empty">Aucun personnage joueur.</p>'}</div>
  </section>

  <section class="card"><h3>Personnages du MJ</h3>
    <p class="hint aide">Visibles dans « Personnages », mais confidentiels : tu choisis sur chaque fiche ce que les joueurs peuvent voir. Coche « Membre du groupe » sur la fiche d'un personnage que tu joues dans le groupe : il compte alors partout comme un personnage joueur.</p>
    ${db.personnages.filter(pnjComplet).length ? `<div class="fiches">${db.personnages.filter(pnjComplet).map(x => { const b = barrePV(x); return `<a class="fiche-carte" href="#/perso/${x.id}/fiche"><span class="fiche-carte-tete"><b>${esc(x.nom)}</b><span class="statut-fiche">${b.max ? `${b.act}/${b.max} PV` : 'PNJ'}</span></span><small>${esc([raceNom(x), classesTxt(etat(x))].filter(Boolean).join(', ') || 'À compléter')}</small></a>`; }).join('')}</div>` : '<p class="empty">Aucun pour l\'instant.</p>'}
    <button class="btn ghost" data-action="mj-nouveau-perso" style="margin-top:.6rem">+ Créer un personnage MJ</button>
  </section>

  ${pageMJ().split('<section class="card"><h3>Combat en cours')[1] ? '<section class="card"><h3>Combat en cours' + pageMJ().split('<section class="card"><h3>Combat en cours')[1] : ''}`;
}

/* ===== Données de préparation du MJ (privées) ===== */
const MJ_DEFAUT = () => ({ xp: { valeur: 0 }, pnj: [], combats: [], combat: null, objets: [], notes: '' });
const mjd = () => (db.mjData = { ...MJ_DEFAUT(), ...(db.mjData || {}) });
const mjAttente = new Set();
let mjTimer;
function saveMJ(cle) {
  saveNow();
  if (!enLigne() || !estMJ()) return;
  mjAttente.add(cle);
  clearTimeout(mjTimer);
  mjTimer = setTimeout(envoyerMJ, 800);
}
async function envoyerMJ() {
  for (const cle of [...mjAttente]) {
    try {
      let local = mjd()[cle] ?? null;
      if (Array.isArray(local)) {
        let srv = null;
        try { srv = (await rpc('mj_lire_cles', { p_code: db.codeMJ, p_cles: [cle] }) || {})[cle]; } catch (e) { /* base pas encore en v8 */ }
        if (Array.isArray(srv) && local.length < srv.length - 1) {
          /* l'appareil a une liste incomplète : on garde tout ce qui est dans la base, plus les ajouts de l'appareil */
          const ids = new Set(srv.map(x => x && x.id));
          local = [...srv, ...local.filter(x => !ids.has(x && x.id))];
          mjd()[cle] = local; saveNow(); render();
          toast(`Liste « ${cle} » reprise depuis la base (${srv.length} éléments retrouvés)`);
        }
      }
      await rpc('mj_ecrire', { p_code: db.codeMJ, p_cle: cle, p_data: local });
      mjAttente.delete(cle);
    } catch (e) {
      statutSync('Préparation MJ non envoyée : ' + e.message, true);
      return;
    }
  }
}
async function chargerMJ() {
  if (!enLigne() || !estMJ()) return;
  try {
    const videLocal = !chargerMJ.fait || !db.mjData || !Object.keys(db.mjData).some(k => k.startsWith('session:') || (Array.isArray(db.mjData[k]) && db.mjData[k].length));
    const m = mjd();
    let v = null;
    try { v = await rpc('mj_versions', { p_code: db.codeMJ }); } catch (e) { /* base pas encore en v8 */ }
    if (!v) {
      const d = await rpc('mj_lire', { p_code: db.codeMJ }) || {};
      for (const [k, x] of Object.entries(d)) if (!mjAttente.has(k)) m[k] = x;
      saveNow(); return;
    }
    const connus = versions('mj');
    const serveur = v.donnees || {};
    const cles = Object.keys(serveur).filter(k => !mjAttente.has(k) && (videLocal || connus[k] !== serveur[k] || !(k in m)));
    if (cles.length) {
      const d = await rpc('mj_lire_cles', { p_code: db.codeMJ, p_cles: cles }) || {};
      for (const [k, x] of Object.entries(d)) {
        const loc = m[k];
        if (Array.isArray(loc) && Array.isArray(x) && loc.length > x.length + 1 && !(state.mjConflits || {})[k]) {
          state.mjConflits = { ...(state.mjConflits || {}), [k]: true };
          const garder = confirm(`Cet appareil contient ${loc.length} élément(s) dans « ${k} », la base seulement ${x.length}.\n\nOK : garder ceux de cet appareil (et ajouter ceux de la base).\nAnnuler : prendre la version de la base.`);
          if (garder) { const ids = new Set(loc.map(y => y && y.id)); m[k] = [...loc, ...x.filter(y => !ids.has(y && y.id))]; saveMJ(k); continue; }
        }
        m[k] = x;
      }
    }
    /* Sessions supprimées depuis un autre appareil */
    for (const k of Object.keys(m)) if (k.startsWith('session:') && !(k in serveur) && !mjAttente.has(k) && k in connus) delete m[k];
    db.versions.mj = { ...serveur };
    chargerMJ.fait = true;
    db.versions.persosMJ = v.persos_mj || {};
    saveNow();
  } catch (e) { console.warn('Préparation MJ indisponible (base pas encore en v6 ?)', e); }
}

/* Expérience commune du groupe (table 3.5 : niveau n à n(n−1)/2 × 1000 XP) */
function niveauXP(xp) { let n = 1; while (XP_NIVEAU(n + 1) <= xp) n++; return n; }
function carteXP() {
  const xp = num(mjd().xp.valeur), n = niveauXP(xp);
  const bas = XP_NIVEAU(n), haut = XP_NIVEAU(n + 1);
  const pct = Math.round((xp - bas) / (haut - bas) * 100);
  return `<section class="card"><h3>Expérience du groupe</h3>
    <p class="xp-ligne"><b>${xp.toLocaleString('fr-FR')} XP</b> <span>niveau ${n}, prochain niveau à ${haut.toLocaleString('fr-FR')} XP</span></p>
    <div class="barre xp"><span style="width:${pct}%"></span></div>
    <div class="row xp-actions">
      <input type="text" inputmode="numeric" id="xp-gain" placeholder="XP gagnés (ex. 450)" aria-label="XP gagnés">
      <button class="btn" data-action="mj-xp-ajouter">Ajouter</button>
      <button class="lien" data-action="mj-xp-fixer">Fixer le total…</button>
    </div>
    <p class="hint">Une seule barre pour tout le groupe. Les joueurs ne la voient pas.</p>
    ${(() => {
      const membres = db.personnages.filter(x => !x._public && estMembre(x) && (!enLigne() || x.publie || x.pnjMJ));
      const lignes = membres.map(x => {
        const prog = x.progression || [];
        const atteints = prog.filter(l => l.atteint).length;
        const prochain = prog.find(l => !l.atteint);
        if (atteints >= n) return `<li><b>${esc(x.nom)}</b> : niveau ${atteints} ✓</li>`;
        if (!prochain || !prochain.classe) return `<li><b>${esc(x.nom)}</b> : niveau ${atteints}, <span class="manque">niveau ${atteints + 1} pas encore préparé</span></li>`;
        return `<li><b>${esc(x.nom)}</b> : niveau ${atteints} → <b>${prochain.niveau}</b> (${esc(R.CLASSES[prochain.classe]?.nom || prochain.classe)}) ${prochain.pret ? '<span class="tag-cat pret">fiche prête</span>' : '<span class="tag-cat">en préparation</span>'}
          <button class="btn petit" data-action="mj-niveau-valider" data-id="${x.id}">Valider le niveau ${prochain.niveau}</button></li>`;
      });
      const prets = membres.filter(x => (x.progression || []).filter(l => l.atteint).length < n && (x.progression || []).find(l => !l.atteint)?.pret);
      return membres.length ? `<h4>Passage de niveau</h4><ul class="niveaux-groupe">${lignes.join('')}</ul>
        ${prets.length > 1 ? `<button class="btn" data-action="mj-niveau-tous">Valider pour les ${prets.length} personnages prêts</button>` : ''}
        <p class="hint aide">Les joueurs préparent leur prochain niveau dans la Progression ; tu le valides ici quand l'XP du groupe l'autorise.</p>` : '';
    })()}
  </section>`;
}
function validerNiveau(x) {
  const l = (x.progression || []).find(y => !y.atteint);
  if (!l || !l.classe) return false;
  l.atteint = true; appliquerAugment(x, l);
  const i = x.progression.indexOf(l);
  x.mjChamps = { ...(x.mjChamps || {}), [`progression.${i}.atteint`]: Date.now(), ...(l.augmentApplique ? { [`caracs.${l.augmentApplique}.val`]: Date.now() } : {}) };
  x.mjMaj = Date.now(); x.maj = Date.now();
  saveNow(); persoModifie(x);
  return l.niveau;
}

/* ===== Bestiaire : créatures du SRD 3.5 traduites, à ajouter en un geste aux PNJ préparés ===== */
let BESTIAIRE = null;
async function chargerBestiaire() {
  if (BESTIAIRE) return BESTIAIRE;
  try {
    const r = await fetch('bestiaire.json');
    BESTIAIRE = await r.json();
  } catch (e) { BESTIAIRE = { creatures: [], rappels: {} }; toast('Bestiaire indisponible hors connexion (ouvre-le une fois en ligne).'); }
  return BESTIAIRE;
}
const FILTRES_FP = [['', 'Tous les FP'], ['0-1', 'FP 1 ou moins'], ['2-2', 'FP 2'], ['3-3', 'FP 3'], ['4-4', 'FP 4'], ['5-5', 'FP 5']];
function creaturesFiltrees() {
  if (!BESTIAIRE) return [];
  const q = norm(state.bestQ || '').trim();
  const [a, b] = (state.bestFP || '').split('-').map(Number);
  return BESTIAIRE.creatures.filter(c =>
    (!state.bestFP || (c.fpN >= (a === 0 ? 0 : a) && c.fpN <= b)) &&
    (!state.bestType || c.typeBase === state.bestType) &&
    (!q || norm(c.nom + ' ' + c.vo + ' ' + c.type + ' ' + c.env).includes(q)))
    .sort((x, y) => x.fpN - y.fpN || x.nom.localeCompare(y.nom, 'fr'));
}
function ficheCreature(c) {
  const ligne = (t, v) => v && v !== '—' ? `<div class="bloc-stat"><span>${t}</span><div>${esc(v)}</div></div>` : '';
  const m = mjd();
  return `<div class="creature-fiche">
    <p class="creature-type">${esc(c.type)} · FP ${esc(c.fp)} · ${esc(c.align)}</p>
    <div class="creature-chiffres">
      <span><b>${c.pv ?? '—'}</b> PV <small>${esc(c.dv)}</small></span>
      <span><b>${c.caN ?? '—'}</b> CA</span>
      <span><b>${esc(c.init)}</b> init.</span>
      <span><b>${esc(c.bba)}</b> BBA · lutte ${esc(c.lutte)}</span>
    </div>
    ${ligne('Classe d\'armure', c.ca)}
    ${ligne('Vitesse', c.vitesse)}
    ${ligne('Attaque', c.attaque)}
    ${ligne('Attaque à outrance', c.outrance)}
    ${ligne('Espace / allonge', c.espace)}
    ${ligne('Attaques spéciales', c.attSpe)}
    ${ligne('Particularités', c.qualSpe)}
    ${ligne('Sauvegardes', c.js)}
    ${ligne('Caractéristiques', c.caracs)}
    ${ligne('Compétences', c.comp)}
    ${ligne('Dons', c.dons)}
    ${ligne('Environnement', c.env)}
    ${ligne('Organisation', c.org)}
    ${ligne('Trésor', c.tresor)}
    ${ligne('Évolution', c.avancement)}
    ${c.pouvoirs.length ? `<h4>Pouvoirs</h4>${c.pouvoirs.map(p => `<p class="pouvoir"><b>${esc(p.nom)}</b> <small>(${esc(p.type)})</small> : ${esc(p.texte)}</p>`).join('')}` : ''}
    ${c.rappels.length ? `<details class="rappels"><summary>Rappels de règles</summary>${c.rappels.map(r => `<p><b>${esc(r[0].toUpperCase() + r.slice(1))}</b> : ${esc(BESTIAIRE.rappels[r] || '')}</p>`).join('')}</details>` : ''}
    <div class="btns creature-actions">
      <button class="btn" data-action="best-pnj" data-id="${c.id}">+ Ajouter aux PNJ</button>
      ${m.combats.length ? `<span class="row"><input type="text" inputmode="numeric" class="s" id="best-nb-${c.id}" value="1" aria-label="Nombre">
        <select id="best-combat-${c.id}" aria-label="Combat">${m.combats.map(x => `<option value="${x.id}">${esc(x.nom)}</option>`).join('')}</select>
        <button class="btn ghost" data-action="best-combat" data-id="${c.id}">Ajouter au combat</button></span>` : '<span class="hint">Prépare un combat ci-dessous pour pouvoir y ajouter des créatures directement.</span>'}
    </div>
  </div>`;
}
function resultatsBestiaire() {
  if (!BESTIAIRE) return '<p class="hint">Chargement du bestiaire…</p>';
  const l = creaturesFiltrees();
  const lim = state.bestTout ? l.length : 40;
  return `<p class="hint">${l.length} créature${l.length > 1 ? 's' : ''}${l.length > lim ? `, les ${lim} premières affichées` : ''}.</p>
    <div class="creatures">${l.slice(0, lim).map(c => `<div class="creature ${state.bestOuvert === c.id ? 'ouverte' : ''}">
      <button class="creature-ligne" data-action="best-ouvrir" data-id="${c.id}">
        <span class="creature-fp">FP ${esc(c.fp)}</span><b>${esc(c.nom)}</b>
        <small>${esc(c.type.replace(/ de taille .*/, ''))} · ${esc(c.taille)} · ${c.pv ?? '?'} PV · CA ${c.caN ?? '?'}</small>
      </button>
      ${state.bestOuvert === c.id ? ficheCreature(c) : ''}
    </div>`).join('') || '<p class="empty">Aucune créature ne correspond.</p>'}</div>
    ${l.length > lim ? '<button class="lien" data-action="best-tout">Tout afficher</button>' : ''}`;
}
function carteBestiaire() {
  if (!BESTIAIRE) chargerBestiaire().then(() => { const z = $('#best-res'); if (z) { z.innerHTML = resultatsBestiaire(); const s = $('#best-type'); if (s && s.options.length <= 1) render(); } });
  const types = BESTIAIRE ? [...new Set(BESTIAIRE.creatures.map(c => c.typeBase))].filter(Boolean).sort((a, b) => a.localeCompare(b, 'fr')) : [];
  return `<section class="card"><details class="bestiaire" ${state.bestFerme ? '' : 'open'}>
    <summary><h3 class="inline">Bestiaire <small>(Manuel des Monstres, en français)</small></h3></summary>
    <p class="hint aide">Les créatures du document de référence libre de D&D 3.5, de FP ½ à 5. Cherche par nom, filtre par FP ou par type, puis ajoute-les à tes PNJ ou directement à un combat préparé. Une fois ajoutées, tu peux les renommer et les ajuster.</p>
    <div class="row best-filtres">
      <input type="search" id="best-q" value="${esc(state.bestQ || '')}" placeholder="Chercher : gobelin, squelette, loup…" aria-label="Chercher une créature">
      <select id="best-fp" aria-label="Facteur de puissance">${FILTRES_FP.map(([v, l]) => `<option value="${v}" ${(state.bestFP || '') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <select id="best-type" aria-label="Type"><option value="">Tous les types</option>${types.map(t => `<option ${state.bestType === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
    </div>
    <div id="best-res">${resultatsBestiaire()}</div>
  </details></section>`;
}
function pnjDepuisCreature(c) {
  const notes = [
    c.attSpe !== '—' ? 'Attaques spéciales : ' + c.attSpe : '',
    c.qualSpe !== '—' ? 'Particularités : ' + c.qualSpe : '',
    ...c.pouvoirs.map(p => `${p.nom} : ${p.texte}`),
    'Compétences : ' + c.comp, 'Dons : ' + c.dons,
  ].filter(Boolean).join('\n');
  return { id: uid(), nom: c.nom, camp: 'ennemi', pvMax: String(c.pv ?? ''), ca: String(c.caN ?? ''), init: String(c.init).replace('+', ''),
    attaques: c.outrance, caracs: `${c.caracs} · ${c.js} · Vitesse ${c.vitesse}`, notes, butin: [], source: c.id, fp: c.fp };
}

/* ===== Générateur de PNJ types (règles du SRD : classes de PNJ et classes de personnage) ===== */
const CLASSES_PNJ = {
  'homme-peuple': { nom: 'Homme du peuple', dv: 4, bba: 'faible', js: {}, pc: 2 },
  expert: { nom: 'Expert', dv: 6, bba: 'moyen', js: { vol: 1 }, pc: 6 },
  combattant: { nom: 'Combattant', dv: 8, bba: 'fort', js: { vig: 1 }, pc: 2 },
  adepte: { nom: 'Adepte', dv: 6, bba: 'faible', js: { vol: 1 }, pc: 2 },
  aristocrate: { nom: 'Aristocrate', dv: 8, bba: 'moyen', js: { vol: 1 }, pc: 4 },
};
const classeGen = id => CLASSES_PNJ[id] || R.CLASSES[id];
/* Modèles : classe, caractéristiques par ordre d'importance, équipement, compétences et dons typiques */
const MODELES_PNJ = [
  { id: 'garde', nom: 'Garde de la ville', classe: 'combattant', ordre: ['for', 'con', 'dex', 'sag', 'int', 'cha'], armure: 'chemise-mailles', bouclier: 'ecu-leger', arme: 'epee-longue', distance: 'arbalete-legere', comp: ['detection', 'perception', 'intimidation'], dons: ['vigilance', 'arme-predilection', 'robustesse', 'attaque-puissance'] },
  { id: 'soldat', nom: 'Soldat', classe: 'combattant', ordre: ['for', 'con', 'dex', 'sag', 'int', 'cha'], armure: 'ecailles', bouclier: 'ecu-lourd', arme: 'epee-longue', distance: 'javeline', comp: ['escalade', 'saut', 'intimidation'], dons: ['arme-predilection', 'robustesse', 'attaque-puissance', 'enchainement'] },
  { id: 'mercenaire', nom: 'Mercenaire', classe: 'guerrier', ordre: ['for', 'con', 'dex', 'sag', 'cha', 'int'], armure: 'cotte-mailles', arme: 'epee-deux-mains', distance: 'arc-long', comp: ['intimidation', 'escalade', 'equitation'], dons: ['attaque-puissance', 'arme-predilection', 'enchainement', 'science-initiative', 'specialisation-martiale', 'robustesse'] },
  { id: 'chef-bandits', nom: 'Chef de bandits', classe: 'guerrier', ordre: ['for', 'dex', 'con', 'cha', 'sag', 'int'], armure: 'cuirasse', arme: 'epee-longue', distance: 'arc-court', comp: ['intimidation', 'bluff', 'detection'], dons: ['attaque-puissance', 'arme-predilection', 'science-initiative', 'enchainement', 'specialisation-martiale', 'vigilance'] },
  { id: 'bandit', nom: 'Bandit de grand chemin', classe: 'combattant', ordre: ['dex', 'for', 'con', 'sag', 'int', 'cha'], armure: 'cuir', arme: 'epee-courte', distance: 'arc-court', comp: ['discretion', 'deplacement-silencieux', 'detection'], dons: ['tir-bout-portant', 'arme-predilection', 'tir-precision'] },
  { id: 'voleur', nom: 'Voleur des rues', classe: 'roublard', ordre: ['dex', 'int', 'con', 'sag', 'cha', 'for'], armure: 'cuir', arme: 'dague', distance: 'dague', comp: ['escamotage', 'discretion', 'deplacement-silencieux', 'crochetage', 'detection', 'bluff'], dons: ['attaque-finesse', 'esquive', 'science-initiative', 'mobilite'] },
  { id: 'assassin', nom: 'Tueur à gages', classe: 'roublard', ordre: ['dex', 'int', 'con', 'sag', 'for', 'cha'], armure: 'cuir-cloute', arme: 'epee-courte', distance: 'arbalete-poing', comp: ['discretion', 'deplacement-silencieux', 'deguisement', 'detection', 'perception'], dons: ['attaque-finesse', 'science-initiative', 'arme-predilection', 'esquive'], notes: 'Enduit souvent ses lames de poison.' },
  { id: 'contrebandier', nom: 'Contrebandier', classe: 'roublard', ordre: ['dex', 'cha', 'int', 'con', 'sag', 'for'], armure: 'cuir', arme: 'rapiere', distance: 'arbalete-legere', comp: ['bluff', 'diplomatie', 'natation', 'estimation', 'discretion'], dons: ['attaque-finesse', 'persuasion', 'esquive'] },
  { id: 'marchand', nom: 'Marchand', classe: 'expert', ordre: ['int', 'cha', 'sag', 'con', 'dex', 'for'], arme: 'dague', comp: ['estimation', 'diplomatie', 'psychologie', 'bluff', 'renseignements'], dons: ['negociation', 'persuasion', 'vigilance'] },
  { id: 'artisan', nom: 'Artisan', classe: 'expert', ordre: ['int', 'dex', 'sag', 'con', 'for', 'cha'], arme: 'marteau-leger', comp: ['artisanat', 'estimation', 'profession'], dons: ['talent', 'assidu'] },
  { id: 'aubergiste', nom: 'Aubergiste', classe: 'homme-peuple', ordre: ['con', 'sag', 'cha', 'for', 'int', 'dex'], arme: 'gourdin', comp: ['profession', 'perception', 'detection'], dons: ['vigilance', 'robustesse'] },
  { id: 'paysan', nom: 'Paysan', classe: 'homme-peuple', ordre: ['for', 'con', 'sag', 'dex', 'int', 'cha'], arme: 'faucille', comp: ['profession', 'dressage', 'escalade'], dons: ['endurance', 'robustesse'] },
  { id: 'marin', nom: 'Marin', classe: 'combattant', ordre: ['for', 'dex', 'con', 'sag', 'int', 'cha'], armure: 'matelassee', arme: 'cimeterre', distance: 'arbalete-legere', comp: ['escalade', 'natation', 'maitrise-cordes', 'equilibre'], dons: ['athletisme', 'robustesse'] },
  { id: 'capitaine', nom: 'Capitaine de navire', classe: 'guerrier', ordre: ['for', 'cha', 'dex', 'con', 'sag', 'int'], armure: 'cuir-cloute', arme: 'rapiere', distance: 'arbalete-legere', comp: ['profession', 'intimidation', 'natation', 'maitrise-cordes'], dons: ['attaque-finesse', 'arme-predilection', 'esquive', 'mobilite', 'specialisation-martiale'] },
  { id: 'chasseur', nom: 'Chasseur', classe: 'rodeur', ordre: ['dex', 'sag', 'con', 'for', 'int', 'cha'], armure: 'cuir', arme: 'epee-courte', distance: 'arc-long', comp: ['survie', 'detection', 'perception', 'discretion', 'deplacement-silencieux'], dons: ['tir-bout-portant', 'tir-precision', 'pistage'] },
  { id: 'eclaireur', nom: 'Éclaireur', classe: 'rodeur', ordre: ['dex', 'sag', 'con', 'for', 'int', 'cha'], armure: 'cuir-cloute', arme: 'epee-courte', distance: 'arc-court', comp: ['discretion', 'deplacement-silencieux', 'detection', 'survie'], dons: ['vigilance', 'tir-bout-portant', 'science-initiative'] },
  { id: 'chevalier', nom: 'Chevalier', classe: 'guerrier', ordre: ['for', 'con', 'cha', 'dex', 'sag', 'int'], armure: 'harnois', bouclier: 'ecu-lourd', arme: 'epee-longue', distance: 'javeline', comp: ['equitation', 'diplomatie', 'intimidation'], dons: ['combat-monte', 'arme-predilection', 'attaque-puissance', 'enchainement', 'specialisation-martiale', 'charge-devastatrice'] },
  { id: 'garde-corps', nom: 'Garde du corps', classe: 'guerrier', ordre: ['for', 'con', 'dex', 'sag', 'int', 'cha'], armure: 'cotte-mailles', bouclier: 'ecu-lourd', arme: 'masse-lourde', distance: 'arbalete-legere', comp: ['detection', 'perception', 'psychologie'], dons: ['vigilance', 'attaques-reflexes', 'arme-predilection', 'robustesse', 'specialisation-martiale'] },
  { id: 'pretre', nom: 'Prêtre de village', classe: 'pretre', ordre: ['sag', 'con', 'cha', 'for', 'int', 'dex'], armure: 'ecailles', bouclier: 'ecu-lourd', arme: 'masse-lourde', distance: 'arbalete-legere', comp: ['concentration', 'premiers-secours', 'diplomatie', 'conn-religion'], dons: ['magie-guerre', 'vigueur-surhumaine', 'volonte-fer'] },
  { id: 'acolyte', nom: 'Acolyte', classe: 'adepte', ordre: ['sag', 'con', 'int', 'cha', 'dex', 'for'], arme: 'baton', comp: ['concentration', 'premiers-secours', 'conn-religion'], dons: ['magie-guerre', 'volonte-fer'] },
  { id: 'cultiste', nom: 'Cultiste', classe: 'adepte', ordre: ['sag', 'cha', 'con', 'int', 'dex', 'for'], armure: 'cuir', arme: 'dague', comp: ['concentration', 'bluff', 'conn-religion'], dons: ['magie-guerre', 'robustesse'] },
  { id: 'mage', nom: 'Mage de cour', classe: 'magicien', ordre: ['int', 'dex', 'con', 'sag', 'cha', 'for'], arme: 'baton', distance: 'arbalete-legere', comp: ['art-magie', 'concentration', 'conn-mysteres', 'decryptage'], dons: ['magie-guerre', 'science-initiative', 'ecriture-parchemins', 'robustesse'] },
  { id: 'druide', nom: 'Druide ermite', classe: 'druide', ordre: ['sag', 'con', 'dex', 'cha', 'int', 'for'], armure: 'peau', bouclier: 'ecu-leger', arme: 'cimeterre', distance: 'fronde', comp: ['survie', 'conn-nature', 'premiers-secours', 'concentration'], dons: ['magie-guerre', 'pistage', 'endurance'] },
  { id: 'barde', nom: 'Barde ambulant', classe: 'barde', ordre: ['cha', 'dex', 'int', 'con', 'sag', 'for'], armure: 'cuir', arme: 'rapiere', distance: 'arc-court', comp: ['representation', 'diplomatie', 'bluff', 'renseignements'], dons: ['attaque-finesse', 'persuasion', 'esquive'] },
  { id: 'noble', nom: 'Noble', classe: 'aristocrate', ordre: ['cha', 'int', 'sag', 'dex', 'con', 'for'], armure: 'chemise-mailles', arme: 'rapiere', comp: ['diplomatie', 'psychologie', 'equitation', 'conn-noblesse', 'bluff'], dons: ['persuasion', 'negociation', 'attaque-finesse'] },
];
const RACES_GEN = { humain: ['Humain', {}], nain: ['Nain', { con: 2, cha: -2 }], elfe: ['Elfe', { dex: 2, con: -2 }], 'demi-orc': ['Demi-orque', { for: 2, int: -2, cha: -2 }], halfelin: ['Halfelin', { dex: 2, for: -2 }], gnome: ['Gnome', { con: 2, for: -2 }], 'demi-elfe': ['Demi-elfe', {}] };
const modC = v => Math.floor((v - 10) / 2);
function genererPNJ(modeleId, niveau, raceId = 'humain') {
  const md = MODELES_PNJ.find(m => m.id === modeleId);
  const cl = classeGen(md.classe);
  const pnjClasse = !!CLASSES_PNJ[md.classe];
  /* Valeurs de caractéristiques : « non élite » pour les classes de PNJ, « élite » pour les autres (Guide du Maître) */
  const valeurs = pnjClasse ? [13, 12, 11, 10, 9, 8] : [15, 14, 13, 12, 10, 8];
  const car = {};
  md.ordre.forEach((k, i) => { car[k] = valeurs[i]; });
  for (const [k, v] of Object.entries(RACES_GEN[raceId][1])) car[k] += v;
  car[md.ordre[0]] += Math.floor(niveau / 4);
  const m = Object.fromEntries(Object.entries(car).map(([k, v]) => [k, modC(v)]));
  const bba = R.bbaClasse(cl.bba, niveau);
  const js = { vig: R.jsClasse(cl.js.vig, niveau) + m.con, ref: R.jsClasse(cl.js.ref, niveau) + m.dex, vol: R.jsClasse(cl.js.vol, niveau) + m.sag };
  const pv = Math.max(1, Math.floor(cl.dv + (niveau - 1) * (cl.dv / 2 + 0.5) + m.con * niveau));
  const armure = md.armure ? R.ARMURE[md.armure] : null, bouclier = md.bouclier ? R.ARMURE[md.bouclier] : null;
  const dexCA = armure && armure.dex != null ? Math.min(m.dex, armure.dex) : m.dex;
  const taille = ['halfelin', 'gnome'].includes(raceId) ? 1 : 0;
  const ca = 10 + dexCA + (armure?.ca || 0) + (bouclier?.ca || 0) + taille;
  const arme = R.ARMES.find(a => a.id === md.arme), dist = md.distance ? R.ARMES.find(a => a.id === md.distance) : null;
  const dons = md.dons.slice(0, 1 + Math.floor(niveau / 3) + (md.classe === 'guerrier' ? 1 + Math.floor(niveau / 2) : 0) + (raceId === 'humain' ? 1 : 0)).filter(d => R.DON[d]);
  const predi = dons.includes('arme-predilection') ? 1 : 0, spe = dons.includes('specialisation-martiale') && niveau >= 4 ? 2 : 0;
  const finesse = dons.includes('attaque-finesse') && arme && (arme.prise === 'legere' || arme.id === 'rapiere');
  const deuxMains = arme && arme.prise === 'deux';
  const attC = bba + (finesse ? m.dex : m.for) + predi + taille;
  const degC = Math.floor(m.for * (deuxMains ? 1.5 : 1)) + spe;
  const attD = bba + m.dex + taille + (dons.includes('tir-bout-portant') ? 0 : 0);
  const iter = n => R.attTxt(R.attaques(n));
  const att = [arme ? `${arme.nom} ${iter(attC)} corps à corps (${arme.deg}${degC ? R.signe(degC) : ''}, ${arme.crit})` : '',
    dist ? `${dist.nom} ${iter(attD)} distance (${dist.deg}${dist.lancer && m.for ? R.signe(m.for) : ''}, ${dist.crit}${dist.portee ? ', ' + dist.portee : ''})` : ''].filter(Boolean).join(' ; ou ');
  const rangs = niveau + 3;
  const nomComp = k => (R.COMPETENCES.find(c => c.id === k) || {}).nom || k;
  const carComp = k => (R.COMPETENCES.find(c => c.id === k) || {}).car || 'int';
  const comps = md.comp.map((k, i) => { const r = i < 3 ? rangs : Math.ceil(rangs / 2); return `${nomComp(k)} ${R.signe(r + (m[carComp(k)] || 0))}`; });
  const lanceur = cl.lanceur ? sortsParJour(md.classe, niveau, { classes: { [md.classe]: niveau }, mods: m, lanceurBonus: {} }) : null;
  const sorts = md.classe === 'adepte' ? `Sorts d'adepte : ${niveau >= 4 ? '3 de niv. 0, 3 de niv. 1, 1 de niv. 2' : '3 de niv. 0, 1 de niv. 1'} (bénédiction, soins légers, sommeil…)` :
    lanceur ? `Sorts par jour : ${lanceur.parJour.map(x => `niv. ${x.niv} : ${x.txt}`).join(', ')}` : '';
  const equip = [armure?.nom, bouclier?.nom, arme?.nom, dist && dist.id !== arme?.id ? dist.nom + (dist.prise === 'distance' ? ' et 20 projectiles' : '') : '', niveau >= 3 ? 'une pièce d\'équipement de maître' : '', niveau >= 5 ? '1 ou 2 potions' : ''].filter(Boolean).join(', ');
  const car6 = R.CARACS.map(c => `${c.n.slice(0, 3)} ${car[c.k]}`).join(', ');
  return {
    modele: md, niveau, race: RACES_GEN[raceId][0],
    titre: `${md.nom} (${RACES_GEN[raceId][0].toLowerCase()}, ${cl.nom.toLowerCase()} ${niveau})`,
    pv, ca, contact: 10 + dexCA + taille, init: m.dex, bba, lutte: bba + m.for - 4 * taille, js, att,
    vitesse: armure && armure.type !== 'legere' ? (['nain', 'halfelin', 'gnome'].includes(raceId) ? '6 m' : '6 m (armure)') : (['nain', 'halfelin', 'gnome'].includes(raceId) ? '6 m' : '9 m'),
    car6, comps, dons: dons.map(d => R.DON[d].nom), equip, sorts, notes: md.notes || '',
    fp: niveau <= 1 && pnjClasse ? '½' : String(Math.max(1, pnjClasse ? niveau - 1 : niveau)),
  };
}
function cartePNJGen() {
  const g = state.gen || (state.gen = { modele: 'garde', niveau: 1, race: 'humain', nb: 1, nom: '' });
  const r = genererPNJ(g.modele, g.niveau, g.race);
  const m = mjd();
  return `<section class="card"><details class="bestiaire generateur" ${state.genFerme ? '' : 'open'}>
    <summary><h3 class="inline">Générateur de PNJ <small>(gardes, marchands, prêtres, bandits…)</small></h3></summary>
    <div class="grid gen-choix">
      <label class="f"><span>Modèle</span><select id="gen-modele">${MODELES_PNJ.map(x => `<option value="${x.id}" ${g.modele === x.id ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select></label>
      <label class="f"><span>Niveau</span><select id="gen-niveau">${Array.from({ length: 12 }, (_, i) => i + 1).map(n => `<option ${g.niveau === n ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <label class="f"><span>Race</span><select id="gen-race">${Object.entries(RACES_GEN).map(([k, [l]]) => `<option value="${k}" ${g.race === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      <label class="f"><span>Nom (facultatif)</span><input type="text" id="gen-nom" value="${esc(g.nom)}" placeholder="${esc(r.modele.nom)}"></label>
    </div>
    <div class="creature-fiche gen-fiche">
      <p class="creature-type">${esc(r.titre)} · FP ${esc(r.fp)}</p>
      <div class="creature-chiffres">
        <span><b>${r.pv}</b> PV</span><span><b>${r.ca}</b> CA <small>(contact ${r.contact})</small></span><span><b>${R.signe(r.init)}</b> init.</span><span><b>${R.signe(r.bba)}</b> BBA · lutte ${R.signe(r.lutte)}</span>
      </div>
      <div class="bloc-stat"><span>Attaques</span><div>${esc(r.att || '—')}</div></div>
      <div class="bloc-stat"><span>Vitesse</span><div>${esc(r.vitesse)}</div></div>
      <div class="bloc-stat"><span>Sauvegardes</span><div>Vig ${R.signe(r.js.vig)}, Réf ${R.signe(r.js.ref)}, Vol ${R.signe(r.js.vol)}</div></div>
      <div class="bloc-stat"><span>Caractéristiques</span><div>${esc(r.car6)}</div></div>
      <div class="bloc-stat"><span>Compétences</span><div>${esc(r.comps.join(', '))}</div></div>
      <div class="bloc-stat"><span>Dons</span><div>${esc(r.dons.join(', ') || '—')}</div></div>
      ${r.sorts ? `<div class="bloc-stat"><span>Magie</span><div>${esc(r.sorts)}</div></div>` : ''}
      <div class="bloc-stat"><span>Équipement</span><div>${esc(r.equip || '—')}</div></div>
      ${r.notes ? `<p class="hint">${esc(r.notes)}</p>` : ''}
      <div class="btns creature-actions">
        <button class="btn" data-action="gen-pnj">+ Ajouter aux PNJ</button>
        ${m.combats.length ? `<span class="row"><input type="text" inputmode="numeric" class="s" id="gen-nb" value="${esc(g.nb)}" aria-label="Nombre">
          <select id="gen-combat" aria-label="Combat">${m.combats.map(x => `<option value="${x.id}">${esc(x.nom)}</option>`).join('')}</select>
          <button class="btn ghost" data-action="gen-combat">Ajouter au combat</button></span>` : ''}
      </div>
    </div>
  </details></section>`;
}
function pnjDepuisGen(r, nom) {
  return { id: uid(), nom: nom || r.modele.nom, camp: 'neutre', pvMax: String(r.pv), ca: String(r.ca), init: String(r.init),
    attaques: r.att, caracs: `${r.car6} · Vig ${R.signe(r.js.vig)}, Réf ${R.signe(r.js.ref)}, Vol ${R.signe(r.js.vol)} · Vitesse ${r.vitesse}`,
    notes: [r.titre, 'Compétences : ' + r.comps.join(', '), 'Dons : ' + r.dons.join(', '), r.sorts, 'Équipement : ' + r.equip, r.notes].filter(Boolean).join('\n'), butin: [], fp: r.fp };
}

/* ----- Historique des données du MJ (base en v13) ----- */
const CATS_HISTO = [['objets', 'Objets en attente'], ['pnj', 'PNJ et créatures'], ['combats', 'Combats préparés'], ['notes', 'Notes'], ['xp', 'XP du groupe']];
function carteHistoriqueMJ() {
  const sessions = sessionsMJ().map(x => ['session:' + x.id, `Session ${x.numero} : ${x.titre || 'sans titre'}`]);
  const cle = state.histoCle || 'objets';
  const l = state.histo && state.histo.cle === cle ? state.histo.liste : null;
  return `<section class="card"><details class="bestiaire" ${state.histoOuvert ? 'open' : ''}>
    <summary><h3 class="inline">Historique et restauration</h3></summary>
    <p class="hint aide">Avant chaque modification, la base garde l'ancienne version (les 30 dernières par catégorie). En cas d'erreur, choisis une version et restaure-la.</p>
    <div class="btns" style="margin-bottom:.6rem">
      <button class="btn ghost" data-action="mj-sauvegarde">⬇ Sauvegarder les données du MJ</button>
      <button class="btn ghost" data-action="mj-import-sauvegarde">⬆ Importer une sauvegarde</button>
      <input type="file" id="mj-import-fichier" accept=".json,.txt,application/json,text/plain" hidden>
    </div>
    <div class="row"><select id="histo-cle">${[...CATS_HISTO, ...sessions].map(([k, t]) => `<option value="${esc(k)}" ${k === cle ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select>
      <button class="btn ghost" data-action="histo-voir">Voir les versions</button></div>
    ${l ? (l.length ? `<div class="histo-liste">${l.map(v => `<div class="histo-version">
        <div><b>${new Date(v.maj).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</b>${v.nombre != null ? ` · ${v.nombre} élément${v.nombre > 1 ? 's' : ''}` : ''}
        ${v.apercu ? `<br><small>${esc(v.apercu)}${v.nombre > 8 ? '…' : ''}</small>` : ''}</div>
        <button class="btn ghost petit" data-action="histo-restaurer" data-id="${v.id}">Restaurer</button></div>`).join('')}</div>` : '<p class="empty">Aucune ancienne version gardée pour l\'instant (l\'historique démarre avec la mise à jour v13).</p>') : ''}
  </details></section>`;
}

/* ----- Préparation : PNJ (bestiaire), combats ----- */
const nouveauPNJ = () => ({ id: uid(), nom: 'Nouveau PNJ', camp: 'ennemi', pvMax: '', ca: '', init: '', attaques: '', caracs: '', notes: '', butin: [] });
const champMJ = (path, label, opt = {}) => `<label class="f${opt.span ? ' span2' : ''}"><span>${esc(label)}</span>${opt.area
  ? `<textarea data-mjbind="${path}" rows="${opt.rows || 2}" placeholder="${esc(opt.ph || '')}">${esc(getP(mjd(), path))}</textarea>`
  : `<input type="text" data-mjbind="${path}" value="${esc(getP(mjd(), path))}" placeholder="${esc(opt.ph || '')}"${opt.num ? ' inputmode="numeric"' : ''}>`}</label>`;

function formPNJ(x, i) {
  const opts = Object.entries(CATS_OBJET).map(([k, l]) => [k, l]);
  return `<div class="pnj en-edition">
    <div class="grid">
      ${champMJ(`pnj.${i}.nom`, 'Nom', { span: true })}
      <label class="f"><span>Camp</span><select data-mjbind="pnj.${i}.camp" data-rerender>${[['ennemi', 'Ennemi'], ['allie', 'Allié'], ['neutre', 'Neutre']].map(([v, l]) => `<option value="${v}" ${x.camp === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      ${champMJ(`pnj.${i}.pvMax`, 'PV', { num: true })}${champMJ(`pnj.${i}.ca`, 'CA', { num: true })}${champMJ(`pnj.${i}.init`, 'Bonus d\'initiative', { num: true, ph: '+2' })}
    </div>
    ${champMJ(`pnj.${i}.caracs`, 'Caractéristiques et sauvegardes', { area: true, ph: 'For 14, Dex 12… · Vig +4, Réf +1, Vol +0' })}
    ${champMJ(`pnj.${i}.attaques`, 'Attaques', { area: true, ph: 'Cimeterre +5 (1d6+2, 18-20)' })}
    ${champMJ(`pnj.${i}.notes`, 'Notes, tactique, capacités', { area: true })}
    <p class="lbl">Butin porté (ira dans « Objets en attente » à sa mort)</p>
    ${(x.butin || []).map((it, j) => `<div class="row butin-ligne">
      <input type="text" data-mjbind="pnj.${i}.butin.${j}.nom" value="${esc(it.nom)}" placeholder="Objet">
      <select data-mjbind="pnj.${i}.butin.${j}.cat">${opts.map(([k, l]) => `<option value="${k}" ${(it.cat || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      <input type="text" class="s" data-mjbind="pnj.${i}.butin.${j}.qte" value="${esc(it.qte)}" placeholder="Qté">
      <input type="text" class="s" data-mjbind="pnj.${i}.butin.${j}.valeur" value="${esc(it.valeur)}" placeholder="Valeur">
      ${selUnite(`data-mjbind="pnj.${i}.butin.${j}.valeurUnite"`, it.valeurUnite)}
      <button class="icon" data-action="mj-butin-suppr" data-i="${i}" data-j="${j}" aria-label="Retirer">✕</button>
    </div>`).join('')}
    <div class="btns"><button class="lien" data-action="mj-butin-ajout" data-i="${i}">+ Objet de butin</button></div>
    <div class="btns"><button class="btn" data-action="mj-edit-fin">Terminé</button><button class="btn danger" data-action="mj-pnj-suppr" data-i="${i}">Supprimer</button></div>
  </div>`;
}
function cartePNJ(x, i) {
  return `<div class="pnj camp-${x.camp}">
    <div class="pnj-tete"><b>${esc(x.nom)}</b><span class="tag-cat">${({ ennemi: 'Ennemi', allie: 'Allié', neutre: 'Neutre' })[x.camp] || ''}</span>
      <button class="lien" data-action="mj-edit" data-cle="pnj:${x.id}">Modifier</button></div>
    <p class="pnj-stats">PV ${esc(x.pvMax || '?')} · CA ${esc(x.ca || '?')} · Init ${esc(x.init || '+0')}${(x.butin || []).length ? ` · ${x.butin.length} objet(s) de butin` : ''}</p>
    ${x.attaques ? `<p class="hint">${esc(x.attaques)}</p>` : ''}
  </div>`;
}
function formCombat(c, i) {
  const pnj = mjd().pnj;
  return `<div class="pnj en-edition">
    ${champMJ(`combats.${i}.nom`, 'Nom de la rencontre')}
    ${champMJ(`combats.${i}.notes`, 'Notes (lieu, déclencheur, tactique)', { area: true })}
    <p class="lbl">Participants</p>
    ${pnj.length ? pnj.map(x => `<label class="row part-ligne"><span>${esc(x.nom)}</span>
      <input type="text" inputmode="numeric" class="s" data-action-input="mj-combat-nb" data-i="${i}" data-pnj="${x.id}" value="${esc((c.participants || []).find(y => y.pnjId === x.id)?.nombre || '')}" placeholder="0" aria-label="Nombre de ${esc(x.nom)}"></label>`).join('')
      : '<p class="empty">Crée d\'abord des PNJ ci-dessus.</p>'}
    <div class="btns"><button class="btn" data-action="mj-edit-fin">Terminé</button><button class="btn danger" data-action="mj-combat-suppr" data-i="${i}">Supprimer</button></div>
  </div>`;
}
function carteCombatPrep(c, i) {
  const pnj = mjd().pnj;
  const liste = (c.participants || []).filter(y => num(y.nombre) > 0).map(y => `${y.nombre} × ${pnj.find(x => x.id === y.pnjId)?.nom || '?'}`);
  return `<div class="pnj">
    <div class="pnj-tete"><b>${esc(c.nom)}</b><button class="lien" data-action="mj-edit" data-cle="combat:${c.id}">Modifier</button></div>
    <p class="pnj-stats">${esc(liste.join(', ') || 'Aucun participant')}</p>
    ${c.notes ? `<p class="hint">${esc(c.notes)}</p>` : ''}
    <button class="btn" data-action="mj-combat-activer" data-i="${i}">⚔ Activer ce combat</button>
  </div>`;
}

/* ----- Combat en cours ----- */
function tuerPNJ(x) {
  x.mort = true;
  const butin = (x.butin || []).filter(it => it.nom);
  if (butin.length) {
    const t = mjd().pnj.find(y => y.id === x.pnjId);
    mjd().objets.push(...butin.map(it => ({ ...it, id: uid(), source: `Butin de ${x.nom}`, detenteur: t ? t.nom : x.nom, type: '' })));
    saveMJ('objets');
    toast(`${x.nom} est mort : ${butin.length} objet(s) en attente`);
  } else toast(`${x.nom} est mort`);
}
function lancerCombat(prep) {
  const m = mjd();
  const joueurs = db.personnages.filter(x => !x._public && (!x.pnjMJ || true) && (!enLigne() || x.publie));
  const combattants = [];
  for (const x of joueurs) {
    combattants.push({ id: uid(), nom: x.nom, type: estMembre(x) ? 'pj' : 'mj', persoId: x.id, init: '', bonusInit: stats(x, etat(x)).init, pv: pvActuels(x), pvMax: num(x.pvMax), ca: stats(x, etat(x)).ca, actif: estMembre(x) });
  }
  for (const y of (prep.participants || [])) {
    const t = m.pnj.find(x => x.id === y.pnjId);
    for (let k = 1; k <= num(y.nombre); k++) {
      combattants.push({ id: uid(), nom: num(y.nombre) > 1 ? `${t.nom} ${k}` : t.nom, type: 'pnj', camp: t.camp, pnjId: t.id, init: '', bonusInit: num(t.init), pv: num(t.pvMax), pvMax: num(t.pvMax), ca: t.ca, actif: true, butin: (t.butin || []).map(b => ({ ...b, id: uid() })) });
    }
  }
  m.combat = { id: uid(), nom: prep.nom, phase: 'initiative', tour: 0, round: 1, combattants };
  saveMJ('combat');
}
function pageCombatMJ() {
  const c = mjd().combat;
  if (!c) return `<section class="card intro"><h3>Aucun combat en cours</h3><p>Prépare une rencontre dans l'onglet Préparation, puis touche « Activer ce combat ».</p></section>`;
  const actifs = c.combattants.filter(x => x.actif);
  if (c.phase === 'initiative') {
    return `<section class="card"><h3>${esc(c.nom)} : initiatives</h3>
      <p class="hint aide">Coche qui participe, puis note le résultat du jet d'initiative de chacun (d20 + bonus). Les PNJ peuvent être lancés automatiquement.</p>
      <div class="init-saisie">${c.combattants.map((x, i) => `<div class="row init-ligne ${x.type}">
        <label class="check"><input type="checkbox" data-mjbind="combat.combattants.${i}.actif" data-rerender ${x.actif ? 'checked' : ''}> <b>${esc(x.nom)}</b></label>
        <small>bonus ${R.signe(num(x.bonusInit))}</small>
        <input type="text" inputmode="numeric" class="s" data-mjbind="combat.combattants.${i}.init" value="${esc(x.init)}" placeholder="?" aria-label="Initiative de ${esc(x.nom)}">
      </div>`).join('')}</div>
      <div class="btns"><button class="btn ghost" data-action="mj-init-pnj">🎲 Lancer pour les PNJ</button><button class="btn" data-action="mj-combat-go">Commencer le combat</button><button class="btn danger" data-action="mj-combat-fin">Annuler</button></div>
    </section>`;
  }
  const ordre = actifs;
  const courant = ordre[c.tour % (ordre.length || 1)];
  return `<section class="card"><h3>${esc(c.nom)}</h3>
    <p class="xp-ligne"><b>Round ${c.round}</b> <span>au tour de ${esc(courant?.nom || '—')}</span></p>
    <ol class="mj-init">${ordre.map(x => {
      const i = c.combattants.indexOf(x);
      return `<li class="${x === courant ? 'actif' : ''} ${x.type === 'pnj' && x.camp !== 'allie' ? 'ennemi' : ''} ${x.mort ? 'mort' : ''}">
        <span class="mj-init-val">${esc(x.init || '—')}</span>
        <span><b>${esc(x.nom)}</b>${x.ca ? ` <small>CA ${esc(x.ca)}</small>` : ''}${x.mort ? ' <small>mort</small>' : ''}
          ${effetsDuCombattant(x, c).map(f => `<span class="effet-mj ${f.type}" title="par ${esc(f.de)}">${esc(f.nom)} <b>${f.reste}</b></span>`).join('')}
          ${!x.mort ? `<button class="lien effet-mj-ajout" data-action="mj-cb-effet" data-i="${i}" title="Ajouter un effet qui dure">+ effet</button>` : ''}</span>
        <span class="mj-pv">${x.pvMax ? `<button class="icon" data-action="mj-cb-pv" data-i="${i}" data-d="-1" aria-label="−1 PV">−</button>${x.pv}/${x.pvMax}<button class="icon" data-action="mj-cb-pv" data-i="${i}" data-d="1" aria-label="+1 PV">+</button>` : ''}
          ${x.type === 'pnj' && !x.mort ? `<button class="icon" data-action="mj-cb-mort" data-i="${i}" title="Mort : son butin passe dans les objets en attente">☠</button>` : ''}</span>
      </li>`;
    }).join('')}</ol>
    <div class="btns"><button class="btn" data-action="mj-suivant">Tour suivant</button><button class="btn danger" data-action="mj-combat-fin">Terminer le combat</button></div>
    <p class="hint aide">Les PV des personnages joueurs sont ceux de leur fiche : les modifier ici les modifie chez le joueur. Un PNJ qui tombe à 0 PV, ou que tu marques ☠, est déclaré mort : son butin part dans « Objets en attente ».</p>
  </section>`;
}

/* ----- Objets en attente ----- */
function pageObjetsMJ() {
  const objets = mjd().objets;
  const cibles = db.personnages.filter(x => !x._public && (!enLigne() || x.publie));
  const detenteurs = [...new Set(mjd().pnj.map(x => x.nom).filter(Boolean))];
  const groupes = [...new Set(objets.map(it => it.detenteur || ''))].sort((x, y) => (x === '') - (y === '') || x.localeCompare(y, 'fr'));
  const ligne = it => {
    const i = objets.indexOf(it);
    if (state.mjEdit === 'obj:' + it.id) return `<div class="objet en-edition">
      <div class="row"><input type="text" data-mjbind="objets.${i}.nom" value="${esc(it.nom)}" placeholder="Objet">
        <select data-mjbind="objets.${i}.cat">${Object.entries(CATS_OBJET).map(([k, l]) => `<option value="${k}" ${(it.cat || '') === k ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
      <div class="row">
        <select data-mjbind="objets.${i}.type" data-rerender aria-label="Destination"><option value="">Butin ou cadeau</option><option value="vente" ${it.type === 'vente' ? 'selected' : ''}>À vendre</option></select>
        <select data-mjbind="objets.${i}.detenteur" aria-label="PNJ détenteur"><option value="">— Aucun PNJ —</option>${detenteurs.map(n => `<option ${it.detenteur === n ? 'selected' : ''}>${esc(n)}</option>`).join('')}${it.detenteur && !detenteurs.includes(it.detenteur) ? `<option selected>${esc(it.detenteur)}</option>` : ''}</select>
      </div>
      <div class="row"><input type="text" class="s" data-mjbind="objets.${i}.qte" value="${esc(it.qte)}" placeholder="${it.type === 'vente' ? 'Stock' : 'Qté'}">
        <input type="text" class="s" data-mjbind="objets.${i}.valeur" value="${esc(it.valeur)}" placeholder="${it.type === 'vente' ? 'Prix' : 'Valeur'}">
        ${selUnite(`data-mjbind="objets.${i}.valeurUnite"`, it.valeurUnite)}
        <input type="text" class="s" data-mjbind="objets.${i}.poids" value="${esc(it.poids)}" placeholder="Poids"></div>
      <input type="text" data-mjbind="objets.${i}.notes" value="${esc(it.notes)}" placeholder="Description, effet, commentaire">
      <div class="objet-image">
        <button class="image-cadre petite" data-action="img-choisir" data-type="mjobjet" data-id="${it.id}" aria-label="${it.image ? 'Changer' : 'Ajouter'} l'image">${it.image ? `<img src="${it.image}" alt="">` : '<span>+ Image</span>'}</button>
        ${it.image ? `<button class="lien" data-action="img-retirer" data-type="mjobjet" data-id="${it.id}">Retirer l'image</button>` : ''}
      </div>
      ${it.type === 'vente' ? `<label class="f"><span>Marché</span><select data-mjbind="objets.${i}.marcheId">${listeMarches().map(m => `<option value="${m.id}" ${(it.marcheId || listeMarches()[0].id) === m.id ? 'selected' : ''}>${esc(m.nom)}</option>`).join('')}</select></label>` : ''}
      ${it.cat === 'magique' ? `<label class="check"><input type="checkbox" data-mjbind="objets.${i}.focalisateur" ${it.focalisateur ? 'checked' : ''}> ✦ Focalisateur</label>` : ''}
      <div class="btns"><button class="btn" data-action="mj-edit-fin">Terminé</button><button class="btn danger" data-action="mj-obj-suppr" data-i="${i}">Supprimer</button></div>
    </div>`;
    return `<div class="objet-vue ${it.image ? 'avec-image' : ''}">
      ${it.image ? `<button class="vignette" data-action="img-zoom" data-src="${it.image}" aria-label="Agrandir l'image de ${esc(it.nom || 'l\'objet')}"><img src="${it.image}" alt=""></button>` : ''}
      <div class="objet-vue-tete"><b>${esc(it.nom || 'Objet')}</b>${num(it.qte) > 1 ? ` <span class="qte">× ${esc(it.qte)}</span>` : ''}${it.cat ? `<span class="tag-cat cat-${it.cat}">${CATS_OBJET[it.cat]}</span>` : ''}
        <span class="tag-cat ${it.type === 'vente' ? 'vente' : ''}">${it.type === 'vente' ? 'À vendre' : 'Butin'}</span>${it.source ? `<span class="tag-cat">${esc(it.source)}</span>` : ''}
        <button class="lien objet-modif" data-action="mj-edit" data-cle="obj:${it.id}">Modifier</button></div>
      ${it.notes || nombre(it.valeur) ? `<p class="objet-det">${esc([nombre(it.valeur) ? prixTxt(it.valeur, it.valeurUnite) : '', it.notes].filter(Boolean).join(' · '))}</p>` : ''}
      ${it.type === 'vente'
        ? `<div class="btns"><button class="btn ghost" data-action="mj-vers-marche" data-i="${i}">Envoyer au marché</button></div>`
        : `<div class="row donner"><select id="cible-${it.id}" aria-label="Donner à">${cibles.map(x => `<option value="${x.id}">${esc(x.nom)}</option>`).join('')}<option value="__coffre__">Coffre commun</option></select>
          <button class="btn ghost" data-action="mj-donner" data-i="${i}">Donner</button></div>`}
    </div>`;
  };
  return `<section class="card"><h3>Objets en attente</h3>
    <p class="hint aide">Butin et cadeaux se <b>donnent</b> directement à un personnage. Les objets <b>à vendre</b> partent au Marché, où les joueurs les achètent. Classés par PNJ détenteur.</p>
    ${groupes.map(g => `<h4 class="groupe-inv">${esc(g || 'Sans PNJ')} <small>${objets.filter(it => (it.detenteur || '') === g).length}</small></h4>
      <div class="objets">${objets.filter(it => (it.detenteur || '') === g).map(ligne).join('')}</div>`).join('') || '<p class="empty">Aucun objet en attente.</p>'}
    <div class="btns" style="margin-top:.6rem"><button class="btn ghost" data-action="mj-obj-ajout">+ Préparer un objet</button><button class="btn ghost" data-action="mj-obj-ajout" data-type="vente">+ Préparer un objet à vendre</button></div>
    ${blocAjoutRapide('mj')}
  </section>
  ${carteMarchesMJ()}
  <section class="card"><h3>Donner des pièces</h3>
    <label class="f"><span>À</span><select id="argent-cible"><option value="__commune__">Le coffre commun</option>${cibles.filter(estMembre).map(x => `<option value="${x.id}">${esc(x.nom)}</option>`).join('')}</select></label>
    ${champsPieces('mjp')}
    <button class="btn" data-action="mj-argent">Donner</button>
    <p class="hint">Un nombre négatif retire des pièces.</p>
  </section>`;
}

/* ===== Sessions : le scénario, séance par séance =====
   Chaque session est rangée sous sa propre clé (« session:<id> ») dans les données privées du MJ,
   pour n'envoyer et ne télécharger que la session modifiée. */
const TYPES_ETAPE = {
  titre: ['Titre de partie', '§', 'Sépare les grandes parties du scénario'],
  scene: ['Scène', '📜', 'Ce qui se passe, description, ambiance'],
  dialogue: ['Dialogue', '💬', 'Texte préparé pour un PNJ'],
  rencontre: ['Rencontre', '⚔', 'Combat préparé ou rencontre avec des PNJ'],
  objet: ['Objets', '🎁', 'Récompenses à distribuer'],
  quete: ['Quête', '🧭', 'Lancement, progression ou fin d\'une quête'],
  image: ['Illustration', '🖼', 'Image à montrer aux joueurs'],
  note: ['Note', '📌', 'Rappel pour le MJ'],
};
const ACTIONS_QUETE = { lancement: 'Lancement', progression: 'Progression', fin: 'Achèvement' };
const cleSession = id => 'session:' + id;
const sessionsMJ = () => Object.entries(mjd()).filter(([k, v]) => k.startsWith('session:') && v).map(([, v]) => v)
  .sort((a, b) => num(a.numero) - num(b.numero));
const sessionMJ = id => mjd()[cleSession(id)];
const xpSession = s => (s.etapes || []).reduce((t, e) => t + num(e.xp), 0);
const xpDonne = s => (s.etapes || []).filter(e => e.xpDonne).reduce((t, e) => t + num(e.xp), 0);

/* Fenêtre séparée, à glisser sur l'écran ou la télévision des joueurs : elle se réutilise à chaque image */
function afficherSurEcran(src) {
  const w = window.open('', 'codex-ecran-joueurs', 'popup=yes,width=1280,height=760');
  if (!w) { alert('Ton navigateur a bloqué la fenêtre. Autorise les fenêtres pop-up pour ce site, puis réessaie.'); return; }
  /* Rien d'autre que l'image : ni titre, ni légende, ni texte d'aide */
  w.document.open();
  w.document.write(`<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Illustration</title>
    <style>html,body{margin:0;height:100%;background:#000;overflow:hidden;cursor:none}
    img{position:fixed;inset:0;width:100%;height:100%;object-fit:contain}</style></head>
    <body ondblclick="document.fullscreenElement?document.exitFullscreen():document.documentElement.requestFullscreen()"><img src="${src}" alt=""></body></html>`);
  w.document.close();
  w.focus();
  toast('Glisse la fenêtre sur l\'écran des joueurs, puis double-clic dessus (ou F11) pour le plein écran.');
}
function pageSessionsMJ() {
  if (state.mjSession && sessionMJ(state.mjSession)) return pageSessionMJ(sessionMJ(state.mjSession));
  const ls = sessionsMJ();
  return `<section class="card"><h3>Sessions</h3>
    <p class="hint aide">Prépare le scénario séance par séance : scènes, dialogues, rencontres, objets, quêtes, XP et illustrations, dans l'ordre où ils arriveront.</p>
    <div class="sessions-liste">${ls.map(s => {
      const n = (s.etapes || []).filter(e => e.type !== 'titre').length, faits = (s.etapes || []).filter(e => e.fait && e.type !== 'titre').length;
      return `<button class="session-prep" data-action="mj-session-ouvrir" data-id="${s.id}">
        <span class="recit-num">Session ${esc(s.numero)}</span>
        <b>${esc(s.titre || 'Sans titre')}</b>
        <small>${n} étape${n > 1 ? 's' : ''}${xpSession(s) ? ` · ${xpSession(s)} XP prévus` : ''}${s.date ? ` · ${dateFr(s.date)}` : ''}</small>
        ${n ? `<span class="barre"><span style="width:${Math.round(faits / n * 100)}%"></span></span>` : ''}
      </button>`;
    }).join('') || '<p class="empty">Aucune session préparée.</p>'}</div>
    <button class="btn" data-action="mj-session-ajout">+ Préparer une session</button>
  </section>`;
}

function etapeEdition(s, e, i) {
  const k = cleSession(s.id), base = `${k}.etapes.${i}`;
  if (e.type === 'titre') return `<div class="etape en-edition type-titre">
    <div class="etape-outils">
      <span class="etape-type">§ Titre de partie</span>
      <button class="icon" data-action="mj-etape-monter" data-s="${s.id}" data-i="${i}" aria-label="Monter" ${i ? '' : 'disabled'}>↑</button>
      <button class="icon" data-action="mj-etape-descendre" data-s="${s.id}" data-i="${i}" aria-label="Descendre" ${i < s.etapes.length - 1 ? '' : 'disabled'}>↓</button>
      <button class="icon" data-action="mj-etape-suppr" data-s="${s.id}" data-i="${i}" aria-label="Supprimer">✕</button>
    </div>
    <input type="text" class="titre-partie-saisie" data-mjbind="${base}.titre" value="${esc(e.titre)}" placeholder="Ex. : Partie 1 — L'arrivée à Marsember">
  </div>`;
  const m = mjd();
  const quetes = fichesToutes().filter(f => f.type === 'quete');
  const nomsPNJ = [...new Set([...m.pnj.map(x => x.nom), ...fichesToutes().filter(f => f.type === 'pnj').map(f => f.nom)])];
  let propre = '';
  if (e.type === 'dialogue') propre = `<label class="f"><span>PNJ qui parle</span><input type="text" list="noms-pnj" data-mjbind="${base}.pnj" value="${esc(e.pnj)}" placeholder="Ex. : Gaby"></label>
    <datalist id="noms-pnj">${nomsPNJ.map(n => `<option value="${esc(n)}">`).join('')}</datalist>`;
  if (e.type === 'rencontre') propre = `<label class="f"><span>Combat préparé (onglet Préparation)</span><select data-mjbind="${base}.combatId" data-rerender><option value="">— Aucun : rencontre sans combat —</option>${m.combats.map(c => `<option value="${c.id}" ${e.combatId === c.id ? 'selected' : ''}>${esc(c.nom)}</option>`).join('')}</select></label>`;
  if (e.type === 'objet') propre = `<div class="f"><span class="lbl">Objets en attente à distribuer ici</span>
    ${m.objets.filter(o => o.type !== 'vente').length ? m.objets.filter(o => o.type !== 'vente').map(o => `<label class="check"><input type="checkbox" data-action="mj-etape-objet" data-s="${s.id}" data-i="${i}" data-o="${o.id}" ${(e.objets || []).includes(o.id) ? 'checked' : ''}> ${esc(o.nom || 'Objet')}${o.detenteur ? ` <small>(${esc(o.detenteur)})</small>` : ''}</label>`).join('') : '<p class="empty">Aucun objet en attente : prépare-les dans l\'onglet Objets.</p>'}</div>`;
  if (e.type === 'quete') propre = `<div class="grid">
    <label class="f"><span>Quête (encyclopédie)</span><select data-mjbind="${base}.queteId" data-rerender><option value="">— Choisir —</option>${quetes.map(f => `<option value="${f.id}" ${e.queteId === f.id ? 'selected' : ''}>${esc(f.nom)}</option>`).join('')}</select></label>
    <label class="f"><span>Étape</span><select data-mjbind="${base}.queteAction">${Object.entries(ACTIONS_QUETE).map(([v, l]) => `<option value="${v}" ${e.queteAction === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
  </div>
  <div class="btns"><button class="lien" data-action="mj-quete-nouvelle" data-s="${s.id}" data-i="${i}">+ Nouvelle quête</button>${e.queteId ? `<a class="lien" href="#/fiche/${e.queteId}">Ouvrir ou modifier la fiche de la quête</a>` : ''}</div>`;
  if (e.type === 'image') propre = `<div class="objet-image">
    <button class="image-cadre petite large" data-action="img-choisir" data-type="sessionimg" data-id="${e.id}" aria-label="${e.image ? 'Changer' : 'Ajouter'} l'illustration">${e.image ? `<img src="${e.image}" alt="">` : '<span>+ Illustration</span>'}</button>
    ${e.image ? `<button class="lien" data-action="mj-etape-image-suppr" data-s="${s.id}" data-i="${i}">Retirer</button>` : ''}
  </div>`;
  return `<div class="etape en-edition type-${e.type}">
    <div class="etape-outils">
      <span class="etape-type">${TYPES_ETAPE[e.type][1]} ${TYPES_ETAPE[e.type][0]}</span>
      <button class="icon" data-action="mj-etape-monter" data-s="${s.id}" data-i="${i}" aria-label="Monter" ${i ? '' : 'disabled'}>↑</button>
      <button class="icon" data-action="mj-etape-descendre" data-s="${s.id}" data-i="${i}" aria-label="Descendre" ${i < s.etapes.length - 1 ? '' : 'disabled'}>↓</button>
      <button class="icon" data-action="mj-etape-suppr" data-s="${s.id}" data-i="${i}" aria-label="Supprimer l'étape">✕</button>
    </div>
    <label class="f"><span>Titre</span><input type="text" data-mjbind="${base}.titre" value="${esc(e.titre)}" placeholder="${esc(TYPES_ETAPE[e.type][2])}"></label>
    ${propre}
    <label class="f"><span>${e.type === 'dialogue' ? 'Texte du PNJ' : e.type === 'image' ? 'Légende ou description' : 'Texte'}</span><textarea data-mjbind="${base}.texte" rows="${e.type === 'scene' || e.type === 'dialogue' ? 5 : 3}">${esc(e.texte)}</textarea></label>
    <label class="f xp-etape"><span>XP à attribuer à cette étape</span><input type="text" inputmode="numeric" data-mjbind="${base}.xp" value="${esc(e.xp)}" placeholder="0"></label>
  </div>`;
}

function etapeJeu(s, e, i) {
  if (e.type === 'titre') return `<h3 class="etape-titre-partie"><span>${esc(e.titre || 'Nouvelle partie')}</span></h3>`;
  const m = mjd();
  const t = TYPES_ETAPE[e.type] || TYPES_ETAPE.note;
  let propre = '';
  if (e.type === 'dialogue' && !e.texte && !e.pnj) propre = '';
  else if (e.type === 'dialogue') propre = `<blockquote class="dialogue">${e.pnj ? `<b>${lienFiche(e.pnj)}</b> : ` : ''}${formaterRecit(e.texte).replace(/^<p>|<\/p>$/g, '') || ''}</blockquote>`;
  else if (e.type === 'image') propre = `${e.image ? `<button class="illustration" data-action="ecran-image" data-s="${s.id}" data-i="${i}" aria-label="Afficher sur l'écran des joueurs"><img src="${e.image}" alt=""></button>
      <div class="btns"><button class="btn" data-action="ecran-image" data-s="${s.id}" data-i="${i}">🖥 Écran des joueurs (autre fenêtre)</button><button class="btn ghost" data-action="img-zoom" data-plein="1" data-src="${e.image}">⛶ Plein écran ici</button></div>` : '<p class="empty">Pas encore d\'image.</p>'}${e.texte ? `<p class="hint">${esc(e.texte)}</p>` : ''}`;
  else propre = e.texte ? `<div class="recit-texte">${formaterRecit(e.texte)}</div>` : '';
  if (e.type === 'rencontre' && e.combatId) {
    const c = m.combats.find(x => x.id === e.combatId);
    if (c) {
      const part = (c.participants || []).filter(y => num(y.nombre) > 0).map(y => ({ y, t: m.pnj.find(x => x.id === y.pnjId) })).filter(o => o.t);
      propre += `<div class="rencontre">
        ${part.map(({ y, t: pnj }) => `<details class="effet"><summary>${y.nombre} × ${esc(pnj.nom)} <small>PV ${esc(pnj.pvMax || '?')}, CA ${esc(pnj.ca || '?')}</small></summary>
          ${pnj.attaques ? `<p><b>Attaques :</b> ${esc(pnj.attaques)}</p>` : ''}${pnj.caracs ? `<p>${esc(pnj.caracs)}</p>` : ''}${pnj.notes ? `<p class="hint">${esc(pnj.notes)}</p>` : ''}</details>`).join('')}
        <button class="btn" data-action="mj-etape-combat" data-id="${c.id}">⚔ Lancer ce combat</button>
      </div>`;
    }
  }
  if (e.type === 'objet') {
    const cibles = db.personnages.filter(x => !x._public && (!enLigne() || x.publie));
    propre += (e.objets || []).map(oid => {
      const i2 = m.objets.findIndex(o => o.id === oid);
      if (i2 < 0) return `<p class="objet-donne">✓ ${esc((e.donnes || {})[oid] || 'Objet déjà distribué')}</p>`;
      const o = m.objets[i2];
      return `<div class="objet-vue ${o.image ? 'avec-image' : ''}">
        ${o.image ? `<button class="vignette" data-action="img-zoom" data-src="${o.image}" aria-label="Agrandir"><img src="${o.image}" alt=""></button>` : ''}
        <div class="objet-vue-tete"><b>${esc(o.nom || 'Objet')}</b>${num(o.qte) > 1 ? ` <span class="qte">× ${esc(o.qte)}</span>` : ''}${o.cat ? `<span class="tag-cat cat-${o.cat}">${CATS_OBJET[o.cat]}</span>` : ''}</div>
        ${o.notes ? `<p class="objet-det">${esc(o.notes)}</p>` : ''}
        <div class="row donner"><select id="cible-${o.id}" aria-label="Donner à">${cibles.map(x => `<option value="${x.id}">${esc(x.nom)}</option>`).join('')}<option value="__coffre__">Coffre commun</option></select>
          <button class="btn ghost" data-action="mj-donner" data-i="${i2}" data-session="${s.id}" data-etape="${i}">Donner</button></div>
      </div>`;
    }).join('');
  }
  if (e.type === 'quete' && e.queteId) {
    const f = findFiche(e.queteId);
    const statutVise = { lancement: 'En cours', progression: 'En cours', fin: 'Terminée' }[e.queteAction || 'lancement'];
    propre = `<p class="quete-etape"><span class="tag-cat quete-${e.queteAction || 'lancement'}">${ACTIONS_QUETE[e.queteAction || 'lancement']}</span> ${f ? `<a href="#/fiche/${f.id}">${esc(f.nom)}</a> ${badgeStatut(f)}` : 'Quête supprimée'}</p>
      ${f && f.statut !== statutVise ? `<button class="btn ghost petit" data-action="mj-quete-statut" data-id="${f.id}" data-statut="${statutVise}">Passer la quête à « ${statutVise} »</button>` : ''}` + propre;
  }
  return `<article class="etape type-${e.type} ${e.fait ? 'faite' : ''}">
    <div class="etape-tete">
      <label class="check etape-fait"><input type="checkbox" data-mjbind="${cleSession(s.id)}.etapes.${i}.fait" data-rerender ${e.fait ? 'checked' : ''}><span class="sr">Fait</span></label>
      <span class="etape-ico" aria-hidden="true">${t[1]}</span>
      <b>${esc(e.titre || t[0])}</b>
      ${num(e.xp) ? `<button class="chip xp-chip ${e.xpDonne ? 'on' : ''}" data-action="mj-etape-xp" data-s="${s.id}" data-i="${i}" title="${e.xpDonne ? 'Annuler l\'attribution' : 'Ajouter à l\'XP du groupe'}">${e.xpDonne ? '✓ ' : '+'}${num(e.xp)} XP</button>` : ''}
    </div>
    ${propre}
  </article>`;
}

function pageSessionMJ(s) {
  const prep = state.mjSessionMode === 'prep';
  const etapes = s.etapes || [];
  const reelles = etapes.filter(e => e.type !== 'titre');
  const faits = reelles.filter(e => e.fait).length;
  const k = cleSession(s.id);
  return `<p><button class="lien" data-action="mj-session-fermer">← Toutes les sessions</button></p>
  <section class="card session-tete">
    ${prep ? `<div class="grid">
      ${champMJ(`${k}.numero`, 'Numéro', { num: true })}
      <label class="f"><span>Date prévue</span><input type="date" data-mjbind="${k}.date" value="${esc(s.date)}"></label>
      ${champMJ(`${k}.titre`, 'Titre', { span: true })}
    </div>
    ${champMJ(`${k}.resume`, 'Résumé et objectifs de la session', { area: true, rows: 3 })}`
    : `<p class="recit-num">Session ${esc(s.numero)}${s.date ? ` · ${dateFr(s.date)}` : ''}</p><h2 class="session-titre">${esc(s.titre || 'Sans titre')}</h2>
      ${s.resume ? `<p>${esc(s.resume)}</p>` : ''}`}
    <div class="session-compteurs">
      <span>${faits} / ${reelles.length} étapes jouées</span>
      <span>XP : ${xpDonne(s)} attribués sur ${xpSession(s)} prévus</span>
    </div>
    ${reelles.length ? `<div class="barre"><span style="width:${Math.round(faits / reelles.length * 100)}%"></span></div>` : ''}
    <div class="btns">
      <button class="btn ${prep ? 'ghost' : ''}" data-action="mj-session-mode" data-mode="jeu">▶ Jouer</button>
      <button class="btn ${prep ? '' : 'ghost'}" data-action="mj-session-mode" data-mode="prep">✎ Préparer</button>
    </div>
  </section>
  <div class="etapes">${etapes.map((e, i) => prep ? etapeEdition(s, e, i) : etapeJeu(s, e, i)).join('') || '<p class="empty">Aucune étape. Passe en mode Préparer pour construire le scénario.</p>'}</div>
  ${prep ? `<section class="card"><h3>Ajouter une étape</h3>
    <div class="ajout-etapes">${Object.entries(TYPES_ETAPE).map(([t, [l, ico, d]]) => `<button class="ajout-etape" data-action="mj-etape-ajout" data-s="${s.id}" data-type="${t}"><span>${ico}</span><b>${l}</b><small>${d}</small></button>`).join('')}</div>
    <div class="btns" style="margin-top:1rem"><button class="btn danger" data-action="mj-session-suppr" data-id="${s.id}">Supprimer la session</button></div>
  </section>` : ''}`;
}

/* ===== Effets à durée (buffs, debuffs) suivis au fil des rounds du combat du MJ =====
   Un effet est rangé sur la fiche de celui qui le lance :
   { id, nom, cible, type: 'buff' | 'debuff', rounds, debut, combat, reste, texte }
   En combat, le temps restant se calcule avec le round publié par le MJ ;
   hors combat, il se décompte à la main. */
const combatPublic = () => (db.combatPublic && db.combatPublic.id ? db.combatPublic : null);
function resteEffet(ef) {
  const cp = combatPublic();
  if (ef.combat && cp && cp.id === ef.combat) return num(ef.debut) + num(ef.rounds) - num(cp.round);
  if (ef.combat && (!cp || cp.id !== ef.combat)) return null; // combat terminé
  return num(ef.reste ?? ef.rounds);
}
/* Tous les effets qui concernent un personnage : les siens et ceux que d'autres ont lancés sur lui */
function effetsSur(p) {
  const res = [];
  for (const x of db.personnages) {
    for (const ef of x.effets || []) {
      const surMoi = ef.cible === 'soi' ? x.id === p.id : norm(ef.cible) === norm(p.nom);
      if (surMoi || x.id === p.id) res.push({ ef, lanceur: x, surMoi });
    }
  }
  return res;
}

/* Durée d'un sort en rounds, d'après sa description de durée et le niveau de lanceur */
function dureeSort(s, e) {
  const t = norm(s?.duree || '');
  const cl = Math.max(1, e.lanceur || 1);
  const m = t.match(/(\d+)\s*(rounds?|min|minutes?|heures?|h\b)/);
  if (!m) return '';
  const n = Number(m[1]);
  const unite = /^round/.test(m[2]) ? 1 : /^min/.test(m[2]) ? 10 : 600;
  const parNiveau = /niveau/.test(t.slice(m.index, m.index + 40));
  return String(n * unite * (parNiveau ? cl : 1));
}
/* Durée d'une capacité saisie : nombre, ou formule avec niv, sag, con, cha, int… (ex. « sag », « 10 », « niv+3 ») */
function dureeCapacite(txt, e, k) {
  if (!txt) return '';
  const f = String(txt).toLowerCase().replace(/niv(eau)?/g, String(k || e.niveau)).replace(/\b(for|dex|con|int|sag|cha)\b/g, c => String(e.mods[c] || 0));
  return /^[\d+\-*\s()]+$/.test(f) ? String(Math.max(0, Function('return (' + f + ')')())) : '';
}

function ouvrirFormEffet(p, base) {
  state.effetForm = { persoId: p.id, nom: base.nom || '', rounds: base.rounds || '', cible: 'soi', type: 'buff', texte: base.texte || '' };
  render();
}
function formEffet() {
  const f = state.effetForm;
  const p = findPerso(f.persoId);
  if (!p) return '';
  const cp = combatPublic();
  const allies = db.personnages.filter(x => x.id !== p.id && estMembre(x) && (!enLigne() || x.publie)).map(x => x.nom);
  const ennemis = (cp?.noms || []).filter(n => !db.personnages.some(x => norm(x.nom) === norm(n)));
  return `<div class="tiroir-fond" data-action="effet-annuler"></div>
  <div class="modal-effet" role="dialog" aria-label="Effet qui dure">
    <h3>Un effet qui dure ?</h3>
    <p class="hint">${cp ? `Combat en cours : <b>${esc(cp.nom)}</b>, round ${esc(cp.round)}. Le décompte suivra les tours du MJ.` : 'Pas de combat en cours : le décompte se fera à la main.'}</p>
    <label class="f"><span>Effet</span><input type="text" id="ef-nom" value="${esc(f.nom)}"></label>
    <div class="grid">
      <label class="f"><span>Sur qui ?</span><select id="ef-cible">
        <option value="soi">Moi-même (${esc(p.nom)})</option>
        ${allies.length ? `<optgroup label="Alliés">${allies.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</optgroup>` : ''}
        ${ennemis.length ? `<optgroup label="Adversaires">${ennemis.map(n => `<option value="${esc(n)}">${esc(n)}</option>`).join('')}</optgroup>` : ''}
      </select></label>
      <label class="f"><span>Durée (rounds)</span><input type="text" inputmode="numeric" id="ef-rounds" value="${esc(f.rounds)}" placeholder="10"></label>
    </div>
    <p class="hint">1 minute = 10 rounds. Un effet sur un adversaire est compté comme un affaiblissement.</p>
    <label class="f"><span>Rappel de l'effet (facultatif)</span><input type="text" id="ef-texte" value="${esc(f.texte)}" placeholder="Ex. : +7 dégâts à mains nues"></label>
    <div class="btns"><button class="btn" data-action="effet-creer">Démarrer l'effet</button><button class="btn ghost" data-action="effet-annuler">Pas d'effet durable</button></div>
  </div>`;
}
function creerEffet() {
  const f = state.effetForm;
  const p = findPerso(f.persoId);
  const rounds = Math.max(1, Math.round(num($('#ef-rounds').value)) || 1);
  const cible = $('#ef-cible').value;
  const cp = combatPublic();
  const ennemi = cible !== 'soi' && !db.personnages.some(x => norm(x.nom) === norm(cible));
  const ef = { id: uid(), nom: $('#ef-nom').value.trim() || 'Effet', cible, type: ennemi ? 'debuff' : 'buff', rounds, texte: $('#ef-texte').value.trim(), debut: cp ? num(cp.round) : 0, combat: cp ? cp.id : '', reste: rounds };
  p.effets = [...(p.effets || []).filter(x => resteEffet(x) == null || resteEffet(x) > 0), ef];
  state.effetForm = null;
  p.maj = Date.now(); saveNow(); persoModifie(p); render();
  toast(`${ef.nom} : ${rounds} round${rounds > 1 ? 's' : ''}`);
}

function blocEffets(p) {
  const l = effetsSur(p);
  const cpMJ = combatPublic();
  for (const ef of cpMJ?.effets || []) if (norm(ef.cible) === norm(p.nom)) l.push({ ef: { ...ef, id: 'mj', combat: cpMJ.id, cible: p.nom }, lanceur: { id: 'mj', nom: 'le MJ' }, surMoi: true });
  const cp = combatPublic();
  const mod = peutModifier(p);
  const ligne = ({ ef, lanceur, surMoi }) => {
    const r = resteEffet(ef);
    const fini = r != null && r <= 0;
    const cibleTxt = ef.cible === 'soi' ? (lanceur.id === p.id ? 'sur toi' : `sur ${lanceur.nom}`) : `sur ${ef.cible}`;
    const deQui = lanceur.id === p.id ? '' : ` · lancé par ${lanceur.nom}`;
    return `<div class="effet-actif ${ef.type} ${fini ? 'fini' : ''}">
      <div><b>${esc(ef.nom)}</b> <small>${esc(cibleTxt + deQui)}</small>${ef.texte ? `<br><small>${esc(ef.texte)}</small>` : ''}</div>
      <span class="effet-reste">${r == null ? 'combat terminé' : fini ? 'terminé' : `${r} round${r > 1 ? 's' : ''}`}</span>
      ${mod && lanceur.id === p.id ? `${!ef.combat && r > 0 ? `<button class="icon" data-action="effet-tick" data-id="${ef.id}" title="Un round s'est écoulé">−1</button>` : ''}<button class="icon" data-action="effet-suppr" data-id="${ef.id}" aria-label="Retirer l'effet">✕</button>` : ''}
    </div>`;
  };
  return `<div class="effets-bloc">
    ${cp ? `<p class="combat-public">⚔ <b>${esc(cp.nom)}</b> · round ${esc(cp.round)}${cp.tour ? ` · au tour de <b>${esc(cp.tour)}</b>` : ''}</p>` : ''}
    <div class="effets-tete"><h4>Effets actifs</h4>${mod ? '<button class="lien" data-action="effet-nouveau">+ Effet</button>' : ''}</div>
    ${l.length ? l.map(ligne).join('') : '<p class="empty">Aucun effet en cours.</p>'}
  </div>`;
}

/* ----- Côté MJ : état public du combat et effets visibles dans l'ordre de jeu ----- */
function publierCombat() {
  const c = mjd().combat;
  const actifs = c ? c.combattants.filter(x => x.actif) : [];
  const etat = c && c.phase === 'combat' ? {
    id: c.id, nom: c.nom, round: c.round,
    tour: (actifs.length ? actifs[c.tour % actifs.length] : null)?.nom || '',
    noms: actifs.filter(x => !x.mort).map(x => x.nom),
    effets: actifs.filter(x => x.persoId).flatMap(x => (x.effets || []).map(ef => ({ cible: x.nom, nom: ef.nom, debut: ef.debut, rounds: ef.rounds, type: ef.type }))),
  } : {};
  db.combatPublic = etat;
  saveNow();
  if (enLigne() && estMJ()) rpc('mj_combat_public', { p_code: db.codeMJ, p_etat: etat }).catch(e => statutSync('Combat non publié (base en v10 ?) : ' + e.message, true));
}
function effetsDuCombattant(x, c) {
  const res = [];
  for (const p of db.personnages) for (const ef of p.effets || []) {
    if (ef.combat !== c.id) continue;
    const cible = ef.cible === 'soi' ? p.nom : ef.cible;
    if (norm(cible) === norm(x.nom)) res.push({ nom: ef.nom, reste: num(ef.debut) + num(ef.rounds) - num(c.round), type: ef.type, de: p.nom });
  }
  for (const ef of x.effets || []) res.push({ nom: ef.nom, reste: num(ef.debut) + num(ef.rounds) - num(c.round), type: ef.type || 'debuff', de: 'MJ' });
  return res.filter(r => r.reste > 0);
}

/* ----- Ce que porte chaque personnage (tiroir et tableau du MJ) ----- */
function porteDe(x) {
  const eq = (x.equipement || []);
  const porte = it => it.equipe !== false;
  const nom = it => it.nom || CATS_OBJET[it.cat] || 'Objet';
  return {
    armure: eq.filter(it => it.cat === 'armure' && porte(it)),
    bouclier: eq.filter(it => it.cat === 'bouclier' && porte(it)),
    vetements: eq.filter(it => it.cat === 'vetement' && porte(it)),
    magiques: eq.filter(it => (it.cat === 'magique' || it.focalisateur) && porte(it)),
    divers: eq.filter(it => ['', 'babiole', 'fourniture', 'tresor'].includes(it.cat || '') && !it.focalisateur).length,
    armes: eq.filter(it => it.cat === 'arme'),
    nom,
  };
}
function listeObjetsMJ(l, nom) {
  if (!l.length) return '<span class="vide">—</span>';
  return l.map(it => {
    const bonus = (it.bonus || []).filter(b => b.cible && num(b.val));
    const info = [it.notes, ...bonus.map(b => `${R.signe(num(b.val))} ${NOM_CIBLE[b.cible] || b.cible}${b.cond ? ' (' + (b.quand || 'sous condition') + ')' : ''}`)].filter(Boolean).join(' · ');
    return `<span class="porte-objet ${it.focalisateur ? 'focal' : ''}" ${info ? `title="${esc(info)}"` : ''}>${esc(nom(it))}${it.focalisateur ? ' ✦' : ''}${bonus.length ? ' <small>•</small>' : ''}</span>`;
  }).join('');
}
const nomArme = t => it => (R.ARME[it.armeType] && it.nom && norm(it.nom) !== norm(R.ARME[it.armeType].nom) ? R.ARME[it.armeType].nom + ' — ' : '') + t.nom(it);
function tableauPorteMJ(persos) {
  if (!persos.length) return '';
  const ligne = (ico, titre, html) => `<div class="porte-ligne"><span class="porte-ico" aria-hidden="true">${ico}</span><span class="porte-titre">${titre}</span><div class="porte-liste">${html}</div></div>`;
  return `<section class="card"><h3>Ce que porte le groupe</h3>
    <div class="porte-cartes">${persos.map(x => {
      const t = porteDe(x), e = etat(x);
      const bag = x.baguette?.nom || x.baguette?.photo ? `${esc(x.baguette.nom || 'sans nom')}${x.baguette.possedee === false ? ' <small>(perdue)</small>' : ''}` : '';
      return `<article class="porte-carte">
        <header><button class="lien porte-nom" data-action="mj-tiroir" data-id="${x.id}">${esc(x.nom)}</button><small>${esc([raceNom(x), classesTxt(e)].filter(Boolean).join(', '))}</small></header>
        ${ligne('🛡️', 'Protection', [...t.armure, ...t.bouclier].length ? listeObjetsMJ([...t.armure, ...t.bouclier], t.nom) : '<span class="vide">aucune</span>')}
        ${t.vetements.length ? ligne('👘', 'Vêtements', listeObjetsMJ(t.vetements, t.nom)) : ''}
        ${t.magiques.length ? ligne('✨', 'Magie', listeObjetsMJ(t.magiques, t.nom)) : ''}
        ${bag ? ligne('🪄', 'Baguette', `<span class="porte-objet focal">${bag}</span>`) : ''}
        ${t.armes.length ? ligne('⚔️', 'Armes', listeObjetsMJ(t.armes, nomArme(t))) : ''}
        ${t.divers ? `<p class="porte-divers">+ ${t.divers} objet${t.divers > 1 ? 's' : ''} divers dans le sac</p>` : ''}
      </article>`;
    }).join('')}</div>
    <p class="hint aide">Un point • signale un objet avec des bonus : survole-le pour les voir. Touche un nom pour ouvrir le détail complet.</p>
  </section>`;
}
function tiroirMJ() {
  const x = findPerso(state.mjTiroir);
  if (!x) return '';
  const e = etat(x), st = stats(x, e), b = barrePV(x), t = porteDe(x), pr = protections(x, e, st);
  const sortA = x.baguette?.sortAncre && findSort(x.baguette.sortAncre);
  const ligne = (titre, html) => `<div class="tiroir-ligne"><span>${titre}</span><div>${html}</div></div>`;
  const nomI = Object.fromEntries(IMMUNITES);
  return `<div class="tiroir-fond" data-action="mj-tiroir-fermer"></div>
  <aside class="tiroir" role="dialog" aria-label="Détail de ${esc(x.nom)}">
    <div class="tiroir-tete">
      ${x.portrait ? `<img src="${x.portrait}" alt="">` : '<span class="vide"></span>'}
      <div><b>${esc(x.nom)}</b><small>${esc([raceNom(x), classesTxt(e)].filter(Boolean).join(', '))}</small></div>
      <button class="icon" data-action="mj-tiroir-fermer" aria-label="Fermer">✕</button>
    </div>
    <p class="tiroir-pv pv-${b.etat}"><b>${b.act}</b> / ${b.max || '—'} PV · CA ${st.ca} (contact ${st.contact}, dépourvu ${st.depourvu})</p>
    ${ligne('Armure', listeObjetsMJ(t.armure, t.nom))}
    ${ligne('Bouclier', listeObjetsMJ(t.bouclier, t.nom))}
    ${ligne('Vêtements', listeObjetsMJ(t.vetements, t.nom))}
    ${ligne('Objets magiques', listeObjetsMJ(t.magiques, t.nom))}
    ${ligne('Armes', listeObjetsMJ(t.armes, nomArme(t)))}
    ${ligne('Baguette', x.baguette?.nom || x.baguette?.photo ? `${esc(x.baguette.nom || 'sans nom')}${sortA ? ` <small>(sort ancré : ${esc(sortA.nom)})</small>` : ''}` : '<span class="vide">—</span>')}
    ${ligne('Sauvegardes', `Vig ${R.signe(st.js.vig)} · Réf ${R.signe(st.js.ref)} · Vol ${R.signe(st.js.vol)} · Init ${R.signe(st.init)}`)}
    ${ligne('Protections', [ENERGIES.filter(([k]) => pr.res[k]).map(([k, l]) => `résist. ${l.replace(/^(à l'|au |à la )/, '')} ${pr.res[k]}`).join(', '), ENERGIES.filter(([k]) => pr.moitie.has(k)).map(([k, l]) => `½ dégâts ${l.replace(/^(à l'|au |à la )/, '')}`).join(', '), pr.rm ? `RM ${pr.rm}` : '', pr.rd.length ? `RD ${pr.rd.join(', ')}` : '', pr.imm.length ? `immunités : ${pr.imm.map(k => nomI[k]).join(', ')}` : ''].filter(Boolean).join(' · ') || '<span class="vide">—</span>')}
    ${Object.keys(e.objets.cond).length ? ligne('Conditionnels', Object.entries(e.objets.cond).flatMap(([k, l]) => l.map(c => `<span class="bonus-cond">${R.signe(c.val)} ${esc(NOM_CIBLE[k] || k)}</span> <small>${esc(c.quand)}</small>`)).join('<br>')) : ''}
    ${ligne('Bourse', esc(piecesTxt(x.argent)) + historiqueBourse(x, 3))}
    ${ligne('Rations', `${nbRations(x)}`)}
    ${ligne('Langues', esc((x.langues || []).join(', ') || '—'))}
    ${(x.etats || []).filter(et => et.actif !== false).length ? ligne('États', (x.etats || []).filter(et => et.actif !== false).map(et => `<span class="etat-puce ${gravite(et)}">${esc(et.nom)}</span>`).join(' ')) : ''}
    ${(x.sorts || []).length ? ligne('Sorts connus', esc((x.sorts || []).map(y => findSort(y.id)?.nom).filter(Boolean).join(', '))) : ''}
    <a class="btn ghost" href="#/perso/${x.id}/fiche">Ouvrir la fiche complète</a>
  </aside>`;
}

/* ===== Ajout rapide d'objets : copier-coller depuis Excel (ou un fichier CSV) =====
   Une ligne par objet. Avec une ligne d'en-tête, les colonnes sont reconnues par leur nom,
   dans n'importe quel ordre ; sans en-tête, l'ordre du modèle est utilisé. */
const COLONNES_OBJET = [
  ['nom', 'Nom', ['nom', 'objet', 'name', 'article']],
  ['cat', 'Catégorie', ['categorie', 'cat', 'type d objet', 'type']],
  ['qte', 'Quantité', ['quantite', 'qte', 'qté', 'nombre', 'nb', 'stock']],
  ['valeur', 'Valeur', ['valeur', 'prix', 'cout']],
  ['unite', 'Monnaie', ['monnaie', 'unite', 'devise', 'piece']],
  ['poids', 'Poids', ['poids']],
  ['notes', 'Notes', ['notes', 'note', 'description', 'effet', 'commentaire']],
  ['detenteur', 'Détenteur', ['detenteur', 'pnj', 'marchand', 'vendeur', 'proprietaire']],
  ['vente', 'À vendre', ['a vendre', 'vente', 'destination']],
  ['marche', 'Marché', ['marche']],
];
const SYN_CAT = {
  arme: ['arme', 'armes', 'weapon'], armure: ['armure', 'armures'], bouclier: ['bouclier', 'boucliers'], vetement: ['vetement', 'vetements', 'habit', 'tenue'],
  magique: ['objet magique', 'magique', 'magie', 'focalisateur'], munition: ['munition', 'munitions', 'fleche', 'carreau'],
  consommable: ['potion', 'elixir', 'flacon', 'fiole', 'consommable'], fourniture: ['fourniture', 'fournitures', 'materiel', 'outil'],
  ration: ['ration', 'rations', 'nourriture', 'vivres'], tresor: ['tresor', 'tresors', 'gemme', 'bijou'], babiole: ['babiole', 'babioles', 'bibelot'],
};
function lireCategorie(txt) {
  const t = norm(txt).trim();
  if (!t) return '';
  for (const [k, l] of Object.entries(SYN_CAT)) if (l.some(x => t === x || t.startsWith(x))) return k;
  return '';
}
function analyserObjets(texte) {
  const lignes = String(texte || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lignes.length) return { objets: [], entete: false };
  const sep = lignes.some(l => l.includes('\t')) ? '\t' : lignes[0].includes(';') ? ';' : ',';
  const decouper = l => l.split(sep).map(c => c.trim().replace(/^"(.*)"$/, '$1'));
  let ordre = COLONNES_OBJET.map(c => c[0]);
  const premiere = decouper(lignes[0]).map(c => norm(c).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim());
  const entete = premiere.some(c => ['nom', 'objet', 'article'].includes(c));
  if (entete) {
    ordre = premiere.map(c => (COLONNES_OBJET.find(([, , syn]) => syn.includes(c)) || [null])[0]);
    lignes.shift();
  }
  const objets = lignes.map(l => {
    const cases = decouper(l);
    const o = {};
    ordre.forEach((k, i) => { if (k && cases[i] != null && cases[i] !== '') o[k] = cases[i]; });
    if (!o.nom) return null;
    const it = { id: uid(), nom: o.nom, cat: lireCategorie(o.cat), qte: String(Math.max(1, Math.round(nombre(o.qte)) || 1)), poids: o.poids || '', notes: o.notes || '' };
    /* « 25 po », « 3,5 pa »… dans la colonne Valeur */
    const v = String(o.valeur || '').match(/([\d.,]+)\s*(pp|po|pa|pc)?/i);
    if (v) { it.valeur = v[1].replace('.', ','); it.valeurUnite = (o.unite || v[2] || 'po').toLowerCase().slice(0, 2); }
    /* Types d'armes et d'armures des règles, reconnus par leur nom */
    const arme = R.ARMES.find(a => norm(a.nom) === norm(o.nom) || norm(o.cat || '').includes(norm(a.nom)));
    const armure = R.ARMURES.find(a => norm(a.nom) === norm(o.nom) || norm(o.cat || '').includes(norm(a.nom)));
    if (arme && (!it.cat || it.cat === 'arme')) Object.assign(it, { cat: 'arme', armeType: arme.id, degats: arme.deg, critique: arme.crit, portee: arme.portee, mode: arme.prise === 'distance' ? 'distance' : '' });
    else if (armure && (!it.cat || it.cat === 'armure' || it.cat === 'bouclier')) Object.assign(it, { cat: armure.type === 'bouclier' ? 'bouclier' : 'armure', armureType: armure.id });
    if (/focal/.test(norm(o.cat || ''))) it.focalisateur = true;
    it._detenteur = o.detenteur || '';
    it._vente = /^(oui|o|x|vente|a vendre|1|vrai|true)$/.test(norm(o.vente || ''));
    it._marche = o.marche || '';
    return it;
  }).filter(Boolean);
  return { objets, entete };
}
/* Ajout rapide de PNJ depuis Excel : même principe que pour les objets */
const COLONNES_PNJ = [
  ['nom', 'Nom', ['nom', 'pnj', 'creature', 'name']], ['camp', 'Camp', ['camp', 'cote', 'allegeance']],
  ['pvMax', 'PV', ['pv', 'points de vie', 'hp', 'pv max']], ['ca', 'CA', ['ca', 'classe d armure', 'ac']],
  ['init', 'Initiative', ['initiative', 'init']], ['attaques', 'Attaques', ['attaques', 'attaque', 'armes']],
  ['caracs', 'Caractéristiques', ['caracteristiques', 'caracs', 'stats']], ['notes', 'Notes', ['notes', 'description', 'pouvoirs']],
  ['fp', 'FP', ['fp', 'facteur de puissance', 'cr']], ['nombre', 'Nombre', ['nombre', 'nb', 'quantite']],
];
function analyserPNJ(texte) {
  const lignes = String(texte || '').replace(/\r/g, '').split('\n').filter(l => l.trim());
  if (!lignes.length) return { pnj: [], entete: false };
  const sep = lignes.some(l => l.includes('\t')) ? '\t' : lignes[0].includes(';') ? ';' : ',';
  const dec = l => l.split(sep).map(c => c.trim().replace(/^"(.*)"$/, '$1'));
  let ordre = COLONNES_PNJ.map(c => c[0]);
  const prem = dec(lignes[0]).map(c => norm(c).replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim());
  const entete = prem.some(c => ['nom', 'pnj', 'creature'].includes(c));
  if (entete) { ordre = prem.map(c => (COLONNES_PNJ.find(([, , syn]) => syn.includes(c)) || [null])[0]); lignes.shift(); }
  const pnj = [];
  for (const l of lignes) {
    const cases = dec(l), o = {};
    ordre.forEach((k, i) => { if (k && cases[i]) o[k] = cases[i]; });
    if (!o.nom) continue;
    const camp = /alli|ami/.test(norm(o.camp || '')) ? 'allie' : /neutre/.test(norm(o.camp || '')) ? 'neutre' : 'ennemi';
    const n = Math.max(1, Math.min(30, Math.round(num(o.nombre)) || 1));
    for (let k = 1; k <= n; k++) pnj.push({ id: uid(), nom: n > 1 ? `${o.nom} ${k}` : o.nom, camp, pvMax: String(Math.round(num(o.pvMax)) || ''), ca: String(Math.round(num(o.ca)) || ''),
      init: String(o.init || '').replace('+', ''), attaques: o.attaques || '', caracs: o.caracs || '', notes: o.notes || '', fp: o.fp || '', butin: [] });
  }
  return { pnj, entete };
}
function blocAjoutPNJ() {
  const st = state.ajoutPNJ;
  const res = st ? analyserPNJ(st) : null;
  return `<details class="ajout-rapide" ${st ? 'open' : ''}><summary>⚡ Ajout rapide de PNJ : copier-coller depuis Excel</summary>
    <p class="hint">Une ligne par PNJ. Colonnes : <b>${COLONNES_PNJ.map(c => c[1]).join(' · ')}</b>. Camp : ennemi, allié ou neutre. « Nombre » crée plusieurs exemplaires numérotés (Gobelin 1, Gobelin 2…).</p>
    <textarea id="ajout-pnj" rows="5" placeholder="Nom&#9;Camp&#9;PV&#9;CA&#9;Initiative&#9;Attaques&#10;Garde de Westgate&#9;ennemi&#9;11&#9;15&#9;1&#9;Épée longue +3 (1d8+1)">${esc(st || '')}</textarea>
    <div class="btns">
      <button class="btn ghost" data-action="ajout-pnj-voir">Vérifier</button>
      ${res && res.pnj.length ? `<button class="btn" data-action="ajout-pnj-ok">Ajouter les ${res.pnj.length} PNJ</button>` : ''}
      <button class="lien" data-action="ajout-pnj-modele">Télécharger le modèle Excel</button>
    </div>
    ${res ? (res.pnj.length ? `<div class="table-defile"><table class="table-porte apercu-objets"><thead><tr><th>Nom</th><th>Camp</th><th>PV</th><th>CA</th><th>Init.</th><th>Attaques</th><th>FP</th></tr></thead>
      <tbody>${res.pnj.map(x => `<tr><td>${esc(x.nom)}</td><td>${esc(x.camp)}</td><td>${esc(x.pvMax || '—')}</td><td>${esc(x.ca || '—')}</td><td>${esc(x.init || '—')}</td><td>${esc(x.attaques || '—')}</td><td>${esc(x.fp || '—')}</td></tr>`).join('')}</tbody></table></div>` : '<p class="empty">Aucune ligne reconnue : il faut au moins une colonne Nom.</p>') : ''}
  </details>`;
}
function blocAjoutRapide(cible) {
  const st = state.ajoutRapide && state.ajoutRapide.cible === cible ? state.ajoutRapide : null;
  const res = st ? analyserObjets(st.texte) : null;
  const mj = cible === 'mj';
  return `<details class="ajout-rapide" ${st ? 'open' : ''}><summary>⚡ Ajout rapide : copier-coller depuis Excel</summary>
    <p class="hint aide">Sélectionne tes lignes dans Excel (ou Google Sheets), copie, puis colle-les ici. Une ligne par objet. Garde la ligne d'en-tête si tu peux : les colonnes sont alors reconnues dans n'importe quel ordre.</p>
    <p class="hint">Colonnes : <b>${COLONNES_OBJET.filter(c => mj || !['detenteur', 'vente', 'marche'].includes(c[0])).map(c => c[1]).join(' · ')}</b>. Catégories acceptées : arme, armure, bouclier, vêtement, objet magique, munition, potion, fourniture, ration, trésor, babiole. Les armes et armures des règles (« Épée longue », « Cuirasse »…) sont reconnues avec leurs caractéristiques.</p>
    <textarea id="ajout-rapide-${cible}" rows="6" placeholder="Nom&#9;Catégorie&#9;Quantité&#9;Valeur&#10;Potion de soins légers&#9;potion&#9;3&#9;50 po">${esc(st?.texte || '')}</textarea>
    <div class="btns">
      <button class="btn ghost" data-action="ajout-rapide-voir" data-cible="${cible}">Vérifier</button>
      ${res && res.objets.length ? `<button class="btn" data-action="ajout-rapide-ok" data-cible="${cible}">Ajouter les ${res.objets.length} objet${res.objets.length > 1 ? 's' : ''}</button>` : ''}
      <button class="lien" data-action="ajout-rapide-modele" data-cible="${cible}">Télécharger le modèle Excel</button>
    </div>
    ${res ? (res.objets.length ? `<div class="table-defile"><table class="table-porte apercu-objets"><thead><tr><th>Nom</th><th>Catégorie</th><th>Qté</th><th>Valeur</th><th>Poids</th>${mj ? '<th>Détenteur</th><th>Destination</th>' : ''}<th>Notes</th></tr></thead>
      <tbody>${res.objets.map(o => `<tr><td>${esc(o.nom)}${o.armeType || o.armureType ? ' <small>✓ règles</small>' : ''}</td><td>${esc(CATS_OBJET[o.cat || ''])}</td><td>${esc(o.qte)}</td><td>${o.valeur ? esc(prixTxt(o.valeur, o.valeurUnite)) : '—'}</td><td>${esc(o.poids || '—')}</td>${mj ? `<td>${esc(o._detenteur || '—')}</td><td>${o._vente ? `À vendre${o._marche ? ' · ' + esc(o._marche) : ''}` : 'Butin'}</td>` : ''}<td>${esc(o.notes || '')}</td></tr>`).join('')}</tbody></table></div>
      <p class="hint">${res.entete ? 'En-tête reconnu.' : 'Pas d\'en-tête : ordre du modèle utilisé.'} Vérifie l'aperçu, puis ajoute.</p>` : '<p class="empty">Aucune ligne reconnue : il faut au moins une colonne Nom.</p>') : ''}
  </details>`;
}
function ajouterObjetsRapides(cible) {
  const res = analyserObjets(state.ajoutRapide?.texte);
  if (!res.objets.length) return 0;
  const nettoyer = ({ _detenteur, _vente, _marche, ...o }) => o;
  if (cible === 'mj') {
    for (const o of res.objets) {
      const m = o._marche && listeMarches().find(x => norm(x.nom) === norm(o._marche));
      mjd().objets.push({ ...nettoyer(o), detenteur: o._detenteur, type: o._vente ? 'vente' : '', marcheId: m ? m.id : (o._vente ? listeMarches()[0].id : undefined) });
    }
    saveMJ('objets');
  } else {
    const p = state.ctx;
    p.equipement = [...(p.equipement || []), ...res.objets.map(nettoyer)];
    save();
  }
  return res.objets.length;
}
function telechargerModeleObjets(cible) {
  const cols = COLONNES_OBJET.filter(c => cible === 'mj' || !['detenteur', 'vente', 'marche'].includes(c[0])).map(c => c[1]);
  const ex = cible === 'mj'
    ? [['Potion de soins légers', 'Potion', '3', '50', 'po', '', 'Soigne 1d8+1 PV', 'Rudolf Reich', 'oui', 'Marché noir'], ['Épée longue', 'Arme', '1', '15', 'po', '2 kg', '', 'Garde régihus', 'non', '']]
    : [['Potion de soins légers', 'Potion', '3', '50', 'po', '', 'Soigne 1d8+1 PV'], ['Corde en chanvre (15 m)', 'Fourniture', '1', '1', 'po', '5 kg', '']];
  const csv = '\ufeff' + [cols, ...ex].map(l => l.map(c => /[;"\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c).join(';')).join('\r\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'modele-objets.csv';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ----- Page MJ à onglets ----- */
function pageMJ2() {
  if (!estMJ()) return pageMJReelle();
  const o = state.mjOnglet || 'groupe';
  const m = mjd();
  const onglets = [['groupe', 'Groupe'], ['sessions', 'Sessions'], ['combat', m.combat ? 'Combat ⚔' : 'Combat'], ['prepa', 'Préparation'], ['objets', `Objets${m.objets.length ? ' (' + m.objets.length + ')' : ''}`], ['notes', 'Notes']];
  let corps;
  if (o === 'combat') corps = pageCombatMJ();
  else if (o === 'sessions') corps = pageSessionsMJ();
  else if (o === 'objets') corps = pageObjetsMJ();
  else if (o === 'notes') corps = `<section class="card"><h3>Notes secrètes</h3>${champMJ('notes', 'Rien que pour toi', { area: true, rows: 14 })}</section>`;
  else if (o === 'prepa') {
    corps = `${carteBestiaire()}${cartePNJGen()}${carteHistoriqueMJ()}<section class="card"><h3>PNJ et créatures</h3>
      <div class="pnjs">${m.pnj.map((x, i) => state.mjEdit === 'pnj:' + x.id ? formPNJ(x, i) : cartePNJ(x, i)).join('') || '<p class="empty">Aucun PNJ préparé.</p>'}</div>
      <button class="btn ghost" data-action="mj-pnj-ajout">+ Préparer un PNJ</button>${blocAjoutPNJ()}</section>
      <section class="card"><h3>Combats préparés</h3>
      <div class="pnjs">${m.combats.map((c, i) => state.mjEdit === 'combat:' + c.id ? formCombat(c, i) : carteCombatPrep(c, i)).join('') || '<p class="empty">Aucun combat préparé.</p>'}</div>
      <button class="btn ghost" data-action="mj-combat-ajout">+ Préparer un combat</button></section>`;
  } else {
    corps = pageMJReelle().replace(/<section class="card"><h3>Combat en cours[\s\S]*$/, '')
      .replace(/<div class="pagehead">[\s\S]*?Quitter le mode MJ<\/button><\/div>/, '')
      .replace('<section class="card mj-actions">', carteXP() + '<section class="card mj-actions">')
      .replace('<section class="card"><h3>Personnages du MJ</h3>', tableauPorteMJ(db.personnages.filter(x => !x._public && estMembre(x) && (!enLigne() || x.publie))) + '<section class="card"><h3>Personnages du MJ</h3>');
  }
  const tete = `<div class="pagehead"><div><h1>Espace MJ</h1><p class="sub">Jour ${esc(db.jour || 1)} de l'aventure${state.persosCharges ? `, mis à jour à ${new Date(state.persosCharges).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}</p></div>
    <button class="btn danger" data-action="mj-sortir">Quitter le mode MJ</button></div>`;
  return `${state.mjTiroir ? tiroirMJ() : ''}${tete}<nav class="tabs mj-onglets" aria-label="Espace MJ">${onglets.map(([k, l]) => `<a href="#/mj" data-action="mj-onglet" data-o="${k}" class="${o === k ? 'active' : ''}">${l}</a>`).join('')}</nav>${corps}`;
}

/* ===== Monnaies ===== */
const UNITES = [['po', 'po (or)'], ['pa', 'pa (argent)'], ['pc', 'pc (cuivre)'], ['pp', 'pp (platine)']];
const MULT_PC = { pp: 1000, po: 100, pa: 10, pc: 1 };
const nombre = v => num(String(v ?? '').replace(',', '.'));
const enPo = (v, u) => nombre(v) * (MULT_PC[u || 'po'] || 100) / 100;
const prixTxt = (v, u) => `${String(v ?? '').replace('.', ',')} ${u || 'po'}`;
const selUnite = (attr, cur) => `<select ${attr} class="unite" aria-label="Monnaie">${UNITES.map(([k, l]) => `<option value="${k}" ${(cur || 'po') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`;
const bourseEnPc = b => ['pp', 'po', 'pa', 'pc'].reduce((t, k) => t + nombre((b || {})[k]) * MULT_PC[k], 0);
function bourseDepuisPc(n, ppAvant = 0) {
  const pp = Math.min(Math.max(0, ppAvant), Math.floor(n / 1000));
  n -= pp * 1000;
  return { pp: String(pp), po: String(Math.floor(n / 100)), pa: String(Math.floor((n % 100) / 10)), pc: String(n % 10) };
}
/* Ajout d'un delta en pièces, avec rendu de monnaie si besoin (même règle que la base) */
function bourseLocalePlus(b, d) {
  const r = {};
  let negatif = false;
  for (const k of ['pp', 'po', 'pa', 'pc']) { r[k] = nombre((b || {})[k]) + nombre((d || {})[k]); if (r[k] < 0) negatif = true; }
  if (bourseEnPc(r) < 0) throw new Error('Pas assez d\'argent');
  return negatif ? bourseDepuisPc(bourseEnPc(r), r.pp) : Object.fromEntries(Object.entries(r).map(([k, v]) => [k, String(v)]));
}
const piecesTxt = b => [['pp', 'pp'], ['po', 'po'], ['pa', 'pa'], ['pc', 'pc']].filter(([k]) => nombre((b || {})[k])).map(([k, l]) => `${nombre(b[k])} ${l}`).join(', ') || 'vide';
const champsPieces = prefixe => `<div class="pieces">${[['po', 'Or'], ['pa', 'Argent'], ['pc', 'Cuivre']].map(([k, l]) =>
  `<label class="f"><span>${l}</span><input type="text" inputmode="numeric" id="${prefixe}-${k}" placeholder="0"></label>`).join('')}</div>`;
const lirePieces = prefixe => Object.fromEntries(['po', 'pa', 'pc'].map(k => [k, String(Math.round(nombre($(`#${prefixe}-${k}`)?.value)))]));

/* ===== Coffre commun (pièces et objets) ===== */
const bc = () => (db.bourseCommune = { bourse: {}, porteur_id: '', journal: [], objets: [], ...(db.bourseCommune || {}) });
function carteBourseCommune() {
  const b = bc();
  const porteur = findPerso(b.porteur_id);
  const mes = db.personnages.filter(x => !x._public && estMembre(x) && (enLigne() ? !!(db.cles || {})[x.id] || estMJ() : true));
  const tous = db.personnages.filter(x => estMembre(x) && (!enLigne() || x.publie));
  const objets = b.objets || [];
  const persoCo = findPerso(state.coPerso) || mes[0];
  return `<section class="card bourse-commune"><h3>Coffre commun</h3>
    <p class="bc-total"><b>${esc(piecesTxt(b.bourse))}</b>${bourseEnPc(b.bourse) ? ` <small>(${prixTxt(Math.round(bourseEnPc(b.bourse)) / 100, 'po')} au total)</small>` : ''}</p>
    <p class="hint">${porteur ? `<b>${esc(porteur.nom)}</b> porte le coffre commun. Cet argent ne s'ajoute pas à sa bourse personnelle.` : 'Personne ne porte le coffre commun pour l\'instant.'}</p>
    ${mes.length ? `<details class="effet" ${state.bcOuvert ? 'open' : ''}><summary>Déposer, prendre, changer de porteur</summary>
      <label class="f"><span>Avec la bourse de</span><select id="bc-perso">${mes.map(x => `<option value="${x.id}">${esc(x.nom)} (${esc(piecesTxt(x.argent))})</option>`).join('')}</select></label>
      ${champsPieces('bc')}
      <div class="btns"><button class="btn" data-action="bc-deposer">Déposer dans le coffre</button><button class="btn ghost" data-action="bc-prendre">Prendre dans le coffre</button></div>
      <div class="row" style="margin-top:.6rem"><select id="bc-porteur" aria-label="Porteur du coffre"><option value="">— Personne —</option>${tous.map(x => `<option value="${x.id}" ${b.porteur_id === x.id ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select>
        <button class="btn ghost" data-action="bc-porteur">Confier le coffre</button></div>
    </details>` : '<p class="hint">Associe ton personnage à cet appareil pour déposer ou prendre de l\'argent.</p>'}
    <h4>Objets dans le coffre ${objets.length ? `<small>${objets.length}</small>` : ''}</h4>
    ${objets.length ? `<div class="coffre-objets">${objets.map(o => `<div class="coffre-objet">
        ${o.image ? `<img src="${o.image}" alt="">` : `<span class="icone">${ICONES_CAT[o.cat || ''] || '📦'}</span>`}
        <div><b>${esc(o.nom || 'Objet')}</b>${num(o.qte) > 1 ? ` <small>× ${esc(o.qte)}</small>` : ''}${o.deposePar ? `<br><small>déposé par ${esc(o.deposePar)}</small>` : ''}</div>
        ${mes.length ? `<button class="btn ghost petit" data-action="coffre-prendre" data-id="${o.id}">Prendre</button>` : ''}
      </div>`).join('')}</div>` : '<p class="empty">Aucun objet dans le coffre.</p>'}
    ${mes.length ? `<details class="effet" ${state.coOuvert ? 'open' : ''}><summary>Déposer ou prendre un objet</summary>
      <label class="f"><span>Personnage</span><select id="co-perso">${mes.map(x => `<option value="${x.id}" ${persoCo && persoCo.id === x.id ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select></label>
      ${persoCo && (persoCo.equipement || []).length ? `<div class="row"><select id="co-objet" aria-label="Objet à déposer">${(persoCo.equipement || []).map(it => `<option value="${it.id}">${esc(it.nom || 'Objet')}${num(it.qte) > 1 ? ' ×' + esc(it.qte) : ''}</option>`).join('')}</select>
        <button class="btn" data-action="coffre-deposer">Déposer dans le coffre</button></div>` : '<p class="hint">Ce personnage n\'a pas d\'objet à déposer.</p>'}
      <p class="hint">Le bouton « Prendre » d'un objet du coffre le place dans l'inventaire du personnage choisi ici.</p>
    </details>` : ''}
    ${(b.journal || []).length ? `<details class="effet"><summary>Derniers mouvements</summary><ul class="journal">${b.journal.slice(0, 12).map(j => `<li><small>${new Date(num(j.quand)).toLocaleDateString('fr-FR')}</small> <b>${esc(j.qui)}</b> ${esc(j.quoi)}${Object.values(j.delta || {}).some(v => num(v)) ? ' : ' + esc(Object.entries(j.delta || {}).filter(([, v]) => num(v)).map(([k, v]) => `${num(v) > 0 ? '+' : ''}${num(v)} ${k}`).join(', ')) : ''}</li>`).join('')}</ul></details>` : ''}
  </section>`;
}
function journalLocal(qui, quoi, delta) {
  const b = bc();
  b.journal = [{ quand: Date.now(), qui, quoi, delta }, ...(b.journal || [])].slice(0, 50);
}

/* ===== Marché ===== */
async function chargerMarche() {
  if (!enLigne()) return;
  try {
    const ch = await lignesChangees('marche', 'marche', 'id,data,maj', id => [...(db.marche || []), ...(db.marches || []), ...(db.ambiances || [])].some(a => a.id === id));
    const parId = new Map([...(db.marche || []), ...(db.marches || []), ...(db.ambiances || [])].map(a => [a.id, a]));
    for (const x of ch.lignes) parId.set(x.id, { ...x.data, id: x.id });
    const tous = [...parId.values()].filter(a => ch.tous.has(a.id));
    db.marche = tous.filter(a => a.kind !== 'marche' && a.kind !== 'ambiance');
    db.marches = tous.filter(a => a.kind === 'marche');
    db.ambiances = tous.filter(a => a.kind === 'ambiance');
    ch.valider();
    saveNow();
  } catch (e) { console.warn('Marché indisponible (base pas encore en v7 ?)', e); }
}
const marcheTimers = {};
function sauverArticle(a) {
  saveNow();
  if (!enLigne() || !estMJ()) return;
  clearTimeout(marcheTimers[a.id]);
  marcheTimers[a.id] = setTimeout(() => rpc('mj_marche_sauver', { p_code: db.codeMJ, p_id: a.id, p_data: a }).catch(e => statutSync('Marché non enregistré : ' + e.message, true)), 700);
}
/* ===== Les marchés : chacun a son décor ; les articles sont posés sur les étals des marchands ===== */
const TYPES_MARCHE = { port: 'Marché du port', ville: 'Marché en ville', noir: 'Marché noir', ambulant: 'Marchand ambulant' };
/* Ambiances créées par le MJ : couleurs de l'auvent et étal clair ou sombre */
const ambiancesPerso = () => db.ambiances || [];
const toutesAmbiances = () => [...Object.entries(TYPES_MARCHE).map(([k, l]) => [k, l]), ...ambiancesPerso().map(a => [a.id, a.nom])];
function styleAmbiance(type) {
  const a = ambiancesPerso().find(x => x.id === type);
  if (!a) return { classe: `type-${type || 'ville'}`, style: '' };
  return { classe: `type-${a.sombre ? 'noir' : 'perso'}`, style: `--toile-a:${a.toileA || '#EDE6D6'};--toile-b:${a.toileB || '#7A4E9C'};` };
}
function sauverAmbiance(a) {
  db.ambiances = [...ambiancesPerso().filter(x => x.id !== a.id), a];
  saveNow();
  if (enLigne() && estMJ()) rpc('mj_marche_sauver', { p_code: db.codeMJ, p_id: a.id, p_data: { ...a, kind: 'ambiance' } }).catch(e => statutSync('Ambiance non enregistrée : ' + e.message, true));
}
const MARCHES_DEFAUT = [
  { id: 'm-port', kind: 'marche', nom: 'Marché du port', type: 'port', image: 'images/marche-port.jpg', ouvert: true, ordre: 1 },
  { id: 'm-ville', kind: 'marche', nom: 'Marché de la ville', type: 'ville', image: 'images/marche-ville.jpg', ouvert: true, ordre: 2 },
  { id: 'm-noir', kind: 'marche', nom: 'Marché noir', type: 'noir', image: 'images/marche-noir.jpg', ouvert: true, ordre: 3 },
  { id: 'm-ambulant', kind: 'marche', nom: 'Marchand ambulant', type: 'ambulant', image: 'images/marche-ambulant.jpg', ouvert: true, ordre: 4 },
];
const listeMarches = () => ((db.marches || []).length ? db.marches : MARCHES_DEFAUT).slice().sort((x, y) => num(x.ordre) - num(y.ordre));
const marcheDe = a => listeMarches().find(m => m.id === a.marcheId) || listeMarches()[0];
const ICONES_CAT = { arme: '⚔️', armure: '🛡️', bouclier: '🛡️', vetement: '👘', magique: '💍', munition: '🏹', consommable: '🧪', fourniture: '🕯️', ration: '🍞', tresor: '💎', babiole: '🎲', '': '📦' };
function sauverMarcheDef(m) {
  /* Première personnalisation : on enregistre aussi les marchés par défaut */
  if (!(db.marches || []).length) db.marches = MARCHES_DEFAUT.map(x => ({ ...x }));
  const i = db.marches.findIndex(x => x.id === m.id);
  if (i >= 0) db.marches[i] = m; else db.marches.push(m);
  saveNow();
  if (!enLigne() || !estMJ()) return;
  const aEnvoyer = db.marches.filter(x => x.id === m.id || !x._envoye);
  for (const x of aEnvoyer) {
    const { _envoye, ...donnees } = x;
    rpc('mj_marche_sauver', { p_code: db.codeMJ, p_id: x.id, p_data: donnees }).then(() => { x._envoye = true; }).catch(e => statutSync('Marché non enregistré : ' + e.message, true));
  }
}
function supprimerMarcheDef(id) {
  if (!(db.marches || []).length) db.marches = MARCHES_DEFAUT.map(x => ({ ...x }));
  db.marches = db.marches.filter(x => x.id !== id);
  saveNow();
  if (enLigne() && estMJ()) {
    rpc('mj_marche_suppr', { p_code: db.codeMJ, p_id: id }).catch(() => {});
    for (const x of db.marches) if (!x._envoye) sauverMarcheDef(x);
  }
}
function pageMarche() {
  const mj = estMJ();
  const marches = listeMarches().filter(m => mj || m.ouvert !== false);
  const sel = marches.find(m => m.id === state.marcheSel) || marches.find(m => (db.marche || []).some(a => marcheDe(a).id === m.id && (mj || a.aVendre))) || marches[0];
  if (!sel) return '<p class="marche-ferme">Aucun marché n\'est ouvert pour le moment.</p>';
  const articles = (db.marche || []).filter(a => marcheDe(a).id === sel.id && (mj || a.aVendre));
  const mes = db.personnages.filter(x => !x._public && estMembre(x) && (enLigne() ? !!(db.cles || {})[x.id] || mj : true));
  const vendeurs = [...new Set(articles.map(a => a.vendeur || 'Étal du marché'))];
  const marchandise = a => {
    const i = db.marche.indexOf(a);
    const epuise = num(a.stock) <= 0;
    const ouvert = state.achatOuvert === a.id;
    const bonus = (a.bonus || []).filter(x => x.cible && num(x.val));
    return `<div class="marchandise ${a.aVendre ? '' : 'retire'} ${epuise ? 'epuise' : ''}">
      <button class="marchandise-visuel" ${a.image ? `data-action="img-zoom" data-src="${a.image}"` : 'disabled'} aria-label="Voir ${esc(a.nom || 'l\'article')}">
        ${a.image ? `<img src="${a.image}" alt="">` : `<span class="icone">${ICONES_CAT[a.cat || ''] || '📦'}</span>`}
        <span class="etiquette">${esc(prixTxt(a.prix, a.unite))}</span>
      </button>
      <b class="marchandise-nom">${esc(a.nom || 'Article')}${a.focalisateur ? ' ✦' : ''}</b>
      <small class="marchandise-stock">${epuise ? 'épuisé' : num(a.stock) > 1 ? `${esc(a.stock)} en stock` : 'dernier exemplaire'}${!a.aVendre ? ' · caché aux joueurs' : ''}</small>
      ${a.notes || bonus.length ? `<details class="marchandise-detail"><summary>Détails</summary>${a.notes ? `<p>${esc(a.notes)}</p>` : ''}${bonus.length ? `<p class="objet-bonus">${bonus.map(x => `<span class="${x.cond ? 'bonus-cond' : 'bonus-objet'}">${R.signe(num(x.val))} ${esc(NOM_CIBLE[x.cible] || x.cible)}</span>`).join('')}</p>` : ''}</details>` : ''}
      ${!epuise && a.aVendre && mes.length ? (ouvert ? `<div class="achat">
          <input type="text" inputmode="numeric" class="s" id="qte-${a.id}" value="1" aria-label="Quantité">
          <select id="payeur-${a.id}" aria-label="Payer avec">${mes.map(x => `<option value="${x.id}|0">Bourse de ${esc(x.nom)}</option><option value="${x.id}|1">Coffre commun (${esc(x.nom)})</option>`).join('')}</select>
          <button class="btn" data-action="acheter" data-id="${a.id}">Payer</button>
        </div>` : `<button class="btn ghost achat-btn" data-action="achat-ouvrir" data-id="${a.id}">Acheter</button>`) : ''}
      ${mj ? `<div class="mj-article">
          <input type="text" inputmode="decimal" class="s" data-marche="${i}.prix" value="${esc(a.prix)}" aria-label="Prix">
          ${selUnite(`data-marche="${i}.unite"`, a.unite)}
          <input type="text" inputmode="numeric" class="s" data-marche="${i}.stock" value="${esc(a.stock)}" aria-label="Stock">
          <label class="check"><input type="checkbox" data-marche="${i}.aVendre" ${a.aVendre ? 'checked' : ''}> À vendre</label>
          <select data-marche="${i}.marcheId" aria-label="Marché">${listeMarches().map(m => `<option value="${m.id}" ${marcheDe(a).id === m.id ? 'selected' : ''}>${esc(m.nom)}</option>`).join('')}</select>
          <button class="lien" data-action="marche-retirer" data-id="${a.id}">Retirer</button>
        </div>` : ''}
    </div>`;
  };
  return `<div class="marche-fond" style="background-image:url('${esc(sel.image || '')}')"></div>
  <div class="marche-contenu ${styleAmbiance(sel.type).classe}" style="${styleAmbiance(sel.type).style}">
    <div class="marche-tete">
      <h1>${esc(sel.nom)}</h1>
      ${marches.length > 1 ? `<nav class="marche-onglets">${marches.map(m => `<button class="${m.id === sel.id ? 'on' : ''}" data-action="marche-choisir" data-id="${m.id}">${esc(m.nom)}${mj && m.ouvert === false ? ' (fermé)' : ''}</button>`).join('')}</nav>` : ''}
      ${mes.length ? `<p class="marche-bourse">${mes.map(x => `${esc(x.nom)} : ${esc(piecesTxt(x.argent))}`).join(' · ')} · Coffre commun : ${esc(piecesTxt(bc().bourse))}</p>` : (!mj ? '<p class="marche-bourse">Associe ton personnage à cet appareil pour acheter.</p>' : '')}
      ${mj ? '<p class="marche-bourse"><a href="#/mj" data-action="mj-onglet" data-o="objets">Gérer les marchés et préparer des articles (espace MJ)</a></p>' : ''}
    </div>
    ${vendeurs.map(v => `<section class="stand">
      <div class="auvent" aria-hidden="true"></div>
      <div class="enseigne">${esc(v)}</div>
      <div class="etal">${articles.filter(a => (a.vendeur || 'Étal du marché') === v).map(marchandise).join('')}</div>
      <div class="comptoir" aria-hidden="true"></div>
    </section>`).join('') || `<section class="stand vide"><div class="auvent" aria-hidden="true"></div><div class="enseigne">Étals vides</div><p class="empty">Rien à vendre ici pour l'instant.${mj ? ' Prépare des objets « À vendre » dans l\'espace MJ, onglet Objets, puis envoie-les vers ce marché.' : ''}</p></section>`}
  </div>`;
}

/* Gestion des marchés dans l'espace MJ */
function carteMarchesMJ() {
  const ms = listeMarches();
  return `<section class="card"><h3>Marchés</h3>
    <p class="hint aide">Chaque marché a son nom, son ambiance et son image de fond. Un marché fermé reste invisible aux joueurs.</p>
    <div class="marches-mj">${ms.map(m => `<div class="marche-mj">
      <button class="marche-mj-image" data-action="marche-image" data-id="${m.id}" style="background-image:url('${esc(m.image || '')}')" aria-label="Changer l'image de ${esc(m.nom)}"><span>Changer l'image</span></button>
      <div class="grid">
        <label class="f span2"><span>Nom</span><input type="text" data-marchedef="${m.id}.nom" value="${esc(m.nom)}"></label>
        <label class="f"><span>Ambiance</span><select data-marchedef="${m.id}.type">${toutesAmbiances().map(([k, l]) => `<option value="${k}" ${m.type === k ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="f"><span>Ordre</span><input type="text" inputmode="numeric" data-marchedef="${m.id}.ordre" value="${esc(m.ordre)}"></label>
      </div>
      <div class="row"><label class="check"><input type="checkbox" data-marchedef="${m.id}.ouvert" ${m.ouvert === false ? '' : 'checked'}> Ouvert aux joueurs</label>
        <span class="hint">${(db.marche || []).filter(a => marcheDe(a).id === m.id).length} article(s)</span>
        <button class="lien danger" data-action="marche-suppr" data-id="${m.id}">Supprimer</button></div>
    </div>`).join('')}</div>
    <button class="btn ghost" data-action="marche-ajout">+ Nouveau marché</button>
    <h4>Ambiances</h4>
    <p class="hint aide">En plus des quatre ambiances de base (port, ville, marché noir, ambulant), crée les tiennes : couleurs de l'auvent rayé et étal clair ou sombre.</p>
    <div class="ambiances-mj">${ambiancesPerso().map(a => `<div class="ambiance-mj">
      <span class="ambiance-apercu" style="--toile-a:${esc(a.toileA || '#EDE6D6')};--toile-b:${esc(a.toileB || '#7A4E9C')}"></span>
      <input type="text" data-ambiance="${a.id}.nom" value="${esc(a.nom)}" aria-label="Nom de l'ambiance">
      <label class="couleur" title="Première couleur de l'auvent"><input type="color" data-ambiance="${a.id}.toileA" value="${esc(a.toileA || '#EDE6D6')}"></label>
      <label class="couleur" title="Seconde couleur de l'auvent"><input type="color" data-ambiance="${a.id}.toileB" value="${esc(a.toileB || '#7A4E9C')}"></label>
      <label class="check"><input type="checkbox" data-ambiance="${a.id}.sombre" ${a.sombre ? 'checked' : ''}> Étal sombre</label>
      <button class="icon" data-action="ambiance-suppr" data-id="${a.id}" aria-label="Supprimer l'ambiance">✕</button>
    </div>`).join('') || '<p class="empty">Aucune ambiance personnalisée.</p>'}</div>
    <button class="btn ghost" data-action="ambiance-ajout">+ Nouvelle ambiance</button>
  </section>`;
}

/* Achat hors ligne (sans base) : même logique que la fonction de la base */
function acheterLocal(a, p, qte, commune) {
  const prix = Math.round(nombre(a.prix) * (MULT_PC[a.unite || 'po'] || 100)) * qte;
  if (num(a.stock) < qte) throw new Error(`Stock insuffisant (il en reste ${num(a.stock)})`);
  if (commune) { bc().bourse = bourseLocalePlus(bc().bourse, { pc: -prix }); journalLocal(p.nom, `achat : ${a.nom} × ${qte}`, { pc: -prix }); }
  else p.argent = bourseLocalePlus(p.argent, { pc: -prix });
  const { aVendre, stock, prix: px, unite, vendeur, type, ...obj } = a;
  p.equipement = [...(p.equipement || []), { ...obj, id: uid(), qte: String(qte), valeur: px, valeurUnite: unite || 'po' }];
  a.stock = String(num(a.stock) - qte);
}

/* ===== Focalisateur ===== */
function carteFocalisateur(p) {
  const f = (p.equipement || []).filter(it => it.focalisateur);
  if (!f.length) return '';
  return f.map(it => `<section class="card focalisateur-carte">
    <p class="recit-num">✦ Focalisateur</p>
    <h2 class="baguette-nom">${esc(it.nom || 'Focalisateur')}</h2>
    ${it.image ? `<img class="focal-image" src="${it.image}" alt="">` : ''}
    ${it.notes ? `<p>${esc(it.notes)}</p>` : ''}
    ${(it.bonus || []).filter(b => b.cible && num(b.val)).length ? `<p class="objet-bonus">${it.bonus.filter(b => b.cible && num(b.val)).map(b => `<span class="bonus-objet">${R.signe(num(b.val))} ${esc(NOM_CIBLE[b.cible] || b.cible)}</span>`).join('')}</p>` : ''}
    ${it.equipe === false ? '<p class="hint">Rangé dans le sac : ses bonus ne comptent pas.</p>' : ''}
  </section>`).join('');
}

function ficheCompetences(p, e) {
  const deClasse = compDeClasse(e);
  const dispo = pointsComp(p, e);
  let depense = 0;
  const rangsMax = e.niveau + 3;
  const reduit = !!db.compReduit;
  const estDeClasse = (id, v) => v && typeof v.classe === 'boolean' ? v.classe : deClasse.has(id);
  const lignes = R.COMPETENCES.map(c => {
    const v = p.comp?.[c.id] || {};
    const classe = estDeClasse(c.id, v);
    depense += classe ? num(v.rangs) : num(v.rangs) * 2;
    if (reduit && !classe && !num(v.rangs) && !num(v.divers)) return '';
    return ligneComp(e, c, v, null, { classe, deClasse: deClasse.has(c.id) });
  });
  const perso = (p.compPerso || []).map((v, i) => {
    depense += v.classe ? num(v.rangs) : num(v.rangs) * 2;
    return ligneComp(e, { id: 'perso' + i, nom: v.nom, car: v.car || 'int', formation: false }, v, null, { classe: !!v.classe, perso: true, i });
  });
  const tete = '<div class="cl cl-tete"><span></span><span>Compétences</span><span>Val</span><span>Rg</span><span>Car</span><span>Div</span></div>';
  const toutes = [...lignes.filter(Boolean), ...perso];
  const moitie = Math.ceil(toutes.length / 2);
  return `<section class="card"><h3>Compétences</h3>
    <div class="cl-resume">
      <span>Points : <b>${depense}</b> / ${dispo}${e.race?.pcBonus ? ' (humain compris)' : ''}</span>
      <span>Rang max CC = niveau + 3 = <b>${rangsMax}</b></span>
      <span>Rang max CaC = (niveau + 3) / 2 = <b>${String(rangsMax / 2).replace('.', ',')}</b></span>
    </div>
    <label class="check"><input type="checkbox" data-action="comp-reduit" ${reduit ? 'checked' : ''}> Seulement les compétences de classe et celles avec des rangs</label>
    <div class="cl-colonnes">
      <div class="cl-col">${tete}${toutes.slice(0, moitie).join('')}</div>
      <div class="cl-col">${tete}${toutes.slice(moitie).join('')}</div>
    </div>
    <button class="btn ghost" data-action="add-comp-perso" style="margin-top:.6rem">+ Autre compétence (langage secret, etc.)</button>
    <p class="hint cl-legende aide"><b>Val</b> : le bonus à ajouter au d20 quand le MJ demande un jet. <b>Rg</b> : rangs. <b>Car</b> : modificateur de caractéristique. <b>Div</b> : bonus divers (objets, circonstances). La case ✱ indique une compétence de classe : touche-la pour changer si ton MJ l'autorise.<br>* Utilisable non entraîné · ◘ Pénalité d'armure ou d'encombrement · Un « — » signifie qu'il faut au moins 1 rang pour l'utiliser.</p>
  </section>`;
}

function carteDon(d, e, p, source, libre = false) {
  const pr = libre ? { ok: true, txt: 'ne s\'appliquent pas (don accordé par la classe)' } : prerequis(d, e, p);
  const calc = d.calc ? d.calc(e) : '';
  return `<div class="don">
    <div class="don-tete"><b>${esc(d.nom)}</b> <span class="type-don">${R.TYPES_DONS[d.type]}</span>${source ? `<span class="source">${esc(source)}</span>` : ''}</div>
    <p>${esc(d.texte)}</p>
    ${calc ? `<p class="calcul">${esc(calc)}</p>` : ''}
    <p class="prereq ${pr.ok ? '' : 'ko'}">Prérequis : ${esc(pr.txt)}${pr.ok ? '' : ` (manque : ${esc(pr.manque.join(', '))})`}</p>
  </div>`;
}

function ficheDons(p, e) {
  const cartes = e.donsListe.map(x => carteDon(R.DON[x.id], e, p, x.source, x.libre)).join('');
  const dejaSupp = new Set(p.donsSupp || []);
  return `<section class="card"><h3>Dons</h3>
    <div class="dons">${cartes || '<p class="empty">Aucun don pour l\'instant. Ils se choisissent niveau par niveau dans l\'onglet Progression.</p>'}</div>
    <h4>Dons accordés hors progression</h4>
    <p class="hint">Pour un don offert par le MJ, un objet ou un événement de campagne.</p>
    <div class="row">
      <select id="don-supp" aria-label="Don à ajouter">${optionsDons(e, p, '', d => !dejaSupp.has(d.id))}</select>
      <button class="btn ghost" data-action="add-don-supp">Ajouter</button>
    </div>
    ${(p.donsSupp || []).length ? `<div class="btns" style="margin-top:.5rem">${p.donsSupp.map((d, i) => `<button class="chip on" data-action="del-don-supp" data-idx="${i}" aria-label="Retirer ${esc(R.DON[d]?.nom)}">${esc(R.DON[d]?.nom || d)} ✕</button>`).join('')}</div>` : ''}
    <h4>Autres dons (hors règles officielles)</h4>
    ${liste(p, 'dons', [{ k: 'nom', l: 'Nom du don' }, { k: 'description', l: 'Effet', type: 'area' }], 'Ajouter un don maison')}
  </section>`;
}

function ficheCapacites(p, e, valsClasses) {
  const race = e.race;
  const raceBloc = race ? `<div class="cap-groupe"><h4>${esc(race.nom)}</h4>
    <dl class="caps">${race.traits.map(([n, t]) => `<dt>${esc(n)}</dt><dd>${esc(t)}</dd>`).join('')}</dl></div>` : '';
  const classes = Object.entries(e.classes).map(([id, k]) => {
    const cl = R.CLASSES[id];
    const vals = valsClasses.find(x => x.id === id)?.vals || [];
    const apt = cl.aptitudes.filter(a => a.niv <= k);
    const sp = sortsParJour(id, k, e);
    return `<div class="cap-groupe"><h4>${esc(cl.nom)} ${k}</h4>
      ${vals.length ? `<dl class="valeurs">${vals.map(([n, v]) => `<dt>${esc(n)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>` : ''}
      ${sp ? tableSorts(sp) : ''}
      <dl class="caps">${apt.map(a => `<dt>${esc(a.nom)} <small>niv. ${a.niv}</small></dt><dd>${esc(a.texte)}</dd>`).join('')}</dl>
      <p class="hint">Maîtrises : ${esc(cl.maitrises)}</p>
    </div>`;
  }).join('');
  return `<section class="card"><h3>Capacités spéciales</h3>
    ${raceBloc}${classes}
    ${!race && !classes ? '<p class="empty">Choisis une race et coche tes niveaux pour voir les capacités apparaître ici.</p>' : ''}
    <h4>Autres capacités</h4>
    ${liste(p, 'capacites', [{ k: 'nom', l: 'Capacité' }, { k: 'description', l: 'Effet', type: 'area' }], 'Ajouter une capacité')}
  </section>`;
}

function tableSorts(sp) {
  const cell = l => l.map(x => `<td>${x.txt}</td>`).join('');
  const tete = sp.parJour.map(x => `<th>${x.niv}</th>`).join('');
  return `<div class="table-sorts"><table>
    <caption>Sorts par jour (${esc(sp.lc.type)}, bonus de ${R.CARACS.find(c => c.k === sp.lc.car).n} compris${sp.lc.domaine ? ', +1 = sort de domaine' : ''})</caption>
    <tr><th>Niveau de sort</th>${tete}</tr>
    <tr><th>Par jour</th>${cell(sp.parJour)}</tr>
    ${sp.connus ? `<tr><th>Connus</th>${cell(sp.connus.slice(0, sp.parJour.length))}</tr>` : ''}
  </table></div>`;
}

/* Recherche tolérante : tous les mots d'abord, puis au moins un mot significatif ;
   cherche dans le nom, le nom anglais, l'effet et les autres noms connus du don. */
function rechercherDons(liste, q) {
  const mots = norm(q).split(/[\s'’-]+/).filter(m => m.length > 1);
  if (!mots.length) return [];
  const score = d => {
    const h = norm([d.nom, d.vo, d.texte, R.ALIAS_DONS[d.id]].join(' '));
    const tous = mots.every(m => h.includes(m));
    const un = mots.filter(m => m.length >= 4 && h.includes(m)).length;
    const nom = norm(d.nom + ' ' + (R.ALIAS_DONS[d.id] || '')).includes(norm(q)) ? 4 : 0;
    return tous ? 10 + nom : un ? un + nom : 0;
  };
  return liste.map(d => [d, score(d)]).filter(([, sc]) => sc > 0)
    .sort((a, b) => b[1] - a[1] || a[0].nom.localeCompare(b[0].nom, 'fr')).map(([d]) => d);
}
function resultatsDons(champ) {
  const p = state.ctx, q = norm(champ.value).trim();
  const zone = champ.parentElement.querySelector(`.don-resultats[data-pour="${champ.dataset.path}"]`);
  if (!zone) return;
  if (!q) { zone.innerHTML = ''; return; }
  const n = Number(champ.dataset.n);
  const e = etat(p, n, true, { niveau: n, champ: champ.dataset.champ });
  const ids = champ.dataset.liste ? champ.dataset.liste.split(',') : null;
  const dons = rechercherDons((ids ? ids.map(id => R.DON[id]) : R.DONS).filter(Boolean), q).slice(0, 12);
  zone.innerHTML = dons.length ? dons.map(d => {
    const ok = champ.dataset.libre || prerequis(d, e, p).ok;
    return `<button class="don-choix ${ok ? '' : 'ko'}" data-action="choisir-don" data-path="${champ.dataset.path}" data-id="${d.id}">
      <b>${esc(d.nom)}</b> <span class="type-don">${R.TYPES_DONS[d.type]}${d.vo ? ` · ${esc(d.vo)}` : ''}${ok ? '' : ', prérequis manquants'}</span>
      <small>${esc(d.texte)}</small></button>`;
  }).join('') : '<p class="empty">Aucun don ne correspond.</p>';
}

function optionsDons(e, p, cur, filtre = () => true, liste = null, sansPrerequis = false) {
  const dons = (liste ? liste.map(id => R.DON[id]) : R.DONS).filter(Boolean).filter(filtre);
  const groupes = {};
  for (const d of dons) (groupes[d.type] = groupes[d.type] || []).push(d);
  const opt = d => {
    const ok = sansPrerequis || prerequis(d, e, p).ok;
    const deja = e.dons.has(d.id) && d.id !== cur && !['talent', 'arme-predilection', 'ecole-renforcee', 'maniement-arme-exotique', 'maniement-armes-guerre', 'science-critique', 'specialisation-martiale'].includes(d.id);
    return `<option value="${d.id}" ${d.id === cur ? 'selected' : ''}>${esc(d.nom)}${deja ? ' (déjà acquis)' : ok ? '' : ' (prérequis manquants)'}</option>`;
  };
  return `<option value="">— Choisir un don —</option>` + Object.entries(groupes).map(([t, l]) =>
    `<optgroup label="${R.TYPES_DONS[t]}">${l.sort((a, b) => a.nom.localeCompare(b.nom, 'fr')).map(opt).join('')}</optgroup>`).join('');
}

/* ---------- Focalisateurs : chaque sort passe par un objet ---------- */
/* La baguette du personnage et les objets magiques marqués « focalisateur » */
function focalisateurs(p) {
  const l = (p.equipement || []).filter(it => it.focalisateur).map(it => ({ id: it.id, nom: it.nom || 'Focalisateur', present: it.equipe !== false }));
  if (p.baguette && (p.baguette.nom || p.baguette.photo)) l.unshift({ id: 'baguette', nom: 'Baguette : ' + (p.baguette.nom || 'sans nom'), present: p.baguette.possedee !== false });
  return l;
}
/* 'ok', 'non-relie' ou 'absent' */
function etatFocal(p, x) {
  if (!x.focal) return 'non-relie';
  const f = focalisateurs(p).find(y => y.id === x.focal);
  return f && f.present ? 'ok' : 'absent';
}
const nomFocal = (p, x) => focalisateurs(p).find(y => y.id === x.focal)?.nom || 'focalisateur disparu';

/* ---------- Sorts du personnage ---------- */
function ongletSorts(p) {
  const items = (p.sorts || []).map((e, i) => ({ e, i, s: findSort(e.id) }))
    .sort((a, b) => String(a.s?.nom ?? '').localeCompare(String(b.s?.nom ?? ''), 'fr'));
  const focs = focalisateurs(p);
  const nonRelies = items.filter(({ e }) => etatFocal(p, e) === 'non-relie').length;
  const linked = items.map(({ e, i, s }) => `
    <div class="item ${ecoleClass(s?.ecole)} focal-${etatFocal(p, e)}">
      <div>${s ? `<a href="#/sort/${s.id}">${esc(s.nom)}</a><span class="meta">${esc(s.ecole)}, ${esc(niveauxTxt(s))}</span><span class="usages">${tagsUsages(s)}</span>`
        : '<em>Sort supprimé du grimoire</em>'}</div>
      <select data-bind="sorts.${i}.statut" aria-label="Statut">
        ${STATUTS.map(st => `<option ${e.statut === st ? 'selected' : ''}>${st}</option>`).join('')}
      </select>
      <button class="icon" data-action="del-sort-perso" data-idx="${i}" aria-label="Retirer le sort">✕</button>
      <input type="text" class="notes" data-bind="sorts.${i}.notes" value="${esc(e.notes)}" placeholder="Notes (charges de la baguette, préparé ×2…)">
      <label class="focal-choix"><span>${etatFocal(p, e) === 'ok' ? '✦' : '⚠'}</span><select data-bind="sorts.${i}.focal" data-rerender aria-label="Focalisateur du sort">
        <option value="">— Relier à un focalisateur —</option>${focs.map(f => `<option value="${f.id}" ${e.focal === f.id ? 'selected' : ''}>${esc(f.nom)}${f.present ? '' : ' (absent)'}</option>`).join('')}
        ${e.focal && !focs.some(f => f.id === e.focal) ? `<option value="${e.focal}" selected>Focalisateur disparu</option>` : ''}
      </select>${etatFocal(p, e) === 'absent' ? '<small class="focal-alerte">Focalisateur absent : sort inutilisable</small>' : ''}</label>
    </div>`).join('');
  const blocFocal = items.length ? `<div class="focal-bandeau ${nonRelies ? 'alerte' : ''}">
    ${focs.length
      ? `<p>${nonRelies ? `<b>${nonRelies} sort${nonRelies > 1 ? 's' : ''} non relié${nonRelies > 1 ? 's' : ''}</b> à un focalisateur : ${nonRelies > 1 ? 'ils sont inutilisables' : 'il est inutilisable'} tant que ce n'est pas fait.` : 'Tous tes sorts sont reliés à un focalisateur.'}</p>
         ${nonRelies ? `<div class="row"><select id="focal-tous">${focs.map(f => `<option value="${f.id}">${esc(f.nom)}</option>`).join('')}</select><button class="btn ghost" data-action="focal-tous">Relier les sorts non reliés</button></div>` : ''}`
      : '<p><b>Aucun focalisateur.</b> Pour lancer des sorts, il faut une baguette (case Baguette de la fiche) ou un objet magique marqué « Focalisateur » dans l\'inventaire.</p>'}
    <p class="hint aide">Sans son focalisateur (baguette perdue, objet rangé ou retiré de l'inventaire), un sort ne peut plus être lancé.</p>
  </div>` : '';
  return `
  <section class="card"><h3>Sorts du personnage</h3>
    ${blocFocal}
    <div class="linked">${linked || '<p class="empty">Aucun sort lié. Ajoute-les depuis le grimoire ci-dessous.</p>'}</div>
  </section>
  <section class="card"><h3>Ajouter un sort</h3>
    <input type="search" id="pickq" value="${esc(state.pickQ)}" placeholder="Chercher un sort par nom…" aria-label="Chercher un sort">
    <div class="chips usages-filtre">${[['', 'Tous'], ...Object.entries(USAGES_SORT)].map(([k, l]) => `<button class="chip ${(state.pickUsage || '') === k ? 'on' : ''}" data-action="pick-usage" data-u="${k}">${l}</button>`).join('')}</div>
    <div class="pick" id="pickres">${pickResults(p)}</div>
    <p class="hint">Un sort manque ? <a href="#/sort-edit/new">Ajoute-le au grimoire</a>, puis reviens ici.</p>
  </section>`;
}
function pickResults(p) {
  const q = norm(state.pickQ);
  const have = new Set((p.sorts || []).map(s => s.id));
  const res = db.sorts
    .filter(s => !have.has(s.id) && (!q || norm(s.nom).includes(q) || norm(s.nomVO).includes(q)) && (!state.pickUsage || usagesSort(s).includes(state.pickUsage)))
    .sort(byNom).slice(0, 40);
  if (!res.length) return '<p class="empty">Aucun sort correspondant.</p>';
  return res.map(s => `<button class="${ecoleClass(s.ecole)}" data-action="add-sort-perso" data-id="${s.id}">
    <b>${esc(s.nom)}</b> <span class="meta">${esc(s.ecole)}, ${esc(niveauxTxt(s))}</span> ${tagsUsages(s)}<small class="pick-desc">${esc(String(s.description || '').slice(0, 110))}${String(s.description || '').length > 110 ? '…' : ''}</small></button>`).join('');
}

/* ---------- Progression ---------- */
function ongletProgression(p) {
  const lv = [...(p.progression || [])].map((l, i) => ({ l, i })).sort((a, b) => a.l.niveau - b.l.niveau);
  const prochain = lv.find(x => !x.l.atteint);
  const actuel = niveauActuel(p);
  const cartes = lv.map(({ l, i }) => carteNiveau(p, l, i, prochain && prochain.i === i)).join('');
  return `
  <p class="hint">${actuel ? `Niveau actuel : ${actuel} (${esc(classesTxt(etat(p)))}).` : 'Aucun niveau atteint pour l\'instant.'} Pour chaque niveau, choisis la classe : tout ce qu'elle apporte s'affiche, avec les dons à sélectionner. Coche « Atteint » quand le MJ valide la montée de niveau.</p>
  <div class="btns" style="margin-bottom:1rem">
    <button class="btn" data-action="add-level">Ajouter le niveau suivant</button>
    <button class="btn ghost" data-action="gen-prog">Préparer les niveaux jusqu'à…</button>
  </div>
  ${cartes ? `<div class="levels">${cartes}</div>` : `
    <div class="card intro"><h3>Aucun niveau</h3>
    <p>Ajoute le niveau 1 pour commencer. Si ton personnage est déjà au niveau 4, ajoute les quatre premiers niveaux et coche-les.</p></div>`}
  ${carteClassesPrestige(p)}`;
}

/* Classes de prestige : celles du Guide du Maître sont prêtes ; les autres (Poing sacré…) se saisissent depuis le livre */
function carteClassesPrestige(p) {
  const mod = peutModifierClasses();
  const defs = classesCommunes();
  const e = etat(p);
  const formulaire = (d, i) => {
    const b = f => `${i}.${f}`;
    return `<div class="pnj en-edition">
      <div class="grid">
        <label class="f span2"><span>Nom</span><input type="text" data-classebind="${b('nom')}" value="${esc(d.nom)}" placeholder="Ex. : Poing sacré"></label>
        <label class="f"><span>Dé de vie</span><select data-classebind="${b('dv')}" data-rerender>${[4, 6, 8, 10, 12].map(v => `<option value="${v}" ${num(d.dv) === v ? 'selected' : ''}>d${v}</option>`).join('')}</select></label>
        <label class="f"><span>Bonus de base à l'attaque</span><select data-classebind="${b('bba')}" data-rerender>${[['fort', 'Bon (comme le guerrier)'], ['moyen', 'Moyen (comme le moine)'], ['faible', 'Faible (comme le magicien)']].map(([v, t]) => `<option value="${v}" ${(d.bba || 'moyen') === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
        <label class="f"><span>Points de compétence / niveau</span><input type="text" inputmode="numeric" data-classebind="${b('pc')}" data-recalc value="${esc(d.pc)}" placeholder="2"></label>
        <label class="f"><span>Nombre de niveaux</span><input type="text" inputmode="numeric" data-classebind="${b('max')}" data-recalc value="${esc(d.max)}" placeholder="10"></label>
      </div>
      <div class="f"><span class="lbl">Bons jets de sauvegarde</span><div class="chips">${[['vig', 'Vigueur'], ['ref', 'Réflexes'], ['vol', 'Volonté']].map(([k2, t]) => `<label class="check"><input type="checkbox" data-classebind="${b(k2)}" data-rerender ${d[k2] ? 'checked' : ''}> ${t}</label>`).join('')}</div></div>
      <div class="f cumul-moine"><span class="lbl">Ses niveaux s'ajoutent à ceux de moine pour :</span>
        <div class="vis-grille">${[['mn', 'Dégâts à mains nues'], ['ca', 'Bonus de CA du moine'], ['deluge', 'Déluge de coups'], ['vitesse', 'Déplacement accéléré']].map(([k2, t]) => `<label class="check"><input type="checkbox" data-classebind="${b('cumul')}.${k2}" data-rerender ${(d.cumul ? d.cumul[k2] : d.cumulMoine) ? 'checked' : ''}> ${t}</label>`).join('')}</div>
        <p class="hint">Coche seulement ce que le livre indique. Pour le poing sacré : les dégâts à mains nues.</p></div>
      <div class="grid">
        <label class="f"><span>Progression des sorts</span><select data-classebind="${b('sortsType')}" data-rerender><option value="">Aucune</option><option value="divin" ${d.sortsType === 'divin' ? 'selected' : ''}>+1 niveau de lanceur divin</option><option value="profane" ${d.sortsType === 'profane' ? 'selected' : ''}>+1 niveau de lanceur profane</option><option value="les deux" ${d.sortsType === 'les deux' ? 'selected' : ''}>Les deux</option></select></label>
        ${d.sortsType ? `<label class="f"><span>À quels niveaux (ex. 1,2,3,5,6,7,9,10)</span><input type="text" data-classebind="${b('sortsNiveaux')}" data-recalc value="${esc(d.sortsNiveaux)}"></label>` : ''}
      </div>
      <div class="grid">
        <label class="f"><span>Bonus de CA propre (niveau:bonus)</span><input type="text" data-classebind="${b('caPaliers')}" value="${esc(d.caPaliers)}" placeholder="1:1, 5:2, 10:3"></label>
        <label class="f"><span>Bonus de vitesse en m (niveau:bonus)</span><input type="text" data-classebind="${b('vitPaliers')}" value="${esc(d.vitPaliers)}" placeholder="3:3"></label>
      </div>
      <p class="hint">Format « niveau:valeur », séparés par des virgules : « 1:1, 5:2, 10:3 » veut dire +1 dès le niveau 1, +2 dès le 5, +3 au 10. Le bonus de CA s'ajoute à la CA. Le bonus de vitesse ne s'ajoute pas au déplacement accéléré du moine : la fiche garde le meilleur des deux.</p>
      <h4 class="titre-saisie">Capacités à utilisations par jour <small>(compteurs dans « En combat »)</small></h4>
      ${(d.ressources || []).map((r, j) => `<div class="bloc-saisie">
        <div class="bloc-saisie-tete"><b>${esc(r.nom || `Capacité ${j + 1}`)}</b><button class="icon" data-action="pp-res-suppr" data-i="${i}" data-j="${j}" aria-label="Supprimer cette capacité">✕</button></div>
        <div class="grid">
          <label class="f span2"><span>Nom</span><input type="text" data-classebind="${b('ressources')}.${j}.nom" value="${esc(r.nom)}" placeholder="Ex. : Flamme sacrée"></label>
          <label class="f"><span>Utilisations par jour</span><input type="text" data-classebind="${b('ressources')}.${j}.paliers" value="${esc(r.paliers)}" placeholder="4:1, 8:2"></label>
          <label class="f"><span>Type d'action</span><input type="text" data-classebind="${b('ressources')}.${j}.action" value="${esc(r.action)}" placeholder="Action simple"></label>
          <label class="f"><span>Durée en rounds</span><input type="text" data-classebind="${b('ressources')}.${j}.duree" value="${esc(r.duree)}" placeholder="10, sag, niv…"></label>
        </div>
        <p class="hint">Utilisations : « 4:1, 8:2 » = 1 fois par jour dès le niveau 4 de la classe, 2 fois dès le niveau 8. Durée : un nombre de rounds (1 minute = 10), ou une formule avec « sag », « con », « niv »… (ex. « sag » pour un nombre de rounds égal au mod Sagesse).</p>
        <label class="f"><span>Effet</span><textarea rows="3" data-classebind="${b('ressources')}.${j}.texte" placeholder="Ce qu'elle fait, tel que décrit dans le livre">${esc(r.texte)}</textarea></label>
      </div>`).join('')}
      <div class="btns"><button class="lien" data-action="pp-res-ajout" data-i="${i}">+ Capacité par jour</button></div>
      <label class="f"><span>Prérequis (un par ligne, à vérifier avec le MJ)</span><textarea data-classebind="${b('prerequis')}" rows="3" placeholder="Bonus de base à l'attaque +4&#10;Science du combat à mains nues">${esc(d.prerequis)}</textarea></label>
      <div class="f"><span class="lbl">Compétences de classe</span><div class="vis-grille">${R.COMPETENCES.map(c => `<label class="check"><input type="checkbox" data-action="pp-comp" data-i="${i}" data-c="${c.id}" ${(d.comp || []).includes(c.id) ? 'checked' : ''}> ${esc(c.nom)}</label>`).join('')}</div></div>
      <h4 class="titre-saisie">Aptitudes par niveau</h4>
      ${(d.aptitudes || []).map((a, j) => `<div class="bloc-saisie">
        <div class="bloc-saisie-tete"><b>${a.nom ? `${esc(a.nom)}${a.niv ? ` <small>niveau ${esc(a.niv)}</small>` : ''}` : `Aptitude ${j + 1}`}</b><button class="icon" data-action="pp-apt-suppr" data-i="${i}" data-j="${j}" aria-label="Supprimer cette aptitude">✕</button></div>
        <div class="grid">
          <label class="f"><span>Niveau</span><input type="text" inputmode="numeric" data-classebind="${b('aptitudes')}.${j}.niv" value="${esc(a.niv)}" placeholder="1"></label>
          <label class="f span2"><span>Nom</span><input type="text" data-classebind="${b('aptitudes')}.${j}.nom" value="${esc(a.nom)}" placeholder="Ex. : Code de conduite"></label>
        </div>
        <label class="f"><span>Ce qu'elle fait</span><textarea rows="2" data-classebind="${b('aptitudes')}.${j}.texte" placeholder="Description">${esc(a.texte)}</textarea></label>
      </div>`).join('')}
      <div class="btns"><button class="lien" data-action="pp-apt-ajout" data-i="${i}">+ Aptitude</button></div>
      <div class="btns"><button class="btn" data-action="pp-fin">Terminé</button><button class="btn danger" data-action="pp-suppr" data-i="${i}">Supprimer</button></div>
    </div>`;
  };
  return `<section class="card"><h3>Classes de prestige</h3>
    <p class="hint aide"><b>Communes à toute la campagne</b> : une classe saisie ici apparaît dans le menu « Classe » de tous les personnages. Les classes de prestige du Guide du Maître sont déjà dans le menu « Classe » de chaque niveau, avec leurs prérequis vérifiés : défenseur nain, danseur de l'ombre, duelliste, théurge mystique, chevalier occulte, archer-mage. Une classe d'un autre livre (Poing sacré du Codex divin, par exemple) se saisit ici à partir du livre ; elle apparaît ensuite dans le même menu.</p>
    ${defs.map((d, i) => mod && state.editPrestige === d.id ? formulaire(d, i) : `<div class="pnj">
      <div class="pnj-tete"><b>${esc(d.nom || 'Sans nom')}</b>${mod ? `<button class="lien" data-action="pp-edit" data-id="${d.id}">Modifier</button>` : ''}</div>
      <p class="pnj-stats">d${esc(d.dv || 8)} · BBA ${esc(d.bba || 'moyen')} · ${esc(d.max || 10)} niveaux${(() => { const c = d.cumul || (d.cumulMoine ? { mn: 1, ca: 1, deluge: 1, vitesse: 1 } : {}); const l = [['mn', 'mains nues'], ['ca', 'CA'], ['deluge', 'déluge'], ['vitesse', 'vitesse']].filter(([k2]) => c[k2]).map(([, t]) => t); return l.length ? ' · cumule avec le moine : ' + l.join(', ') : ''; })()}${(e.classes['pp-' + d.id]) ? ` · niveau ${e.classes['pp-' + d.id]} pour ce personnage` : ''}${(() => { const n = db.personnages.filter(x => (x.progression || []).some(l => l.classe === 'pp-' + d.id)).map(x => x.nom); return n.length ? ` · utilisée par ${esc(n.join(', '))}` : ''; })()}</p>
    </div>`).join('')}
    ${mod ? '<button class="btn ghost" data-action="pp-ajout">+ Saisir une classe de prestige</button>' : ''}
  </section>`;
}

function carteNiveau(p, l, i, estProchain) {
  const n = l.niveau;
  const cl = R.CLASSES[l.classe];
  const cls = l.atteint ? 'done' : estProchain ? 'next' : '';
  const ouvert = state.ouverts.has(n) || (estProchain && !state.fermes.has(n));
  const avant = etat(p, n - 1, true);
  const apres = etat(p, n, true);
  const k = cl ? apres.classes[l.classe] : 0;
  const resume = cl ? `${cl.nom} ${k}` : 'Classe à choisir';
  const donsDuNiveau = [l.donRace, l.don, ...(l.donsBonus || [])].filter(Boolean).map(d => R.DON[d]?.nom).filter(Boolean);
  const opt = (id, c, extra = '') => `<option value="${id}" ${l.classe === id ? 'selected' : ''}>${esc(c.nom)}${extra}</option>`;
  const prestiges = Object.entries(R.CLASSES).filter(([id, c]) => c.prestige && (!c.perso || classesCommunes().some(d => 'pp-' + d.id === id) || (p.prestigePerso || []).some(d => 'pp-' + d.id === id)));
  const classeOptsHTML = `<optgroup label="Classes de base">${Object.entries(R.CLASSES).filter(([, c]) => !c.prestige).map(([id, c]) => opt(id, c)).join('')}</optgroup>
    ${prestiges.length ? `<optgroup label="Classes de prestige">${prestiges.map(([id, c]) => {
      const pr = prerequisPrestige(c, avant, p);
      const manque = pr.some(x => x.ok === false);
      const plein = (avant.classes[id] || 0) >= c.max;
      return opt(id, c, plein ? ' (niveau max atteint)' : manque ? ' (prérequis manquants)' : '');
    }).join('')}</optgroup>` : ''}`;
  const blocPrestige = cl && cl.prestige ? (() => {
    const pr = prerequisPrestige(cl, avant, p);
    return `<div class="prestige-info">
      <p><b>Classe de prestige</b> · ${cl.max} niveaux · DV d${cl.dv} · BBA ${({ fort: 'bon', moyen: 'moyen', faible: 'faible' })[cl.bba]} · bons jets : ${['vig', 'ref', 'vol'].filter(x => cl.js[x]).map(x => ({ vig: 'Vigueur', ref: 'Réflexes', vol: 'Volonté' })[x]).join(', ') || 'aucun'}${cl.cumulMoine || Object.values(cl.cumul || {}).some(Boolean) ? ' · cumule avec le moine (' + (cl.cumulMoine ? 'tout' : [['mn', 'mains nues'], ['ca', 'CA'], ['deluge', 'déluge'], ['vitesse', 'vitesse']].filter(([k2]) => cl.cumul[k2]).map(([, t]) => t).join(', ')) + ')' : ''}</p>
      ${pr.length ? `<ul class="prerequis-liste">${pr.map(x => `<li class="${x.ok === false ? 'ko' : x.ok ? 'ok' : ''}">${x.ok === false ? '✗' : x.ok ? '✓' : '•'} ${esc(x.texte)}</li>`).join('')}</ul>` : ''}
      ${k > cl.max ? `<p class="alerte-obligatoire">Cette classe n'a que ${cl.max} niveaux.</p>` : ''}
      ${pr.some(x => x.ok === false) ? '<p class="hint">Les prérequis doivent être remplis avant de prendre le premier niveau, sauf accord du MJ.</p>' : ''}
    </div>`;
  })() : '';
  return `
  <div class="level ${cls}">
    <div class="pip" aria-hidden="true">${n}</div>
    <details class="card" data-niveau="${n}" ${ouvert ? 'open' : ''}>
      <summary>
        <b>Niveau ${n}</b> <span class="resume">${esc(resume)}${donsDuNiveau.length ? ', ' + esc(donsDuNiveau.join(', ')) : ''}</span>
        ${estProchain ? '<span class="nextbadge">Prochain niveau</span>' : ''}${l.atteint ? '<span class="atteint-badge">Atteint</span>' : ''}
      </summary>
      <div class="levelhead">
        <label class="f"><span>Classe de ce niveau${n > 1 ? ' (la même qu\'avant, sauf multiclassage)' : ''}</span>
          <select data-bind="progression.${i}.classe" data-rerender>
            <option value="">— Choisir —</option>
            ${classeOptsHTML}
          </select></label>
        ${enLigne() && !estMJ() && !l.atteint
          ? `<label class="check" title="Le MJ valide ensuite le passage de niveau"><input type="checkbox" data-bind="progression.${i}.pret" data-rerender ${l.pret ? 'checked' : ''}> Fiche prête, à valider par le MJ</label>`
          : `<label class="check"><input type="checkbox" data-bind="progression.${i}.atteint" data-rerender ${l.atteint ? 'checked' : ''} ${enLigne() && !estMJ() ? 'disabled' : ''}> Atteint${!l.atteint && l.pret ? ' <small class="pret">(prêt)</small>' : ''}</label>`}
        <button class="icon" data-action="del-level" data-idx="${i}" aria-label="Supprimer le niveau ${n}">✕</button>
      </div>
      ${blocPrestige}
      ${cl ? gainsNiveau(p, l, i, cl, k, avant, apres) : '<p class="empty">Choisis une classe pour voir ce que ce niveau apporte.</p>'}
      ${ta(l, 'notes', 'Notes', { rows: 2 }).replace('data-bind="notes"', `data-bind="progression.${i}.notes"`)}
    </details>
  </div>`;
}

function gainsNiveau(p, l, i, cl, k, avant, apres) {
  const n = l.niveau;
  const g = [];
  const delta = (a, b) => a === b ? R.signe(b) : `${R.signe(a)} → <b>${R.signe(b)}</b>`;
  g.push(['Bonus de base à l\'attaque', avant.bba === apres.bba ? `${R.attTxt(R.attaques(apres.bba))} (inchangé)` : `${R.attTxt(R.attaques(avant.bba))} → <b>${R.attTxt(R.attaques(apres.bba))}</b>`]);
  g.push(['Jets de sauvegarde de base', `Vig ${delta(avant.js.vig, apres.js.vig)}, Réf ${delta(avant.js.ref, apres.js.ref)}, Vol ${delta(avant.js.vol, apres.js.vol)}`]);
  let pc = Math.max(1, cl.pc + apres.mods.int) + (apres.race?.pcBonus ? 1 : 0);
  g.push(['Points de compétence', `${n === 1 ? pc * 4 : pc} (${cl.pc} + mod Int${apres.race?.pcBonus ? ' + 1 humain' : ''}${n === 1 ? ', ×4 au niveau 1' : ''})`]);
  const lignes = g.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('');

  /* Choix à faire */
  const choix = [];
  const selDon = (champ, label, liste, sansPrerequis) => {
    const e = etat(p, n, true, { niveau: n, champ });
    const path = champ.startsWith('bonus') ? `progression.${i}.donsBonus.${champ.slice(5)}` : `progression.${i}.${champ}`;
    const cur = champ.startsWith('bonus') ? (l.donsBonus || [])[Number(champ.slice(5))] : l[champ];
    const d = cur && R.DON[cur];
    const nb = (liste || R.DONS).length;
    return `<div class="choix-don"><label class="f"><span>${label}</span>
      ${nb > 6 ? `<input type="search" class="don-recherche" data-path="${path}" data-n="${n}" data-champ="${champ}" data-liste="${liste ? liste.join(',') : ''}" data-libre="${sansPrerequis ? 1 : ''}" placeholder="Chercher un don : nom, effet (ex. esquive, CA, lutte)…" aria-label="Chercher un don">
      <div class="don-resultats" data-pour="${path}"></div>` : ''}
      <select data-bind="${path}" data-rerender aria-label="${esc(label)}">${optionsDons(e, p, cur || '', () => true, liste, sansPrerequis)}</select></label>
      ${d ? carteDon(d, apres, p, '', sansPrerequis) : ''}</div>`;
  };
  if (n === 1 && apres.race?.donBonus) choix.push(selDon('donRace', 'Don supplémentaire (humain)'));
  if (R.NIVEAUX_DONS.includes(n)) choix.push(selDon('don', `Don du niveau ${n}`));
  if (cl.donsBonus && cl.donsBonus(k)) {
    const l2 = typeof cl.donsBonusListe === 'function' ? cl.donsBonusListe(k)
      : cl.donsBonusListe === 'combat' ? R.DONS.filter(d => d.type === 'C').map(d => d.id)
      : R.DONS.filter(d => d.type === 'M' || d.type === 'O' || d.id === 'maitrise-sorts').map(d => d.id);
    choix.push(selDon('bonus0', `Don supplémentaire de ${cl.nom.toLowerCase()}`, l2, typeof cl.donsBonusListe === 'function'));
  }
  for (const d of cl.donsAuto?.[k] || []) choix.push(`<div class="choix-don"><p class="lbl">Don automatique</p>${carteDon(R.DON[d], apres, p, '', true)}</div>`);
  const c = cl.choix?.[k];
  if (c) {
    choix.push(`<label class="f"><span>${esc(c.nom)}</span><select data-bind="progression.${i}.choix.${c.id}" data-rerender>
      <option value="">— Choisir —</option>${Object.entries(c.options).map(([v, t]) => `<option value="${v}" ${l.choix?.[c.id] === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>`);
  }
  if (cl.donsStyle) {
    const style = (p.progression.find(x => x.classe === l.classe && x.choix?.style) || {}).choix?.style;
    const d = style && cl.donsStyle[style][k];
    if (d) choix.push(`<div class="choix-don"><p class="lbl">Don du style de combat</p>${carteDon(R.DON[d], apres, p, '', true)}</div>`);
  }
  if (n % 4 === 0) {
    choix.push(`<label class="f"><span>Augmentation de caractéristique (+1)</span><select data-bind="progression.${i}.augment" data-rerender>
      <option value="">— Choisir —</option>${R.CARACS.map(x => `<option value="${x.k}" ${l.augment === x.k ? 'selected' : ''}>${x.n}</option>`).join('')}</select></label>
      <p class="hint">Quand tu coches « Atteint », ce +1 s'ajoute tout seul à la caractéristique sur la fiche (et se retire si tu décoches).</p>`);
  }
  if (l.classe === 'pretre' && k === 1) {
    const div = R.DIVINITE[p.divinite];
    const permis = div ? div.domaines : Object.keys(R.DOMAINES);
    const optsDom = autre => Object.values(R.DOMAINES).filter(d => permis.includes(d.id) || d.id === l.domaine1 || d.id === l.domaine2).map(d => `<option value="${d.id}" ${d.id === autre ? 'disabled' : ''}>${esc(d.nom)}${permis.includes(d.id) ? '' : ' (hors des domaines de ta divinité)'}</option>`).join('');
    const carte = id => { const d = R.DOMAINES[id]; return d ? `<div class="domaine-carte"><b>${esc(d.nom)}</b><p>${esc(d.pouvoir)}</p><p class="hint">Sorts : ${d.sorts.map((x, n) => `${n + 1}. ${sortDomaineHTML(x)}`).join(' · ')}</p></div>` : ''; };
    choix.push(`<div class="choix-domaines">
      <p class="lbl">Domaines du prêtre (2, parmi ceux de ta divinité)</p>
      ${div ? `<p class="hint">${esc(div.nom)} : ${esc(div.domaines.map(x => R.DOMAINES[x].nom).join(', '))}${div.autres.length ? ` ; et dans les suppléments : ${esc(div.autres.join(', '))} (pas encore dans l'appli, à voir avec le MJ)` : ''}.</p>` : '<p class="hint">Choisis d\'abord une divinité sur la fiche (Identité) pour ne voir que ses domaines.</p>'}
      <div class="grid">
        <label class="f"><span>Domaine 1</span><select data-bind="progression.${i}.domaine1" data-rerender><option value="">— Choisir —</option>${optsDom(l.domaine2).replace(`value="${l.domaine1}"`, `value="${l.domaine1}" selected`)}</select></label>
        <label class="f"><span>Domaine 2</span><select data-bind="progression.${i}.domaine2" data-rerender><option value="">— Choisir —</option>${optsDom(l.domaine1).replace(`value="${l.domaine2}"`, `value="${l.domaine2}" selected`)}</select></label>
      </div>
      ${carte(l.domaine1)}${carte(l.domaine2)}
      <p class="hint">Chaque domaine donne un pouvoir et une liste de sorts : chaque jour, tu prépares en plus un sort de domaine par niveau de sort, choisi dans l'un de tes deux domaines.</p>
    </div>`);
  }
  choix.push('<p class="hint">Points de vie : c\'est le MJ qui les fixe. Mets simplement à jour « Points de vie max » sur la fiche.</p>');

  /* Nouvelles aptitudes et valeurs qui évoluent */
  const apt = cl.aptitudes.filter(a => a.niv === k);
  const vAvant = Object.fromEntries(valeursClasse(l.classe, k - 1, avant));
  const changes = valeursClasse(l.classe, k, apres).filter(([nom, v]) => String(vAvant[nom]) !== String(v))
    .map(([nom, v]) => `<li><b>${esc(nom)}</b> : ${vAvant[nom] != null ? `${esc(vAvant[nom])} → ` : ''}<b>${esc(v)}</b></li>`);
  for (const id of avant.dons) {
    const d = R.DON[id];
    if (d.calc && apres.dons.has(id)) {
      const a = d.calc(avant), b = d.calc(apres);
      if (a !== b) changes.push(`<li><b>${esc(d.nom)}</b> : ${esc(b)}</li>`);
    }
  }
  const spA = sortsParJour(l.classe, k - 1, avant), spB = sortsParJour(l.classe, k, apres);
  const bs = blocSortsNiveau(p, l, i, cl, k, avant, apres);
  const sortsChange = spB && JSON.stringify(spA?.parJour) !== JSON.stringify(spB.parJour);
  return `
    <dl class="gains">${lignes}</dl>
    ${apt.length ? `<h4>Nouvelles aptitudes de ${esc(cl.nom.toLowerCase())}</h4><dl class="caps">${apt.map(a => `<dt>${esc(a.nom)}</dt><dd>${esc(a.texte)}</dd>`).join('')}</dl>` : ''}
    ${changes.length ? `<h4>Ce qui s'améliore</h4><ul class="changes">${changes.join('')}</ul>` : ''}
    ${sortsChange ? tableSorts(spB) : ''}
    ${bs.tableau}
    ${bs.choix}
    <h4>Choix du niveau</h4>
    <div class="choix">${choix.join('')}</div>`;
}

/* ===== Sorts gagnés en montant de niveau ===== */
const ABR_SORTS = { magicien: 'Ens/Mag', ensorceleur: 'Ens/Mag', pretre: 'Prê', druide: 'Dru', barde: 'Brd', rodeur: 'Rôd', paladin: 'Pal' };
const sortsDeClasse = (abr, min, max) => db.sorts.filter(x => (x.niveaux || []).some(n => n.classe === abr && n.niveau >= min && n.niveau <= max));
const nivSortClasse = (x, abr) => (x.niveaux || []).find(n => n.classe === abr)?.niveau;
function blocSortsNiveau(p, l, i, cl, k, avant, apres) {
  /* Quelle classe de lanceur progresse à ce niveau ? */
  let cid = null, spA = null, spB = null;
  if (cl.lanceur) { cid = l.classe; spA = sortsParJour(cid, k - 1, avant); spB = sortsParJour(cid, k, apres); }
  else if (cl.sortsPlus && cl.sortsPlus.niveaux.includes(k)) {
    cid = Object.keys(apres.lanceurBonus || {}).find(c => (apres.lanceurBonus[c] || 0) > (avant.lanceurBonus?.[c] || 0));
    if (cid) { spA = sortsParJour(cid, avant.classes[cid], avant); spB = sortsParJour(cid, apres.classes[cid], apres); }
  }
  if (!cid || !spB) return { tableau: '', choix: '' };
  const lc = R.CLASSES[cid].lanceur, abr = ABR_SORTS[cid];
  const effA = (avant.classes[cid] || 0) + (avant.lanceurBonus?.[cid] || 0), effB = (apres.classes[cid] || 0) + (apres.lanceurBonus?.[cid] || 0);
  const nivMax = Math.max(...spB.parJour.map(x => x.niv));
  const mod = peutModifier(p);
  const blocs = [];
  if (lc.connus && abr) {
    /* Lanceur spontané : nouveaux sorts connus par niveau de sort */
    const A = effA ? (lc.connus[effA] || '').split(' ').map(Number) : [];
    const B = (lc.connus[effB] || '').split(' ').map(Number);
    B.forEach((v, niv) => { const nb = v - (A[niv] || 0); if (nb > 0) blocs.push({ cle: String(niv), titre: `${nb} nouveau${nb > 1 ? 'x' : ''} sort${nb > 1 ? 's' : ''} connu${nb > 1 ? 's' : ''} de niveau ${niv}`, quota: nb, min: niv, max: niv }); });
  } else if (cid === 'magicien' && abr) {
    if (effB === 1) {
      blocs.push({ cle: 'ecoles', ecoles: true });
      blocs.push({ cle: 'zero', titre: 'Grimoire : tous les sorts de niveau 0', tous: 0 });
      const q = 3 + Math.max(0, apres.mods.int);
      blocs.push({ cle: '1', titre: `Grimoire : ${q} sorts de niveau 1 (3 + mod Int)`, quota: q, min: 1, max: 1 });
    } else blocs.push({ cle: 'max', titre: `2 nouveaux sorts pour le grimoire (niveau ${nivMax} au plus)`, quota: 2, min: 1, max: nivMax });
  }
  const interdites = new Set(cid === 'magicien' ? (p.ecolesInterdites || []) : []);
  const html = blocs.map(bl => {
    if (bl.ecoles) return `<div class="choix-sorts"><p class="lbl">Magicienne spécialisée ? Écoles interdites</p>
      <div class="chips">${['Abjuration', 'Divination', 'Enchantement', 'Évocation', 'Illusion', 'Invocation', 'Nécromancie', 'Transmutation'].map(ec => `<button class="chip ${interdites.has(ec) ? 'on interdite' : ''}" data-action="ecole-interdite" data-e="${ec}" ${mod ? '' : 'disabled'}>${ec}</button>`).join('')}</div>
      <p class="hint">Une magicienne spécialisée renonce à une ou deux écoles : leurs sorts sont exclus de son grimoire et des choix ci-dessous. Une magicienne universaliste n'en coche aucune.</p></div>`;
    if (bl.tous != null) {
      const zero = sortsDeClasse(abr, 0, 0).filter(x => !interdites.has(x.ecole));
      const manquants = zero.filter(x => !(p.sorts || []).some(y => y.id === x.id));
      return `<div class="choix-sorts"><p class="lbl">${esc(bl.titre)} <span class="quota ${manquants.length ? '' : 'ok'}">${zero.length - manquants.length} / ${zero.length}</span></p>
        ${manquants.length && mod ? `<button class="btn ghost" data-action="prog-sorts-zero" data-abr="${abr}">Ajouter les ${manquants.length} sorts de niveau 0</button>` : ''}</div>`;
    }
    const choisis = (l.sortsAppris || []).filter(x => x.bloc === bl.cle);
    return `<div class="choix-sorts">
      <p class="lbl">${esc(bl.titre)} <span class="quota ${choisis.length >= bl.quota ? 'ok' : ''}">${choisis.length} / ${bl.quota}</span></p>
      <div class="chips">${choisis.map(x => { const sp = findSort(x.id); return `<span class="chip on">${esc(sp ? sp.nom : x.id)}${mod ? `<button class="chip-x" data-action="prog-sort-suppr" data-i="${i}" data-id="${x.id}" aria-label="Retirer">✕</button>` : ''}</span>`; }).join('')}</div>
      ${choisis.length < bl.quota && mod ? `<input type="search" class="prog-sort-q" data-i="${i}" data-bloc="${bl.cle}" data-interdites="${[...interdites].join('|')}" data-abr="${abr}" data-min="${bl.min}" data-max="${bl.max}" placeholder="Chercher un sort (nom, effet, usage : offensif, soin…)" aria-label="Chercher un sort à apprendre">
        <div class="prog-sort-res" data-pour="${i}-${bl.cle}"></div>` : ''}
    </div>`;
  }).join('');
  const nivAvant = spA ? Math.max(...spA.parJour.map(x => x.niv)) : 0;
  const doms = cid === 'pretre' ? (apres.domaines || []) : [];
  const nouveauxDom = doms.length && nivMax > nivAvant && nivMax >= 1
    ? `<p class="domaine-nouveau">Nouveau sort de domaine de niveau ${nivMax} : ${doms.map(d => `${sortDomaineHTML(R.DOMAINES[d].sorts[nivMax - 1])} <small>(${esc(R.DOMAINES[d].nom)})</small>`).join(' ou ')}</p>` : '';
  const note = !blocs.length
    ? (lc.type.startsWith('divin') ? `<p class="hint">${esc(R.CLASSES[cid].nom)} : tu prépares chaque jour tes sorts parmi <b>toute la liste</b> de ta classe, jusqu'au niveau ${nivMax}. Rien à choisir ici, seulement de nouveaux emplacements.</p>${nouveauxDom}` : '')
    : '<p class="hint">Les sorts choisis sont ajoutés à l\'onglet Sorts. Retirer un sort ici le retire aussi de l\'onglet Sorts.</p>';
  return {
    tableau: !cl.lanceur && JSON.stringify(spA?.parJour) !== JSON.stringify(spB.parJour) ? `<h4>Sorts de ${esc(R.CLASSES[cid].nom.toLowerCase())} : +1 niveau de lanceur</h4>${tableSorts(spB)}` : '',
    choix: html || note ? `<div class="sorts-niveau"><h4>Sorts à apprendre</h4>${html}${note}</div>` : '',
  };
}

/* ---------- Journal : récapitulatifs communs et notes personnelles ---------- */
const TYPES_NOTES = {
  note: 'Note', indice: 'Indice', pnj: 'PNJ', lieu: 'Lieu', quete: 'Quête', butin: 'Butin', question: 'Question',
};
const TYPES_SUIVIS = ['question', 'quete'];
const findSession = id => (db.sessions || []).find(s => s.id === id);
const carnetActif = () => {
  if (!enLigne()) return null;
  const mine = mesPersos();
  if (!mine.length) return null;
  return mine.some(p => p.id === state.carnet) ? state.carnet : mine[0].id;
};
const sessionsTriees = () => [...(db.sessions || [])]
  .filter(s => !enLigne() || s.persoId === carnetActif())
  .sort((a, b) => num(b.numero) - num(a.numero));
const titreSession = s => `Session ${s.numero}${s.titre ? ' : ' + s.titre : ''}`;
const dateFr = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
const heure = t => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

function sousNav(actif) {
  return `<nav class="tabs" aria-label="Journal">
    <a href="#/recaps" class="${actif === 'recaps' ? 'active' : ''}">Récits</a>
    <a href="#/encyclo" class="${actif === 'encyclo' ? 'active' : ''}">Encyclopédie</a>
    <a href="#/notes" class="${actif === 'notes' ? 'active' : ''}">Mes notes</a>
  </nav>`;
}

/* Mentions : @Nom ou @[Nom en plusieurs mots] */
const RE_MENTION = /@\[([^\]]+)\]|@([\p{L}\p{N}_'’-]+)/gu;
/* @[Fiche|texte affiché] : lien vers « Fiche », affiché « texte affiché » */
function partiesMention(a, b) {
  if (a) { const [c, t] = a.split('|'); return { cible: c.trim(), texte: (t ?? c).trim() }; }
  const n = b.replace(/_/g, ' ').trim();
  return { cible: n, texte: n };
}
const sansMentions = t => String(t || '').replace(RE_MENTION, (m, a, b) => partiesMention(a, b).texte);
function mentionsDe(texte) {
  return [...String(texte || '').matchAll(RE_MENTION)].map(m => partiesMention(m[1], m[2]).cible).filter(Boolean);
}
function avecMentions(texte) {
  const t = String(texte || '');
  let out = '', last = 0;
  for (const m of t.matchAll(RE_MENTION)) {
    const { cible: nom, texte } = partiesMention(m[1], m[2]);
    out += esc(t.slice(last, m.index)) + `<a class="mention" href="#/notes/recherche/${encodeURIComponent(nom)}">${esc(texte)}</a>`;
    last = m.index + m[0].length;
  }
  return (out + esc(t.slice(last))).replace(/\n/g, '<br>');
}
function indexMentions() {
  const compte = new Map();
  for (const s of sessionsTriees()) {
    for (const n of s.notes || []) {
      for (const nom of new Map(mentionsDe(n.texte).map(m => [norm(m), m])).values()) {
        const cle = norm(nom);
        const cur = compte.get(cle) || { nom, n: 0 };
        cur.n++;
        compte.set(cle, cur);
      }
    }
  }
  return [...compte.values()].sort((a, b) => b.n - a.n || a.nom.localeCompare(b.nom, 'fr'));
}

/* ===== Récapitulatifs communs =====
   La version publiée vient de recaps.json, à la racine du site (identique pour tout le monde).
   Les créations et modifications restent locales tant qu'elles ne sont pas publiées. */
const champsRecap = r => JSON.stringify(['numero', 'date', 'titre', 'auteur', 'texte', 'photoType', 'photoMaj'].map(k => String(r[k] ?? (k === 'photoMaj' ? 0 : ''))));
const TYPES_PHOTO = { repas: 'Le repas', apero: 'L\'apéro', illustration: 'Illustration', groupe: 'Photo de groupe' };
/* Les photos ne sont pas gardées dans le stockage de l'appareil (trop lourdes) : cache en mémoire */
const photoRecap = r => r.photo !== undefined ? r.photo : (state.photos || {})[r.id];
async function chargerPhoto(id) {
  state.photos = state.photos || {};
  if (id in state.photos || !enLigne()) return;
  state.photos[id] = '';
  try {
    const l = await api(`recaps?id=eq.${encodeURIComponent(id)}&select=photo`);
    state.photos[id] = (l && l[0] && l[0].photo) || '';
    if (location.hash.includes(id)) render();
  } catch (e) { delete state.photos[id]; }
}
const recapsPublies = () => db.recapsPublies || [];
function recapsTous() {
  const supprimes = new Set(db.recapsSupprimes || []);
  const m = new Map(recapsPublies().map(r => [r.id, r]));
  for (const r of db.recaps || []) m.set(r.id, r);
  return [...m.values()].filter(r => !supprimes.has(r.id)).sort((a, b) => num(b.numero) - num(a.numero));
}
const findRecap = id => recapsTous().find(r => r.id === id);
function statutRecap(r) {
  const pub = recapsPublies().find(x => x.id === r.id);
  const loc = (db.recaps || []).find(x => x.id === r.id);
  if (!pub) return 'brouillon';
  if (loc && champsRecap(loc) !== champsRecap(pub)) return 'modifie';
  return 'publie';
}
const STATUTS_RECAP = { brouillon: 'Non publié', modifie: 'Modifié, non publié', publie: 'Publié' };
const aPublier = () => recapsTous().filter(r => statutRecap(r) !== 'publie').length + (db.recapsSupprimes || []).length + fichesAPublier();

/* Base de données en ligne (Supabase), configurée dans config.js */
const CFG = window.CODEX_CONFIG || {};
const enLigne = () => !!(CFG.supabaseUrl && CFG.supabaseCle) && !/XXXX/.test(CFG.supabaseUrl + CFG.supabaseCle);
async function api(chemin, opts = {}) {
  const entetes = { apikey: CFG.supabaseCle, 'Content-Type': 'application/json' };
  if (CFG.supabaseCle.startsWith('eyJ')) entetes.Authorization = 'Bearer ' + CFG.supabaseCle; // ancienne clé « anon »
  const res = await fetch(CFG.supabaseUrl.replace(/\/+$/, '') + '/rest/v1/' + chemin, { ...opts, headers: { ...entetes, ...(opts.headers || {}) } });
  if (!res.ok) {
    let msg = 'erreur ' + res.status;
    try { const j = await res.json(); msg = j.message || msg; } catch (e) { /* réponse vide */ }
    throw new Error(msg);
  }
  const txt = await res.text();
  return txt ? JSON.parse(txt) : null;
}
const rpc = (fonction, args) => api('rpc/' + fonction, { method: 'POST', body: JSON.stringify(args) });

async function chargerRecaps() {
  try {
    let pub;
    if (enLigne()) {
      let lignes;
      try {
        lignes = await api('recaps?select=id,numero,date,titre,auteur,texte,maj,photo_type,photo_maj&order=numero.desc');
      } catch (e) {
        lignes = await api('recaps?select=id,numero,date,titre,auteur,texte,maj&order=numero.desc'); // base pas encore en v3
      }
      pub = (lignes || []).map(({ photo_type, photo_maj, ...r }) => ({ ...r, date: r.date || '', titre: r.titre || '', auteur: r.auteur || '', texte: r.texte || '', photoType: photo_type || '', photoMaj: Number(photo_maj) || 0 }));
    } else {
      const res = await fetch('recaps.json', { cache: 'no-store' });
      if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
      pub = res.ok ? ((await res.json()).recaps || []) : [];
      state.photos = state.photos || {};
      pub = pub.map(({ photo, ...r }) => { if (photo) state.photos[r.id] = photo; return r; });
    }
    db.recapsPublies = pub;
    /* Ce qui est désormais publié à l'identique n'a plus besoin d'être gardé en local */
    db.recaps = (db.recaps || []).filter(l => { const p = pub.find(x => x.id === l.id); return !p || champsRecap(p) !== champsRecap(l); });
    db.recapsSupprimes = (db.recapsSupprimes || []).filter(id => pub.some(x => x.id === id));
    state.recapsCharges = Date.now();
    state.recapsErreur = '';
    saveNow();
    return true;
  } catch (e) {
    console.warn('Récapitulatifs publiés indisponibles', e);
    state.recapsErreur = e.message;
    return false;
  }
}

/* Conteur désigné pour la prochaine session */
async function chargerInfos() {
  if (!enLigne()) return;
  try {
    let l;
    l = await api('campagne_info?select=*');
    if (l && l[0]) db.combatPublic = l[0].combat || {};
    if (l && l[0] && l[0].bourse) db.bourseCommune = { bourse: l[0].bourse, porteur_id: l[0].porteur_id || '', journal: l[0].bourse_journal || [], objets: l[0].coffre_objets || [] };
    db.conteur = (l && l[0]) || null;
    if (l && l[0] && l[0].jour) db.jour = l[0].jour;
    saveNow();
  } catch (e) { console.warn('Infos de campagne indisponibles (base pas encore en v3 ?)', e); }
}
function carteConteur(admin) {
  const c = db.conteur;
  const moi = c && c.conteur_id && (enLigne() ? !!(db.cles || {})[c.conteur_id] : false);
  const prochaine = recapsTous().reduce((m, r) => Math.max(m, num(r.numero)), 0) + 1;
  const options = db.personnages.filter(x => !enLigne() || x.publie).map(x => [x.id, x.joueur ? `${x.joueur} (${x.nom})` : x.nom]);
  if (!c?.conteur_nom && !admin) return '';
  return `<section class="card conteur ${moi ? 'moi' : ''}"><h3>Prochain récit</h3>
    ${c?.conteur_nom
      ? `<p class="conteur-nom">${c.session ? `Session ${esc(c.session)} : ` : ''}<b>${esc(c.conteur_nom)}</b></p>
         <p class="hint">${moi ? 'C\'est toi qui racontes la prochaine session ! ' : ''}Le conteur prépare le récit et une photo : le repas, l'apéro, une illustration ou une photo de groupe.</p>`
      : '<p class="empty">Personne n\'est encore désigné.</p>'}
    ${admin ? `<details class="admin"><summary>Désigner le conteur</summary>
      <div class="grid">
        <label class="f span2"><span>Joueur</span><select id="conteur-choix"><option value="">— Choisir —</option>${options.map(([v, l]) => `<option value="${v}" ${c?.conteur_id === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select></label>
        <label class="f"><span>Pour la session</span><input type="number" id="conteur-session" value="${esc(c?.session && num(c.session) >= prochaine ? c.session : prochaine)}"></label>
      </div>
      <button class="btn" data-action="definir-conteur">Désigner</button>
    </details>` : ''}
  </section>`;
}

/* Envoie en ligne tout ce qui n'est pas encore publié */
async function publierTout() {
  if (!db.codeCampagne && !db.codeMJ) { toast('Saisis d\'abord le code de campagne ou le code MJ'); return; }
  const aEnvoyer = codeAdmin() ? recapsTous().filter(r => statutRecap(r) !== 'publie') : [];
  const sansPhoto = aEnvoyer.filter(r => !photoRecap(r) && !r.photoMaj);
  if (sansPhoto.length && !confirm(`${sansPhoto.map(r => 'Session ' + r.numero).join(', ')} : pas de photo. Publier quand même ?`)) return;
  try {
    for (const r of aEnvoyer) {
      await rpc('publier_recap', {
        p_code: codeAdmin(), p_id: r.id, p_numero: Math.round(num(r.numero)), p_date: r.date || null,
        p_titre: r.titre || '', p_auteur: r.auteur || '', p_texte: r.texte || '',
        p_photo: r.photo === undefined ? null : r.photo, p_photo_type: r.photoType || '', p_photo_maj: r.photoMaj || 0,
      });
      if (r.photo !== undefined) { state.photos = state.photos || {}; state.photos[r.id] = r.photo; }
    }
    if (codeAdmin()) for (const id of db.recapsSupprimes || []) await rpc('supprimer_recap', { p_code: codeAdmin(), p_id: id });
    for (const f of fichesToutes().filter(x => statutPublication(x) !== 'publie')) {
      await sauverFicheRPC(f);
    }
    for (const id of db.fichesSupprimees || []) await rpc('supprimer_fiche', { p_code: codeFiches(), p_id: id });
    await chargerFiches();
    await chargerRecaps();
    render();
    toast('Publié pour toute la compagnie');
  } catch (e) {
    alert('Publication impossible : ' + e.message + (db.codeMJ && !db.codeCampagne ? ' (la base est-elle en v11 ?)' : ''));
  }
}

function recapLocal(id) {
  db.recaps = db.recaps || [];
  let r = db.recaps.find(x => x.id === id);
  if (!r) {
    const pub = recapsPublies().find(x => x.id === id);
    if (!pub) return null;
    r = { ...pub };
    db.recaps.push(r);
  }
  return r;
}
function nouveauRecap(depuis) {
  const numero = depuis ? depuis.numero : recapsTous().reduce((m, r) => Math.max(m, num(r.numero)), 0) + 1;
  return {
    id: uid(), numero, date: depuis ? depuis.date : new Date().toISOString().slice(0, 10),
    titre: depuis ? depuis.titre : '', auteur: (db.conteur && db.conteur.conteur_nom) || '', texte: depuis ? brouillonRecap(depuis) : '', maj: Date.now(),
    photoType: '', photoMaj: 0, photo: '',
  };
}

function bandeauPublication() {
  const n = aPublier();
  if (!n) return state.recapsErreur && enLigne() ? `<p class="hint">Base de données injoignable (${esc(state.recapsErreur)}). Les récapitulatifs affichés sont ceux du dernier chargement.</p>` : '';
  const pluriel = n > 1 ? 's' : '';
  if (enLigne()) {
    return `<section class="card bandeau">
      <h3>À publier</h3>
      <p>${(() => {
        const rn = recapsTous().filter(r => statutRecap(r) !== 'publie');
        const rs = (db.recapsSupprimes || []).length, fn = fichesToutes().filter(f => statutPublication(f) !== 'publie').length, fs = (db.fichesSupprimees || []).length;
        const l = [
          rn.length ? `${rn.length} récit${rn.length > 1 ? 's' : ''} nouveau${rn.length > 1 ? 'x' : ''} ou modifié${rn.length > 1 ? 's' : ''} (${rn.map(r => 'session ' + esc(r.numero)).join(', ')})` : '',
          rs ? `${rs} récit${rs > 1 ? 's' : ''} supprimé${rs > 1 ? 's' : ''} (encore visible${rs > 1 ? 's' : ''} chez les autres)` : '',
          fn ? `${fn} fiche${fn > 1 ? 's' : ''} nouvelle${fn > 1 ? 's' : ''} ou modifiée${fn > 1 ? 's' : ''}` : '',
          fs ? `${fs} fiche${fs > 1 ? 's' : ''} supprimée${fs > 1 ? 's' : ''}` : '',
        ].filter(Boolean);
        return `En attente : ${l.join(' ; ')}. Ces changements ne sont que sur cet appareil tant que tu ne publies pas.`;
      })()}</p>
      <div class="btns" style="margin-top:.6rem"><button class="btn" data-action="publier-tout">Publier maintenant</button></div>
    </section>`;
  }
  return `<section class="card bandeau">
    <h3>À publier</h3>
    <p>${n} élément${pluriel} (récits ou fiches) modifié${pluriel} sur cet appareil seulement. Tant qu'ils ne sont pas publiés, les autres joueurs ne les voient pas.</p>
    <div class="btns"><button class="btn" data-action="export-recaps">Exporter recaps.json</button><button class="btn ghost" data-action="export-fiches">Exporter fiches.json</button></div>
    <p class="hint">Ensuite, place <b>recaps.json</b> dans le dossier du site et fais un <b>git push</b>. Un autre joueur peut aussi t'envoyer ce fichier : importe-le depuis l'onglet Partage, puis publie.</p>
  </section>`;
}

function pageRecaps() {
  const liste = recapsTous();
  const joueurs = liste.map(r => {
    const st = statutRecap(r);
    return `<a class="session-carte" href="#/recap/${r.id}">
      <span class="session-num">${esc(r.numero)}</span>
      <span class="session-txt"><b>${esc(r.titre || 'Sans titre')}</b>
        <small>${esc([r.auteur ? 'Raconté par ' + r.auteur : '', dateFr(r.date)].filter(Boolean).join(', '))}</small>
        ${r.texte ? `<span class="session-extrait">${esc(texteBrut(r.texte).replace(/\s+/g, ' ').trim().slice(0, 150))}${r.texte.length > 150 ? '…' : ''}</span>` : ''}
      </span>
      ${st !== 'publie' ? `<span class="statut statut-${st}">${STATUTS_RECAP[st]}</span>` : ''}
    </a>`;
  }).join('');
  return `${sousNav('recaps')}
  <div class="pagehead">
    <div><h1>Récapitulatifs</h1><p class="sub">Le récit lu en début de session, commun à toute la compagnie</p></div>
    ${estAdmin() ? '<button class="btn" data-action="new-recap">Nouveau récapitulatif</button>' : ''}
  </div>
  <input type="search" id="rq" placeholder="Chercher un PNJ, un lieu, une quête dans les récits…" aria-label="Chercher dans les récits">
  ${carteConteur(estAdmin())}
  ${estAdmin() ? bandeauPublication() : ''}
  <section class="card"><h3>Les sessions racontées</h3>
    ${joueurs ? `<div class="sessions">${joueurs}</div>` : '<p class="empty">Aucun récapitulatif publié pour l\'instant.</p>'}
  </section>`;
}

function pageRecap(id) {
  const r = findRecap(id);
  if (!r) return `${sousNav('recaps')}<p>Récapitulatif introuvable. <a href="#/recaps">Retour aux récapitulatifs</a></p>`;
  const st = statutRecap(r);
  if (state.editRecap === id && estAdmin()) {
    const loc = recapLocal(id);
    state.ctx = loc;
    state.editRecapObj = loc;
    const noms = [...new Set([...db.personnages.map(p => p.joueur), ...db.personnages.map(p => p.nom)].filter(Boolean))];
    return `${sousNav('recaps')}
    <p><a href="#/recaps">← Récits</a></p>
    <h1>Modifier le récapitulatif</h1>
    <section class="card" style="margin-top:1rem">
      <div class="grid">
        ${fi(loc, 'numero', 'Session n°', { type: 'number' })}
        ${fi(loc, 'date', 'Date de la session', { type: 'date' })}
        ${fi(loc, 'titre', 'Titre', { ph: 'Ex. : Le tombeau des anciens', span: true })}
        <label class="f span2"><span>Raconté par</span>
          <input type="text" list="liste-auteurs" data-bind="auteur" value="${esc(loc.auteur)}" placeholder="Le joueur qui fait le récit"></label>
        <datalist id="liste-auteurs">${noms.map(n => `<option value="${esc(n)}">`).join('')}</datalist>
      </div>
      <label class="f"><span>Récit</span></label>
      ${barreOutils()}
      <textarea data-bind="texte" id="zone-recit" rows="16" placeholder="La dernière fois, la compagnie…" aria-label="Récit">${esc(loc.texte)}</textarea>
      <details class="apercu" open><summary>Aperçu</summary><div class="recit-texte" id="apercu-recit">${formaterRecit(loc.texte) || '<p class="empty">Le récit apparaîtra ici, mis en forme.</p>'}</div></details>
      <div class="photo-recap">
        <h4>Photo de la session</h4>
        ${photoRecap(loc) ? `<img class="photo-apercu" src="${photoRecap(loc)}" alt="Photo de la session">` : '<p class="alerte-photo">Pas encore de photo : le conteur doit en fournir une.</p>'}
        <div class="grid">
          ${sel(loc, 'photoType', 'Ce que montre la photo', Object.entries(TYPES_PHOTO))}
        </div>
        <div class="btns">
          <button class="btn ghost" data-action="photo-recap">${photoRecap(loc) ? 'Changer la photo' : 'Ajouter une photo'}</button>
          ${photoRecap(loc) ? '<button class="btn danger" data-action="photo-recap-retirer">Retirer la photo</button>' : ''}
        </div>
      </div>
      <div class="btns">
        ${enLigne() ? '<button class="btn" data-action="recap-publier">Enregistrer et publier</button><button class="btn ghost" data-action="recap-fin">Enregistrer sans publier</button>' : '<button class="btn" data-action="recap-fin">Terminé</button>'}
        <button class="btn danger" data-action="del-recap" data-id="${r.id}">Supprimer</button>
      </div>
    </section>`;
  }
  if (r.photoMaj && photoRecap(r) === undefined) chargerPhoto(r.id);
  const paragraphes = formaterRecit(r.texte);
  return `${sousNav('recaps')}
  <p><a href="#/recaps">← Récits</a></p>
  <article class="recit">
    <p class="recit-num">Session ${esc(r.numero)}</p>
    <h1>${esc(r.titre || 'Sans titre')}</h1>
    <p class="sub">${esc([r.auteur ? 'Raconté par ' + r.auteur : '', dateFr(r.date)].filter(Boolean).join(', '))}</p>
    ${photoRecap(r) ? `<figure class="photo-recit"><img src="${photoRecap(r)}" alt="${esc(TYPES_PHOTO[r.photoType] || 'Photo de la session')}">${r.photoType ? `<figcaption>${esc(TYPES_PHOTO[r.photoType])}</figcaption>` : ''}</figure>` : ''}
    <div class="ornement" aria-hidden="true"><span></span></div>
    <div class="recit-texte">${paragraphes || '<p class="empty">Le récit n\'est pas encore écrit.</p>'}</div>
  </article>
  <div class="btns" style="margin-top:1rem">
    ${estAdmin() ? `<button class="btn" data-action="recap-edit" data-id="${r.id}">Modifier</button>` : ''}
    <button class="btn ghost" data-action="recap-copier" data-id="${r.id}">Copier le texte</button>
    ${st !== 'publie' ? `<span class="statut statut-${st}">${STATUTS_RECAP[st]}</span>` : ''}
  </div>
  ${st !== 'publie' && estAdmin() ? bandeauPublication() : ''}`;
}

/* ===== Mise en forme du récit =====
   Syntaxe simple, insérée par la barre d'outils :
   **gras**  _italique_  ++souligné++  ==mise en valeur==
   # Titre   ## Grand texte   > citation   - liste   --- séparateur */
function formaterLigne(t) {
  return liensMentions(esc(t)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\+\+(.+?)\+\+/g, '<u>$1</u>')
    .replace(/==(.+?)==/g, '<mark>$1</mark>')
    .replace(/(^|[\s(«"'’])_(.+?)_(?=$|[\s).,;:!?»"'’])/g, '$1<em>$2</em>'));
}
/* Les @mentions deviennent des liens vers les fiches de l'encyclopédie (marqueurs posés avant l'échappement) */
function marquerMentions(t) {
  const idx = indexNoms();
  const marque = String(t || '').replace(RE_MENTION, (m, a, b) => {
    const { cible, texte } = partiesMention(a, b);
    const f = idx.get(norm(cible));
    return `\u0001${f ? f.id : ''}\u0002${texte}\u0003`;
  });
  return lierNomsConnus(marque);
}
/* Liens automatiques : chaque nom de fiche (ou autre nom connu) écrit avec une majuscule devient un lien,
   à sa première apparition dans chaque paragraphe, sans avoir à écrire @[…]. */
let reNoms = null, reNomsCle = '';
function lierNomsConnus(texte) {
  const fiches = fichesToutes();
  const cle = fiches.map(f => f.id + f.nom + f.alias).join('|');
  if (cle !== reNomsCle) {
    reNomsCle = cle;
    const noms = [];
    for (const f of fiches) for (const n of [f.nom, ...String(f.alias || '').split(',')]) {
      const x = n.trim();
      if (x.length >= 4 && /^[A-ZÀ-ÖØ-Þ]/.test(x)) noms.push([x, f.id]);
    }
    noms.sort((a, b) => b[0].length - a[0].length);
    reNoms = noms.length ? { re: new RegExp('(^|[^\\p{L}\\p{N}\\u0002])(' + noms.map(([x]) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + ')(?![\\p{L}\\p{N}])', 'gu'), ids: new Map(noms.map(([x, id]) => [x, id])) } : null;
  }
  if (!reNoms) return texte;
  return texte.split('\n').map(ligne => {
    const deja = new Set();
    /* on ne touche pas aux liens déjà posés (entre \u0001 et \u0003) ni aux adresses web */
    return ligne.split(/(\u0001[^\u0003]*\u0003|https?:\/\/\S+)/).map(seg => {
      if (/^\u0001|^https?:/.test(seg)) { const m = seg.match(/^\u0001([^\u0002]*)/); if (m) deja.add(m[1]); return seg; }
      return seg.replace(reNoms.re, (m, avant, nom) => {
        const id = reNoms.ids.get(nom);
        if (!id || deja.has(id)) return m;
        deja.add(id);
        return `${avant}\u0001${id}\u0002${nom}\u0003`;
      });
    }).join('');
  }).join('\n');
}
const liensMentions = h => h.replace(/\u0001([^\u0002]*)\u0002([^\u0003]*)\u0003/g, (m, id, nom) => id ? `<a class="mention" href="#/fiche/${id}">${nom}</a>` : nom);
function formaterRecit(texte) {
  const lignes = marquerMentions(texte).replace(/\r/g, '').split('\n');
  const out = [];
  let para = [], liste = [];
  const finPara = () => { if (para.length) { out.push(`<p>${para.map(formaterLigne).join('<br>')}</p>`); para = []; } };
  const finListe = () => { if (liste.length) { out.push(`<ul>${liste.map(l => `<li>${formaterLigne(l)}</li>`).join('')}</ul>`); liste = []; } };
  for (const brut of lignes) {
    const l = brut.trimEnd();
    let m;
    if (!l.trim()) { finPara(); finListe(); continue; }
    if (/^-{3,}$/.test(l.trim())) { finPara(); finListe(); out.push('<div class="ornement" aria-hidden="true"><span></span></div>'); continue; }
    if ((m = l.match(/^#\s+(.*)$/))) { finPara(); finListe(); out.push(`<h2 class="recit-titre">${formaterLigne(m[1])}</h2>`); continue; }
    if ((m = l.match(/^##\s+(.*)$/))) { finPara(); finListe(); out.push(`<p class="recit-grand">${formaterLigne(m[1])}</p>`); continue; }
    if ((m = l.match(/^>\s?(.*)$/))) { finPara(); finListe(); out.push(`<blockquote>${formaterLigne(m[1])}</blockquote>`); continue; }
    if ((m = l.match(/^[-•]\s+(.*)$/))) { finPara(); liste.push(m[1]); continue; }
    finListe(); para.push(l);
  }
  finPara(); finListe();
  return out.join('');
}
/* Texte sans les marques de mise en forme (copie, extraits) */
const texteBrut = t => sansMentions(t)
  .replace(/\*\*(.+?)\*\*/g, '$1').replace(/\+\+(.+?)\+\+/g, '$1').replace(/==(.+?)==/g, '$1')
  .replace(/(^|\s)_(.+?)_(?=\s|$|[.,;:!?])/g, '$1$2').replace(/^#{1,2}\s+/gm, '').replace(/^>\s?/gm, '').replace(/^-{3,}$/gm, '');

const OUTILS_TEXTE = [
  ['gras', 'G', 'Gras'], ['italique', 'I', 'Italique'], ['souligne', 'S', 'Souligné'], ['valeur', '✦', 'Mettre en valeur (bronze)'],
  ['titre', 'Titre', 'Titre de partie'], ['grand', 'A+', 'Texte plus grand'], ['citation', '« »', 'Citation'],
  ['liste', '•', 'Liste à puces'], ['separateur', '◆', 'Séparateur'],
];
function barreOutils() {
  return `<div class="barre-texte" role="toolbar" aria-label="Mise en forme du récit">
    ${OUTILS_TEXTE.map(([f, l, t]) => `<button type="button" class="outil outil-${f}" data-action="fmt" data-fmt="${f}" title="${t}" aria-label="${t}">${l}</button>`).join('')}
  </div>`;
}
function appliquerFormat(zone, fmt) {
  const v = zone.value;
  let a = zone.selectionStart, b = zone.selectionEnd;
  const enLigne = { gras: ['**', '**'], italique: ['_', '_'], souligne: ['++', '++'], valeur: ['==', '=='] }[fmt];
  const prefixe = { titre: '# ', grand: '## ', citation: '> ', liste: '- ' }[fmt];
  let nouveau, debutSel, finSel;
  if (enLigne) {
    const sel = v.slice(a, b) || 'texte';
    nouveau = v.slice(0, a) + enLigne[0] + sel + enLigne[1] + v.slice(b);
    debutSel = a + enLigne[0].length; finSel = debutSel + sel.length;
  } else if (prefixe) {
    const d = v.lastIndexOf('\n', a - 1) + 1;
    const fin = v.indexOf('\n', b); const f = fin < 0 ? v.length : fin;
    const bloc = v.slice(d, f).split('\n').map(l => l.startsWith(prefixe) ? l.slice(prefixe.length) : prefixe + l.replace(/^(#{1,2}|>|-)\s?/, '')).join('\n');
    nouveau = v.slice(0, d) + bloc + v.slice(f);
    debutSel = d; finSel = d + bloc.length;
  } else {
    /* Le séparateur s'insère après la sélection, sans rien effacer */
    const fin = v.indexOf('\n', b); const pos = fin < 0 ? v.length : fin;
    const ins = '\n\n---\n\n';
    nouveau = v.slice(0, pos) + ins + v.slice(pos).replace(/^\n+/, '');
    debutSel = finSel = pos + ins.length;
  }
  zone.value = nouveau;
  zone.focus();
  zone.setSelectionRange(debutSel, finSel);
  zone.dispatchEvent(new Event('input', { bubbles: true }));
}

/* ===== Encyclopédie de campagne =====
   Fiches partagées (PNJ, lieux, quêtes…), publiées comme les récapitulatifs :
   lecture pour tous, écriture par l'administrateur. */
const TYPES_FICHE = {
  quete: 'Quêtes', pnj: 'PNJ', lieu: 'Lieux', faction: 'Factions et familles',
  objet: 'Objets', savoir: 'Histoire et savoir', pj: 'Personnages joueurs',
};
const TYPE_FICHE_UN = { quete: 'Quête', pnj: 'PNJ', lieu: 'Lieu', faction: 'Faction', objet: 'Objet', savoir: 'Savoir', pj: 'Personnage joueur' };
const STATUTS_FICHE = {
  quete: ['En cours', 'Terminée', 'Échouée', 'Abandonnée'],
  pnj: ['Vivant', 'Mort', 'Disparu', 'Inconnu'],
  pj: ['Dans le groupe', 'Absent', 'Mort'],
  faction: ['Alliée', 'Neutre', 'Hostile', 'Inconnue'],
  objet: ['Possédé', 'Perdu', 'Donné', 'Vendu'],
  lieu: ['Visité', 'Pas encore visité'],
  savoir: [],
};
const champsFiche = f => JSON.stringify([...['nom', 'type', 'role', 'lieu', 'statut', 'alias', 'description'].map(k => String(f[k] ?? '')), JSON.stringify(f.extra || {})]);
const fichesPubliees = () => db.fichesPubliees || [];
function fichesToutes() {
  const sup = new Set(db.fichesSupprimees || []);
  const m = new Map(fichesPubliees().map(f => [f.id, f]));
  for (const f of db.fiches || []) m.set(f.id, f);
  return [...m.values()].filter(f => !sup.has(f.id)).sort((a, b) => String(a.nom).localeCompare(String(b.nom), 'fr'));
}
const findFiche = id => fichesToutes().find(f => f.id === id);
function statutPublication(f) {
  const pub = fichesPubliees().find(x => x.id === f.id);
  const loc = (db.fiches || []).find(x => x.id === f.id);
  if (!pub) return 'brouillon';
  if (loc && champsFiche(loc) !== champsFiche(pub)) return 'modifie';
  return 'publie';
}
const fichesAPublier = () => fichesToutes().filter(f => statutPublication(f) !== 'publie').length + (db.fichesSupprimees || []).length;

async function chargerFiches() {
  try {
    let pub;
    if (enLigne()) {
      let ch;
      try { ch = await lignesChangees('fiches', 'fiches', 'id,nom,type,role,lieu,statut,alias,description,extra,maj', id => fichesPubliees().some(f => f.id === id)); }
      catch (e) { ch = await lignesChangees('fiches', 'fiches', 'id,nom,type,role,lieu,statut,alias,description,maj', id => fichesPubliees().some(f => f.id === id)); }
      const parId = new Map(fichesPubliees().map(f => [f.id, f]));
      for (const f of ch.lignes) parId.set(f.id, { ...f, role: f.role || '', lieu: f.lieu || '', statut: f.statut || '', alias: f.alias || '', description: f.description || '', extra: f.extra || {} });
      pub = [...parId.values()].filter(f => ch.tous.has(f.id));
      ch.valider();
    } else {
      const res = await fetch('fiches.json', { cache: 'no-store' });
      pub = res.ok ? ((await res.json()).fiches || []) : [];
    }
    db.fichesPubliees = pub;
    db.fiches = (db.fiches || []).filter(l => { const p = pub.find(x => x.id === l.id); return !p || champsFiche(p) !== champsFiche(l); });
    db.fichesSupprimees = (db.fichesSupprimees || []).filter(id => pub.some(x => x.id === id));
    saveNow();
  } catch (e) {
    console.warn('Encyclopédie indisponible (base pas encore en v4 ?)', e);
  }
}
function ficheLocale(id) {
  db.fiches = db.fiches || [];
  let f = db.fiches.find(x => x.id === id);
  if (!f) {
    const pub = fichesPubliees().find(x => x.id === id);
    if (!pub) return null;
    f = { ...pub };
    db.fiches.push(f);
  }
  return f;
}

/* Nom ou alias → fiche */
function indexNoms() {
  const m = new Map();
  for (const f of fichesToutes()) {
    for (const n of [f.nom, ...String(f.alias || '').split(',')]) {
      const k = norm(n).trim();
      if (k && !m.has(k)) m.set(k, f);
    }
  }
  return m;
}
const nomsDe = f => [f.nom, ...String(f.alias || '').split(',')].map(n => n.trim()).filter(n => n.length > 2);

/* Passages des récits où la fiche apparaît (par son nom ou un alias) */
const reMot = n => new RegExp('(^|[^a-z0-9])' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9])');
function apparitions(f) {
  const noms = nomsDe(f).map(n => reMot(norm(n)));
  const res = [];
  for (const r of [...recapsTous()].sort((a, b) => num(a.numero) - num(b.numero))) {
    const paras = sansMentions(r.texte).split(/\n+/).map(p => p.replace(/^(#{1,2}|>|-)\s+/, '').trim()).filter(Boolean);
    const trouves = paras.filter(p => { const n = norm(p); return noms.some(re => re.test(n)); });
    if (trouves.length) res.push({ r, extraits: trouves.slice(0, 3), total: trouves.length });
  }
  return res;
}
function surligner(texte, termes) {
  let h = esc(texte.replace(/\*\*|\+\+|==/g, ''));
  for (const t of termes) {
    if (!t) continue;
    const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    h = h.replace(re, '<mark>$1</mark>');
  }
  return h;
}

function lienFiche(nom) {
  const f = indexNoms().get(norm(nom).trim());
  return f ? `<a class="mention" href="#/fiche/${f.id}">${esc(nom)}</a>` : esc(nom);
}
function badgeStatut(f) {
  if (!f.statut) return '';
  const cls = /mort|échou|hostile|perdu|abandon/i.test(f.statut) ? 'ko' : /termin|alli|possédé|dans le groupe|vivant|visité$/i.test(f.statut) ? 'ok' : '';
  return `<span class="statut-fiche ${cls}">${esc(f.statut)}</span>`;
}

/* Quête principale : mise en avant partout */
const porteeQuete = f => f.type !== 'quete' ? '' : (f.extra && f.extra.portee) || (/principale/i.test(f.role || '') ? 'principale' : /personnelle/i.test(f.role || '') ? 'personnelle' : 'secondaire');
const estQuetePrincipale = f => porteeQuete(f) === 'principale';
const persoDeQuete = f => (f.extra && f.extra.persoId && findPerso(f.extra.persoId)) || null;
const nomPersoQuete = f => persoDeQuete(f)?.nom || (f.extra && f.extra.persoNom) || '';
function carteFiche(f) {
  const st = statutPublication(f);
  const princ = estQuetePrincipale(f), perso = porteeQuete(f) === 'personnelle';
  return `<a class="fiche-carte type-${f.type} ${princ ? 'quete-principale' : ''} ${perso ? 'quete-perso' : ''}" href="#/fiche/${f.id}">
    ${princ ? '<span class="badge-principale">★ Quête principale</span>' : ''}${perso ? `<span class="badge-perso">Quête personnelle${nomPersoQuete(f) ? ' · ' + esc(nomPersoQuete(f)) : ''}</span>` : ''}
    <span class="fiche-carte-tete"><b>${esc(f.nom)}</b>${badgeStatut(f)}</span>
    ${f.role && !princ || f.lieu ? `<small>${esc([princ ? '' : f.role, f.lieu].filter(Boolean).join(', '))}</small>` : ''}
    ${st !== 'publie' && peutEcrireFiches() ? `<span class="statut statut-${st}">${STATUTS_RECAP[st]}</span>` : ''}
  </a>`;
}

function pageEncyclo(mode, q) {
  if (mode === 'recherche' && q != null) state.eq = decodeURIComponent(q);
  return `${sousNav('encyclo')}
  <div class="pagehead">
    <div><h1>Encyclopédie</h1><p class="sub">Tout ce que la compagnie sait du monde</p></div>
    <div class="btns">
      ${peutEcrireFiches() ? '<button class="btn" data-action="new-fiche">Nouvelle fiche</button>' : ''}
      <button class="btn ghost" data-action="export-ia">Exporter pour une IA</button>
    </div>
  </div>
  ${peutEcrireFiches() ? bandeauPublication() : ''}
  <input type="search" id="eq" value="${esc(state.eq)}" placeholder="Chercher un nom, un lieu, un mot dans les fiches et les récits…" aria-label="Chercher dans l'encyclopédie et les récits">
  <div id="eres">${resultatsEncyclo()}</div>`;
}

function resultatsEncyclo() {
  const fiches = fichesToutes();
  const q = norm(state.eq).trim();
  if (q) {
    const f = fiches.filter(x => [x.nom, x.alias, x.role, x.lieu, x.description].some(v => norm(v).includes(q)));
    const passages = [];
    for (const r of [...recapsTous()].sort((a, b) => num(a.numero) - num(b.numero))) {
      for (const p of sansMentions(r.texte).split(/\n+/).map(x => x.replace(/^(#{1,2}|>|-)\s+/, '').trim()).filter(Boolean)) {
        if (norm(p).includes(q)) passages.push({ r, p });
      }
    }
    const termes = [state.eq.trim()];
    return `<p class="count">${f.length} fiche${f.length > 1 ? 's' : ''} et ${passages.length} passage${passages.length > 1 ? 's' : ''} pour « ${esc(state.eq)} » <button class="lien" data-action="eq-effacer">Effacer</button></p>
      ${f.length ? `<div class="fiches">${f.map(carteFiche).join('')}</div>` : ''}
      ${passages.length ? `<h4>Dans les récits</h4><ul class="passages">${passages.slice(0, 60).map(({ r, p }) => `<li><a href="#/recap/${r.id}">Session ${esc(r.numero)}${r.titre ? ' : ' + esc(r.titre) : ''}</a><p>${surligner(p, termes)}</p></li>`).join('')}</ul>` : ''}
      ${!f.length && !passages.length ? '<p class="empty">Rien trouvé. Essaie un autre mot, ou une partie du nom.</p>' : ''}`;
  }
  const filtre = state.ftype || '';
  const chips = `<div class="chips">${[['', 'Tout'], ...Object.entries(TYPES_FICHE)].map(([k, l]) =>
    `<button class="chip ${filtre === k ? 'on' : ''}" data-action="ftype" data-type="${k}">${l} <small>${k ? fiches.filter(f => f.type === k).length : fiches.length}</small></button>`).join('')}</div>`;
  const groupes = Object.entries(TYPES_FICHE).filter(([k]) => !filtre || filtre === k).map(([k, l]) => {
    const liste = fiches.filter(f => f.type === k).sort((x, y) => estQuetePrincipale(y) - estQuetePrincipale(x));
    if (!liste.length) return '';
    if (k === 'quete') {
      const princ = liste.filter(estQuetePrincipale), pers = liste.filter(f => porteeQuete(f) === 'personnelle'), autres = liste.filter(f => porteeQuete(f) === 'secondaire');
      const parPerso = {};
      for (const f of pers) (parPerso[nomPersoQuete(f) || 'Sans personnage'] = parPerso[nomPersoQuete(f) || 'Sans personnage'] || []).push(f);
      return `${princ.length ? `<section class="card bloc-principal"><h3>★ ${princ.length > 1 ? 'Quêtes principales' : 'Quête principale'}</h3><div class="fiches">${princ.map(carteFiche).join('')}</div></section>` : ''}
        ${pers.length ? `<section class="card"><h3>Quêtes personnelles</h3>${Object.entries(parPerso).map(([n, l2]) => `<h4 class="quetes-de">${esc(n)}</h4><div class="fiches">${l2.map(carteFiche).join('')}</div>`).join('')}</section>` : ''}
        ${autres.length ? `<section class="card"><h3>Quêtes secondaires</h3><div class="fiches">${autres.map(carteFiche).join('')}</div></section>` : ''}`;
    }
    return `<section class="card"><h3>${l}</h3><div class="fiches">${liste.map(carteFiche).join('')}</div></section>`;
  }).join('');
  return chips + (groupes || `<section class="card intro"><p class="empty">L'encyclopédie est vide.${peutEcrireFiches() ? ' Crée une première fiche, ou importe un fichier d\'encyclopédie depuis l\'onglet Partage.' : ''}</p></section>`);
}

function pageFiche(id) {
  const f = findFiche(id);
  if (!f) return `${sousNav('encyclo')}<p>Fiche introuvable. <a href="#/encyclo">Retour à l'encyclopédie</a></p>`;
  if (state.editFiche === id && peutEcrireFiches()) return formFiche(f);
  const st = statutPublication(f);
  const perso = f.type === 'pj' && db.personnages.find(p => norm(p.nom) === norm(f.nom));
  const app = apparitions(f);
  const termes = nomsDe(f);
  return `${sousNav('encyclo')}
  <p><a href="#/encyclo">← Encyclopédie</a></p>
  <article class="fiche type-${f.type}">
    <p class="recit-num">${esc(TYPE_FICHE_UN[f.type] || 'Fiche')}</p>
    <h1>${esc(f.nom)}</h1>
    ${estQuetePrincipale(f) ? '<p class="badge-principale grand">★ Quête principale</p>' : porteeQuete(f) === 'personnelle' ? `<p class="badge-perso grand">Quête personnelle${nomPersoQuete(f) ? ` de ${persoDeQuete(f) ? `<a href="#/perso/${persoDeQuete(f).id}/fiche">${esc(nomPersoQuete(f))}</a>` : esc(nomPersoQuete(f))}` : ''}</p>${f.role && !/personnelle/i.test(f.role) ? `<p class="sub">${esc(f.role)}</p>` : ''}` : f.role ? `<p class="sub">${esc(f.role)}</p>` : ''}
    <div class="fiche-meta">
      ${f.lieu ? `<span>Lieu : ${lienFiche(f.lieu)}</span>` : ''}${badgeStatut(f)}
      ${f.alias ? `<span>Aussi appelé : ${esc(f.alias)}</span>` : ''}
    </div>
    <div class="ornement" aria-hidden="true"><span></span></div>
    <div class="recit-texte">${formaterRecit(f.description) || '<p class="empty">Pas encore de description.</p>'}</div>
    ${perso ? `<p><a class="btn ghost" href="#/perso/${perso.id}/fiche">Voir la fiche de personnage</a></p>` : ''}
  </article>
  <section class="card"><h3>Apparaît dans</h3>
    ${app.length ? `<ul class="passages">${app.map(({ r, extraits, total }) => `<li><a href="#/recap/${r.id}">Session ${esc(r.numero)}${r.titre ? ' : ' + esc(r.titre) : ''}</a>${total > 1 ? ` <small>${total} passages</small>` : ''}
      ${extraits.map(p => `<p>${surligner(p, termes)}</p>`).join('')}</li>`).join('')}</ul>` : '<p class="empty">Aucun récit ne la mentionne encore.</p>'}
  </section>
  ${peutEcrireFiches() ? `<div class="btns">
    <button class="btn" data-action="fiche-edit" data-id="${f.id}">Modifier</button>
    ${st !== 'publie' ? `<span class="statut statut-${st}">${STATUTS_RECAP[st]}</span>` : ''}
  </div>${st !== 'publie' ? bandeauPublication() : ''}` : ''}`;
}

function formFiche(f0) {
  const f = ficheLocale(f0.id);
  state.ctx = f;
  state.editFicheObj = f;
  const lieux = fichesToutes().filter(x => x.type === 'lieu').map(x => x.nom);
  const statuts = STATUTS_FICHE[f.type] || [];
  return `${sousNav('encyclo')}
  <p><a href="#/fiche/${f.id}">← Retour à la fiche</a></p>
  <h1>Modifier la fiche</h1>
  <section class="card" style="margin-top:1rem">
    <div class="grid">
      ${fi(f, 'nom', 'Nom', { span: true })}
      ${sel(f, 'type', 'Type', Object.entries(TYPE_FICHE_UN))}
      ${statuts.length ? sel(f, 'statut', 'Statut', statuts) : fi(f, 'statut', 'Statut')}
      ${f.type === 'quete' ? `<label class="f"><span>Type de quête</span><select data-bind="extra.portee" data-rerender>${[['principale', '★ Quête principale'], ['secondaire', 'Quête secondaire'], ['personnelle', 'Quête personnelle']].map(([v, l]) => `<option value="${v}" ${porteeQuete(f) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${porteeQuete(f) === 'personnelle' ? `<label class="f"><span>Quête de</span><select data-bind="extra.persoId" data-rerender><option value="">— Choisir un personnage —</option>${db.personnages.filter(x => estMembre(x) && (!enLigne() || x.publie || x.pnjMJ)).map(x => `<option value="${x.id}" ${f.extra?.persoId === x.id ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select></label>` : ''}` : ''}
      ${fi(f, 'role', 'Rôle ou résumé en quelques mots', { span: true, ph: 'Ex. : Aubergiste de Wellon' })}
      <label class="f span2"><span>Lieu</span><input type="text" list="liste-lieux" data-bind="lieu" value="${esc(f.lieu)}" placeholder="Ex. : Wellon"></label>
      <datalist id="liste-lieux">${lieux.map(l => `<option value="${esc(l)}">`).join('')}</datalist>
      ${fi(f, 'alias', 'Autres noms ou orthographes (séparés par des virgules)', { span: true, ph: 'Ex. : Phyra, l\'elfe noire' })}
    </div>
    <label class="f"><span>Description</span></label>
    ${barreOutils()}
    <textarea data-bind="description" id="zone-recit" rows="10" aria-label="Description">${esc(f.description)}</textarea>
    <details class="apercu" open><summary>Aperçu</summary><div class="recit-texte" id="apercu-recit">${formaterRecit(f.description) || '<p class="empty">La description apparaîtra ici.</p>'}</div></details>
    <p class="hint aide">Écris <b>@[Nom]</b> pour créer un lien vers une autre fiche (ex. @[Wellon]). Les autres noms servent à retrouver la fiche dans les récits, même avec une autre orthographe.</p>
    <div class="btns">
      ${enLigne() ? '<button class="btn" data-action="fiche-publier">Enregistrer et publier</button><button class="btn ghost" data-action="fiche-fin">Enregistrer sans publier</button>' : '<button class="btn" data-action="fiche-fin">Terminé</button>'}
      <button class="btn danger" data-action="del-fiche" data-id="${f.id}">Supprimer</button>
    </div>
  </section>`;
}

/* Un seul fichier texte lisible : fiches puis récits, pour une IA ou pour archiver */
function exportIA() {
  const L = [`# ${document.title}`, '', `Export du ${new Date().toLocaleDateString('fr-FR')}. Ce document contient l'encyclopédie de la campagne (fiches de référence), puis les récits des sessions dans l'ordre.`, ''];
  for (const [k, l] of Object.entries(TYPES_FICHE)) {
    const liste = fichesToutes().filter(f => f.type === k);
    if (!liste.length) continue;
    L.push(`## ${l}`, '');
    for (const f of liste) {
      L.push(`### ${f.nom}`);
      const meta = [f.role, f.lieu && `Lieu : ${f.lieu}`, f.statut && `Statut : ${f.statut}`, f.alias && `Aussi appelé : ${f.alias}`].filter(Boolean);
      if (meta.length) L.push(meta.join(' | '));
      if (f.description) L.push('', texteBrut(f.description).trim());
      L.push('');
    }
  }
  L.push('## Récits des sessions', '');
  for (const r of [...recapsTous()].sort((a, b) => num(a.numero) - num(b.numero))) {
    L.push(`### Session ${r.numero}${r.titre ? ' : ' + r.titre : ''}`);
    if (r.auteur || r.date) L.push([r.auteur && `Raconté par ${r.auteur}`, r.date && dateFr(r.date)].filter(Boolean).join(', '));
    L.push('', texteBrut(r.texte).trim(), '');
  }
  const blob = new Blob([L.join('\n')], { type: 'text/markdown' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'encyclopedie-campagne.md';
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Fichier exporté : encyclopedie-campagne.md');
}

/* ===== Notes personnelles ===== */
function nouvelleSession() {
  const numero = sessionsTriees().reduce((m, s) => Math.max(m, num(s.numero)), 0) + 1;
  return { id: uid(), persoId: carnetActif() || undefined, numero, date: new Date().toISOString().slice(0, 10), titre: '', notes: [], maj: Date.now() };
}

function noteHtml(n, i, s, editable) {
  const suivi = TYPES_SUIVIS.includes(n.type);
  if (editable && state.editNote === n.id) {
    return `<li class="note note-${n.type} edition">
      <textarea data-bind="notes.${i}.texte" rows="3" aria-label="Texte de la note">${esc(n.texte)}</textarea>
      <div class="note-actions">
        <select data-bind="notes.${i}.type" data-rerender aria-label="Type de note">${Object.entries(TYPES_NOTES).map(([k, l]) => `<option value="${k}" ${n.type === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <button class="btn" data-action="note-fin">Terminé</button>
        <button class="btn danger" data-action="note-suppr" data-idx="${i}">Supprimer</button>
      </div>
    </li>`;
  }
  return `<li class="note note-${n.type} ${n.resolu ? 'resolue' : ''}">
    <div class="note-tete">
      <span class="type-note">${TYPES_NOTES[n.type] || 'Note'}</span>
      ${s ? `<a class="note-session" href="#/session/${s.id}">${esc(titreSession(s))}</a>` : `<span class="note-heure">${heure(n.t)}</span>`}
      ${suivi ? `<label class="check-resolu"><input type="checkbox" data-action="note-resolu" data-s="${(s || state.ctx).id}" data-n="${n.id}" ${n.resolu ? 'checked' : ''}> Résolu</label>` : ''}
      ${editable ? `<button class="icon" data-action="note-edit" data-id="${n.id}" aria-label="Modifier la note">✎</button>` : ''}
    </div>
    <p>${avecMentions(n.texte)}</p>
  </li>`;
}

function pageNotes(mode, q) {
  if (mode === 'recherche' && q != null) state.jq = decodeURIComponent(q);
  const carnet = carnetActif();
  if (enLigne() && !carnet) {
    return `${sousNav('notes')}
    <h1>Mes notes</h1>
    <section class="card intro" style="margin-top:1rem"><h3>D'abord, ton personnage</h3>
      <p>Les notes sont rattachées à ton personnage et protégées par son code personnel : personne d'autre ne peut les lire.</p>
      <p>Crée ton personnage, ou ouvre sa fiche et touche « C'est ton personnage ? » pour saisir ton code sur cet appareil.</p>
      <a class="btn" href="#/persos">Aller aux personnages</a>
    </section>`;
  }
  if (carnet) {
    /* Notes d'avant la mise en ligne : rangées dans le carnet du personnage */
    const orphelines = (db.sessions || []).filter(s => !s.persoId);
    if (orphelines.length) { orphelines.forEach(s => { s.persoId = carnet; }); saveNow(); notesModifiees(carnet); }
  }
  const sessions = sessionsTriees();
  const mine = mesPersos();
  return `${sousNav('notes')}
  <div class="pagehead">
    <div><h1>Mes notes</h1><p class="sub">${enLigne() ? `Carnet de ${esc(findPerso(carnet)?.nom || '')}, visible de toi seul` : 'Personnelles : elles restent sur cet appareil'}</p></div>
    <div class="btns">
      <button class="btn" data-action="new-session">Nouvelle session</button>
      ${sessions[0] ? `<a class="btn ghost" href="#/session/${sessions[0].id}">Reprendre la session ${esc(sessions[0].numero)}</a>` : ''}
    </div>
  </div>
  ${mine.length > 1 && enLigne() ? `<label class="f" style="margin-bottom:.8rem"><span>Carnet de notes</span><select id="carnet">${mine.map(x => `<option value="${x.id}" ${x.id === carnet ? 'selected' : ''}>${esc(x.nom)}</option>`).join('')}</select></label>` : ''}
  <input type="search" id="jq" value="${esc(state.jq)}" placeholder="Chercher dans toutes mes notes : un nom, un lieu, un mot…" aria-label="Chercher dans mes notes">
  <div id="jres">${resultatsJournal()}</div>`;
}

function resultatsJournal() {
  const sessions = sessionsTriees();
  const q = norm(state.jq).trim();
  if (q) {
    const res = [];
    for (const s of sessions) (s.notes || []).forEach(n => { if (norm(n.texte).includes(q)) res.push(noteHtml(n, 0, s, false)); });
    return `<p class="count">${res.length} résultat${res.length > 1 ? 's' : ''} pour « ${esc(state.jq)} » <button class="lien" data-action="jq-effacer">Effacer</button></p>
      ${res.length ? `<ul class="notes">${res.join('')}</ul>` : '<p class="empty">Rien trouvé. Essaie un autre mot.</p>'}`;
  }
  const fils = [];
  for (const s of sessions) for (const n of s.notes || []) if (TYPES_SUIVIS.includes(n.type) && !n.resolu) fils.push(noteHtml(n, 0, s, false));
  const index = indexMentions();
  const cartes = sessions.map(s => {
    const nb = (s.notes || []).length;
    return `<a class="session-carte" href="#/session/${s.id}">
      <span class="session-num">${esc(s.numero)}</span>
      <span class="session-txt"><b>${esc(s.titre || 'Sans titre')}</b>
        <small>${esc(dateFr(s.date))}${nb ? `, ${nb} note${nb > 1 ? 's' : ''}` : ''}</small></span></a>`;
  }).join('');
  return `
  ${fils.length ? `<section class="card"><h3>Fils rouges</h3>
    <p class="hint aide">Questions et quêtes encore ouvertes, toutes sessions confondues. Coche « Résolu » quand c'est réglé.</p>
    <ul class="notes">${fils.join('')}</ul></section>` : ''}
  <section class="card"><h3>Sessions</h3>
    ${cartes ? `<div class="sessions">${cartes}</div>` : '<p class="empty">Aucune session. Crée la première au début de ta prochaine partie.</p>'}
  </section>
  ${index.length ? `<section class="card"><h3>Index</h3>
    <p class="hint aide">Tout ce que tu as mentionné avec @ dans tes notes. Touche un nom pour retrouver chaque passage.</p>
    <div class="chips">${index.map(m => `<a class="chip" href="#/notes/recherche/${encodeURIComponent(m.nom)}">${esc(m.nom)} <small>${m.n}</small></a>`).join('')}</div>
  </section>` : ''}`;
}

function pageSession(id) {
  const s0 = findSession(id);
  const s = s0 && (!enLigne() || mesPersos().some(p => p.id === s0.persoId)) ? s0 : null;
  if (!s) return `${sousNav('notes')}<p>Session introuvable. <a href="#/notes">Retour à mes notes</a></p>`;
  state.ctx = s;
  const notes = (s.notes || []).map((n, i) => ({ n, i })).reverse();
  const type = state.typeNote || 'note';
  const recap = recapsTous().find(r => String(r.numero) === String(s.numero));
  return `${sousNav('notes')}
  <p><a href="#/notes">← Mes notes</a></p>
  <div class="pagehead"><div><h1>${esc(titreSession(s))}</h1><p class="sub">${esc(dateFr(s.date))}, notes personnelles</p></div>
    <button class="btn danger" data-action="del-session">Supprimer la session</button></div>
  <section class="card">
    <div class="grid">
      ${fi(s, 'numero', 'Numéro', { type: 'number', recalc: true })}
      ${fi(s, 'date', 'Date', { type: 'date', recalc: true })}
      ${fi(s, 'titre', 'Titre', { ph: 'Ex. : Le tombeau des anciens', recalc: true, span: true })}
    </div>
  </section>

  <section class="card saisie"><h3>Prise de notes</h3>
    <div class="chips types" role="group" aria-label="Type de la prochaine note">
      ${Object.entries(TYPES_NOTES).map(([k, l]) => `<button class="chip note-${k} ${type === k ? 'on' : ''}" data-action="type-note" data-type="${k}" aria-pressed="${type === k}">${l}</button>`).join('')}
    </div>
    <textarea id="nouvelle-note" rows="2" placeholder="Ce qui vient de se passer… (Entrée pour enregistrer)" aria-label="Nouvelle note"></textarea>
    <div class="btns" style="margin-top:.5rem"><button class="btn" data-action="add-note">Ajouter la note</button></div>
    <p class="hint aide">Écris <b>@Nom</b> pour un PNJ, un lieu ou un objet (<b>@[Nom en plusieurs mots]</b> s'il y a des espaces) : il rejoint l'index de tes notes. Maj + Entrée pour aller à la ligne.</p>
    ${notes.length ? `<ul class="notes">${notes.map(({ n, i }) => noteHtml(n, i, null, true)).join('')}</ul>` : '<p class="empty">Pas encore de note pour cette session.</p>'}
  </section>

  <section class="card"><h3>Récapitulatif commun</h3>
    ${recap
      ? `<p>Le récapitulatif de la session ${esc(s.numero)} existe déjà${recap.auteur ? `, raconté par ${esc(recap.auteur)}` : ''}.</p>
         <a class="btn ghost" href="#/recap/${recap.id}">Lire le récapitulatif</a>`
      : estAdmin()
        ? `<p class="hint">Prépare le récapitulatif à partir de tes notes, classées par type. Seul le texte du récapitulatif sera partagé : tes notes restent privées.</p>
           <button class="btn ghost" data-action="new-recap" data-session="${s.id}">Préparer le récapitulatif depuis mes notes</button>`
        : '<p class="hint">Pas encore de récapitulatif pour cette session. Il apparaîtra dans l\'onglet Récapitulatifs dès qu\'il sera enregistré.</p>'}
  </section>`;
}

function brouillonRecap(s) {
  const notes = s.notes || [];
  const bloc = (titre, type) => {
    const l = notes.filter(n => n.type === type);
    return l.length ? [titre, ...l.map(n => `- ${sansMentions(n.texte).replace(/\n+/g, ' ')}${n.resolu ? ' (résolu)' : ''}`), ''] : [];
  };
  return [
    'La dernière fois…', '', '(Écris ici le récit à lire en début de session, puis supprime les listes ci-dessous.)', '',
    ...bloc('Quêtes', 'quete'), ...bloc('Indices', 'indice'), ...bloc('PNJ', 'pnj'), ...bloc('Lieux', 'lieu'),
    ...bloc('Butin', 'butin'), ...bloc('Questions en suspens', 'question'), ...bloc('Autres notes', 'note'),
  ].join('\n').trim();
}

function ajouterNote() {
  const s = state.ctx, champ = $('#nouvelle-note');
  if (!s || !champ) return;
  const texte = champ.value.trim();
  if (!texte) { champ.focus(); return; }
  s.notes = s.notes || [];
  s.notes.push({ id: uid(), t: Date.now(), type: state.typeNote || 'note', texte, resolu: false });
  s.maj = Date.now();
  state.typeNote = 'note';
  saveNow();
  notesModifiees(s.persoId);
  render();
  $('#nouvelle-note')?.focus();
}

/* Les récapitulatifs rédigés dans l'ancienne version deviennent des récapitulatifs communs non publiés */
function migrerSessions(liste) {
  db.recaps = db.recaps || [];
  for (const s of liste || []) {
    if (s.recap && String(s.recap).trim()) {
      db.recaps.push({ id: uid(), numero: s.numero, date: s.date, titre: s.titre || '', auteur: '', texte: s.recap, maj: s.maj || Date.now() });
    }
    delete s.recap;
  }
}

/* ---------- Droits et synchronisation en ligne ---------- */
/* Hors ligne (pas de config.js), tout reste local et tout est modifiable, comme avant. */
const estAdmin = () => !enLigne() || !!db.codeCampagne || !!db.codeMJ;
const codeAdmin = () => db.codeCampagne || db.codeMJ || '';
/* L'encyclopédie (quêtes, PNJ, lieux…) : l'administrateur et le MJ */
const peutEcrireFiches = () => estAdmin() || estMJ();
const codeFiches = () => db.codeCampagne || db.codeMJ || '';
/* Avec les informations complémentaires (base en v16) ; sinon, sans elles */
async function sauverFicheRPC(f) {
  const base = { p_code: codeFiches(), p_id: f.id, p_nom: f.nom || '', p_type: f.type || 'pnj', p_role: f.role || '', p_lieu: f.lieu || '', p_statut: f.statut || '', p_alias: f.alias || '', p_description: f.description || '' };
  try { await rpc('sauver_fiche', { ...base, p_extra: f.extra || {} }); }
  catch (e) { if (/p_extra|function|fonction|schema cache/i.test(e.message)) await rpc('sauver_fiche', base); else throw e; }
}
async function publierFiche(f) {
  if (!enLigne()) return;
  await sauverFicheRPC(f);
  await chargerFiches();
}
const estAMoi = p => !enLigne() || !!(db.cles || {})[p.id];
const peutModifier = p => !!p && (p.pnjMJ ? (estMJ() && !p._public) : (estAMoi(p) || (enLigne() && (!!db.codeCampagne || estMJ())) || (enLigne() && !p.publie)));
const codePour = p => p.pnjMJ ? (db.codeMJ || '') : ((db.cles || {})[p.id] || db.codeCampagne || db.codeMJ || '');
const mesPersos = () => db.personnages.filter(p => enLigne() ? !!(db.cles || {})[p.id] : true);

function statutSync(txt, persistant = false) {
  const s = $('#status');
  if (!s) return;
  s.textContent = txt;
  s.classList.add('on');
  clearTimeout(statutSync._t);
  if (!persistant) statutSync._t = setTimeout(() => s.classList.remove('on'), 2000);
}

/* Personnages : la version en ligne fait foi, sauf modification locale pas encore envoyée */
/* ===== Téléchargement économe : d'abord les dates de modification (quelques octets),
   puis seulement les lignes qui ont changé depuis la dernière fois ===== */
const msDe = t => (typeof t === 'number' ? t : Date.parse(t)) || 0;
const versions = cache => ((db.versions = db.versions || {})[cache] = db.versions[cache] || {});
async function lignesChangees(table, cache, champs, present = () => true) {
  const vers = await api(`${table}?select=id,maj`) || [];
  const connus = versions(cache);
  const ids = vers.filter(v => connus[v.id] !== msDe(v.maj) || !present(v.id)).map(v => v.id);
  const lignes = [];
  for (let i = 0; i < ids.length; i += 40) {
    const lot = ids.slice(i, i + 40).map(id => `"${String(id).replace(/"/g, '')}"`).join(',');
    lignes.push(...(await api(`${table}?select=${champs}&id=in.(${encodeURIComponent(lot)})`) || []));
  }
  return {
    tous: new Set(vers.map(v => v.id)),
    lignes,
    valider: () => { db.versions[cache] = Object.fromEntries(vers.map(v => [v.id, msDe(v.maj)])); },
  };
}

/* ===== Journal des modifications des joueurs (visible du MJ et de l'administrateur) =====
   Sur l'appareil d'un joueur, chaque envoi de fiche est comparé à la dernière version connue du serveur ;
   les différences sont envoyées au journal. Rien n'est noté depuis l'appareil du MJ. */
function resumeLog(p) {
  const e = etat(p);
  return {
    nom: p.nom || '', pv: pvActuels(p), pvMax: num(p.pvMax), niveau: e.niveau, classes: classesTxt(e),
    caracs: Object.fromEntries(R.CARACS.map(c => [c.k, (p.caracs || {})[c.k]?.val ?? ''])),
    argent: piecesTxt(p.argent),
    objets: Object.fromEntries((p.equipement || []).map(it => [it.id, `${it.nom || 'Objet'}|${num(it.qte) || 1}|${it.equipe === false ? 0 : 1}`])),
    sorts: (p.sorts || []).map(x => x.id),
    etats: (p.etats || []).filter(x => x.actif !== false).map(x => x.nom),
    comp: Object.fromEntries(Object.entries(p.comp || {}).filter(([, v]) => num(v.rangs)).map(([k, v]) => [k, num(v.rangs)])),
    dons: [...e.dons].sort(),
    baguette: p.baguette?.nom || '',
    langues: (p.langues || []).join(', '),
  };
}
function differencesLog(a, b) {
  if (!a || !b) return [];
  const l = [];
  const champ = (t, x, y) => { if (String(x) !== String(y)) l.push(`${t} : ${x === '' ? '—' : x} → ${y === '' ? '—' : y}`); };
  champ('Nom', a.nom, b.nom); champ('PV', a.pv, b.pv); champ('PV max', a.pvMax, b.pvMax); champ('Niveau', a.niveau, b.niveau);
  if (a.classes !== b.classes) l.push(`Classes : ${a.classes || '—'} → ${b.classes || '—'}`);
  for (const c of R.CARACS) champ(c.n, a.caracs[c.k], b.caracs[c.k]);
  champ('Bourse', a.argent, b.argent);
  const nomObj = v => v.split('|')[0], qte = v => Number(v.split('|')[1]), porte = v => v.split('|')[2];
  for (const [id, v] of Object.entries(b.objets)) {
    const w = a.objets[id];
    if (!w) l.push(`Objet ajouté : ${nomObj(v)}${qte(v) > 1 ? ' ×' + qte(v) : ''}`);
    else {
      if (nomObj(w) !== nomObj(v)) l.push(`Objet renommé : ${nomObj(w)} → ${nomObj(v)}`);
      if (qte(w) !== qte(v)) l.push(`${nomObj(v)} : quantité ${qte(w)} → ${qte(v)}`);
      if (porte(w) !== porte(v)) l.push(`${nomObj(v)} : ${porte(v) === '1' ? 'porté' : 'rangé'}`);
    }
  }
  for (const [id, w] of Object.entries(a.objets)) if (!b.objets[id]) l.push(`Objet retiré : ${nomObj(w)}${qte(w) > 1 ? ' ×' + qte(w) : ''}`);
  const nomSort = id => findSort(id)?.nom || id;
  for (const id of b.sorts) if (!a.sorts.includes(id)) l.push(`Sort ajouté : ${nomSort(id)}`);
  for (const id of a.sorts) if (!b.sorts.includes(id)) l.push(`Sort retiré : ${nomSort(id)}`);
  for (const n of b.etats) if (!a.etats.includes(n)) l.push(`État ajouté : ${n}`);
  for (const n of a.etats) if (!b.etats.includes(n)) l.push(`État retiré : ${n}`);
  const nomComp = k => (R.COMPETENCES.find(c => c.id === k) || {}).nom || k;
  for (const k of new Set([...Object.keys(a.comp), ...Object.keys(b.comp)])) if ((a.comp[k] || 0) !== (b.comp[k] || 0)) l.push(`${nomComp(k)} : ${a.comp[k] || 0} → ${b.comp[k] || 0} rang(s)`);
  for (const d of b.dons) if (!a.dons.includes(d)) l.push(`Don ajouté : ${R.DON[d]?.nom || d}`);
  for (const d of a.dons) if (!b.dons.includes(d)) l.push(`Don retiré : ${R.DON[d]?.nom || d}`);
  champ('Baguette', a.baguette, b.baguette); champ('Langues', a.langues, b.langues);
  return l.slice(0, 40);
}
/* Base de comparaison : la dernière version connue du serveur */
const baseLog = () => (db.baseLog = db.baseLog || {});
function memoriserBaseLog(p) { try { baseLog()[p.id] = resumeLog(p); } catch (e) { /* fiche incomplète */ } }
async function noterModifs(p) {
  if (estMJ() || !enLigne() || p.pnjMJ) return;
  const avant = baseLog()[p.id];
  const apres = resumeLog(p);
  const lignes = differencesLog(avant, apres);
  if (lignes.length) await rpc('journal_ajouter', { p_id: p.id, p_code: codePour(p), p_nom: p.nom || '', p_lignes: lignes }).catch(() => {});
}
async function chargerJournal() {
  const code = db.codeMJ || db.codeCampagne;
  if (!enLigne() || !code) return;
  try { state.journal = await rpc('journal_lire', { p_code: code, p_limite: 300 }) || []; state.journalErreur = ''; }
  catch (e) { state.journalErreur = e.message; }
}
/* Le personnage de cet appareil : le dernier ouvert parmi ceux dont on a le code */
function monPerso() {
  const mes = db.personnages.filter(x => !x._public && !x.pnjMJ && (!enLigne() || (db.cles || {})[x.id]));
  return mes.find(x => x.id === db.monPerso) || mes[0] || null;
}
const voitJournal = () => estMJ() || !!db.codeCampagne;
function pageJournalModifs() {
  if (!voitJournal()) return '<section class="card intro"><p class="empty">Réservé au MJ et à l\'administrateur.</p></section>';
  if (!state.journal && !state.journalErreur) { chargerJournal().then(render); return '<p class="hint">Chargement…</p>'; }
  const persos = [...new Set((state.journal || []).map(x => x.perso_nom))].sort();
  const l = (state.journal || []).filter(x => !state.journalPerso || x.perso_nom === state.journalPerso);
  const jour = d => new Date(d).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  let dernier = '';
  return `<div class="pagehead"><div><h1>Log</h1><p class="sub">Les modifications faites par les joueurs sur leurs fiches</p></div>
    <button class="btn ghost" data-action="journal-actualiser">↻ Actualiser</button></div>
    ${state.journalErreur ? `<p class="hint">Journal indisponible (${esc(state.journalErreur)}). La base est-elle en v12 ?</p>` : ''}
    ${persos.length > 1 ? `<div class="chips">${['', ...persos].map(n => `<button class="chip ${(state.journalPerso || '') === n ? 'on' : ''}" data-action="journal-filtre" data-n="${esc(n)}">${esc(n || 'Tous')}</button>`).join('')}</div>` : ''}
    <div class="journal-modifs">${l.map(x => {
      const j = jour(x.cree), tete = j !== dernier ? `<h3 class="journal-jour">${esc(j)}</h3>` : '';
      dernier = j;
      return `${tete}<article class="journal-entree">
        <header><b>${esc(x.perso_nom)}</b><small>${new Date(x.cree).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</small></header>
        <ul>${(x.lignes || []).map(t => `<li>${esc(t)}</li>`).join('')}</ul>
      </article>`;
    }).join('') || '<p class="empty">Aucune modification enregistrée pour l\'instant.</p>'}</div>
    <p class="hint aide">Seules les modifications faites par les joueurs depuis leur propre appareil sont notées. Les actions du MJ (PV, rations, objets donnés, jour suivant…) n'apparaissent pas ici.</p>`;
}

async function chargerPersos() {
  if (!enLigne()) return false;
  try {
    const ch = await lignesChangees('persos', 'persos', 'id,data,maj', id => !!findPerso(id));
    const enLigneIds = ch.tous;
    const recus = new Map(ch.lignes.map(l => [l.id, l]));
    const attente = new Set(db.enAttente || []);
    const res = [];
    for (const id of enLigneIds) {
      const l = recus.get(id);
      const local = findPerso(id);
      if (!l) { if (local) res.push(local); continue; }
      if (local && attente.has(l.id)) { res.push(local); continue; }
      /* Personnage du MJ : le MJ garde sa version complète, les autres reçoivent la version publique */
      if (l.data.pnjMJ && local && local.pnjMJ && !local._public && estMJ()) { res.push(local); continue; }
      const data = { ...l.data, id: l.id, publie: true, _public: !!l.data.pnjMJ };
      migrer(data);
      if (local) { for (const k of Object.keys(local)) delete local[k]; Object.assign(local, data); res.push(local); }
      else res.push(data);
      if (!data._public) memoriserBaseLog(data);
    }
    /* Gardés : les personnages jamais mis en ligne. Retirés : ceux supprimés en ligne par leur propriétaire. */
    for (const p of db.personnages) if (!enLigneIds.has(p.id) && (!p.publie || attente.has(p.id))) res.push(p);
    db.personnages = res;
    ch.valider();
    state.syncErreur = '';
    state.persosCharges = Date.now();
    saveNow();
    return true;
  } catch (e) {
    state.syncErreur = e.message;
    console.warn('Personnages en ligne indisponibles', e);
    return false;
  }
}

let envoiTimer;
function persoModifie(p) {
  if (!enLigne() || !p || !p.publie || !codePour(p)) return;
  db.enAttente = [...new Set([...(db.enAttente || []), p.id])];
  clearTimeout(envoiTimer);
  envoiTimer = setTimeout(envoyerPersos, 1500);
}
async function envoyerPersos() {
  if (!enLigne()) return;
  for (const id of [...(db.enAttente || [])]) {
    const p = findPerso(id);
    if (!p || !codePour(p)) { db.enAttente = db.enAttente.filter(x => x !== id); continue; }
    try {
      if (p.pnjMJ) {
        await rpc('sauver_perso', { p_id: id, p_code: codePour(p), p_data: projectionPublique(p) });
        await rpc('sauver_perso_mj', { p_code: codePour(p), p_id: id, p_data: { ...p, publie: true } });
      } else {
        /* Le MJ a pu changer les PV, les rations ou recharger la journée entre-temps : on reprend ses valeurs */
        const v = await api(`persos?id=eq.${encodeURIComponent(id)}&select=mjMaj:data->mjMaj`).catch(() => null);
        if (v && v[0] && num(v[0].mjMaj) > num(p.mjMaj)) {
          const srv = await api(`persos?id=eq.${encodeURIComponent(id)}&select=data`).catch(() => null);
          const d = srv && srv[0] && srv[0].data;
          if (d) { memoriserBaseLog({ ...d, id }); fusionMJ(p, d); }
        }
        const maj = await rpc('sauver_perso', { p_id: id, p_code: codePour(p), p_data: { ...p, publie: true } });
        if (maj) versions('persos')[id] = msDe(maj);
        await noterModifs(p);
        memoriserBaseLog(p);
      }
      db.enAttente = db.enAttente.filter(x => x !== id);
      state.syncErreur = '';
      statutSync('Synchronisé');
    } catch (e) {
      state.syncErreur = e.message;
      statutSync('Hors ligne : en attente d\'envoi', true);
      if (/code/i.test(e.message)) { delete db.cles[id]; db.enAttente = db.enAttente.filter(x => x !== id); alert(`« ${p.nom} » : ${e.message}.`); render(); }
      break;
    }
  }
  ecrireDb();
}

async function mettreEnLigne(p, code) {
  await rpc('sauver_perso', { p_id: p.id, p_code: code, p_data: { ...p, publie: true } });
  db.cles = db.cles || {};
  db.cles[p.id] = code;
  p.publie = true;
  saveNow();
}

/* Notes : une ligne par personnage, lisible uniquement avec son code personnel */
let notesTimer;
function notesModifiees(persoId) {
  if (!enLigne() || !persoId || !(db.cles || {})[persoId]) return;
  db.notesEnAttente = [...new Set([...(db.notesEnAttente || []), persoId])];
  clearTimeout(notesTimer);
  notesTimer = setTimeout(envoyerNotes, 1500);
}
async function envoyerNotes() {
  for (const id of [...(db.notesEnAttente || [])]) {
    const code = (db.cles || {})[id];
    if (!code) { db.notesEnAttente = db.notesEnAttente.filter(x => x !== id); continue; }
    try {
      await rpc('sauver_notes', { p_id: id, p_code: code, p_data: { sessions: (db.sessions || []).filter(s => s.persoId === id) } });
      db.notesEnAttente = db.notesEnAttente.filter(x => x !== id);
      statutSync('Notes synchronisées');
    } catch (e) {
      statutSync('Hors ligne : notes en attente d\'envoi', true);
      break;
    }
  }
  ecrireDb();
}
async function chargerNotes() {
  if (!enLigne()) return;
  const attente = new Set(db.notesEnAttente || []);
  for (const [id, code] of Object.entries(db.cles || {})) {
    if (attente.has(id) || !findPerso(id)) continue;
    try {
      const data = await rpc('lire_notes', { p_id: id, p_code: code }) || {};
      const distantes = data.sessions || [];
      const ids = new Set(distantes.map(s => s.id));
      const autres = (db.sessions || []).filter(s => s.persoId !== id);
      const locales = (db.sessions || []).filter(s => s.persoId === id);
      const fusion = distantes.map(d => {
        const l = locales.find(x => x.id === d.id);
        return l && (l.maj || 0) > (d.maj || 0) ? l : d;
      });
      /* Une session locale absente en ligne mais créée depuis la dernière synchro est gardée (et renvoyée) */
      const derniere = (db.notesSynchro || {})[id] || 0;
      const nouvelles = locales.filter(l => !ids.has(l.id) && (l.maj || 0) > derniere);
      db.sessions = [...autres, ...fusion, ...nouvelles];
      db.notesSynchro = { ...(db.notesSynchro || {}), [id]: Date.now() };
      if (nouvelles.length) notesModifiees(id);
    } catch (e) {
      console.warn('Notes indisponibles pour', id, e);
    }
  }
  state.notesChargees = Date.now();
  saveNow();
}

/* Encart affiché sur la fiche d'un personnage selon les droits */
function encartDroits(p) {
  if (!enLigne()) return '';
  if (!p.publie) {
    return `<section class="card bandeau"><h3>Sur cet appareil seulement</h3>
      <p>Ce personnage n'est pas encore en ligne : les autres joueurs ne le voient pas. Choisis un code personnel pour le mettre en ligne. Ce code protège ta fiche et tes notes, et permet de les retrouver sur un autre appareil.</p>
      <div class="grid">
        <label class="f"><span>Code personnel</span><input type="password" id="code-perso" autocomplete="new-password" placeholder="4 caractères minimum"></label>
        <label class="f"><span>Confirmation</span><input type="password" id="code-perso-2" autocomplete="new-password"></label>
      </div>
      <button class="btn" data-action="perso-en-ligne">Mettre en ligne</button>
    </section>`;
  }
  if (estAMoi(p)) return '';
  return `<details class="card revendiquer">
    <summary>Lecture seule${db.codeCampagne ? ' (modification permise par le code administrateur)' : ''}. C'est ton personnage ?</summary>
    <p class="hint">Saisis ton code personnel pour modifier la fiche et retrouver tes notes sur cet appareil.</p>
    <div class="row"><input type="password" id="code-revendiquer" autocomplete="current-password" placeholder="Code personnel" aria-label="Code personnel">
      <button class="btn" data-action="revendiquer">Valider</button></div>
  </details>`;
}

function pageNouveauPerso() {
  return `
  <p><a href="#/persos">← Personnages</a></p>
  <h1>Nouveau personnage</h1>
  <section class="card" style="margin-top:1rem">
    <p>Tout le monde pourra voir ta fiche, mais toi seul pourras la modifier grâce à ton code personnel. Il protège aussi tes notes de session. Garde-le bien : il sert à retrouver ton personnage sur un autre appareil.</p>
    <div class="grid">
      <label class="f span2"><span>Nom du personnage</span><input type="text" id="np-nom" autocomplete="off"></label>
      <label class="f"><span>Code personnel</span><input type="password" id="np-code" autocomplete="new-password" placeholder="4 caractères minimum"></label>
      <label class="f"><span>Confirmation du code</span><input type="password" id="np-code-2" autocomplete="new-password"></label>
    </div>
    <button class="btn" data-action="creer-perso">Créer le personnage</button>
  </section>
  <section class="card"><h3>Déjà un personnage ?</h3>
    <p class="hint">Sur un nouvel appareil, ouvre ta fiche dans la liste des personnages, puis « C'est ton personnage ? » pour saisir ton code.</p>
  </section>`;
}

/* ---------- Grimoire ---------- */
function filtrerSorts() {
  const f = state.filtres, q = norm(f.q);
  return db.sorts.filter(s =>
    (!q || norm(s.nom).includes(q) || norm(s.nomVO).includes(q) || norm(s.description).includes(q)) &&
    (!f.ecole || s.ecole === f.ecole) &&
    (!f.classe || (s.niveaux || []).some(n => n.classe === f.classe && (f.niveau === '' || n.niveau === Number(f.niveau)))) &&
    (f.classe || f.niveau === '' || (s.niveaux || []).some(n => n.niveau === Number(f.niveau))) &&
    (!f.usage || usagesSort(s).includes(f.usage))
  ).sort(byNom);
}
function resultatsSorts() {
  const res = filtrerSorts();
  const lis = res.map(s => `<li><a class="spell ${ecoleClass(s.ecole)}" href="#/sort/${s.id}">
      <span><span class="nom">${esc(s.nom)}</span>${s.source === 'Maison' ? '<span class="maison">maison</span>' : ''}<br>
      <span class="tag">${esc(s.ecole)}${s.sousEcole ? ' (' + esc(s.sousEcole) + ')' : ''}</span> ${tagsUsages(s)}</span>
      <span class="meta">${esc(niveauxTxt(s))}</span></a></li>`).join('');
  return `<p class="count">${res.length} sort${res.length > 1 ? 's' : ''}</p>
    ${lis ? `<ul class="spells">${lis}</ul>` : '<p class="empty">Aucun sort ne correspond à ces filtres.</p>'}`;
}
/* ===== Grimoire > Aptitudes : dons, aptitudes de classe et manœuvres de combat ===== */
const MANOEUVRES = [
  ['Actions du round', 'Action simple', "Une attaque, un sort, boire une potion, activer un objet, aider un allié. À chaque round : une action simple et une action de mouvement, ou une action complexe, plus des actions libres."],
  ['Attaque à outrance', 'Action complexe', "Toutes les attaques auxquelles le BBA donne droit (+6/+1, etc.). On ne peut alors faire qu'un pas de placement de 1,5 m. Le déluge de coups du moine est une attaque à outrance."],
  ['Charge', 'Action complexe', "Déplacement en ligne droite jusqu'à deux fois sa vitesse (au moins 3 m), puis une attaque au corps à corps : +2 au jet d'attaque, −2 à la CA jusqu'au prochain tour. Le chemin doit être dégagé."],
  ['Pas de placement', 'Gratuit', "Un déplacement de 1,5 m qui ne provoque pas d'attaque d'opportunité, si l'on ne se déplace pas autrement pendant le round."],
  ['Retraite', 'Action complexe', "Se déplacer jusqu'à deux fois sa vitesse : la case de départ ne provoque pas d'attaque d'opportunité de la part des ennemis qu'on voit."],
  ['Défense totale', 'Action simple', "On renonce à attaquer : +4 d'esquive à la CA jusqu'au prochain tour (+6 avec 5 rangs en Acrobaties)."],
  ['Combat sur la défensive', 'Pendant une attaque', "−4 aux jets d'attaque du round, +2 d'esquive à la CA (+3 avec 5 rangs en Acrobaties)."],
  ['Attaque d\'opportunité', 'Réaction', "Une attaque gratuite contre un ennemi adjacent qui quitte une case menacée, lance un sort, tire à distance ou fait certaines actions. Une seule par round (davantage avec Attaques réflexes)."],
  ['Prise en tenaille', 'Position', "Deux alliés de part et d'autre d'un ennemi : chacun gagne +2 au jet d'attaque. Le roublard y ajoute son attaque sournoise."],
  ['Bousculade', 'Pendant une charge ou une action simple', "Pousser un adversaire : tests de Force opposés (+4 par catégorie de taille d'écart, +2 en charge). En cas de réussite, il recule de 1,5 m, plus 1,5 m par tranche de 5 points d'écart. Provoque une attaque d'opportunité sans le don Science de la bousculade."],
  ['Croc-en-jambe', 'À la place d\'une attaque', "Attaque de contact au corps à corps, puis test de Force (ou Dex) opposé à la Force ou Dex de la cible : réussite, elle tombe à terre (−4 en attaque au corps à corps, +4 contre elle au corps à corps). Si on rate, la cible peut riposter. Science du croc-en-jambe évite l'attaque d'opportunité."],
  ['Désarmement', 'À la place d\'une attaque', "Jets d'attaque opposés (+4 avec une arme à deux mains, ±4 par taille d'écart). Réussite : l'arme de l'adversaire tombe (ou on la prend si on est à mains nues). Échec : il peut tenter de vous désarmer en retour."],
  ['Destruction d\'arme', 'À la place d\'une attaque', "Frapper l'arme ou le bouclier d'un adversaire : jets d'attaque opposés, puis dégâts à l'objet (moins sa solidité)."],
  ['Feinte', 'Action simple', "Test de Bluff opposé à Psychologie (ou au BBA + mod Sag) de la cible : si on réussit, elle perd son bonus de Dextérité contre votre prochaine attaque. Science de la feinte en fait une action de mouvement."],
  ['Lutte', 'À la place d\'une attaque', "1) attaque de contact pour la saisir ; 2) tests de lutte opposés (BBA + mod For + taille) ; en cas de réussite, on l'agrippe et on inflige les dégâts à mains nues. Pour se dégager : test de lutte ou d'Évasion. Science de la lutte évite l'attaque d'opportunité."],
  ['Renversement', 'Pendant un déplacement', "Passer au travers d'un adversaire : il peut s'écarter ou résister ; tests de Force opposés, le perdant tombe à terre."],
  ['Combat à deux armes', 'Attaque à outrance', "Une attaque supplémentaire avec l'arme secondaire : −6 / −10 sans don, −4 / −4 avec une arme secondaire légère et le don Combat à deux armes, −2 / −2 avec les deux."],
  ['Tir dans la mêlée', 'Attaque à distance', "−4 pour tirer sur une cible engagée au corps à corps avec un allié (annulé par Tir de précision)."],
  ['Retarder', 'Gratuit', "Jouer plus tard dans le round : votre initiative devient le moment où vous agissez."],
  ['Préparer une action', 'Action simple', "Annoncer une action et son déclencheur (« j'attaque le premier qui franchit la porte ») ; elle se déclenche avant l'action qui la provoque."],
  ['Coup de grâce', 'Action complexe', "Contre un adversaire sans défense : coup critique automatique, et il doit réussir un jet de Vigueur (DD 10 + dégâts) ou mourir. Provoque une attaque d'opportunité."],
  ['Se relever', 'Action de mouvement', "Se relever quand on est à terre provoque une attaque d'opportunité."],
];
function prerequisDonTexte(d) {
  const p = d.p || {}, l = [];
  const noms = { for: 'For', dex: 'Dex', con: 'Con', int: 'Int', sag: 'Sag', cha: 'Cha' };
  for (const [k, v] of Object.entries(p.car || {})) l.push(`${noms[k]} ${v}`);
  if (p.bba) l.push(`BBA +${p.bba}`);
  for (const id of p.dons || []) l.push(R.DON[id]?.nom || id);
  for (const [k, v] of Object.entries(p.classe || {})) l.push(`${R.CLASSES[k]?.nom || k} niveau ${v}`);
  for (const [k, v] of Object.entries(p.rang || {})) l.push(`${(R.COMPETENCES.find(c => c.id === k) || {}).nom || k} ${v} rang${v > 1 ? 's' : ''}`);
  if (p.lanceur) l.push(`niveau de lanceur ${p.lanceur}`);
  if (p.renvoi) l.push('pouvoir renvoyer ou intimider les morts-vivants');
  return l.join(', ');
}
function ongletsGrimoire(actif) {
  return `<nav class="tabs grimoire-onglets">
    <a href="#/sorts" class="${actif === 'sorts' ? 'active' : ''}">Sorts</a>
    <a href="#/aptitudes" class="${actif === 'aptitudes' ? 'active' : ''}">Aptitudes</a>
  </nav>`;
}
function pageAptitudes() {
  const o = state.aptOnglet || 'dons';
  const sous = [['dons', 'Dons'], ['classes', 'Aptitudes de classe'], ['manoeuvres', 'Manœuvres de combat']];
  let corps = '';
  if (o === 'dons') {
    const q = state.aptQ || '';
    const liste = (q ? rechercherDons(R.DONS, q) : R.DONS.slice().sort((a, b) => a.nom.localeCompare(b.nom, 'fr'))).filter(d => !state.aptType || d.type === state.aptType);
    corps = `<div class="filters">
        <input type="search" id="apt-q" value="${esc(q)}" placeholder="Nom, nom anglais ou effet…" aria-label="Chercher un don">
        <select id="apt-type" aria-label="Type de don"><option value="">Tous les types</option>${Object.entries(R.TYPES_DONS).map(([k, l]) => `<option value="${k}" ${state.aptType === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      <p class="hint">${liste.length} don${liste.length > 1 ? 's' : ''}. Les dons de combat peuvent être pris comme dons supplémentaires de guerrier.</p>
      <div class="cartes-aptitudes">${liste.map(d => `<article class="carte-aptitude">
        <header><b>${esc(d.nom)}</b><span class="tag-cat">${R.TYPES_DONS[d.type]}</span></header>
        ${d.vo ? `<small class="vo">${esc(d.vo)}</small>` : ''}
        ${prerequisDonTexte(d) ? `<p class="prerequis"><span>Prérequis :</span> ${esc(prerequisDonTexte(d))}</p>` : ''}
        <p>${esc(d.texte)}</p>
      </article>`).join('')}</div>`;
  } else if (o === 'classes') {
    const ids = Object.keys(R.CLASSES).filter(id => !R.CLASSES[id].perso || classesCommunes().some(d => 'pp-' + d.id === id));
    const id = ids.includes(state.aptClasse) ? state.aptClasse : 'moine';
    const cl = R.CLASSES[id];
    const comps = (cl.comp || []).map(c => (R.COMPETENCES.find(x => x.id === c) || {}).nom).filter(Boolean);
    corps = `<div class="filters"><select id="apt-classe" aria-label="Classe">
        <optgroup label="Classes de base">${ids.filter(i => !R.CLASSES[i].prestige).map(i => `<option value="${i}" ${i === id ? 'selected' : ''}>${esc(R.CLASSES[i].nom)}</option>`).join('')}</optgroup>
        <optgroup label="Classes de prestige">${ids.filter(i => R.CLASSES[i].prestige).map(i => `<option value="${i}" ${i === id ? 'selected' : ''}>${esc(R.CLASSES[i].nom)}</option>`).join('')}</optgroup>
      </select></div>
      <section class="card classe-resume">
        <h3>${esc(cl.nom)}</h3>
        <p>Dé de vie d${cl.dv} · BBA ${({ fort: 'bon', moyen: 'moyen', faible: 'faible' })[cl.bba]} · bons jets : ${['vig', 'ref', 'vol'].filter(x => cl.js[x]).map(x => ({ vig: 'Vigueur', ref: 'Réflexes', vol: 'Volonté' })[x]).join(', ') || 'aucun'} · ${cl.pc} + Int points de compétence par niveau${cl.prestige ? ` · ${cl.max} niveaux` : ''}</p>
        ${cl.maitrises ? `<p class="hint">Maîtrises : ${esc(cl.maitrises)}</p>` : ''}
        ${comps.length ? `<p class="hint">Compétences de classe : ${esc(comps.join(', '))}</p>` : ''}
        ${(cl.prerequis || []).length ? `<p class="hint">Prérequis : ${esc(cl.prerequis.map(x => x[0]).join(' · '))}</p>` : ''}
      </section>
      <div class="aptitudes-niveaux">${(cl.aptitudes || []).slice().sort((a, b) => a.niv - b.niv).map(a => `<article class="carte-aptitude">
        <header><span class="niv">Niv. ${a.niv}</span><b>${esc(a.nom)}</b></header>
        <p>${esc(a.texte)}</p>
      </article>`).join('') || '<p class="empty">Pas d\'aptitudes détaillées pour cette classe.</p>'}</div>`;
  } else {
    corps = `<p class="hint">Les actions et manœuvres que tout personnage peut tenter en combat, d'après le Manuel des Joueurs.</p>
      <div class="cartes-aptitudes">${MANOEUVRES.map(([n, a, t]) => `<article class="carte-aptitude">
        <header><b>${esc(n)}</b><span class="tag-cat">${esc(a)}</span></header><p>${esc(t)}</p></article>`).join('')}</div>`;
  }
  return `<div class="pagehead"><div><h1>Grimoire</h1><p class="sub">Dons, aptitudes de classe et manœuvres de combat</p></div></div>
    ${ongletsGrimoire('aptitudes')}
    <div class="chips sous-onglets">${sous.map(([k, l]) => `<button class="chip ${o === k ? 'on' : ''}" data-action="apt-onglet" data-o="${k}">${l}</button>`).join('')}</div>
    <div id="apt-corps">${corps}</div>`;
}

function pageSorts() {
  const f = state.filtres;
  const classes = [...new Set(db.sorts.flatMap(s => (s.niveaux || []).map(n => n.classe)))].sort();
  const opt = (v, l, cur) => `<option value="${esc(v)}" ${cur === v ? 'selected' : ''}>${esc(l)}</option>`;
  return `
  <div class="pagehead">
    <div><h1>Grimoire</h1><p class="sub">Tous les sorts connus de la campagne</p></div>
    <a class="btn" href="#/sort-edit/new">Ajouter un sort</a>
  </div>
  ${ongletsGrimoire('sorts')}
  <div class="filters">
    <input type="search" class="q" data-filtre="q" value="${esc(f.q)}" placeholder="Nom ou effet…" aria-label="Rechercher">
    <select data-filtre="ecole" aria-label="École">${opt('', 'Toutes les écoles', f.ecole)}${ECOLES.map(e => opt(e, e, f.ecole)).join('')}</select>
    <select data-filtre="classe" aria-label="Classe">${opt('', 'Toutes les classes', f.classe)}${classes.map(c => opt(c, CLASSES_ABR[c] || c, f.classe)).join('')}</select>
    <select data-filtre="niveau" aria-label="Niveau">${opt('', 'Tous niveaux', f.niveau)}${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => opt(String(n), 'Niveau ' + n, f.niveau)).join('')}</select>
    <select data-filtre="usage" aria-label="Usage">${opt('', 'Tous les usages', f.usage)}${Object.entries(USAGES_SORT).map(([k, l]) => opt(k, l, f.usage)).join('')}</select>
  </div>
  <div id="sortres">${resultatsSorts()}</div>`;
}

function pageSort(id) {
  const s = findSort(id);
  if (!s) return `<p>Sort introuvable. <a href="#/sorts">Retour au grimoire</a></p>`;
  const ecole = s.ecole + (s.sousEcole ? ` (${s.sousEcole})` : '') + (s.registre ? ` [${s.registre}]` : '');
  const row = (l, v) => v ? `<dt>${l}</dt><dd>${esc(v)}</dd>` : '';
  const desc = String(s.description || '').split(/\n+/).filter(Boolean).map(x => `<p>${esc(x)}</p>`).join('');
  const users = db.personnages.filter(p => (p.sorts || []).some(x => x.id === s.id));
  return `
  <p><a href="#/sorts">← Grimoire</a></p>
  <div class="spellhead ${ecoleClass(s.ecole)}">
    <h1>${esc(s.nom)}${s.source === 'Maison' ? '<span class="maison">maison</span>' : ''}</h1>
    ${s.nomVO ? `<p class="sub">VO : ${esc(s.nomVO)}</p>` : ''}
    <p class="ecole">${esc(ecole)}</p>
    <p class="usages">${tagsUsages(s)}</p>
  </div>
  <section class="card">
    <dl class="fiche-sort">
      ${row('Niveau', niveauxTxt(s))}${row('Composantes', s.composantes)}${row('Temps d\'incantation', s.incantation)}
      ${row('Portée', s.portee)}${row('Cible, zone ou effet', s.cible)}${row('Durée', s.duree)}
      ${row('Jet de sauvegarde', s.sauvegarde)}${row('Résistance à la magie', s.rm)}
    </dl>
    <div class="desc">${desc || '<p class="empty">Pas de description.</p>'}</div>
    ${users.length ? `<p class="hint">Utilisé par : ${users.map(p => `<a href="#/perso/${p.id}/sorts">${esc(p.nom)}</a>`).join(', ')}</p>` : ''}
  </section>
  <div class="btns">
    <a class="btn" href="#/sort-edit/${s.id}">Modifier</a>
    <button class="btn danger" data-action="del-sort" data-id="${s.id}">Supprimer du grimoire</button>
  </div>`;
}

function pageSortEdit(id) {
  if (!state.draft || state.draft._for !== id) {
    const src = id === 'new' ? { id: uid(), source: 'Maison', ecole: 'Évocation', niveaux: [] } : findSort(id);
    if (!src) return `<p>Sort introuvable. <a href="#/sorts">Retour au grimoire</a></p>`;
    state.draft = { ...src, niveauxTxt: niveauxTxt(src), _for: id };
  }
  const d = state.draft;
  state.ctx = d;
  return `
  <p><a href="${id === 'new' ? '#/sorts' : '#/sort/' + id}">← Annuler</a></p>
  <h1>${id === 'new' ? 'Nouveau sort' : 'Modifier le sort'}</h1>
  <section class="card" style="margin-top:1rem">
    <div class="grid">
      ${fi(d, 'nom', 'Nom')}${fi(d, 'nomVO', 'Nom anglais (VO)')}
      <label class="f"><span>École</span><select data-bind="ecole">${ECOLES.map(e => `<option ${d.ecole === e ? 'selected' : ''}>${e}</option>`).join('')}</select></label>
      ${fi(d, 'sousEcole', 'Sous-école', { ph: 'Création, Guérison…' })}
      ${fi(d, 'registre', 'Registre', { ph: 'Feu, Mental, Force…' })}
      ${fi(d, 'niveauxTxt', 'Niveaux par classe', { ph: 'Ens/Mag 3, Brd 3' })}
      ${fi(d, 'composantes', 'Composantes', { ph: 'V, G, M' })}${fi(d, 'incantation', 'Temps d\'incantation')}
      ${fi(d, 'portee', 'Portée')}${fi(d, 'cible', 'Cible, zone ou effet')}
      ${fi(d, 'duree', 'Durée')}${fi(d, 'sauvegarde', 'Jet de sauvegarde')}${fi(d, 'rm', 'Résistance à la magie')}
    </div>
    ${ta(d, 'description', 'Description', { rows: 8 })}
    <div class="f"><span class="lbl">Usage (pour filtrer et aider à choisir)</span>
      <div class="chips">${Object.entries(USAGES_SORT).map(([k, l]) => `<button class="chip ${(d.usages || usagesSort({ ...d, usages: null, _usages: null })).includes(k) ? 'on' : ''}" data-action="toggle-usage" data-u="${k}">${l}</button>`).join('')}</div>
    </div>
    <p class="hint">Niveaux : abréviation de la classe suivie du niveau, séparés par des virgules. Abréviations utilisées : ${Object.entries(CLASSES_ABR).map(([k, v]) => `${k} (${v})`).join(', ')}.</p>
  </section>
  <button class="btn" data-action="save-sort">Enregistrer le sort</button>`;
}

function pageDonnees() {
  const taille = (new Blob([JSON.stringify(db)]).size / 1024).toFixed(0);
  return `
  <div class="pagehead"><div><h1>Partage et sauvegarde</h1>
    <p class="sub">Les données restent sur cet appareil. Le partage se fait par fichier.</p></div></div>

  <section class="card intro"><h3>Partager avec la troupe</h3>
    <div class="btns">
      <button class="btn" data-action="import">Importer un fichier</button>
      <button class="btn ghost" data-action="export-all">Exporter toute la campagne</button>
    </div>
  </section>

  <section class="card intro"><h3>Base de données de la campagne</h3>
    ${enLigne()
      ? `<p>Connectée${state.syncErreur || state.recapsErreur ? ` (dernière synchronisation en échec : ${esc(state.syncErreur || state.recapsErreur)})` : ''}. Tout le monde voit toutes les fiches et les récapitulatifs ; chacun ne modifie que son personnage, avec son code personnel.</p>
         <p>Personnages associés à cet appareil : ${mesPersos().map(x => esc(x.nom)).join(', ') || 'aucun'}.</p>
         <details class="admin"><summary>Administration</summary>
           <p class="hint">Le code administrateur permet d'enregistrer les récapitulatifs et de corriger n'importe quelle fiche. Il n'ouvre pas les notes des joueurs.</p>
           ${db.codeCampagne
             ? `<p>Code administrateur enregistré sur cet appareil.</p><button class="btn danger" data-action="code-oublier">Retirer le code</button>`
             : `<div class="row"><input type="password" id="code-reglage" autocomplete="off" placeholder="Code administrateur" aria-label="Code administrateur">
                <button class="btn" data-action="code-verifier">Vérifier et enregistrer</button></div>`}
         </details>`
      : '<p>Non configurée : tout reste sur cet appareil, et les récapitulatifs sont publiés via le fichier recaps.json du site.</p>'}
  </section>

  <section class="card intro"><h3>Grimoire</h3>
    <p>${db.sorts.length} sorts, dont ${db.sorts.filter(s => s.source === 'Maison').length} ajoutés à la main. Exporte le grimoire pour donner tes sorts ajoutés aux autres joueurs.</p>
    <div class="btns">
      <button class="btn ghost" data-action="export-sorts">Exporter le grimoire</button>
      <button class="btn danger" data-action="reset-sorts">Restaurer les sorts d'origine</button>
    </div>
  </section>

  <section class="card intro"><h3>Sur cet appareil</h3>
    <p>${db.personnages.length} personnage${db.personnages.length > 1 ? 's' : ''}, environ ${taille} Ko utilisés. Fais un export complet de temps en temps : vider les données du navigateur efface tout.</p>
    <p class="hint">Pour installer l'appli : sur Android, menu ⋮ puis « Ajouter à l'écran d'accueil ». Sur iPhone, bouton Partager puis « Sur l'écran d'accueil ».</p>
  </section>`;
}

/* ---------- Rendu et navigation ---------- */
function ranger_aides(racine = document) {
  for (const el of [...racine.querySelectorAll('.aide')]) {
    const carte = el.closest('details.card, section.card, .card');
    const titre = carte && (carte.querySelector(':scope > summary h3') || carte.querySelector(':scope > h3') || carte.querySelector('h3'));
    if (!titre) continue;
    let bulle = titre.querySelector('.aide-bulle');
    if (!bulle) {
      titre.insertAdjacentHTML('beforeend', '<button type="button" class="aide-btn" aria-label="Explications" aria-expanded="false">?</button><span class="aide-bulle" hidden></span>');
      bulle = titre.querySelector('.aide-bulle');
    }
    bulle.insertAdjacentHTML('beforeend', `<span class="aide-para">${el.innerHTML}</span>`);
    el.remove();
  }
}
document.addEventListener('click', ev => {
  const b = ev.target.closest && ev.target.closest('.aide-btn');
  document.querySelectorAll('.aide-bulle:not([hidden])').forEach(x => { if (!b || x !== b.nextElementSibling) { x.hidden = true; x.previousElementSibling.setAttribute('aria-expanded', 'false'); } });
  if (!b) return;
  ev.preventDefault(); ev.stopPropagation();
  const bulle = b.nextElementSibling;
  bulle.hidden = !bulle.hidden;
  b.setAttribute('aria-expanded', String(!bulle.hidden));
}, true);
function render(garderScroll = true) {
  const y = window.scrollY;
  const h = location.hash.replace(/^#\/?/, '') || 'persos';
  const [page, id, tab] = h.split('/');
  state.ctx = null;
  if (page !== 'sort-edit') state.draft = null;
  if (page !== 'recap') { state.editRecap = null; state.editRecapObj = null; }
  if (page !== 'fiche') { state.editFiche = null; state.editFicheObj = null; }
  let html;
  switch (page) {
    case 'perso': html = pagePerso(id, tab); break;
    case 'sorts': html = pageSorts(); break;
    case 'aptitudes': html = pageAptitudes(); break;
    case 'log': html = pageJournalModifs(); break;
    case 'sort': html = pageSort(id); break;
    case 'sort-edit': html = pageSortEdit(id); break;
    case 'journal':
    case 'recaps': html = pageRecaps(); break;
    case 'recap': html = pageRecap(id); break;
    case 'notes': html = pageNotes(id, tab); break;
    case 'encyclo': html = pageEncyclo(id, tab); break;
    case 'fiche': html = pageFiche(id); break;
    case 'session': html = pageSession(id); break;
    case 'nouveau': html = pageNouveauPerso(); break;
    case 'mj': html = pageMJ2(); break;
    case 'marche': html = pageMarche(); break;
    case 'donnees': html = pageDonnees(); break;
    default: html = pagePersos();
  }
  $('#app').innerHTML = html;
  ranger_aides($('#app'));
  const nav = page === 'mj' ? 'mj' : page === 'perso' || page === 'nouveau' ? 'persos' : page.startsWith('sort') ? 'sorts' : ['recaps', 'recap', 'notes', 'session', 'encyclo', 'fiche'].includes(page) ? 'journal' : page;
  /* Mon personnage, en haut à droite (sauf dans l'espace MJ) */
  const chip = document.getElementById('mon-perso');
  if (chip) {
    const mien = monPerso();
    chip.hidden = !mien || page === 'mj';
    if (mien) {
      chip.href = `#/perso/${mien.id}/fiche`;
      chip.innerHTML = `${mien.portrait ? `<img src="${mien.portrait}" alt="">` : `<span class="initiale">${esc((mien.nom || '?')[0])}</span>`}<span class="nom">${esc(mien.nom || 'Mon personnage')}</span>`;
    }
  }
  const navLog = document.querySelector('[data-nav="log"]');
  if (navLog) navLog.hidden = !voitJournal();
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === nav || (a.dataset.nav === 'sorts' && nav === 'aptitudes')));
  if (garderScroll) window.scrollTo(0, y);
}
function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}
window.addEventListener('hashchange', () => {
  render(false); window.scrollTo(0, 0);
  const page = (location.hash.replace(/^#\/?/, '').split('/')[0]) || '';
  if (['persos', 'perso', ''].includes(page) && enLigne() && Date.now() - (state.persosCharges || 0) > 30000) {
    chargerPersos().then(ok => { if (ok && ['persos', 'perso', ''].includes(location.hash.replace(/^#\/?/, '').split('/')[0]) && !document.activeElement?.dataset?.bind) render(); });
  }
  if (['journal', 'recaps', 'recap', 'encyclo', 'fiche'].includes(page) && Date.now() - (state.recapsCharges || 0) > 30000 && !state.editRecap && !state.editFiche) {
    chargerInfos();
    chargerFiches();
    chargerRecaps().then(ok => { if (ok && ['journal', 'recaps', 'recap', 'encyclo', 'fiche'].includes(location.hash.replace(/^#\/?/, '').split('/')[0])) render(); });
  }
});

/* ---------- Saisie ---------- */
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'pickq') {
    state.pickQ = t.value;
    if (state.ctx) $('#pickres').innerHTML = pickResults(state.ctx);
    return;
  }
  if (t.id === 'co-perso') { state.coPerso = t.value; state.coOuvert = true; render(); return; }
  if (t.id === 'histo-cle') { state.histoCle = t.value; state.histo = null; render(); return; }
  if (['gen-modele', 'gen-niveau', 'gen-race', 'gen-nom', 'gen-nb'].includes(t.id)) {
    const g = state.gen;
    if (t.id === 'gen-modele') g.modele = t.value; else if (t.id === 'gen-niveau') g.niveau = Number(t.value); else if (t.id === 'gen-race') g.race = t.value;
    else if (t.id === 'gen-nom') { g.nom = t.value; return; } else { g.nb = t.value; return; }
    render();
    return;
  }
  if (['apt-q', 'apt-type', 'apt-classe'].includes(t.id)) {
    if (t.id === 'apt-q') state.aptQ = t.value; else if (t.id === 'apt-type') state.aptType = t.value; else state.aptClasse = t.value;
    const z = $('#apt-corps');
    if (z) { const tmp = document.createElement('div'); tmp.innerHTML = pageAptitudes(); z.innerHTML = tmp.querySelector('#apt-corps').innerHTML; }
    if (t.id === 'apt-q') { const q = $('#apt-q'); q.focus(); q.setSelectionRange(q.value.length, q.value.length); }
    return;
  }
  if (['best-q', 'best-fp', 'best-type'].includes(t.id)) {
    state.bestQ = $('#best-q').value; state.bestFP = $('#best-fp').value; state.bestType = $('#best-type').value; state.bestTout = false;
    const z = $('#best-res'); if (z) z.innerHTML = resultatsBestiaire();
    return;
  }
  if (t.classList.contains('prog-sort-q')) {
    const q = norm(t.value).trim(), d = t.dataset;
    const zone = t.parentElement.querySelector('.prog-sort-res');
    const p2 = state.ctx;
    const deja = new Set((p2.sorts || []).map(x => x.id));
    const res = !q ? [] : sortsDeClasse(d.abr, num(d.min), num(d.max))
      .filter(x => !(d.interdites || '').split('|').includes(x.ecole))
      .filter(x => !deja.has(x.id) && (norm(x.nom).includes(q) || norm(x.description).includes(q) || usagesSort(x).some(u => norm(USAGES_SORT[u]).includes(q))))
      .sort(byNom).slice(0, 15);
    zone.innerHTML = res.map(x => `<button class="don-choix" data-action="prog-sort-ajout" data-i="${d.i}" data-bloc="${d.bloc}" data-id="${x.id}">
      <b>${esc(x.nom)}</b> <span class="type-don">niveau ${nivSortClasse(x, d.abr)}, ${esc(x.ecole)}</span> ${tagsUsages(x)}
      <small>${esc(String(x.description || '').slice(0, 140))}</small></button>`).join('') || (q ? '<p class="empty">Aucun sort ne correspond.</p>' : '');
    return;
  }
  if (t.id === 'invq') {
    state.invQ = t.value;
    const p2 = state.ctx;
    if (p2 && $('#inv-groupes')) $('#inv-groupes').innerHTML = groupesInvHTML(p2, p2.equipement || [], peutModifier(p2));
    return;
  }
  if (t.id === 'eq') {
    state.eq = t.value;
    $('#eres').innerHTML = resultatsEncyclo();
    return;
  }
  if (t.id === 'jq') {
    state.jq = t.value;
    $('#jres').innerHTML = resultatsJournal();
    return;
  }
  if (t.id === 'nouvelle-note') return;
  if (t.dataset.filtre) {
    state.filtres[t.dataset.filtre] = t.value;
    $('#sortres').innerHTML = resultatsSorts();
    return;
  }
  if (t.id === 'carnet') { state.carnet = t.value; render(); return; }
  if (t.dataset.classebind) {
    if (!peutModifierClasses()) return;
    const [i, ...chemin] = t.dataset.classebind.split('.');
    const d = classesCommunes()[Number(i)];
    if (!d) return;
    setP(d, chemin.join('.'), t.type === 'checkbox' ? t.checked : t.value);
    sauverClasse(d);
    if (t.hasAttribute('data-rerender')) render();
    return;
  }
  if (t.dataset.ambiance) {
    if (!estMJ()) return;
    const [id, champ] = t.dataset.ambiance.split('.');
    const a = { ...ambiancesPerso().find(x => x.id === id) };
    a[champ] = t.type === 'checkbox' ? t.checked : t.value;
    sauverAmbiance(a);
    if (t.type !== 'text') render();
    return;
  }
  if (t.dataset.marchedef) {
    if (!estMJ()) return;
    const [id, champ] = t.dataset.marchedef.split('.');
    const m = { ...listeMarches().find(x => x.id === id) };
    m[champ] = t.type === 'checkbox' ? t.checked : t.value;
    delete m._envoye;
    sauverMarcheDef(m);
    if (t.type === 'checkbox' || t.tagName === 'SELECT') render();
    return;
  }
  if (t.dataset.marche) {
    const [i, champ] = t.dataset.marche.split('.');
    const a = db.marche[Number(i)];
    a[champ] = t.type === 'checkbox' ? t.checked : t.value;
    sauverArticle(a);
    if (t.type === 'checkbox' || t.tagName === 'SELECT') render();
    return;
  }
  if (t.dataset.mjbind) {
    setP(mjd(), t.dataset.mjbind, t.type === 'checkbox' ? t.checked : t.value);
    saveMJ(t.dataset.mjbind.split('.')[0]);
    if (t.hasAttribute('data-rerender')) render();
    return;
  }
  if (t.dataset.actionInput === 'mj-combat-nb') {
    const c = mjd().combats[Number(t.dataset.i)];
    c.participants = (c.participants || []).filter(y => y.pnjId !== t.dataset.pnj);
    if (num(t.value) > 0) c.participants.push({ pnjId: t.dataset.pnj, nombre: num(t.value) });
    saveMJ('combats');
    return;
  }
  const mArmure = (t.dataset.bind || '').match(/^equipement\.(\d+)\.armureType$/);
  if (mArmure && state.ctx && peutModifier(state.ctx)) {
    const it = state.ctx.equipement[Number(mArmure[1])], ref = R.ARMURE[t.value];
    it.armureType = ref ? ref.id : '';
    if (ref && !it.nom) it.nom = ref.nom;
    if (it.equipe === undefined) it.equipe = true;
    save(); render(); return;
  }
  const mArme = (t.dataset.bind || '').match(/^equipement\.(\d+)\.armeType$/);
  if (mArme && state.ctx && peutModifier(state.ctx)) {
    const it = state.ctx.equipement[Number(mArme[1])], ref = R.ARME[t.value];
    if (ref) {
      const petit = etat(state.ctx).taille === 'P';
      Object.assign(it, { armeType: ref.id, degats: petit ? (R.DEGATS_P[ref.deg] || ref.deg) : ref.deg, critique: ref.crit, portee: ref.portee, mode: ref.prise === 'distance' ? 'distance' : '' });
      if (!it.nom) it.nom = ref.nom;
    } else it.armeType = '';
    save(); render(); return;
  }
  if (t.classList.contains('don-recherche')) { resultatsDons(t); return; }
  if (t.id === 'zone-recit' && $('#apercu-recit')) $('#apercu-recit').innerHTML = formaterRecit(t.value) || '<p class="empty">Le récit apparaîtra ici, mis en forme.</p>';
  const path = t.dataset.bind;
  if (!path || !state.ctx) return;
  if (db.personnages.includes(state.ctx) && !peutModifier(state.ctx)) return;
  if (state.ctx === state.editRecapObj && !estAdmin()) return;
  if (state.ctx === state.editFicheObj && !peutEcrireFiches()) return;
  if (state.ctx === state.editFicheObj && path === 'extra.persoId') state.ctx.extra = { ...(state.ctx.extra || {}), persoNom: findPerso(t.value)?.nom || '' };
  /* Valider un niveau est réservé au MJ (le joueur le prépare seulement) */
  if (/^progression\.\d+\.atteint$/.test(path) && enLigne() && !estMJ() && db.personnages.includes(state.ctx)) { t.checked = !t.checked; toast('C\'est le MJ qui valide le passage de niveau.'); return; }
  const mAm = path.match(/^ameliorations\.(\d+)\./);
  if (mAm && enLigne() && !estMJ() && state.ctx.ameliorations?.[Number(mAm[1])]?.parMJ) return;
  setP(state.ctx, path, t.type === 'checkbox' ? t.checked : t.value);
  if (state.ctx === state.draft) return; // le sort n'est enregistré qu'au clic sur le bouton
  if (estMJ() && enLigne() && db.personnages.includes(state.ctx) && !state.ctx.pnjMJ) {
    state.ctx.mjChamps = { ...(state.ctx.mjChamps || {}), [path.startsWith('ameliorations.') ? 'ameliorations' : path]: Date.now() };
    state.ctx.mjMaj = Date.now();
  }
  state.ctx.maj = Date.now();
  if (path === 'nom' && $('#ptitle')) $('#ptitle').textContent = t.value || 'Sans nom';
  /* Augmentation de caractéristique : reportée sur la fiche quand le niveau est atteint */
  const mAug = path.match(/^progression\.(\d+)\.(atteint|augment)$/);
  if (mAug) appliquerAugment(state.ctx, state.ctx.progression[Number(mAug[1])]);
  const m = path.match(/^caracs\.(\w+)\.val$/);
  if (m && $('#mod-' + m[1])) $('#mod-' + m[1]).textContent = t.value === '' ? '—' : R.signe(R.mod(num(t.value) + num($('#mod-' + m[1]).dataset.bonus)));
  save();
  if (t.hasAttribute('data-rerender')) render();
});
/* Mémorise les groupes d'inventaire ouverts ou fermés */
document.addEventListener('click', ev => {
  const sb = ev.target.closest && ev.target.closest('details.bestiaire > summary');
  if (sb) setTimeout(() => { const d = sb.parentElement; if (d.classList.contains('generateur')) state.genFerme = !d.open; else if (d.querySelector('#histo-cle')) state.histoOuvert = d.open; else state.bestFerme = !d.open; }, 0);
  const sm = ev.target.closest && ev.target.closest('details.groupe-inv-d > summary');
  if (!sm || state.invQ || state.invCat) return;
  const d = sm.parentElement;
  setTimeout(() => { db.invOuverts = { ...(db.invOuverts || {}), [d.dataset.groupe]: d.open }; saveNow(); }, 0);
});

/* Entrée enregistre la note rapide (Maj + Entrée pour aller à la ligne) */
document.addEventListener('keydown', ev => {
  if (ev.target.id === 'rq' && ev.key === 'Enter' && ev.target.value.trim()) {
    ev.preventDefault();
    go('#/encyclo/recherche/' + encodeURIComponent(ev.target.value.trim()));
    return;
  }
  if (ev.target.id === 'nouvelle-note' && ev.key === 'Enter' && !ev.shiftKey && !ev.isComposing) {
    ev.preventDefault();
    ajouterNote();
  }
});
/* Les totaux calculés se mettent à jour quand on quitte le champ */
document.addEventListener('change', ev => {
  if (!ev.target.hasAttribute('data-recalc') || !state.ctx || state.ctx === state.draft) return;
  // On attend que le focus soit passé au champ suivant, puis on le lui rend après le rafraîchissement
  setTimeout(() => {
    const a = document.activeElement;
    const bind = a && a.dataset ? a.dataset.bind : null;
    const pos = a && typeof a.selectionStart === 'number' ? a.selectionStart : null;
    render();
    if (bind) {
      const n = document.querySelector(`[data-bind="${CSS.escape(bind)}"]`);
      if (n) { n.focus({ preventScroll: true }); if (pos != null && n.setSelectionRange) try { n.setSelectionRange(pos, pos); } catch (e) {} }
    }
  }, 0);
});
/* Mémorise les niveaux dépliés ou repliés */
document.addEventListener('toggle', ev => {
  const d = ev.target;
  if (d.matches && d.matches('details[data-section]')) {
    db.replis = { ...(db.replis || {}), [d.dataset.section]: !d.open };
    ecrireDb();
    return;
  }
  if (!d.matches || !d.matches('details[data-niveau]')) return;
  const n = Number(d.dataset.niveau);
  if (d.open) { state.ouverts.add(n); state.fermes.delete(n); } else { state.ouverts.delete(n); state.fermes.add(n); }
}, true);

/* ---------- Actions ---------- */
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-action]');
  if (!b) return;
  const p = state.ctx;
  const a = b.dataset.action;
  const idx = Number(b.dataset.idx);
  const libres = ['ajout-pnj-voir', 'ajout-pnj-ok', 'ajout-pnj-modele', 'mj-niveau-valider', 'mj-niveau-tous', 'coffre-deposer', 'coffre-prendre', 'mj-sauvegarde', 'mj-import-sauvegarde', 'histo-voir', 'histo-restaurer', 'gen-pnj', 'gen-combat', 'journal-actualiser', 'journal-filtre', 'apt-onglet', 'best-ouvrir', 'best-tout', 'best-pnj', 'best-combat', 'ajout-rapide-voir', 'ajout-rapide-ok', 'ajout-rapide-modele', 'ecran-image', 'ambiance-ajout', 'ambiance-suppr', 'mj-quete-nouvelle', 'mj-quete-statut', 'marche-image', 'marche-choisir', 'achat-ouvrir', 'marche-ajout', 'marche-suppr', 'effet-annuler', 'mj-cb-effet', 'pp-res-ajout', 'pp-res-suppr', 'pp-ajout', 'pp-edit', 'pp-fin', 'pp-suppr', 'pp-comp', 'pp-apt-ajout', 'pp-apt-suppr', 'mj-tiroir', 'mj-tiroir-fermer', 'inv-cat', 'mj-session-ajout', 'mj-session-ouvrir', 'mj-session-fermer', 'mj-session-mode', 'mj-session-suppr', 'mj-etape-ajout', 'mj-etape-monter', 'mj-etape-descendre', 'mj-etape-suppr', 'mj-etape-objet', 'mj-etape-image-suppr', 'mj-etape-xp', 'mj-etape-combat', 'img-zoom', 'bc-deposer', 'bc-prendre', 'bc-porteur', 'mj-argent', 'mj-vers-marche', 'marche-retirer', 'acheter', 'mj-onglet', 'mj-edit', 'mj-edit-fin', 'mj-xp-ajouter', 'mj-xp-fixer', 'mj-pnj-ajout', 'mj-pnj-suppr', 'mj-butin-ajout', 'mj-butin-suppr', 'mj-combat-ajout', 'mj-combat-suppr', 'mj-combat-activer', 'mj-init-pnj', 'mj-combat-go', 'mj-combat-fin', 'mj-cb-pv', 'mj-cb-mort', 'mj-obj-ajout', 'mj-obj-suppr', 'mj-donner', 'mj-pvj', 'mj-ration', 'mj-jour', 'mj-nouveau-perso', 'actualiser', 'pick-usage', 'lang-plus', 'mj-entrer', 'mj-sortir', 'mj-suivant', 'mj-pv', 'comp-reduit', 'replis-tout', 'new-perso', 'creer-perso', 'perso-en-ligne', 'revendiquer', 'export-perso', 'import', 'export-all', 'export-sorts', 'reset-sorts', 'code-verifier', 'code-oublier'];
  if (p && db.personnages.includes(p) && !peutModifier(p) && !libres.includes(a)) { toast('Lecture seule : ce personnage n\'est pas le tien'); return; }

  switch (a) {
    case 'new-perso': {
      if (enLigne()) { go('#/nouveau'); setTimeout(() => $('#np-nom')?.focus(), 60); break; }
      const np = nouveauPerso();
      db.personnages.push(np); saveNow();
      go(`#/perso/${np.id}/fiche`);
      setTimeout(() => { const i = $('[data-bind="nom"]'); i?.focus(); i?.select(); }, 50);
      break;
    }
    case 'del-perso': {
      const enLigneAussi = enLigne() && p.publie;
      if (!confirm(enLigneAussi ? `Supprimer définitivement « ${p.nom} » pour tout le monde ?` : `Supprimer définitivement « ${p.nom} » de cet appareil ?`)) break;
      const retirer = () => {
        db.personnages = db.personnages.filter(x => x.id !== p.id);
        if (db.cles) delete db.cles[p.id];
        db.enAttente = (db.enAttente || []).filter(x => x !== p.id);
        saveNow(); toast('Personnage supprimé'); go('#/persos');
      };
      if (enLigneAussi) rpc('supprimer_perso', { p_id: p.id, p_code: codePour(p) }).then(retirer).catch(e => alert('Suppression impossible : ' + e.message));
      else retirer();
      break;
    }
    case 'creer-perso': {
      const nom = $('#np-nom').value.trim(), code = $('#np-code').value, code2 = $('#np-code-2').value;
      if (!nom) { toast('Donne un nom au personnage'); break; }
      if (code.length < 4) { toast('Le code doit faire au moins 4 caractères'); break; }
      if (code !== code2) { toast('Les deux codes ne correspondent pas'); break; }
      const np = nouveauPerso();
      np.nom = nom;
      db.personnages.push(np); saveNow();
      b.disabled = true;
      mettreEnLigne(np, code)
        .then(() => toast('Personnage créé et mis en ligne'))
        .catch(e => alert('Créé sur cet appareil seulement (' + e.message + '). Tu pourras le mettre en ligne depuis sa fiche.'))
        .finally(() => go(`#/perso/${np.id}/fiche`));
      break;
    }
    case 'perso-en-ligne': {
      const code = $('#code-perso').value, code2 = $('#code-perso-2').value;
      if (code.length < 4) { toast('Le code doit faire au moins 4 caractères'); break; }
      if (code !== code2) { toast('Les deux codes ne correspondent pas'); break; }
      b.disabled = true;
      mettreEnLigne(p, code).then(() => {
        for (const se of db.sessions || []) if (!se.persoId) se.persoId = p.id;
        notesModifiees(p.id);
        saveNow(); render(); toast('Personnage mis en ligne');
      }).catch(e => { b.disabled = false; alert('Mise en ligne impossible : ' + e.message); });
      break;
    }
    case 'revendiquer': {
      const code = $('#code-revendiquer').value;
      if (!code) { toast('Saisis ton code personnel'); break; }
      rpc('verifier_perso', { p_id: p.id, p_code: code }).then(ok => {
        if (!ok) { toast('Code incorrect'); return; }
        db.cles = { ...(db.cles || {}), [p.id]: code };
        state.carnet = p.id;
        saveNow();
        return chargerNotes().then(() => { render(); toast('Personnage associé à cet appareil'); });
      }).catch(e => alert('Vérification impossible : ' + e.message));
      break;
    }
    case 'add-item': {
      const key = b.dataset.list;
      p[key] = p[key] || [];
      p[key].push(LIST_TEMPLATES[key]());
      const n = p[key].length - 1;
      if (key === 'equipement') state.editObjet = p[key][n].id;
      save(); render();
      $(`[data-bind^="${key}.${n}."]`)?.focus();
      break;
    }
    case 'del-item': {
      const key = b.dataset.list, it = p[key][idx];
      const vide = Object.values(it).every(v => !String(v).trim());
      if (vide || confirm('Supprimer cette ligne ?')) { p[key].splice(idx, 1); save(); render(); }
      break;
    }
    case 'add-sort-perso':
      p.sorts = p.sorts || [];
      p.sorts.push({ id: b.dataset.id, statut: 'Connu', notes: '' });
      save(); render();
      toast('Sort ajouté');
      break;
    case 'del-sort-perso':
      p.sorts.splice(idx, 1); save(); render();
      break;
    case 'gen-prog': {
      const max = Number(prompt('Créer les niveaux jusqu\'à quel niveau ?', '20'));
      if (!max || max < 1 || max > 40) break;
      p.progression = p.progression || [];
      const have = new Set(p.progression.map(l => l.niveau));
      for (let n = 1; n <= max; n++) {
        if (have.has(n)) continue;
        /* Même classe que le niveau précédent : on ne change que pour multiclasser */
        const prec = [...p.progression].filter(l => l.niveau < n && l.classe).sort((a, b) => b.niveau - a.niveau)[0];
        p.progression.push(nouveauNiveau(n, prec ? prec.classe : ''));
      }
      save(); render();
      break;
    }
    case 'add-level': {
      p.progression = p.progression || [];
      const n = p.progression.reduce((m, l) => Math.max(m, l.niveau), 0) + 1;
      const prec = [...p.progression].filter(l => l.classe).sort((a, b) => b.niveau - a.niveau)[0];
      p.progression.push(nouveauNiveau(n, prec ? prec.classe : '')); state.ouverts.add(n); save(); render();
      break;
    }
    case 'del-level':
      if (confirm(`Supprimer le niveau ${p.progression[idx].niveau} et ce qu'il contient ?`)) {
        const l = p.progression[idx];
        l.atteint = false; appliquerAugment(p, l);
        p.sorts = (p.sorts || []).filter(x => x.notes !== `Appris au niveau ${l.niveau}`);
        p.progression.splice(idx, 1); save(); render();
      }
      break;
    case 'save-sort': {
      const d = state.draft;
      if (!String(d.nom || '').trim()) { toast('Donne un nom au sort'); break; }
      const { niveauxTxt: nt, _for, _usages, ...sort } = d;
      sort.niveaux = parseNiveaux(nt);
      if (sort.source === 'SRD') sort.modifie = true;
      const i = db.sorts.findIndex(s => s.id === sort.id);
      if (i >= 0) db.sorts[i] = sort; else db.sorts.push(sort);
      state.draft = null; saveNow(); toast('Sort enregistré');
      go(`#/sort/${sort.id}`);
      break;
    }
    case 'del-sort': {
      const s = findSort(b.dataset.id);
      if (confirm(`Supprimer « ${s.nom} » du grimoire ? Il disparaîtra aussi des fiches qui l'utilisent.`)) {
        db.sorts = db.sorts.filter(x => x.id !== s.id);
        if (s.source === 'SRD') db.sortsSupprimes = [...new Set([...(db.sortsSupprimes || []), s.id])];
        saveNow();
        toast('Sort supprimé'); go('#/sorts');
      }
      break;
    }
    case 'export-perso': {
      const ids = new Set((p.sorts || []).map(s => s.id));
      download(`personnage-${slug(p.nom)}.json`, {
        type: 'personnage', version: APP_VERSION, personnage: p,
        sorts: db.sorts.filter(s => ids.has(s.id) && s.source === 'Maison'),
      });
      break;
    }
    case 'export-all':
      download(`campagne-${new Date().toISOString().slice(0, 10)}.json`,
        { type: 'campagne', version: APP_VERSION, personnages: db.personnages, sessions: db.sessions || [], recaps: db.recaps || [], fiches: db.fiches || [], sorts: db.sorts.filter(s => s.source === 'Maison') });
      break;
    case 'export-sorts':
      download('grimoire.json', { type: 'sorts', version: APP_VERSION, sorts: db.sorts.filter(s => s.source === 'Maison') });
      break;
    case 'reset-sorts':
      if (confirm('Remettre tous les sorts d\'origine dans leur version de départ ? Tes modifications sur ces sorts seront perdues et les sorts supprimés reviendront. Les sorts ajoutés à la main sont conservés.')) {
        chargerSortsSRD().then(data => {
          db.sorts = [...(data.sorts || []), ...db.sorts.filter(s => s.source === 'Maison')];
          db.sortsSupprimes = [];
          db.sortsVersion = data.version || 1;
          saveNow(); toast('Sorts d\'origine restaurés'); render();
        }).catch(e => toast('Échec : ' + e.message));
      }
      break;
    case 'new-session': {
      const ns = nouvelleSession();
      db.sessions = db.sessions || [];
      db.sessions.push(ns); saveNow(); notesModifiees(ns.persoId);
      go(`#/session/${ns.id}`);
      setTimeout(() => $('#nouvelle-note')?.focus(), 60);
      break;
    }
    case 'del-session':
      if (confirm(`Supprimer « ${titreSession(p)} » et toutes ses notes ?`)) {
        db.sessions = db.sessions.filter(x => x.id !== p.id); saveNow(); notesModifiees(p.persoId);
        toast('Session supprimée'); go('#/notes');
      }
      break;
    case 'type-note':
      state.typeNote = b.dataset.type;
      document.querySelectorAll('.types .chip').forEach(c => { const on = c.dataset.type === state.typeNote; c.classList.toggle('on', on); c.setAttribute('aria-pressed', on); });
      $('#nouvelle-note')?.focus();
      break;
    case 'add-note':
      ajouterNote();
      break;
    case 'note-edit':
      state.editNote = b.dataset.id; render();
      break;
    case 'note-fin':
      state.editNote = null; save(); render();
      break;
    case 'note-suppr':
      if (confirm('Supprimer cette note ?')) { p.notes.splice(idx, 1); p.maj = Date.now(); state.editNote = null; saveNow(); notesModifiees(p.persoId); render(); }
      break;
    case 'note-resolu': {
      const ses = findSession(b.dataset.s);
      const n = ses && ses.notes.find(x => x.id === b.dataset.n);
      if (n) { n.resolu = b.checked; ses.maj = Date.now(); saveNow(); notesModifiees(ses.persoId); setTimeout(render, 150); }
      break;
    }
    case 'new-recap': {
      if (!estAdmin()) { toast('Réservé à l\'administrateur'); break; }
      const ses = b.dataset.session ? findSession(b.dataset.session) : null;
      const r = nouveauRecap(ses);
      db.recaps = db.recaps || [];
      db.recaps.push(r); saveNow();
      state.editRecap = r.id;
      go(`#/recap/${r.id}`);
      break;
    }
    case 'recap-edit':
      if (!estAdmin()) { toast('Réservé à l\'administrateur'); break; }
      state.editRecap = b.dataset.id; recapLocal(b.dataset.id); render();
      break;
    case 'recap-fin':
      state.editRecap = null; saveNow(); render();
      toast(aPublier() ? 'Enregistré sur cet appareil. Pense à publier.' : 'Enregistré');
      break;
    case 'del-recap': {
      if (!estAdmin()) { toast('Réservé à l\'administrateur'); break; }
      const id = b.dataset.id;
      if (!confirm('Supprimer ce récapitulatif ? S\'il est déjà publié, il disparaîtra pour tout le monde à la prochaine publication.')) break;
      db.recaps = (db.recaps || []).filter(x => x.id !== id);
      if (recapsPublies().some(x => x.id === id)) db.recapsSupprimes = [...new Set([...(db.recapsSupprimes || []), id])];
      state.editRecap = null; saveNow(); go('#/recaps');
      break;
    }
    case 'publier-tout': {
      if (!estAdmin()) { toast('Réservé à l\'administrateur'); break; }
      const champ = $('#code-campagne');
      if (champ && champ.value.trim()) { db.codeCampagne = champ.value.trim(); saveNow(); }
      b.disabled = true;
      publierTout().finally(() => { b.disabled = false; });
      break;
    }
    case 'recap-publier':
      if (!estAdmin()) { toast('Réservé à l\'administrateur'); break; }
      state.editRecap = null; saveNow();
      if (!db.codeCampagne) { render(); toast('Saisis le code de campagne pour publier'); break; }
      publierTout();
      break;
    case 'code-verifier': {
      const code = $('#code-reglage').value.trim();
      if (!code) { toast('Saisis le code'); break; }
      rpc('verifier_code', { p_code: code }).then(ok => {
        if (ok) { db.codeCampagne = code; saveNow(); render(); toast('Code administrateur accepté'); }
        else toast('Code incorrect');
      }).catch(e => alert('Vérification impossible : ' + e.message));
      break;
    }
    case 'code-oublier':
      db.codeCampagne = ''; saveNow(); render(); toast('Code retiré de cet appareil');
      break;
    case 'recap-copier': {
      const r = findRecap(b.dataset.id);
      const txt = [`Session ${r.numero}${r.titre ? ' : ' + r.titre : ''}`, '', texteBrut(r.texte)].join('\n');
      navigator.clipboard?.writeText(txt).then(() => toast('Texte copié'), () => toast('Copie impossible sur ce navigateur'));
      break;
    }
    case 'export-recaps':
      download('recaps.json', { type: 'recaps', version: 1, maj: Date.now(),
        recaps: recapsTous().map(r => ({ id: r.id, numero: r.numero, date: r.date, titre: r.titre, auteur: r.auteur, texte: r.texte, maj: r.maj, photoType: r.photoType || '', photoMaj: r.photoMaj || 0, photo: photoRecap(r) || '' })) });
      break;
    case 'jq-effacer':
      state.jq = ''; go('#/notes');
      break;
    case 'comp-reduit':
      db.compReduit = b.checked;
      ecrireDb();
      render();
      break;
    case 'choisir-don':
      setP(p, b.dataset.path, b.dataset.id);
      save(); render();
      toast(`${R.DON[b.dataset.id].nom} sélectionné`);
      break;
    case 'photo-recap':
      if (!estAdmin()) break;
      state.imgType = 'recap';
      $('#imginput').value = '';
      $('#imginput').click();
      break;
    case 'photo-recap-retirer':
      if (!estAdmin() || !confirm('Retirer la photo de ce récapitulatif ?')) break;
      p.photo = ''; p.photoMaj = Date.now(); saveNow(); render();
      break;
    case 'definir-conteur': {
      if (!estAdmin()) break;
      const id = $('#conteur-choix').value, session = Math.round(num($('#conteur-session').value)) || null;
      const x = findPerso(id);
      const nom = x ? (x.joueur ? `${x.joueur} (${x.nom})` : x.nom) : '';
      const fini = () => { db.conteur = { conteur_id: id, conteur_nom: nom, session }; saveNow(); render(); toast(nom ? `${nom} racontera la session ${session || ''}` : 'Conteur retiré'); };
      if (enLigne()) rpc('definir_conteur', { p_code: codeAdmin(), p_id: id, p_nom: nom, p_session: session }).then(fini).catch(e => alert('Impossible : ' + e.message));
      else fini();
      break;
    }
    case 'add-bonus': {
      const it = p.equipement[idx];
      it.bonus = [...(it.bonus || []), { cible: '', val: '1' }];
      if (it.equipe === undefined) it.equipe = true;
      save(); render();
      break;
    }
    case 'del-bonus':
      p.equipement[idx].bonus.splice(Number(b.dataset.j), 1); save(); render();
      break;
    case 'fmt': {
      const zone = $('#zone-recit');
      if (zone) appliquerFormat(zone, b.dataset.fmt);
      break;
    }
    case 'ftype':
      state.ftype = b.dataset.type; $('#eres').innerHTML = resultatsEncyclo();
      break;
    case 'eq-effacer':
      state.eq = ''; go('#/encyclo');
      break;
    case 'export-ia':
      exportIA();
      break;
    case 'export-fiches':
      download('fiches.json', { type: 'encyclopedie', version: 1, fiches: fichesToutes() });
      break;
    case 'new-fiche': {
      if (!peutEcrireFiches()) break;
      const f = { id: uid(), nom: 'Nouvelle fiche', type: state.ftype || 'pnj', role: '', lieu: '', statut: '', alias: '', description: '', maj: Date.now() };
      db.fiches = [...(db.fiches || []), f]; saveNow();
      state.editFiche = f.id;
      go(`#/fiche/${f.id}`);
      setTimeout(() => { const i = $('[data-bind="nom"]'); i?.focus(); i?.select(); }, 60);
      break;
    }
    case 'fiche-edit':
      if (!peutEcrireFiches()) break;
      state.editFiche = b.dataset.id; ficheLocale(b.dataset.id); render();
      break;
    case 'fiche-fin':
      state.editFiche = null; saveNow(); render();
      toast(aPublier() ? 'Enregistré sur cet appareil. Pense à publier.' : 'Enregistré');
      break;
    case 'fiche-publier':
      if (!peutEcrireFiches()) break;
      state.editFiche = null; saveNow();
      publierTout();
      break;
    case 'del-fiche': {
      if (!peutEcrireFiches() || !confirm('Supprimer cette fiche ? Elle disparaîtra pour tout le monde à la prochaine publication.')) break;
      const id = b.dataset.id;
      db.fiches = (db.fiches || []).filter(x => x.id !== id);
      if (fichesPubliees().some(x => x.id === id)) db.fichesSupprimees = [...new Set([...(db.fichesSupprimees || []), id])];
      state.editFiche = null; saveNow(); go('#/encyclo');
      break;
    }
    case 'comp-classe': {
      const cle = b.dataset.cle;
      if (cle.startsWith('perso:')) { const v = p.compPerso[Number(cle.slice(6))]; v.classe = !v.classe; }
      else {
        p.comp = p.comp || {};
        const v = p.comp[cle] = p.comp[cle] || {};
        const parDefaut = compDeClasse(etat(p)).has(cle);
        const actuel = typeof v.classe === 'boolean' ? v.classe : parDefaut;
        if (!actuel === parDefaut) delete v.classe; else v.classe = !actuel;
      }
      save(); render();
      break;
    }
    case 'add-comp-perso':
      p.compPerso = [...(p.compPerso || []), { nom: '', car: 'int', rangs: '', divers: '', classe: true }];
      save(); render();
      setTimeout(() => { const l = document.querySelectorAll('.cl-nom-perso'); l[l.length - 1]?.focus(); }, 50);
      break;
    case 'del-comp-perso':
      if (confirm('Supprimer cette compétence ?')) { p.compPerso.splice(idx, 1); save(); render(); }
      break;
    case 'objet-edit':
      state.editObjet = b.dataset.id; render();
      break;
    case 'objet-fin':
      state.editObjet = null; save(); render();
      break;
    case 'baguette-edit':
      state.editBaguette = p.id; p.baguette = p.baguette || {}; render();
      break;
    case 'baguette-fin':
      state.editBaguette = null; save(); render();
      break;
    case 'baguette-encyclo': {
      const fe = ficheEncycloBaguette(p);
      if (!fe) break;
      const txt = sansMentions(fe.description).replace(/^Baguette de [^,]+, remise par [^.]+\.\s*/, '');
      const lg = txt.match(/(\d+)\s*cm/);
      p.baguette = { ...(p.baguette || {}), nom: fe.nom, description: (p.baguette?.description ? p.baguette.description + '\n\n' : '') + txt, longueur: p.baguette?.longueur || (lg ? lg[1] + ' cm' : '') };
      save(); render(); toast('Description reprise de l\'encyclopédie');
      break;
    }
    case 'sort-infini':
      p.sorts[idx].illimite = !p.sorts[idx].illimite; save(); render();
      break;
    case 'pick-usage':
      state.pickUsage = b.dataset.u; $('#pickres').innerHTML = pickResults(p);
      document.querySelectorAll('.usages-filtre .chip').forEach(c => c.classList.toggle('on', c.dataset.u === state.pickUsage));
      break;
    case 'toggle-usage': {
      const d = state.draft;
      const cur = d.usages && d.usages.length ? [...d.usages] : [...usagesSort({ ...d, usages: null, _usages: null })];
      d.usages = cur.includes(b.dataset.u) ? cur.filter(x => x !== b.dataset.u) : [...cur, b.dataset.u];
      render();
      break;
    }
    case 'nuit':
      if (!confirm('Une nuit de repos : toutes les capacités et les sorts du jour sont récupérés. Continuer ?')) break;
      p.compteurs = {};
      (p.sorts || []).forEach(x => { x.utilises = 0; });
      save(); render(); toast('☾ Bonne nuit : tout est récupéré');
      break;
    case 'cpt-use': {
      p.compteurs = { ...(p.compteurs || {}), [b.dataset.id]: num((p.compteurs || {})[b.dataset.id]) + 1 };
      save();
      const r = ressources(p, etat(p)).find(x => x.id === b.dataset.id);
      ouvrirFormEffet(p, { nom: r?.nom, rounds: r?.duree || '', texte: '' });
      break;
    }
    case 'cpt-annuler':
      p.compteurs = { ...(p.compteurs || {}), [b.dataset.id]: Math.max(0, num((p.compteurs || {})[b.dataset.id]) - 1) };
      save(); render();
      break;
    case 'cpt-pv': {
      const r = ressources(p, etat(p)).find(x => x.id === b.dataset.id);
      const reste = r.max - num((p.compteurs || {})[r.id]);
      const n = Math.round(num(prompt(`Combien de PV ? (il en reste ${reste})`, String(Math.min(reste, 5)))));
      if (!n || n < 0) break;
      p.compteurs = { ...(p.compteurs || {}), [r.id]: num((p.compteurs || {})[r.id]) + Math.min(n, reste) };
      save(); render();
      break;
    }
    case 'sort-use': {
      p.sorts[idx].utilises = num(p.sorts[idx].utilises) + 1; save();
      const sp = findSort(p.sorts[idx].id);
      if (sp && !/instantan/i.test(sp.duree || '')) ouvrirFormEffet(p, { nom: sp.nom, rounds: dureeSort(sp, etat(p)) });
      else render();
      break;
    }
    case 'effet-nouveau':
      ouvrirFormEffet(p, {});
      break;
    case 'effet-creer':
      creerEffet();
      break;
    case 'effet-annuler':
      state.effetForm = null; render();
      break;
    case 'effet-tick': {
      const ef = (p.effets || []).find(x => x.id === b.dataset.id);
      if (ef) { ef.reste = Math.max(0, num(ef.reste ?? ef.rounds) - 1); save(); render(); }
      break;
    }
    case 'effet-suppr':
      p.effets = (p.effets || []).filter(x => x.id !== b.dataset.id); save(); render();
      break;
    case 'sort-annuler':
      p.sorts[idx].utilises = Math.max(0, num(p.sorts[idx].utilises) - 1); save(); render();
      break;
    case 'objet-use': {
      const it = p.equipement[idx];
      it.qte = String(Math.max(0, num(it.qte) - 1)); save(); render();
      toast(`${it.nom || 'Objet'} : il en reste ${it.qte}`);
      break;
    }
    case 'lang-plus':
      state.langPanel = !state.langPanel; render();
      break;
    case 'lang-add':
      p.langues = [...new Set([...(p.langues || []), b.dataset.l])]; save(); render();
      break;
    case 'lang-add-autre': {
      const v = $('#lang-autre').value.trim();
      if (!v) break;
      p.langues = [...new Set([...(p.langues || []), v])]; save(); render();
      break;
    }
    case 'lang-del':
      p.langues = (p.langues || []).filter(l => l !== b.dataset.l); save(); render();
      break;
    case 'mj-entrer': {
      const code = $('#code-mj').value.trim();
      const ok = () => { db.codeMJ = code; if (db.versions) { delete db.versions.mj; delete db.versions.persosMJcomplets; } saveNow(); toast('Bienvenue, maître du jeu'); chargerPersosMJ().then(chargerMJ).then(render); };
      if (enLigne()) rpc('verifier_mj', { p_code: code }).then(v => v ? ok() : toast('Code MJ incorrect')).catch(e => alert('Vérification impossible (la base est-elle en v5 ?) : ' + e.message));
      else if (code === CODE_MJ_DEMO) ok(); else toast('Code MJ incorrect');
      break;
    }
    case 'mj-sortir':
      db.codeMJ = '';
      /* les versions complètes des personnages du MJ ne restent pas sur l'appareil */
      if (enLigne()) { db.personnages = db.personnages.filter(x => !x.pnjMJ); db.mjData = null; if (db.versions) { delete db.versions.mj; delete db.versions.persosMJcomplets; } }
      saveNow(); go('#/persos'); actualiser();
      break;
    case 'mj-suivant': {
      const c = mjd().combat;
      if (!c) { state.mjTour = (state.mjTour || 0) + 1; render(); break; }
      const actifs = c.combattants.filter(x => x.actif);
      if (!actifs.length) break;
      let n = 0;
      const avant = actifs.flatMap(x => effetsDuCombattant(x, c).map(f => `${f.nom} (${x.nom})`));
      do { c.tour++; n++; } while (actifs[c.tour % actifs.length].mort && n <= actifs.length);
      c.round = Math.floor(c.tour / actifs.length) + 1;
      const apres = new Set(actifs.flatMap(x => effetsDuCombattant(x, c).map(f => `${f.nom} (${x.nom})`)));
      const finis = avant.filter(x => !apres.has(x));
      if (finis.length) toast(`Fin : ${finis.join(', ')}`);
      saveMJ('combat'); publierCombat(); render();
      break;
    }
    case 'mj-pv': {
      const c = state.mjInit[idx];
      c.pv = Math.max(-10, Math.min(c.pvMax, c.pv + Number(b.dataset.d))); render();
      break;
    }
    case 'actualiser':
      actualiser(true);
      break;
    case 'etat-add': {
      const k = $('#etat-choix').value;
      const pre = ETATS_PREDEFINIS[k];
      const et = pre
        ? { id: uid(), nom: pre.nom, description: pre.texte, duree: '', depuis: '', bonus: pre.bonus.map(x => ({ ...x })), actif: true }
        : { id: uid(), nom: '', description: '', duree: 'permanent', depuis: '', bonus: [], actif: true };
      p.etats = [...(p.etats || []), et];
      if (!pre) state.editEtat = et.id;
      save(); render();
      if (!pre) setTimeout(() => $(`[data-bind="etats.${p.etats.length - 1}.nom"]`)?.focus(), 60);
      break;
    }
    case 'etat-edit':
      state.editEtat = b.dataset.id; render();
      break;
    case 'etat-fin':
      state.editEtat = null; save(); render();
      break;
    case 'etat-actif': {
      const et = p.etats[idx];
      if (et.actif === false) et.actif = true;
      else if (et.duree === 'permanent') et.actif = false;
      else p.etats.splice(idx, 1);
      save(); render();
      break;
    }
    case 'etat-suppr':
      if (confirm('Supprimer cet état ?')) { p.etats.splice(idx, 1); state.editEtat = null; save(); render(); }
      break;
    case 'etat-add-bonus':
      p.etats[idx].bonus = [...(p.etats[idx].bonus || []), { cible: '', val: '-2' }]; save(); render();
      break;
    case 'etat-del-bonus':
      p.etats[idx].bonus.splice(Number(b.dataset.j), 1); save(); render();
      break;
    case 'pv-delta': {
      const m = num(p.pvMax);
      p.pvActuels = String(Math.max(-10, Math.min(m || 9999, pvActuels(p) + Number(b.dataset.d))));
      save(); render();
      break;
    }
    case 'pv-saisir': {
      const v = prompt('Points de vie actuels :', String(pvActuels(p)));
      if (v === null || v.trim() === '' || isNaN(Number(v))) break;
      p.pvActuels = String(Math.max(-10, Number(v))); save(); render();
      break;
    }
    case 'dv-utiliser': {
      const v = prompt('Résultat du dé de vie (bonus de Constitution compris) :', '');
      if (v === null || v.trim() === '' || isNaN(Number(v))) break;
      p.dvUtilises = num(p.dvUtilises) + 1;
      p.pvActuels = String(Math.min(num(p.pvMax) || 9999, pvActuels(p) + Math.max(0, Number(v))));
      save(); render(); toast(`+${Math.max(0, Number(v))} PV`);
      break;
    }
    case 'ration-defaut':
      p.rationDefaut = b.dataset.id; save(); render();
      break;
    case 'mj-pvj': {
      const x = findPerso(b.dataset.id);
      if (!x) break;
      const m = num(x.pvMax);
      const nv = Math.max(-10, Math.min(m || 9999, pvActuels(x) + Number(b.dataset.d)));
      const fini = () => { x.pvActuels = String(nv); x.mjMaj = Date.now(); saveNow(); render(); };
      if (enLigne() && !x.pnjMJ) rpc('mj_pv', { p_code: db.codeMJ, p_id: x.id, p_pv: nv }).then(fini).catch(e => alert('Impossible : ' + e.message));
      else { fini(); if (x.pnjMJ) persoModifie(x); }
      break;
    }
    case 'mj-ration': {
      if (!confirm('Chaque joueur consomme une ration (celle choisie par défaut). Continuer ?')) break;
      /* Les membres du groupe joués par le MJ : leur version complète est sur cet appareil */
      const membresMJ = () => db.personnages.filter(x => pnjComplet(x) && x.membreGroupe).filter(x => { const ok = majLocaleRation(x); if (ok) persoModifie(x); return ok; }).length;
      if (enLigne()) rpc('mj_ration', { p_code: db.codeMJ }).then(n => { const m = membresMJ(); toast(`${n + m} ration(s) consommée(s)`); actualiser(); }).catch(e => alert('Impossible : ' + e.message));
      else { const n = db.personnages.filter(estMembre).filter(majLocaleRation).length; saveNow(); render(); toast(`${n} ration(s) consommée(s)`); }
      break;
    }
    case 'mj-jour': {
      if (!confirm('Jour suivant : tout le monde récupère ses PV max, ses dés de vie, ses sorts et ses capacités du jour. Continuer ?')) break;
      const locaux = () => db.personnages.filter(x => x.pnjMJ && !x._public).forEach(x => { majLocaleJourSuivant(x); persoModifie(x); });
      if (enLigne()) rpc('mj_jour_suivant', { p_code: db.codeMJ }).then(() => { locaux(); db.jour = num(db.jour || 1) + 1; toast('☀ Un nouveau jour se lève'); actualiser(); }).catch(e => alert('Impossible : ' + e.message));
      else { db.personnages.forEach(majLocaleJourSuivant); db.jour = num(db.jour || 1) + 1; saveNow(); render(); toast('☀ Un nouveau jour se lève'); }
      break;
    }
    case 'mj-nouveau-perso': {
      const np = nouveauPerso();
      Object.assign(np, { nom: 'Personnage du MJ', pnjMJ: true, joueur: 'MJ', visibilite: { portrait: true }, publie: enLigne() });
      db.personnages.push(np); saveNow(); persoModifie(np);
      go(`#/perso/${np.id}/fiche`);
      break;
    }
    case 'mj-onglet':
      ev.preventDefault(); state.mjOnglet = b.dataset.o; state.mjEdit = null;
      if (!/^#\/mj/.test(location.hash)) go('#/mj'); else render();
      window.scrollTo(0, 0);
      break;
    case 'mj-edit':
      state.mjEdit = b.dataset.cle; render();
      break;
    case 'mj-edit-fin':
      state.mjEdit = null; saveNow(); render();
      break;
    case 'mj-xp-ajouter': {
      const n = Math.round(num($('#xp-gain').value));
      if (!n) { toast('Indique le nombre d\'XP gagnés'); break; }
      const m = mjd(); m.xp = { valeur: num(m.xp.valeur) + n }; saveMJ('xp'); render(); toast(`+${n} XP pour le groupe`);
      break;
    }
    case 'mj-xp-fixer': {
      const v = prompt('Total d\'expérience du groupe :', String(num(mjd().xp.valeur)));
      if (v === null || isNaN(Number(v))) break;
      mjd().xp = { valeur: Math.max(0, Math.round(Number(v))) }; saveMJ('xp'); render();
      break;
    }
    case 'mj-pnj-ajout': {
      const x = nouveauPNJ(); mjd().pnj.push(x); state.mjEdit = 'pnj:' + x.id; saveMJ('pnj'); render();
      break;
    }
    case 'mj-pnj-suppr':
      if (confirm('Supprimer ce PNJ ?')) { mjd().pnj.splice(Number(b.dataset.i), 1); state.mjEdit = null; saveMJ('pnj'); render(); }
      break;
    case 'mj-butin-ajout': {
      const x = mjd().pnj[Number(b.dataset.i)]; x.butin = [...(x.butin || []), { nom: '', cat: '', qte: '1', valeur: '' }]; saveMJ('pnj'); render();
      break;
    }
    case 'mj-butin-suppr':
      mjd().pnj[Number(b.dataset.i)].butin.splice(Number(b.dataset.j), 1); saveMJ('pnj'); render();
      break;
    case 'mj-combat-ajout': {
      const c = { id: uid(), nom: 'Nouvelle rencontre', notes: '', participants: [] }; mjd().combats.push(c); state.mjEdit = 'combat:' + c.id; saveMJ('combats'); render();
      break;
    }
    case 'mj-combat-suppr':
      if (confirm('Supprimer ce combat préparé ?')) { mjd().combats.splice(Number(b.dataset.i), 1); state.mjEdit = null; saveMJ('combats'); render(); }
      break;
    case 'mj-combat-activer': {
      if (mjd().combat && !confirm('Un combat est déjà en cours. Le remplacer ?')) break;
      lancerCombat(mjd().combats[Number(b.dataset.i)]); publierCombat();
      state.mjOnglet = 'combat'; render(); window.scrollTo(0, 0);
      break;
    }
    case 'mj-init-pnj':
      for (const x of mjd().combat.combattants) if (x.type === 'pnj' && x.init === '') x.init = String(1 + Math.floor(Math.random() * 20) + num(x.bonusInit));
      saveMJ('combat'); render();
      break;
    case 'mj-combat-go': {
      const c = mjd().combat;
      const manquants = c.combattants.filter(x => x.actif && x.init === '');
      if (manquants.length && !confirm(`Pas d'initiative pour : ${manquants.map(x => x.nom).join(', ')}. Commencer quand même ?`)) break;
      c.combattants.sort((a2, b2) => num(b2.init) - num(a2.init) || num(b2.bonusInit) - num(a2.bonusInit));
      c.phase = 'combat'; c.tour = 0; c.round = 1; saveMJ('combat'); publierCombat(); render();
      break;
    }
    case 'mj-combat-fin':
      if (confirm('Terminer le combat ?')) { mjd().combat = null; saveMJ('combat'); publierCombat(); render(); }
      break;
    case 'mj-cb-pv': {
      const c = mjd().combat, x = c.combattants[Number(b.dataset.i)];
      const nv = Math.max(-10, Math.min(x.pvMax || 9999, num(x.pv) + Number(b.dataset.d)));
      x.pv = nv;
      if (x.persoId) {
        const pj = findPerso(x.persoId);
        if (pj) {
          const fini = () => { pj.pvActuels = String(nv); pj.mjMaj = Date.now(); saveNow(); };
          if (enLigne() && !pj.pnjMJ) rpc('mj_pv', { p_code: db.codeMJ, p_id: pj.id, p_pv: nv }).then(fini).catch(e => alert('Impossible : ' + e.message));
          else { fini(); if (pj.pnjMJ) persoModifie(pj); }
        }
      }
      if (x.type === 'pnj' && nv <= 0 && !x.mort) tuerPNJ(x);
      saveMJ('combat'); render();
      break;
    }
    case 'mj-cb-mort': {
      const x = mjd().combat.combattants[Number(b.dataset.i)];
      if (confirm(`${x.nom} est mort ? Son butin passera dans les objets en attente.`)) { tuerPNJ(x); saveMJ('combat'); publierCombat(); render(); }
      break;
    }
    case 'mj-obj-ajout': {
      const it = { id: uid(), nom: '', cat: '', qte: '1', valeur: '', valeurUnite: 'po', poids: '', notes: '', type: b.dataset.type || '' }; mjd().objets.push(it); state.mjEdit = 'obj:' + it.id; saveMJ('objets'); render();
      break;
    }
    case 'mj-obj-suppr':
      if (confirm('Supprimer cet objet ?')) { mjd().objets.splice(Number(b.dataset.i), 1); state.mjEdit = null; saveMJ('objets'); render(); }
      break;
    case 'mj-donner': {
      const i = Number(b.dataset.i), obj = mjd().objets[i];
      if ($('#cible-' + obj.id).value === '__coffre__') {
        const { source, type, detenteur, ...propre } = obj;
        const item = { ...propre, id: uid(), deposePar: 'MJ' };
        const fin = () => { bc().objets = [...(bc().objets || []), item]; mjd().objets.splice(i, 1); saveMJ('objets'); render(); toast(`${obj.nom || 'Objet'} déposé dans le coffre commun`); };
        if (enLigne()) rpc('coffre_deposer', { p_id: null, p_code: db.codeMJ, p_objet: item }).then(fin).catch(e => alert('Impossible (la base est-elle en v14 ?) : ' + e.message));
        else fin();
        break;
      }
      const cible = findPerso($('#cible-' + obj.id).value);
      if (!cible) break;
      const { source, type, detenteur, ...propre } = obj;
      const item = { ...propre, id: uid() };
      const fini = () => {
        if (b.dataset.session) {
          const ss = sessionMJ(b.dataset.session), et = ss && ss.etapes[Number(b.dataset.etape)];
          if (et) { et.donnes = { ...(et.donnes || {}), [obj.id]: `${obj.nom || 'Objet'} → ${cible.nom}` }; saveMJ(cleSession(ss.id)); }
        }
        cible.equipement = [...(cible.equipement || []), { ...item, donMJ: Date.now() }];
        cible.mjMaj = Date.now();
        mjd().objets.splice(i, 1); saveMJ('objets'); render();
        toast(`${obj.nom || 'Objet'} donné à ${cible.nom}`);
      };
      if (enLigne() && !cible.pnjMJ) rpc('mj_donner_objet', { p_code: db.codeMJ, p_id: cible.id, p_objet: item }).then(fini).catch(e => alert('Impossible : ' + e.message));
      else { fini(); if (cible.pnjMJ) persoModifie(cible); }
      break;
    }
    case 'coffre-deposer': {
      state.coOuvert = true;
      const x = findPerso($('#co-perso').value);
      const it = x && (x.equipement || []).find(o => o.id === $('#co-objet').value);
      if (!it || !confirm(`Déposer « ${it.nom || 'cet objet'} » dans le coffre commun ?`)) break;
      const objet = { ...it, equipe: undefined, deposePar: x.nom };
      const retirer = () => { x.equipement = x.equipement.filter(o => o.id !== it.id); x.maj = Date.now(); saveNow(); persoModifie(x); };
      if (enLigne()) rpc('coffre_deposer', { p_id: x.id, p_code: codePour(x), p_objet: objet })
        .then(() => { retirer(); bc().objets = [...(bc().objets || []), objet]; toast(`${it.nom} est dans le coffre`); return actualiser(); })
        .then(render).catch(e => alert('Impossible (la base est-elle en v14 ?) : ' + e.message));
      else { retirer(); bc().objets = [...(bc().objets || []), objet]; journalLocal(x.nom, 'dépose ' + (it.nom || 'un objet'), {}); saveNow(); render(); }
      break;
    }
    case 'coffre-prendre': {
      const x = findPerso(($('#co-perso') || {}).value) || db.personnages.find(y => !y._public && estMembre(y) && (!enLigne() || (db.cles || {})[y.id] || estMJ()));
      const o = (bc().objets || []).find(y => y.id === b.dataset.id);
      if (!x || !o || !confirm(`${x.nom} prend « ${o.nom || 'cet objet'} » dans le coffre ?`)) break;
      const ajouter = obj => { const { deposePar, ...propre } = obj; x.equipement = [...(x.equipement || []), { ...propre, id: uid() }]; x.maj = Date.now(); bc().objets = (bc().objets || []).filter(y => y.id !== o.id); saveNow(); persoModifie(x); };
      if (enLigne()) rpc('coffre_prendre', { p_id: x.id, p_code: codePour(x), p_objet_id: o.id })
        .then(obj => { ajouter(obj); toast(`${o.nom} est dans l'inventaire de ${x.nom}`); return actualiser(); })
        .then(render).catch(e => { alert('Impossible : ' + e.message); actualiser().then(render); });
      else { ajouter(o); journalLocal(x.nom, 'prend ' + (o.nom || 'un objet'), {}); saveNow(); render(); }
      break;
    }
    case 'bc-deposer':
    case 'bc-prendre': {
      state.bcOuvert = true;
      const x = findPerso($('#bc-perso').value);
      const pieces = lirePieces('bc');
      if (!bourseEnPc(pieces)) { toast('Indique un montant'); break; }
      const delta = a === 'bc-deposer' ? pieces : Object.fromEntries(Object.entries(pieces).map(([k, v]) => [k, String(-num(v))]));
      if (enLigne() && pnjComplet(x)) {
        const moins = Object.fromEntries(Object.entries(delta).map(([k, v]) => [k, String(-num(v))]));
        try { bourseLocalePlus(x.argent, moins); } catch (e) { alert(e.message); break; }
        rpc('bourse_modifier', { p_code: db.codeMJ, p_delta: delta, p_motif: `${a === 'bc-deposer' ? 'dépôt' : 'retrait'} de ${x.nom}` })
          .then(() => { x.argent = bourseLocalePlus(x.argent, moins); saveNow(); persoModifie(x); toast(a === 'bc-deposer' ? 'Déposé dans le coffre commun' : 'Pris dans le coffre commun'); return actualiser(); })
          .catch(e => alert('Impossible : ' + e.message));
      } else if (enLigne()) {
        rpc('bourse_transfert', { p_id: x.id, p_code: codePour(x), p_delta: delta })
          .then(() => { toast(a === 'bc-deposer' ? 'Déposé dans le coffre commun' : 'Pris dans le coffre commun'); return actualiser(); })
          .catch(e => alert('Impossible : ' + e.message));
      } else {
        try {
          const moins = Object.fromEntries(Object.entries(delta).map(([k, v]) => [k, String(-num(v))]));
          x.argent = bourseLocalePlus(x.argent, moins); bc().bourse = bourseLocalePlus(bc().bourse, delta);
          journalLocal(x.nom, a === 'bc-deposer' ? 'dépôt' : 'retrait', delta); saveNow(); render();
        } catch (e) { alert(e.message); }
      }
      break;
    }
    case 'bc-porteur': {
      state.bcOuvert = true;
      const porteur = $('#bc-porteur').value, x = findPerso($('#bc-perso').value);
      if (enLigne()) rpc('bourse_porteur', { p_id: x.id, p_code: codePour(x), p_porteur: porteur }).then(() => { bc().porteur_id = porteur; saveNow(); render(); toast('Coffre confié'); }).catch(e => alert('Impossible : ' + e.message));
      else { bc().porteur_id = porteur; saveNow(); render(); }
      break;
    }
    case 'mj-argent': {
      const cible = $('#argent-cible').value, pieces = lirePieces('mjp');
      if (!Object.values(pieces).some(v => num(v))) { toast('Indique un montant'); break; }
      const fini = () => { toast('Pièces données'); actualiser(); render(); };
      if (enLigne()) {
        const cx = findPerso(cible);
        if (cx && pnjComplet(cx)) {
          try { cx.argent = bourseLocalePlus(cx.argent, pieces); saveNow(); persoModifie(cx); fini(); } catch (e) { alert(e.message); }
          break;
        }
        (cible === '__commune__' ? rpc('bourse_modifier', { p_code: db.codeMJ, p_delta: pieces, p_motif: 'don du MJ' }) : rpc('mj_donner_argent', { p_code: db.codeMJ, p_id: cible, p_delta: pieces }))
          .then(fini).catch(e => alert('Impossible : ' + e.message));
      } else {
        try {
          if (cible === '__commune__') { bc().bourse = bourseLocalePlus(bc().bourse, pieces); journalLocal('MJ', 'don du MJ', pieces); }
          else { const x = findPerso(cible); x.argent = bourseLocalePlus(x.argent, pieces); }
          saveNow(); fini();
        } catch (e) { alert(e.message); }
      }
      break;
    }
    case 'mj-vers-marche': {
      const i = Number(b.dataset.i), obj = mjd().objets[i];
      const { type, source, qte, valeur, valeurUnite, detenteur, ...reste } = obj;
      const article = { ...reste, id: uid(), prix: valeur || '0', unite: valeurUnite || 'po', stock: qte || '1', vendeur: detenteur || '', aVendre: false, marcheId: obj.marcheId || listeMarches()[0].id };
      const fini = () => { db.marche = [...(db.marche || []), article]; mjd().objets.splice(i, 1); saveMJ('objets'); render(); toast('Envoyé au marché : coche « À vendre » quand tu veux l\'ouvrir aux joueurs'); };
      if (enLigne()) rpc('mj_marche_sauver', { p_code: db.codeMJ, p_id: article.id, p_data: article }).then(fini).catch(e => alert('Impossible : ' + e.message));
      else fini();
      break;
    }
    case 'marche-retirer': {
      const art = (db.marche || []).find(x => x.id === b.dataset.id);
      if (!art || !confirm(`Retirer « ${art.nom} » du marché ? Il revient dans tes objets en attente.`)) break;
      const { aVendre, stock, prix, unite, vendeur, ...reste } = art;
      const fini = () => { db.marche = db.marche.filter(x => x.id !== art.id); mjd().objets.push({ ...reste, id: uid(), type: 'vente', qte: stock, valeur: prix, valeurUnite: unite, detenteur: vendeur }); saveMJ('objets'); render(); };
      if (enLigne()) rpc('mj_marche_suppr', { p_code: db.codeMJ, p_id: art.id }).then(fini).catch(e => alert('Impossible : ' + e.message));
      else fini();
      break;
    }
    case 'acheter': {
      const art = (db.marche || []).find(x => x.id === b.dataset.id);
      const qte = Math.max(1, Math.round(num($('#qte-' + art.id).value)));
      const [pid, commune] = $('#payeur-' + art.id).value.split('|');
      const x = findPerso(pid);
      const total = Math.round(nombre(art.prix) * (MULT_PC[art.unite || 'po'] || 100)) * qte;
      if (!confirm(`Acheter ${qte} × ${art.nom} pour ${prixTxt(total / 100, 'po')} avec ${commune === '1' ? 'le coffre commun' : 'la bourse de ' + x.nom} ?`)) break;
      b.disabled = true;
      if (enLigne() && pnjComplet(x)) {
        (async () => {
          if (num(art.stock) < qte) throw new Error(`Stock insuffisant (il en reste ${num(art.stock)})`);
          if (commune === '1') await rpc('bourse_modifier', { p_code: db.codeMJ, p_delta: { pc: String(-total) }, p_motif: `achat : ${art.nom} × ${qte} (${x.nom})` });
          else x.argent = bourseLocalePlus(x.argent, { pc: -total });
          const { aVendre, stock, prix: px, unite, vendeur, type, ...obj } = art;
          x.equipement = [...(x.equipement || []), { ...obj, id: uid(), qte: String(qte), valeur: px, valeurUnite: unite || 'po' }];
          art.stock = String(num(art.stock) - qte);
          await rpc('mj_marche_sauver', { p_code: db.codeMJ, p_id: art.id, p_data: art });
          saveNow(); persoModifie(x); toast(`${art.nom} acheté !`); await actualiser(); render();
        })().catch(e => { b.disabled = false; alert('Achat impossible : ' + e.message); });
      } else if (enLigne()) {
        rpc('acheter', { p_id: x.id, p_code: codePour(x), p_article: art.id, p_qte: qte, p_commune: commune === '1' })
          .then(() => { toast(`${art.nom} acheté !`); return actualiser(); })
          .catch(e => { b.disabled = false; alert('Achat impossible : ' + e.message); });
      } else {
        try { acheterLocal(art, x, qte, commune === '1'); saveNow(); render(); toast(`${art.nom} acheté !`); }
        catch (e) { b.disabled = false; alert('Achat impossible : ' + e.message); }
      }
      break;
    }
    case 'img-zoom': {
      const d = document.createElement('div');
      d.className = 'zoom';
      d.innerHTML = `<img src="${b.dataset.src}" alt=""><button class="zoom-fermer" aria-label="Fermer">✕</button>`;
      d.addEventListener('click', () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); d.remove(); });
      document.body.appendChild(d);
      if (b.dataset.plein && d.requestFullscreen) d.requestFullscreen().catch(() => {});
      break;
    }
    case 'mj-session-ajout': {
      const n = Math.max(0, ...sessionsMJ().map(x => num(x.numero)), ...recapsTous().map(r => num(r.numero))) + 1;
      const ss = { id: uid(), numero: n, titre: '', date: '', resume: '', etapes: [] };
      mjd()[cleSession(ss.id)] = ss; saveMJ(cleSession(ss.id));
      state.mjSession = ss.id; state.mjSessionMode = 'prep'; render(); window.scrollTo(0, 0);
      break;
    }
    case 'mj-session-ouvrir':
      state.mjSession = b.dataset.id; state.mjSessionMode = 'jeu'; render(); window.scrollTo(0, 0);
      break;
    case 'mj-session-fermer':
      state.mjSession = null; render(); window.scrollTo(0, 0);
      break;
    case 'mj-session-mode':
      state.mjSessionMode = b.dataset.mode; render();
      break;
    case 'mj-session-suppr': {
      const ss = sessionMJ(b.dataset.id);
      if (!ss || !confirm(`Supprimer la session ${ss.numero} et tout son scénario ?`)) break;
      delete mjd()[cleSession(ss.id)]; saveNow();
      if (enLigne()) rpc('mj_supprimer_cle', { p_code: db.codeMJ, p_cle: cleSession(ss.id) }).catch(e => alert('Suppression en ligne impossible (base en v8 ?) : ' + e.message));
      state.mjSession = null; render();
      break;
    }
    case 'mj-etape-ajout': {
      const ss = sessionMJ(b.dataset.s);
      ss.etapes = [...(ss.etapes || []), { id: uid(), type: b.dataset.type, titre: '', texte: '', xp: '', objets: [] }];
      saveMJ(cleSession(ss.id)); render();
      setTimeout(() => { const l = document.querySelectorAll('.etape.en-edition'); l[l.length - 1]?.scrollIntoView({ block: 'center' }); l[l.length - 1]?.querySelector('input')?.focus(); }, 60);
      break;
    }
    case 'mj-etape-monter':
    case 'mj-etape-descendre': {
      const ss = sessionMJ(b.dataset.s), i = Number(b.dataset.i), j = a === 'mj-etape-monter' ? i - 1 : i + 1;
      if (j < 0 || j >= ss.etapes.length) break;
      [ss.etapes[i], ss.etapes[j]] = [ss.etapes[j], ss.etapes[i]];
      saveMJ(cleSession(ss.id)); render();
      break;
    }
    case 'mj-etape-suppr': {
      const ss = sessionMJ(b.dataset.s);
      if (confirm('Supprimer cette étape ?')) { ss.etapes.splice(Number(b.dataset.i), 1); saveMJ(cleSession(ss.id)); render(); }
      break;
    }
    case 'mj-etape-objet': {
      const ss = sessionMJ(b.dataset.s), et = ss.etapes[Number(b.dataset.i)];
      const l = new Set(et.objets || []);
      if (b.checked) l.add(b.dataset.o); else l.delete(b.dataset.o);
      et.objets = [...l]; saveMJ(cleSession(ss.id));
      break;
    }
    case 'mj-etape-image-suppr': {
      const ss = sessionMJ(b.dataset.s); delete ss.etapes[Number(b.dataset.i)].image; saveMJ(cleSession(ss.id)); render();
      break;
    }
    case 'mj-etape-xp': {
      const ss = sessionMJ(b.dataset.s), et = ss.etapes[Number(b.dataset.i)], m = mjd();
      const v = num(et.xp);
      m.xp = { valeur: Math.max(0, num(m.xp.valeur) + (et.xpDonne ? -v : v)) };
      et.xpDonne = !et.xpDonne;
      saveMJ('xp'); saveMJ(cleSession(ss.id)); render();
      toast(et.xpDonne ? `+${v} XP pour le groupe` : `${v} XP retirés`);
      break;
    }
    case 'mj-etape-combat': {
      const c = mjd().combats.find(x => x.id === b.dataset.id);
      if (!c) break;
      if (mjd().combat && !confirm('Un combat est déjà en cours. Le remplacer ?')) break;
      lancerCombat(c); publierCombat(); state.mjOnglet = 'combat'; render(); window.scrollTo(0, 0);
      break;
    }
    case 'inv-cat':
      state.invCat = b.dataset.c; render();
      break;
    case 'ajust-effacer':
      if (confirm('Effacer les anciens ajustements manuels ?')) { p.ajust = {}; save(); render(); }
      break;
    case 'attaques-effacer':
      p.attaques = ''; save(); render();
      break;
    case 'mj-tiroir':
      state.mjTiroir = b.dataset.id; render();
      break;
    case 'mj-tiroir-fermer':
      state.mjTiroir = null; render();
      break;
    case 'pp-ajout': {
      if (!peutModifierClasses()) { alert('Associe un de tes personnages à cet appareil (avec son code) pour saisir une classe commune.'); break; }
      const d = { id: uid(), nom: '', dv: 8, bba: 'moyen', pc: 2, max: 10, comp: [], aptitudes: [] };
      classesCommunes().push(d); state.editPrestige = d.id; sauverClasse(d); render();
      break;
    }
    case 'pp-edit':
      state.editPrestige = b.dataset.id; render();
      break;
    case 'pp-fin':
      state.editPrestige = null; saveNow(); if (enLigne()) envoyerClasses(); render();
      break;
    case 'pp-suppr': {
      const d = classesCommunes()[Number(b.dataset.i)];
      const qui = db.personnages.filter(x => (x.progression || []).some(l => l.classe === 'pp-' + d.id)).map(x => x.nom);
      if (qui.length) { alert(`Des niveaux utilisent encore cette classe (${qui.join(', ')}) : change-les d'abord.`); break; }
      if (confirm('Supprimer cette classe de prestige pour toute la campagne ?')) {
        db.classesPerso = classesCommunes().filter(x => x.id !== d.id); delete R.CLASSES['pp-' + d.id];
        state.editPrestige = null; sauverClasse(d); render();
      }
      break;
    }
    case 'pp-comp': {
      const d = classesCommunes()[Number(b.dataset.i)];
      const l = new Set(d.comp || []); if (b.checked) l.add(b.dataset.c); else l.delete(b.dataset.c);
      d.comp = [...l]; sauverClasse(d);
      break;
    }
    case 'pp-apt-ajout': {
      const d = classesCommunes()[Number(b.dataset.i)]; d.aptitudes = [...(d.aptitudes || []), { niv: '', nom: '', texte: '' }]; sauverClasse(d); render();
      break;
    }
    case 'pp-res-ajout': {
      const d = classesCommunes()[Number(b.dataset.i)]; d.ressources = [...(d.ressources || []), { nom: '', paliers: '', action: '', texte: '' }]; sauverClasse(d); render();
      break;
    }
    case 'pp-res-suppr': {
      const d = classesCommunes()[Number(b.dataset.i)]; d.ressources.splice(Number(b.dataset.j), 1); sauverClasse(d); render();
      break;
    }
    case 'pp-apt-suppr': {
      const d = classesCommunes()[Number(b.dataset.i)]; d.aptitudes.splice(Number(b.dataset.j), 1); sauverClasse(d); render();
      break;
    }
    case 'prog-sort-ajout': {
      const l = p.progression[Number(b.dataset.i)];
      l.sortsAppris = [...(l.sortsAppris || []), { id: b.dataset.id, bloc: b.dataset.bloc }];
      if (!(p.sorts || []).some(x => x.id === b.dataset.id)) p.sorts = [...(p.sorts || []), { id: b.dataset.id, statut: 'Connu', notes: `Appris au niveau ${l.niveau}` }];
      save(); render(); toast(`${findSort(b.dataset.id)?.nom || 'Sort'} appris`);
      break;
    }
    case 'prog-sort-suppr': {
      const l = p.progression[Number(b.dataset.i)];
      l.sortsAppris = (l.sortsAppris || []).filter(x => x.id !== b.dataset.id);
      p.sorts = (p.sorts || []).filter(x => !(x.id === b.dataset.id && x.notes === `Appris au niveau ${l.niveau}`));
      save(); render();
      break;
    }
    case 'prog-sorts-zero': {
      const deja = new Set((p.sorts || []).map(x => x.id));
      const interdites = new Set(p.ecolesInterdites || []);
      const nv = sortsDeClasse(b.dataset.abr, 0, 0).filter(x => !deja.has(x.id) && !interdites.has(x.ecole)).map(x => ({ id: x.id, statut: 'Connu', notes: 'Grimoire (niveau 0)' }));
      p.sorts = [...(p.sorts || []), ...nv]; save(); render(); toast(`${nv.length} sorts de niveau 0 ajoutés`);
      break;
    }
    case 'ecole-interdite': {
      const l = new Set(p.ecolesInterdites || []);
      if (l.has(b.dataset.e)) l.delete(b.dataset.e); else l.add(b.dataset.e);
      p.ecolesInterdites = [...l]; save(); render();
      break;
    }
    case 'mj-cb-effet': {
      const c = mjd().combat, x = c.combattants[Number(b.dataset.i)];
      const nom = prompt(`Effet sur ${x.nom} (ex. Lenteur, Bénédiction) :`, '');
      if (!nom) break;
      const r = Math.round(num(prompt('Durée en rounds :', '3')));
      if (!r) break;
      const nefaste = confirm(`« ${nom} » est-il un effet néfaste pour ${x.nom} (affaiblissement) ?\nOK = néfaste, Annuler = bénéfique`);
      x.effets = [...(x.effets || []), { id: uid(), nom, rounds: r, debut: c.round, type: nefaste ? 'debuff' : 'buff' }];
      saveMJ('combat'); publierCombat(); render();
      break;
    }
    case 'focal-tous': {
      const f = $('#focal-tous').value;
      (p.sorts || []).forEach(x => { if (!x.focal) x.focal = f; });
      save(); render(); toast('Sorts reliés');
      break;
    }
    case 'marche-image':
      if (!estMJ()) break;
      state.imgType = 'marche'; state.imgObjet = b.dataset.id;
      $('#imginput').value = ''; $('#imginput').click();
      break;
    case 'marche-choisir':
      state.marcheSel = b.dataset.id; state.achatOuvert = null; render(); window.scrollTo(0, 0);
      break;
    case 'achat-ouvrir':
      state.achatOuvert = b.dataset.id; render();
      break;
    case 'marche-ajout': {
      if (!estMJ()) break;
      const m = { id: 'm-' + uid(), kind: 'marche', nom: 'Nouveau marché', type: 'ville', image: 'images/marche-ville.jpg', ouvert: false, ordre: listeMarches().length + 1 };
      sauverMarcheDef(m); render(); toast('Marché créé (fermé aux joueurs pour l\'instant)');
      break;
    }
    case 'marche-suppr': {
      if (!estMJ()) break;
      const m = listeMarches().find(x => x.id === b.dataset.id);
      const n = (db.marche || []).filter(a => marcheDe(a).id === m.id).length;
      if (listeMarches().length <= 1) { alert('Il faut garder au moins un marché.'); break; }
      if (!confirm(`Supprimer « ${m.nom} » ?${n ? ` Ses ${n} article(s) passeront dans le premier marché restant.` : ''}`)) break;
      supprimerMarcheDef(m.id); render();
      break;
    }
    case 'mj-quete-nouvelle': {
      const nom = prompt('Nom de la nouvelle quête :', '');
      if (!nom) break;
      const f = { id: uid(), nom, type: 'quete', role: 'Quête', lieu: '', statut: 'En cours', alias: '', description: '', maj: Date.now() };
      db.fiches = [...(db.fiches || []), f];
      const ss = sessionMJ(b.dataset.s); ss.etapes[Number(b.dataset.i)].queteId = f.id;
      saveMJ(cleSession(ss.id)); saveNow(); render();
      publierFiche(f).then(render).catch(e2 => toast('Quête enregistrée sur cet appareil (publication : ' + e2.message + ')'));
      toast(`Quête « ${nom} » créée`);
      break;
    }
    case 'mj-quete-statut': {
      const f = ficheLocale(b.dataset.id);
      if (!f) break;
      f.statut = b.dataset.statut; saveNow(); render();
      publierFiche(f).then(() => { toast(`${f.nom} : ${f.statut}`); render(); }).catch(e2 => alert('Impossible : ' + e2.message));
      break;
    }
    case 'ecran-image': {
      const et = sessionMJ(b.dataset.s)?.etapes[Number(b.dataset.i)];
      if (et?.image) afficherSurEcran(et.image);
      break;
    }
    case 'ambiance-ajout': {
      if (!estMJ()) break;
      sauverAmbiance({ id: 'amb-' + uid(), kind: 'ambiance', nom: 'Nouvelle ambiance', toileA: '#EDE6D6', toileB: '#7A4E9C', sombre: false }); render();
      break;
    }
    case 'ambiance-suppr': {
      if (!estMJ()) break;
      const a = ambiancesPerso().find(x => x.id === b.dataset.id);
      if (!a || !confirm(`Supprimer l'ambiance « ${a.nom} » ? Les marchés qui l'utilisent repasseront en « Marché en ville ».`)) break;
      db.ambiances = ambiancesPerso().filter(x => x.id !== a.id);
      for (const m of listeMarches().filter(x => x.type === a.id)) { const m2 = { ...m, type: 'ville' }; delete m2._envoye; sauverMarcheDef(m2); }
      saveNow(); if (enLigne()) rpc('mj_marche_suppr', { p_code: db.codeMJ, p_id: a.id }).catch(() => {});
      render();
      break;
    }
    case 'ajout-rapide-voir': {
      const c = b.dataset.cible;
      state.ajoutRapide = { cible: c, texte: $('#ajout-rapide-' + c).value };
      render();
      break;
    }
    case 'ajout-rapide-ok': {
      const c = b.dataset.cible;
      if (c === 'mj' && !estMJ()) break;
      if (c === 'perso' && (!peutModifier(p) || !estMJ())) break;
      const n = ajouterObjetsRapides(c);
      state.ajoutRapide = null; render();
      toast(`${n} objet${n > 1 ? 's' : ''} ajouté${n > 1 ? 's' : ''}`);
      break;
    }
    case 'ajout-rapide-modele':
      telechargerModeleObjets(b.dataset.cible);
      break;
    case 'best-ouvrir':
      state.bestOuvert = state.bestOuvert === b.dataset.id ? null : b.dataset.id;
      $('#best-res').innerHTML = resultatsBestiaire();
      break;
    case 'best-tout':
      state.bestTout = true; $('#best-res').innerHTML = resultatsBestiaire();
      break;
    case 'best-pnj': {
      const c = BESTIAIRE.creatures.find(x => x.id === b.dataset.id);
      mjd().pnj.push(pnjDepuisCreature(c)); saveMJ('pnj');
      toast(`${c.nom} ajouté aux PNJ préparés`); render();
      break;
    }
    case 'best-combat': {
      const c = BESTIAIRE.creatures.find(x => x.id === b.dataset.id);
      const cb = mjd().combats.find(x => x.id === $('#best-combat-' + c.id).value);
      const n = Math.max(1, Math.round(num($('#best-nb-' + c.id).value)) || 1);
      let pnj = mjd().pnj.find(x => x.source === c.id && x.nom === c.nom);
      if (!pnj) { pnj = pnjDepuisCreature(c); mjd().pnj.push(pnj); saveMJ('pnj'); }
      cb.participants = cb.participants || [];
      const part = cb.participants.find(y => y.pnjId === pnj.id);
      if (part) part.nombre = String(num(part.nombre) + n); else cb.participants.push({ pnjId: pnj.id, nombre: String(n) });
      saveMJ('combats'); toast(`${n} × ${c.nom} → ${cb.nom}`); render();
      break;
    }
    case 'apt-onglet':
      state.aptOnglet = b.dataset.o; render();
      break;
    case 'journal-actualiser':
      state.journal = null; render();
      break;
    case 'journal-filtre':
      state.journalPerso = b.dataset.n; render();
      break;
    case 'gen-pnj': {
      const g = state.gen, r = genererPNJ(g.modele, g.niveau, g.race);
      mjd().pnj.push(pnjDepuisGen(r, g.nom)); saveMJ('pnj');
      toast(`${g.nom || r.modele.nom} ajouté aux PNJ préparés`); render();
      break;
    }
    case 'gen-combat': {
      const g = state.gen, r = genererPNJ(g.modele, g.niveau, g.race);
      const cb = mjd().combats.find(x => x.id === $('#gen-combat').value);
      const n = Math.max(1, Math.round(num($('#gen-nb').value)) || 1);
      const pnj = pnjDepuisGen(r, g.nom); pnj.camp = 'ennemi';
      mjd().pnj.push(pnj); saveMJ('pnj');
      cb.participants = [...(cb.participants || []), { pnjId: pnj.id, nombre: String(n) }];
      saveMJ('combats'); toast(`${n} × ${pnj.nom} → ${cb.nom}`); render();
      break;
    }
    case 'histo-voir': {
      const cle = state.histoCle || 'objets';
      state.histoOuvert = true;
      rpc('mj_historique_lire', { p_code: db.codeMJ, p_cle: cle })
        .then(l => { state.histo = { cle, liste: l || [] }; render(); })
        .catch(e => alert('Historique indisponible (la base est-elle en v13 ?) : ' + e.message));
      break;
    }
    case 'histo-restaurer': {
      if (!confirm('Restaurer cette version ? La version actuelle restera dans l\'historique, tu pourras y revenir.')) break;
      rpc('mj_historique_restaurer', { p_code: db.codeMJ, p_id: Number(b.dataset.id) })
        .then(r => { mjd()[r.cle] = r.data; saveNow(); if (db.versions) delete db.versions.mj; state.histo = null; toast('Version restaurée'); render(); })
        .catch(e => alert('Restauration impossible : ' + e.message));
      break;
    }
    case 'mj-sauvegarde':
      download(`sauvegarde-mj-${new Date().toISOString().slice(0, 10)}.json`, { type: 'mj', version: APP_VERSION, date: new Date().toISOString(), mjData: mjd() });
      break;
    case 'mj-import-sauvegarde':
      $('#mj-import-fichier').value = ''; $('#mj-import-fichier').click();
      break;
    case 'mj-niveau-valider': {
      const x = findPerso(b.dataset.id);
      const nv = x && validerNiveau(x);
      if (nv) { toast(`${x.nom} passe au niveau ${nv} !`); render(); }
      break;
    }
    case 'mj-niveau-tous': {
      const n = niveauXP(num(mjd().xp.valeur));
      const l = db.personnages.filter(x => !x._public && estMembre(x) && (x.progression || []).filter(y => y.atteint).length < n && (x.progression || []).find(y => !y.atteint)?.pret).map(x => [x, validerNiveau(x)]).filter(([, v]) => v);
      toast(l.map(([x, v]) => `${x.nom} : niveau ${v}`).join(' · ')); render();
      break;
    }
    case 'am-ajout': {
      const am = { id: uid(), cible: 'caParade', val: b.dataset.malus ? '-1' : '', note: '', permanent: '' };
      if (estMJ() && enLigne()) am.parMJ = true;
      p.ameliorations = [...(p.ameliorations || []), am];
      if (estMJ() && enLigne()) { p.mjChamps = { ...(p.mjChamps || {}), ameliorations: Date.now() }; p.mjMaj = Date.now(); }
      save(); render();
      break;
    }
    case 'am-suppr': {
      const am = p.ameliorations[idx];
      if (am?.parMJ && enLigne() && !estMJ()) { toast('Seul le MJ peut retirer ce bonus ou malus.'); break; }
      p.ameliorations.splice(idx, 1);
      if (estMJ() && enLigne()) { p.mjChamps = { ...(p.mjChamps || {}), ameliorations: Date.now() }; p.mjMaj = Date.now(); }
      save(); render();
      break;
    }
    case 'ajout-pnj-voir':
      state.ajoutPNJ = $('#ajout-pnj').value; render();
      break;
    case 'ajout-pnj-ok': {
      if (!estMJ()) break;
      const l = analyserPNJ(state.ajoutPNJ).pnj;
      mjd().pnj.push(...l); saveMJ('pnj'); state.ajoutPNJ = null; render();
      toast(`${l.length} PNJ ajouté${l.length > 1 ? 's' : ''}`);
      break;
    }
    case 'ajout-pnj-modele': {
      const csv = '\ufeff' + [COLONNES_PNJ.map(c => c[1]), ['Garde de Westgate', 'ennemi', '11', '15', '1', 'Épée longue +3 corps à corps (1d8+1)', 'For 13, Dex 11, Con 12, Int 10, Sag 11, Cha 9', 'Alerte au moindre bruit', '1', '4'], ['Grosse Berta', 'neutre', '6', '10', '0', 'Gourdin +0 (1d6)', '', 'Marchande de Westgate', '½', '1']].map(l => l.join(';')).join('\r\n');
      const a2 = document.createElement('a'); a2.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' })); a2.download = 'modele-pnj.csv';
      document.body.appendChild(a2); a2.click(); setTimeout(() => { URL.revokeObjectURL(a2.href); a2.remove(); }, 1000);
      break;
    }
    case 'arme-ordre': {
      const ids = [...document.querySelectorAll('.armes [data-carte]')].map(x => x.dataset.carte);
      const i = ids.indexOf(b.dataset.id), j = i + Number(b.dataset.sens);
      if (i < 0 || j < 0 || j >= ids.length) break;
      [ids[i], ids[j]] = [ids[j], ids[i]];
      p.ordreArmes = ids; save(); render();
      break;
    }
    case 'replis-tout': {
      const ouvrir = b.dataset.ouvrir === '1';
      document.querySelectorAll('details[data-section]').forEach(d => { d.open = ouvrir; });
      break;
    }
    case 'img-choisir':
      state.imgType = b.dataset.type;
      state.imgObjet = b.dataset.id || null;
      $('#imginput').value = '';
      $('#imginput').click();
      break;
    case 'img-retirer':
      if (b.dataset.type === 'objet') { const it = (p.equipement || []).find(x => x.id === b.dataset.id); if (it) { delete it.image; save(); render(); } break; }
      if (b.dataset.type === 'mjobjet') { const it = mjd().objets.find(x => x.id === b.dataset.id); if (it) { delete it.image; saveMJ('objets'); render(); } break; }
      if (b.dataset.type === 'baguette') { if (confirm('Retirer la photo de la baguette ?')) { p.baguette.photo = ''; saveNow(); persoModifie(p); render(); } break; }
      if (confirm(b.dataset.type === 'portrait' ? 'Retirer le portrait ?' : 'Retirer l\'emblème ?')) { p[b.dataset.type] = ''; saveNow(); persoModifie(p); render(); }
      break;
    case 'toggle-langue': {
      const l = b.dataset.l;
      p.langues = p.langues || [];
      p.langues = p.langues.includes(l) ? p.langues.filter(x => x !== l) : [...p.langues, l];
      save(); render();
      break;
    }
    case 'add-don-supp': {
      const v = $('#don-supp').value;
      if (!v) { toast('Choisis un don dans la liste'); break; }
      p.donsSupp = [...(p.donsSupp || []), v]; save(); render();
      break;
    }
    case 'del-don-supp':
      p.donsSupp.splice(idx, 1); save(); render();
      break;
    case 'import':
      $('#fileinput').value = '';
      $('#fileinput').click();
      break;
  }
});


/* ---------- Import / export ---------- */
function download(name, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  toast('Fichier exporté : ' + name);
}

$('#fileinput').addEventListener('change', async ev => {
  const file = ev.target.files[0];
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const persos = data.type === 'personnage' ? [data.personnage] : data.type === 'campagne' ? data.personnages || [] : [];
    const sorts = data.sorts || [];
    const sessions = data.type === 'campagne' ? data.sessions || [] : [];
    const recapsImp = ['recaps', 'campagne', 'encyclopedie'].includes(data.type) ? data.recaps || [] : [];
    const fichesImp = ['campagne', 'encyclopedie'].includes(data.type) ? data.fiches || [] : [];
    if (!persos.length && !sorts.length && !sessions.length && !recapsImp.length && !fichesImp.length) throw new Error('ce fichier ne vient pas du Codex de campagne');

    const remplaces = persos.filter(p => findPerso(p.id)).map(p => p.nom);
    if (remplaces.length && !confirm(`Ces personnages existent déjà et seront remplacés par la version importée :\n${remplaces.join(', ')}\n\nContinuer ?`)) return;

    for (const p of persos) {
      migrer(p);
      delete p.publie;
      const i = db.personnages.findIndex(x => x.id === p.id);
      if (i >= 0) db.personnages[i] = p; else db.personnages.push(p);
    }
    let recapsMaj = 0;
    db.recaps = db.recaps || [];
    for (const r of recapsImp) {
      if (!findRecap(r.id)) {
        const vide = recapsTous().find(x => num(x.numero) === num(r.numero) && !String(x.texte || '').trim() && !String(x.titre || '').trim());
        if (vide) r.id = vide.id;
      }
      const cur = findRecap(r.id);
      if (cur && champsRecap(cur) === champsRecap(r)) continue;
      const i = db.recaps.findIndex(x => x.id === r.id);
      if (i >= 0) db.recaps[i] = r; else db.recaps.push(r);
      db.recapsSupprimes = (db.recapsSupprimes || []).filter(x => x !== r.id);
      recapsMaj++;
    }
    let fichesMaj = 0;
    db.fiches = db.fiches || [];
    for (const f of fichesImp) {
      const cur = findFiche(f.id);
      if (cur && champsFiche(cur) === champsFiche(f)) continue;
      const i = db.fiches.findIndex(x => x.id === f.id);
      if (i >= 0) db.fiches[i] = f; else db.fiches.push(f);
      db.fichesSupprimees = (db.fichesSupprimees || []).filter(x => x !== f.id);
      fichesMaj++;
    }
    migrerSessions(sessions);
    let nouvellesSessions = 0;
    db.sessions = db.sessions || [];
    for (const se of sessions) {
      const i = db.sessions.findIndex(x => x.id === se.id);
      if (i < 0) { db.sessions.push(se); nouvellesSessions++; }
      else if ((se.maj || 0) > (db.sessions[i].maj || 0)) db.sessions[i] = se;
    }
    let nouveauxSorts = 0;
    for (const s of sorts) {
      const i = db.sorts.findIndex(x => x.id === s.id);
      if (i >= 0) db.sorts[i] = s; else { db.sorts.push(s); nouveauxSorts++; }
    }
    saveNow();
    toast(`Import terminé : ${persos.length} personnage(s), ${nouvellesSessions} session(s) de notes, ${recapsMaj} récapitulatif(s), ${fichesMaj} fiche(s), ${nouveauxSorts} nouveau(x) sort(s)`);
    go(persos.length === 1 ? `#/perso/${persos[0].id}/fiche` : persos.length ? '#/persos' : fichesImp.length ? '#/encyclo' : recapsImp.length ? '#/recaps' : sessions.length ? '#/notes' : '#/sorts');
  } catch (e) {
    alert('Import impossible : ' + e.message);
  }
});

/* ---------- Images (portrait et emblème) ---------- */
async function reduireImage(file, max, type) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    await new Promise((ok, ko) => { img.onload = ok; img.onerror = () => ko(new Error('format d\'image non reconnu')); img.src = url; });
    const r = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * r); c.height = Math.round(img.height * r);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    let data = c.toDataURL(type, 0.85);
    if (!data.startsWith('data:' + type)) data = c.toDataURL('image/png');
    return data;
  } finally {
    URL.revokeObjectURL(url);
  }
}
/* Import d'une sauvegarde du MJ : un fichier « sauvegarde-mj », ou une copie brute des données d'un appareil.
   Les listes sont fusionnées (rien n'est supprimé) et envoyées dans la base. */
document.addEventListener('change', async ev => {
  if (ev.target.id !== 'mj-import-fichier' || !ev.target.files[0] || !estMJ()) return;
  try {
    let txt = await ev.target.files[0].text();
    txt = txt.trim().replace(/^"|"$/g, '');
    let o; try { o = JSON.parse(txt); } catch (e) { o = JSON.parse(JSON.parse('"' + txt + '"')); }
    if (typeof o === 'string') o = JSON.parse(o);
    const src = o.mjData || (o.type === 'mj' ? o.mjData : null);
    if (!src) throw new Error('aucune donnée du MJ dans ce fichier');
    const m = mjd(); const bilan = [];
    for (const [k, v] of Object.entries(src)) {
      if (Array.isArray(v)) {
        const cur = Array.isArray(m[k]) ? m[k] : [];
        const ids = new Set(cur.map(x => x && x.id));
        const ajout = v.filter(x => x && !ids.has(x.id));
        if (ajout.length) { m[k] = [...cur, ...ajout]; saveMJ(k); bilan.push(`${ajout.length} dans « ${k} »`); }
      } else if (k.startsWith('session:') && !m[k]) { m[k] = v; saveMJ(k); bilan.push(`session ${v.numero || ''}`); }
    }
    render();
    alert(bilan.length ? `Récupéré : ${bilan.join(', ')}.` : 'Rien de nouveau dans ce fichier : tout y était déjà.');
  } catch (e) { alert('Import impossible : ' + e.message); }
});

$('#imginput').addEventListener('change', async ev => {
  const file = ev.target.files[0];
  const p = state.ctx;
  if (!file || !state.imgType) return;
  /* Images d'objets : petites vignettes (256 px) pour garder les fiches légères */
  if (state.imgType === 'marche') {
    const m = { ...listeMarches().find(x => x.id === state.imgObjet) };
    if (m.id) { m.image = await reduireImage(file, 1280, 'image/jpeg'); delete m._envoye; sauverMarcheDef(m); render(); toast('Image du marché changée'); }
    return;
  }
  if (state.imgType === 'sessionimg') {
    const ss = sessionMJ(state.mjSession);
    const et = ss && (ss.etapes || []).find(x => x.id === state.imgObjet);
    if (et) { et.image = await reduireImage(file, 1024, 'image/jpeg'); saveMJ(cleSession(ss.id)); render(); toast('Illustration ajoutée'); }
    return;
  }
  if (state.imgType === 'mjobjet') {
    const it = mjd().objets.find(x => x.id === state.imgObjet);
    if (it) { it.image = await reduireImage(file, 256, 'image/webp'); saveMJ('objets'); render(); toast('Image ajoutée'); }
    return;
  }
  if (!p) return;
  if (state.imgType === 'objet') {
    const it = (p.equipement || []).find(x => x.id === state.imgObjet);
    if (it) { it.image = await reduireImage(file, 256, 'image/webp'); p.maj = Date.now(); saveNow(); persoModifie(p); render(); toast('Image ajoutée'); }
    return;
  }
  try {
    if (state.imgType === 'baguette') {
      p.baguette = { ...(p.baguette || {}), photo: await reduireImage(file, 1280, 'image/jpeg') };
      p.maj = Date.now();
      saveNow(); persoModifie(p); render(); toast('Photo de la baguette ajoutée');
      return;
    }
    if (state.imgType === 'recap') {
      p.photo = await reduireImage(file, 1280, 'image/jpeg');
      p.photoMaj = Date.now();
      saveNow(); render(); toast('Photo ajoutée au récapitulatif');
      return;
    }
    const portrait = state.imgType === 'portrait';
    p[state.imgType] = await reduireImage(file, portrait ? 640 : 256, portrait ? 'image/jpeg' : 'image/webp');
    p.maj = Date.now();
    saveNow(); persoModifie(p); render();
    toast(portrait ? 'Portrait ajouté' : 'Emblème ajouté');
  } catch (e) {
    alert('Image impossible à charger : ' + e.message);
  }
});

/* ---------- Actualisation automatique (base en ligne) ----------
   Les fiches, récits, fiches d'encyclopédie et le conteur sont relus :
   au retour sur l'appli, toutes les minutes tant qu'elle est ouverte, et sur demande. */
let actualisationEnCours = false;
const enSaisie = () => {
  const a = document.activeElement;
  return a && (a.matches('input, textarea, select') || a.isContentEditable);
};
async function actualiser(manuel = false) {
  if (!enLigne() || actualisationEnCours) return;
  actualisationEnCours = true;
  if (manuel) statutSync('Actualisation…', true);
  try {
    await envoyerPersos();
    await Promise.all([chargerPersos(), chargerRecaps(), chargerFiches(), chargerInfos()]);
    await chargerPersosMJ();
    await chargerMJ();
    await chargerMarche();
    await chargerClasses();
    if (manuel) statutSync(state.syncErreur ? 'Hors ligne' : 'À jour');
    /* On ne redessine pas sous les doigts de quelqu'un qui est en train d'écrire */
    if (!enSaisie() && !state.editRecap && !state.editFiche && !state.editObjet && !state.editBaguette && !state.mjEdit) { state.renduDiffere = false; render(); }
    else state.renduDiffere = true;
  } finally {
    actualisationEnCours = false;
  }
}
/* Au retour sur l'appli (y compris sur iPhone, où le minuteur s'arrête en arrière-plan) */
let derniereActu = 0;
const actuRetour = () => { if (document.visibilityState === 'visible' && Date.now() - derniereActu > 5000) { derniereActu = Date.now(); actualiser(); } };
document.addEventListener('visibilitychange', actuRetour);
window.addEventListener('pageshow', actuRetour);
window.addEventListener('focus', actuRetour);
window.addEventListener('online', actuRetour);
/* Les nouveautés arrivées pendant une saisie s'affichent dès que la saisie est terminée */
document.addEventListener('focusout', () => setTimeout(() => {
  if (state.renduDiffere && !enSaisie() && !state.editRecap && !state.editFiche && !state.editObjet && !state.editBaguette && !state.mjEdit) { state.renduDiffere = false; render(); }
}, 400));
/* Toutes les 15 s dans l'espace MJ, 30 s sur une fiche, 60 s ailleurs */
let tic = 0;
setInterval(() => {
  if (document.visibilityState !== 'visible') return;
  tic++;
  const page = (location.hash.replace(/^#\/?/, '').split('/')[0]) || 'persos';
  if (page === 'mj' || (page === 'perso' && (combatPublic() || tic % 2 === 0)) || tic % 4 === 0) actualiser();
}, 15000);

/* ---------- Démarrage ---------- */
(async function start() {
  await load();
  db.personnages.forEach(migrer);
  migrerSessions(db.sessions);
  render();
  await Promise.all([initSorts(), chargerRecaps(), chargerPersos(), chargerInfos(), chargerFiches()]);
  await chargerPersosMJ();
  await chargerMJ();
  await chargerMarche();
  await chargerClasses();
  migrerClassesDesFiches();
  render();
  if (enLigne()) {
    await envoyerPersos();
    await chargerNotes();
    await envoyerNotes();
    render();
  }
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker :', e));
  }
  navigator.storage?.persist?.().catch(() => {});
})();
