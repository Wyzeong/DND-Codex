'use strict';

/* ============================================================
   Codex de campagne : fiches, grimoire et progression (D&D 3.5)
   Données stockées dans le navigateur (localStorage).
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

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) db = Object.assign(db, JSON.parse(raw));
  } catch (e) {
    console.error(e);
    toast('Lecture des données impossible : ' + e.message);
  }
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
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
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
  filtres: { q: '', ecole: '', classe: '', niveau: '' },
  draft: null,           // sort en cours d'édition
  pickQ: '',
  ouverts: new Set(),    // niveaux dépliés dans la progression
  fermes: new Set(),     // niveaux repliés volontairement
  imgType: null,
  jq: '',               // recherche dans le journal
  typeNote: 'note',     // type de la prochaine note
  editNote: null,       // note en cours de modification
  editRecap: null,      // récapitulatif en cours de modification
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
const LIST_TEMPLATES = {
  dons: () => ({ nom: '', description: '' }),
  capacites: () => ({ nom: '', description: '' }),
  equipement: () => ({ nom: '', qte: '', poids: '', notes: '' }),
};
function nouveauNiveau(n) {
  return { niveau: n, classe: '', atteint: false, don: '', donRace: '', donsBonus: [], augment: '', pv: '', choix: {}, notes: '' };
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
function etat(p, n, prevus = false, sauf = null) {
  const tous = [...(p.progression || [])].sort((a, b) => a.niveau - b.niveau);
  const lv = tous.filter(l => R.CLASSES[l.classe] && (prevus || l.atteint)).slice(0, n ?? Infinity);
  const race = R.RACES[p.race] || null;
  const e = { niveau: lv.length, classes: {}, etapes: [], bba: 0, js: { vig: 0, ref: 0, vol: 0 }, dons: new Set(), donsListe: [], race, taille: race ? race.taille : 'M' };
  e.car = {};
  for (const c of R.CARACS) e.car[c.k] = p.caracs?.[c.k]?.val === '' || p.caracs?.[c.k]?.val == null ? null : num(p.caracs[c.k].val);
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
    if (prevus && !l.atteint && l.augment && e.car[l.augment] != null) e.car[l.augment] += 1;
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
  e.lanceur = Math.max(0, ...Object.entries(e.classes).map(([id, k]) => {
    const lc = R.CLASSES[id].lanceur;
    if (!lc) return 0;
    return lc.debut ? (k >= lc.debut ? Math.floor(k / 2) : 0) : k;
  }));
  return e;
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
const compDeClasse = e => new Set(Object.keys(e.classes).flatMap(id => R.CLASSES[id].comp));

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
  const moine = e.classes.moine || 0;
  const js = { ...e.js };
  js.vig += e.mods.con + (e.dons.has('vigueur-surhumaine') ? 2 : 0);
  js.ref += e.mods.dex + (e.dons.has('reflexes-surhumains') ? 2 : 0);
  js.vol += e.mods.sag + (e.dons.has('volonte-fer') ? 2 : 0);
  const notesJs = [];
  if (p.race === 'halfelin') { js.vig++; js.ref++; js.vol++; notesJs.push('+1 halfelin inclus'); }
  if ((e.classes.paladin || 0) >= 2) { js.vig += e.mods.cha; js.ref += e.mods.cha; js.vol += e.mods.cha; notesJs.push('Grâce divine incluse'); }
  for (const s of ['vig', 'ref', 'vol']) js[s] += num(a[s]);
  const bonusMoine = moine ? Math.max(0, e.mods.sag) + Math.floor(moine / 5) : 0;
  const armure = num(a.armure), bouclier = num(a.bouclier), nat = num(a.naturelle), parade = num(a.parade), div = num(a.caDivers);
  const ca = 10 + e.mods.dex + t.ca + armure + bouclier + nat + parade + div + bonusMoine;
  const contact = 10 + e.mods.dex + t.ca + parade + div + bonusMoine;
  const esquiveInst = (e.classes.barbare || 0) >= 2 || (e.classes.roublard || 0) >= 4;
  const depourvu = esquiveInst ? ca : ca - Math.max(0, e.mods.dex);
  let vitesse = e.race ? e.race.vitesse : 9;
  const notesVit = [];
  if (moine >= 3) { vitesse += 3 * Math.floor(moine / 3); notesVit.push('déplacement accéléré du moine inclus (sans armure)'); }
  if (e.classes.barbare) { vitesse += 3; notesVit.push('déplacement accéléré du barbare inclus'); }
  vitesse += num(a.vitesse);
  const bba = e.bba + num(a.bba);
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
    js, notesJs, init: e.mods.dex + (e.dons.has('science-initiative') ? 4 : 0) + num(a.init),
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
  const opts = options.map(x => Array.isArray(x) ? x : [x, x]);
  return `<label class="f${opt.span ? ' span2' : ''}"><span>${esc(label)}</span>
    <select data-bind="${path}" data-rerender>
      <option value="">${esc(opt.vide || '— Choisir —')}</option>
      ${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(cur) === String(v) ? 'selected' : ''}>${esc(l)}</option>`).join('')}
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
        <div class="banniere-img">${p.portrait ? `<img src="${p.portrait}" alt="">` : `<div class="silhouette">${SILHOUETTE_SVG}</div>`}</div>
        <h2>${esc(p.nom || 'Sans nom')}</h2>
        <p>${esc([raceNom(p), classesTxt(e)].filter(Boolean).join(', ') || 'À compléter')}</p>
        ${p.joueur ? `<p>${esc(p.joueur)}</p>` : ''}
        ${p.embleme ? `<img class="embleme-banniere" src="${p.embleme}" alt="">` : '<span class="losange" aria-hidden="true"></span>'}
      </div>
    </a>`;
  }).join('');
  return `
    <header class="hero">
      ${LOGO_SVG}
      <h1>L'Éveil<br>du Givre Éternel</h1>
      <p class="campagne">CAMPAGNE D&amp;D 3.5</p>
      <p class="devise">Il existe encore des secrets que le monde a oubliés…</p>
    </header>
    <div class="ornement" aria-hidden="true"><span></span></div>
    <div class="pagehead">
      <div><h1>Personnages</h1><p class="sub">La compagnie</p></div>
      <div class="btns">
        <button class="btn" data-action="new-perso">Créer un personnage</button>
        <button class="btn ghost" data-action="import">Importer</button>
      </div>
    </div>
    ${bannieres ? `<div class="persos">${bannieres}</div>` : `
      <div class="card intro">
        <h3>La compagnie est vide</h3>
        <p>Crée ta fiche, ou importe celle qu'un autre joueur t'a envoyée (fichier .json).</p>
      </div>`}`;
}

function pagePerso(id, tab) {
  const p = findPerso(id);
  if (!p) return `<p>Personnage introuvable. <a href="#/persos">Retour à la liste</a></p>`;
  state.ctx = p;
  tab = tab || 'fiche';
  const e = etat(p);
  const tabs = [['fiche', 'Fiche'], ['sorts', 'Sorts'], ['progression', 'Progression']]
    .map(([k, l]) => `<a href="#/perso/${p.id}/${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('');
  const contenu = tab === 'sorts' ? ongletSorts(p) : tab === 'progression' ? ongletProgression(p) : ongletFiche(p, e);
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
    <nav class="tabs" aria-label="Sections du personnage">${tabs}</nav>
    ${body}`;
}

function recap(p, e) {
  if (!e.niveau && !e.race) return '';
  const s = stats(p, e);
  const pv = p.pvMax !== '' && p.pvMax != null ? p.pvMax : (s.pvComplets ? s.pvCalc : '—');
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

function ongletFiche(p, e) {
  const s = stats(p, e);
  const race = e.race;
  const raceOpts = [...Object.entries(R.RACES).map(([k, r]) => [k, r.nom]), ['autre', 'Autre race (campagne)']];
  const nivTxt = e.niveau ? `Niveau ${e.niveau} : ${classesTxt(e)}` : 'Aucun niveau atteint. Ajoute et coche tes niveaux dans l\'onglet Progression.';
  const stat = (label, val, note) => `<div class="stat"><span>${label}</span><b>${val}</b>${note ? `<small>${note}</small>` : ''}</div>`;
  const aj = (path, label) => `<label class="aj"><span>${label}</span><input type="text" inputmode="numeric" data-bind="ajust.${path}" data-recalc value="${esc(getP(p, 'ajust.' + path))}" placeholder="0"></label>`;
  const valsClasses = Object.entries(e.classes).map(([id, k]) => ({ id, k, vals: valeursClasse(id, k, e) })).filter(x => x.vals.length);
  const deluge = valsClasses.find(x => x.id === 'moine')?.vals.find(v => v[0] === 'Déluge de coups');
  return `
  <section class="card">
    <div class="identite">
      ${blocImages(p)}
      <div class="grid">
        ${fi(p, 'nom', 'Nom')}${fi(p, 'joueur', 'Joueur')}
        ${sel(p, 'race', 'Race', raceOpts)}
        ${p.race === 'autre' ? fi(p, 'raceAutre', 'Nom de la race') : ''}
        ${sel(p, 'alignement', 'Alignement', R.ALIGNEMENTS)}
        ${sel(p, 'divinite', 'Divinité', [...R.DIVINITES, 'Autre'])}
        ${p.divinite === 'Autre' ? fi(p, 'diviniteAutre', 'Nom de la divinité') : ''}
        ${sel(p, 'sexe', 'Sexe', R.SEXES)}
        ${fi(p, 'age', 'Âge', { type: 'number' })}${fi(p, 'taillePoids', 'Taille et poids', { ph: '1,30 m, 75 kg' })}
      </div>
    </div>
    <p class="niveau-ligne">${esc(nivTxt)}</p>
    ${race ? `<p class="hint">Catégorie de taille ${R.TAILLES[race.taille].nom.toLowerCase()}, vitesse de base ${race.vitesse} m. Ajustements raciaux : ${race.ajust}. Classe de prédilection : ${race.classeFav}.</p>` : ''}
    <div class="f"><span class="lbl">Langues</span>
      <div class="chips">${R.LANGUES.map(l => `<button class="chip ${p.langues?.includes(l) ? 'on' : ''}" data-action="toggle-langue" data-l="${esc(l)}" aria-pressed="${p.langues?.includes(l) ? 'true' : 'false'}">${esc(l)}</button>`).join('')}</div>
    </div>
    ${fi(p, 'languesAutres', 'Autres langues (campagne)')}
    ${ta(p, 'apparence', 'Apparence et historique')}
  </section>

  <section class="card"><h3>Caractéristiques</h3>
    <div class="caracs">
      ${R.CARACS.map(c => `<div class="carac"><b title="${c.n}">${c.l}</b>
        <input type="text" inputmode="numeric" data-bind="caracs.${c.k}.val" data-recalc value="${esc(getP(p, `caracs.${c.k}.val`))}" aria-label="${c.n}">
        <span class="mod" id="mod-${c.k}">${e.car[c.k] == null ? '—' : R.signe(e.mods[c.k])}</span>
      </div>`).join('')}
    </div>
    <p class="hint">Saisis les valeurs finales (ajustements raciaux compris). Les modificateurs se calculent seuls.</p>
  </section>

  <section class="card"><h3>Combat</h3>
    <div class="stats">
      ${stat('Classe d\'armure', s.ca)}${stat('Contact', s.contact)}${stat('Pris au dépourvu', s.depourvu, s.esquiveInst ? 'Esquive instinctive' : '')}
      ${stat('Initiative', R.signe(s.init))}${stat('Vitesse', s.vitesse + ' m')}
      ${stat('Vigueur', R.signe(s.js.vig))}${stat('Réflexes', R.signe(s.js.ref))}${stat('Volonté', R.signe(s.js.vol))}
      ${stat('BBA', R.attTxt(s.att))}${stat('Corps à corps', R.signe(s.cac))}${stat('Distance', R.signe(s.dist))}${stat('Lutte', R.signe(s.lutte))}
      ${s.rm ? stat('Résistance à la magie', s.rm) : ''}${s.rd.length ? stat('Réduction des dégâts', s.rd.join(', ')) : ''}
    </div>
    ${deluge ? `<p class="hint"><b>Déluge de coups :</b> ${esc(deluge[1])}</p>` : ''}
    ${[...s.notesJs, ...s.notesVit].length ? `<p class="hint">${esc((t => t[0].toUpperCase() + t.slice(1))([...s.notesJs, ...s.notesVit].join(' ; ')))}.</p>` : ''}
    <div class="grid" style="margin-top:.8rem">
      ${fi(p, 'pvMax', 'Points de vie max', { type: 'number' })}
      <div class="f"><span>D'après les dés notés en progression</span><b class="calc">${s.pvComplets ? s.pvCalc + ' PV' : 'Dés de vie incomplets'}</b></div>
    </div>
    <details class="ajustements"><summary>Équipement et bonus divers (armure, objets, sorts…)</summary>
      <div class="aj-grid">
        ${aj('armure', 'Armure')}${aj('bouclier', 'Bouclier')}${aj('naturelle', 'Armure naturelle')}${aj('parade', 'Parade')}${aj('caDivers', 'CA divers')}
        ${aj('vig', 'Vigueur')}${aj('ref', 'Réflexes')}${aj('vol', 'Volonté')}${aj('init', 'Initiative')}${aj('bba', 'Attaque')}${aj('vitesse', 'Vitesse (m)')}
      </div>
      <p class="hint">Ces bonus s'ajoutent aux valeurs calculées. Le don Esquive n'est pas compté (il ne vise qu'un adversaire).</p>
    </details>
    ${ta(p, 'attaques', 'Armes et attaques', { ph: 'Ex. : Kama +5 (1d6+1, critique ×2)' })}
  </section>

  ${ficheCompetences(p, e)}
  ${ficheDons(p, e)}
  ${ficheCapacites(p, e, valsClasses)}

  <section class="card"><h3>Équipement</h3>
    ${liste(p, 'equipement', [{ k: 'nom', l: 'Objet' }, { k: 'qte', l: 'Qté', w: 's' }, { k: 'poids', l: 'Poids', w: 's' }, { k: 'notes', l: 'Notes' }], 'Ajouter un objet')}
    <div class="grid" style="margin-top:1rem">
      ${fi(p, 'argent.pp', 'Pièces de platine')}${fi(p, 'argent.po', 'Pièces d\'or')}
      ${fi(p, 'argent.pa', 'Pièces d\'argent')}${fi(p, 'argent.pc', 'Pièces de cuivre')}
    </div>
  </section>

  <section class="card"><h3>Notes</h3>
    ${ta(p, 'notes', 'Notes libres', { rows: 5 })}
  </section>`;
}

function ficheCompetences(p, e) {
  const deClasse = compDeClasse(e);
  const dispo = pointsComp(p, e);
  let depense = 0;
  const rangsMax = e.niveau + 3;
  const lignes = R.COMPETENCES.map(c => {
    const v = p.comp?.[c.id] || {};
    const rangs = num(v.rangs), classe = deClasse.has(c.id);
    depense += classe ? rangs : rangs * 2;
    const mod = c.car ? e.mods[c.car] : 0;
    const bonus = bonusComp(c.id, e);
    const total = rangs + mod + bonus + num(v.divers);
    const inutilisable = c.formation && rangs === 0;
    const spe = ['artisanat', 'profession', 'representation', 'langue'].includes(c.id);
    return `<div class="comp ${classe ? 'de-classe' : ''} ${inutilisable ? 'formation' : ''}">
      <div class="comp-nom">${classe ? '<span class="etoile" title="Compétence de classe">★</span>' : ''}${esc(c.nom)}${c.formation ? '<span class="formation-tag" title="Formation nécessaire">F</span>' : ''}
        <small>${c.car ? R.CARACS.find(x => x.k === c.car).l + ' ' + R.signe(mod) : ''}${bonus ? `, bonus ${R.signe(bonus)}` : ''}</small>
        ${spe ? `<input type="text" class="spe" data-bind="comp.${c.id}.spe" value="${esc(v.spe)}" placeholder="Spécialité">` : ''}
      </div>
      <input type="text" inputmode="decimal" data-bind="comp.${c.id}.rangs" data-recalc value="${esc(v.rangs)}" placeholder="0" aria-label="Rangs en ${esc(c.nom)}">
      <input type="text" inputmode="numeric" data-bind="comp.${c.id}.divers" data-recalc value="${esc(v.divers)}" placeholder="0" aria-label="Bonus divers en ${esc(c.nom)}">
      <b class="comp-total">${inutilisable ? '—' : R.signe(total)}</b>
    </div>`;
  }).join('');
  return `<section class="card"><h3>Compétences</h3>
    <p class="hint">Points : ${depense} dépensés sur ${dispo} disponibles${e.race?.pcBonus ? ' (bonus humain compris)' : ''}. Rangs max : ${rangsMax} pour une compétence de classe ★, ${String(rangsMax / 2).replace('.', ',')} sinon (une compétence hors classe coûte 2 points par rang). F = formation nécessaire.</p>
    <div class="comp entete"><span>Compétence</span><span>Rangs</span><span>Divers</span><span>Total</span></div>
    <div class="comps">${lignes}</div>
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

/* ---------- Sorts du personnage ---------- */
function ongletSorts(p) {
  const items = (p.sorts || []).map((e, i) => ({ e, i, s: findSort(e.id) }))
    .sort((a, b) => String(a.s?.nom ?? '').localeCompare(String(b.s?.nom ?? ''), 'fr'));
  const linked = items.map(({ e, i, s }) => `
    <div class="item ${ecoleClass(s?.ecole)}">
      <div>${s ? `<a href="#/sort/${s.id}">${esc(s.nom)}</a><span class="meta">${esc(s.ecole)}, ${esc(niveauxTxt(s))}</span>`
        : '<em>Sort supprimé du grimoire</em>'}</div>
      <select data-bind="sorts.${i}.statut" aria-label="Statut">
        ${STATUTS.map(st => `<option ${e.statut === st ? 'selected' : ''}>${st}</option>`).join('')}
      </select>
      <button class="icon" data-action="del-sort-perso" data-idx="${i}" aria-label="Retirer le sort">✕</button>
      <input type="text" class="notes" data-bind="sorts.${i}.notes" value="${esc(e.notes)}" placeholder="Notes (charges de la baguette, préparé ×2…)">
    </div>`).join('');
  return `
  <section class="card"><h3>Sorts du personnage</h3>
    <div class="linked">${linked || '<p class="empty">Aucun sort lié. Ajoute-les depuis le grimoire ci-dessous.</p>'}</div>
  </section>
  <section class="card"><h3>Ajouter un sort</h3>
    <input type="search" id="pickq" value="${esc(state.pickQ)}" placeholder="Chercher un sort par nom…" aria-label="Chercher un sort">
    <div class="pick" id="pickres">${pickResults(p)}</div>
    <p class="hint">Un sort manque ? <a href="#/sort-edit/new">Ajoute-le au grimoire</a>, puis reviens ici.</p>
  </section>`;
}
function pickResults(p) {
  const q = norm(state.pickQ);
  const have = new Set((p.sorts || []).map(s => s.id));
  const res = db.sorts
    .filter(s => !have.has(s.id) && (!q || norm(s.nom).includes(q) || norm(s.nomVO).includes(q)))
    .sort(byNom).slice(0, 25);
  if (!res.length) return '<p class="empty">Aucun sort correspondant.</p>';
  return res.map(s => `<button class="${ecoleClass(s.ecole)}" data-action="add-sort-perso" data-id="${s.id}">
    <b>${esc(s.nom)}</b> <span class="meta">${esc(s.ecole)}, ${esc(niveauxTxt(s))}</span></button>`).join('');
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
    <p>Ajoute le niveau 1 pour commencer. Si ton personnage est déjà au niveau 4, ajoute les quatre premiers niveaux et coche-les.</p></div>`}`;
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
  const classeOpts = Object.entries(R.CLASSES).map(([id, c]) => [id, c.nom]);
  return `
  <div class="level ${cls}">
    <div class="pip" aria-hidden="true">${n}</div>
    <details class="card" data-niveau="${n}" ${ouvert ? 'open' : ''}>
      <summary>
        <b>Niveau ${n}</b> <span class="resume">${esc(resume)}${donsDuNiveau.length ? ', ' + esc(donsDuNiveau.join(', ')) : ''}</span>
        ${estProchain ? '<span class="nextbadge">Prochain niveau</span>' : ''}${l.atteint ? '<span class="atteint-badge">Atteint</span>' : ''}
      </summary>
      <div class="levelhead">
        <label class="f"><span>Classe prise à ce niveau</span>
          <select data-bind="progression.${i}.classe" data-rerender>
            <option value="">— Choisir —</option>
            ${classeOpts.map(([v, t]) => `<option value="${v}" ${l.classe === v ? 'selected' : ''}>${t}</option>`).join('')}
          </select></label>
        <label class="check"><input type="checkbox" data-bind="progression.${i}.atteint" data-rerender ${l.atteint ? 'checked' : ''}> Atteint</label>
        <button class="icon" data-action="del-level" data-idx="${i}" aria-label="Supprimer le niveau ${n}">✕</button>
      </div>
      ${cl ? gainsNiveau(p, l, i, cl, k, avant, apres) : '<p class="empty">Choisis une classe pour voir ce que ce niveau apporte.</p>'}
      ${ta(l, 'notes', 'Notes', { rows: 2 }).replace('data-bind="notes"', `data-bind="progression.${i}.notes"`)}
    </details>
  </div>`;
}

function gainsNiveau(p, l, i, cl, k, avant, apres) {
  const n = l.niveau;
  const g = [];
  const delta = (a, b) => a === b ? R.signe(b) : `${R.signe(a)} → <b>${R.signe(b)}</b>`;
  g.push(['Dé de vie', `d${cl.dv}${n === 1 ? ' (maximum au niveau 1)' : ''}, + mod Con (${R.signe(apres.mods.con)})`]);
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
    return `<div class="choix-don"><label class="f"><span>${label}</span>
      <select data-bind="${path}" data-rerender>${optionsDons(e, p, cur || '', () => true, liste, sansPrerequis)}</select></label>
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
      <p class="hint">Une fois le niveau atteint, pense à ajouter ce +1 à la valeur sur la fiche.</p>`);
  }
  choix.push(`<label class="f pv-niveau"><span>Points de vie obtenus (jet du dé de vie, sans la Con)</span>
    <input type="text" inputmode="numeric" data-bind="progression.${i}.pv" value="${esc(l.pv)}" placeholder="${n === 1 ? cl.dv : '1 à ' + cl.dv}"></label>`);

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
  const sortsChange = spB && JSON.stringify(spA?.parJour) !== JSON.stringify(spB.parJour);
  return `
    <dl class="gains">${lignes}</dl>
    ${apt.length ? `<h4>Nouvelles aptitudes de ${esc(cl.nom.toLowerCase())}</h4><dl class="caps">${apt.map(a => `<dt>${esc(a.nom)}</dt><dd>${esc(a.texte)}</dd>`).join('')}</dl>` : ''}
    ${changes.length ? `<h4>Ce qui s'améliore</h4><ul class="changes">${changes.join('')}</ul>` : ''}
    ${sortsChange ? tableSorts(spB) : ''}
    <h4>Choix du niveau</h4>
    <div class="choix">${choix.join('')}</div>`;
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
    <a href="#/recaps" class="${actif === 'recaps' ? 'active' : ''}">Récapitulatifs</a>
    <a href="#/notes" class="${actif === 'notes' ? 'active' : ''}">Mes notes</a>
  </nav>`;
}

/* Mentions : @Nom ou @[Nom en plusieurs mots] */
const RE_MENTION = /@\[([^\]]+)\]|@([\p{L}\p{N}_'’-]+)/gu;
const sansMentions = t => String(t || '').replace(RE_MENTION, (m, a, b) => (a || b.replace(/_/g, ' ')).trim());
function mentionsDe(texte) {
  return [...String(texte || '').matchAll(RE_MENTION)].map(m => (m[1] || m[2].replace(/_/g, ' ')).trim()).filter(Boolean);
}
function avecMentions(texte) {
  const t = String(texte || '');
  let out = '', last = 0;
  for (const m of t.matchAll(RE_MENTION)) {
    const nom = (m[1] || m[2].replace(/_/g, ' ')).trim();
    out += esc(t.slice(last, m.index)) + `<a class="mention" href="#/notes/recherche/${encodeURIComponent(nom)}">${esc(nom)}</a>`;
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
const champsRecap = r => JSON.stringify(['numero', 'date', 'titre', 'auteur', 'texte'].map(k => String(r[k] ?? '')));
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
const aPublier = () => recapsTous().filter(r => statutRecap(r) !== 'publie').length + (db.recapsSupprimes || []).length;

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
      const lignes = await api('recaps?select=id,numero,date,titre,auteur,texte,maj&order=numero.desc');
      pub = (lignes || []).map(r => ({ ...r, date: r.date || '', titre: r.titre || '', auteur: r.auteur || '', texte: r.texte || '' }));
    } else {
      const res = await fetch('recaps.json', { cache: 'no-store' });
      if (!res.ok && res.status !== 404) throw new Error('HTTP ' + res.status);
      pub = res.ok ? ((await res.json()).recaps || []) : [];
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

/* Envoie en ligne tout ce qui n'est pas encore publié */
async function publierTout() {
  if (!db.codeCampagne) { toast('Saisis d\'abord le code de campagne'); return; }
  const aEnvoyer = recapsTous().filter(r => statutRecap(r) !== 'publie');
  try {
    for (const r of aEnvoyer) {
      await rpc('publier_recap', {
        p_code: db.codeCampagne, p_id: r.id, p_numero: Math.round(num(r.numero)), p_date: r.date || null,
        p_titre: r.titre || '', p_auteur: r.auteur || '', p_texte: r.texte || '',
      });
    }
    for (const id of db.recapsSupprimes || []) await rpc('supprimer_recap', { p_code: db.codeCampagne, p_id: id });
    await chargerRecaps();
    render();
    toast('Publié pour toute la compagnie');
  } catch (e) {
    if (/code/i.test(e.message)) { db.codeCampagne = ''; saveNow(); render(); }
    alert('Publication impossible : ' + e.message);
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
    titre: depuis ? depuis.titre : '', auteur: '', texte: depuis ? brouillonRecap(depuis) : '', maj: Date.now(),
  };
}

function bandeauPublication() {
  const n = aPublier();
  if (!n) return state.recapsErreur && enLigne() ? `<p class="hint">Base de données injoignable (${esc(state.recapsErreur)}). Les récapitulatifs affichés sont ceux du dernier chargement.</p>` : '';
  const pluriel = n > 1 ? 's' : '';
  if (enLigne()) {
    return `<section class="card bandeau">
      <h3>À publier</h3>
      <p>${n} récapitulatif${pluriel} pas encore publié${pluriel}. Tant qu'ils ne le sont pas, les autres joueurs ne les voient pas.</p>
      <div class="btns" style="margin-top:.6rem"><button class="btn" data-action="publier-tout">Publier maintenant</button></div>
    </section>`;
  }
  return `<section class="card bandeau">
    <h3>À publier</h3>
    <p>${n} récapitulatif${pluriel} modifié${pluriel} sur cet appareil seulement. Tant qu'ils ne sont pas publiés, les autres joueurs ne les voient pas.</p>
    <div class="btns"><button class="btn" data-action="export-recaps">Exporter recaps.json</button></div>
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
        ${r.texte ? `<span class="session-extrait">${esc(sansMentions(r.texte).replace(/\s+/g, ' ').slice(0, 150))}${r.texte.length > 150 ? '…' : ''}</span>` : ''}
      </span>
      ${st !== 'publie' ? `<span class="statut statut-${st}">${STATUTS_RECAP[st]}</span>` : ''}
    </a>`;
  }).join('');
  return `${sousNav('recaps')}
  <div class="pagehead">
    <div><h1>Récapitulatifs</h1><p class="sub">Le récit lu en début de session, commun à toute la compagnie</p></div>
    ${estAdmin() ? '<button class="btn" data-action="new-recap">Nouveau récapitulatif</button>' : ''}
  </div>
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
    <p><a href="#/recaps">← Récapitulatifs</a></p>
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
      ${ta(loc, 'texte', 'Récit', { rows: 16, ph: 'La dernière fois, la compagnie…' })}
      <div class="btns">
        ${enLigne() ? '<button class="btn" data-action="recap-publier">Enregistrer et publier</button><button class="btn ghost" data-action="recap-fin">Enregistrer sans publier</button>' : '<button class="btn" data-action="recap-fin">Terminé</button>'}
        <button class="btn danger" data-action="del-recap" data-id="${r.id}">Supprimer</button>
      </div>
    </section>`;
  }
  const paragraphes = sansMentions(r.texte).split(/\n{2,}/).map(p => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');
  return `${sousNav('recaps')}
  <p><a href="#/recaps">← Récapitulatifs</a></p>
  <article class="recit">
    <p class="recit-num">Session ${esc(r.numero)}</p>
    <h1>${esc(r.titre || 'Sans titre')}</h1>
    <p class="sub">${esc([r.auteur ? 'Raconté par ' + r.auteur : '', dateFr(r.date)].filter(Boolean).join(', '))}</p>
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
    <p class="hint">Questions et quêtes encore ouvertes, toutes sessions confondues. Coche « Résolu » quand c'est réglé.</p>
    <ul class="notes">${fils.join('')}</ul></section>` : ''}
  <section class="card"><h3>Sessions</h3>
    ${cartes ? `<div class="sessions">${cartes}</div>` : '<p class="empty">Aucune session. Crée la première au début de ta prochaine partie.</p>'}
  </section>
  ${index.length ? `<section class="card"><h3>Index</h3>
    <p class="hint">Tout ce que tu as mentionné avec @ dans tes notes. Touche un nom pour retrouver chaque passage.</p>
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
    <p class="hint">Écris <b>@Nom</b> pour un PNJ, un lieu ou un objet (<b>@[Nom en plusieurs mots]</b> s'il y a des espaces) : il rejoint l'index de tes notes. Maj + Entrée pour aller à la ligne.</p>
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
const estAdmin = () => !enLigne() || !!db.codeCampagne;
const estAMoi = p => !enLigne() || !!(db.cles || {})[p.id];
const peutModifier = p => !!p && (estAMoi(p) || (enLigne() && !!db.codeCampagne) || (enLigne() && !p.publie));
const codePour = p => (db.cles || {})[p.id] || db.codeCampagne || '';
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
async function chargerPersos() {
  if (!enLigne()) return false;
  try {
    const lignes = await api('persos?select=id,data,maj') || [];
    const enLigneIds = new Set(lignes.map(l => l.id));
    const attente = new Set(db.enAttente || []);
    const res = [];
    for (const l of lignes) {
      const local = findPerso(l.id);
      if (local && attente.has(l.id)) { res.push(local); continue; }
      const data = { ...l.data, id: l.id, publie: true };
      migrer(data);
      if (local) { for (const k of Object.keys(local)) delete local[k]; Object.assign(local, data); res.push(local); }
      else res.push(data);
    }
    /* Gardés : les personnages jamais mis en ligne. Retirés : ceux supprimés en ligne par leur propriétaire. */
    for (const p of db.personnages) if (!enLigneIds.has(p.id) && (!p.publie || attente.has(p.id))) res.push(p);
    db.personnages = res;
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
      await rpc('sauver_perso', { p_id: id, p_code: codePour(p), p_data: { ...p, publie: true } });
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
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* saveNow gère l'alerte */ }
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
  try { localStorage.setItem(STORE_KEY, JSON.stringify(db)); } catch (e) { /* */ }
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
    (f.classe || f.niveau === '' || (s.niveaux || []).some(n => n.niveau === Number(f.niveau)))
  ).sort(byNom);
}
function resultatsSorts() {
  const res = filtrerSorts();
  const lis = res.map(s => `<li><a class="spell ${ecoleClass(s.ecole)}" href="#/sort/${s.id}">
      <span><span class="nom">${esc(s.nom)}</span>${s.source === 'Maison' ? '<span class="maison">maison</span>' : ''}<br>
      <span class="tag">${esc(s.ecole)}${s.sousEcole ? ' (' + esc(s.sousEcole) + ')' : ''}</span></span>
      <span class="meta">${esc(niveauxTxt(s))}</span></a></li>`).join('');
  return `<p class="count">${res.length} sort${res.length > 1 ? 's' : ''}</p>
    ${lis ? `<ul class="spells">${lis}</ul>` : '<p class="empty">Aucun sort ne correspond à ces filtres.</p>'}`;
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
  <div class="filters">
    <input type="search" class="q" data-filtre="q" value="${esc(f.q)}" placeholder="Nom ou effet…" aria-label="Rechercher">
    <select data-filtre="ecole" aria-label="École">${opt('', 'Toutes les écoles', f.ecole)}${ECOLES.map(e => opt(e, e, f.ecole)).join('')}</select>
    <select data-filtre="classe" aria-label="Classe">${opt('', 'Toutes les classes', f.classe)}${classes.map(c => opt(c, CLASSES_ABR[c] || c, f.classe)).join('')}</select>
    <select data-filtre="niveau" aria-label="Niveau">${opt('', 'Tous niveaux', f.niveau)}${[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => opt(String(n), 'Niveau ' + n, f.niveau)).join('')}</select>
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
    <p class="hint">Niveaux : abréviation de la classe suivie du niveau, séparés par des virgules. Abréviations utilisées : ${Object.entries(CLASSES_ABR).map(([k, v]) => `${k} (${v})`).join(', ')}.</p>
  </section>
  <button class="btn" data-action="save-sort">Enregistrer le sort</button>`;
}

function pageDonnees() {
  const taille = (new Blob([localStorage.getItem(STORE_KEY) || '']).size / 1024).toFixed(0);
  return `
  <div class="pagehead"><div><h1>Partage et sauvegarde</h1>
    <p class="sub">Les données restent sur cet appareil. Le partage se fait par fichier.</p></div></div>

  <section class="card intro"><h3>Partager avec la troupe</h3>
    <p>Chaque joueur remplit sa fiche sur son propre téléphone, puis l'exporte depuis la page du personnage. Le fichier .json s'envoie par Discord, mail ou message, et le destinataire l'importe ici. Un personnage déjà présent est remplacé par la version importée.</p>
    <p>L'export de toute la campagne contient aussi tes notes personnelles de session. C'est pratique pour passer d'un appareil à l'autre, mais pense-y avant de l'envoyer à quelqu'un.</p>
    <p>Pour les récapitulatifs communs, utilise plutôt « Exporter recaps.json » dans Journal, Récapitulatifs : ce fichier ne contient que les récits, sans aucune note.</p>
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
function render(garderScroll = true) {
  const y = window.scrollY;
  const h = location.hash.replace(/^#\/?/, '') || 'persos';
  const [page, id, tab] = h.split('/');
  state.ctx = null;
  if (page !== 'sort-edit') state.draft = null;
  if (page !== 'recap') { state.editRecap = null; state.editRecapObj = null; }
  let html;
  switch (page) {
    case 'perso': html = pagePerso(id, tab); break;
    case 'sorts': html = pageSorts(); break;
    case 'sort': html = pageSort(id); break;
    case 'sort-edit': html = pageSortEdit(id); break;
    case 'journal':
    case 'recaps': html = pageRecaps(); break;
    case 'recap': html = pageRecap(id); break;
    case 'notes': html = pageNotes(id, tab); break;
    case 'session': html = pageSession(id); break;
    case 'nouveau': html = pageNouveauPerso(); break;
    case 'donnees': html = pageDonnees(); break;
    default: html = pagePersos();
  }
  $('#app').innerHTML = html;
  const nav = page === 'perso' || page === 'nouveau' ? 'persos' : page.startsWith('sort') ? 'sorts' : ['recaps', 'recap', 'notes', 'session'].includes(page) ? 'journal' : page;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
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
  if (['journal', 'recaps', 'recap'].includes(page) && Date.now() - (state.recapsCharges || 0) > 30000 && !state.editRecap) {
    chargerRecaps().then(ok => { if (ok && ['journal', 'recaps', 'recap'].includes(location.hash.replace(/^#\/?/, '').split('/')[0])) render(); });
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
  const path = t.dataset.bind;
  if (!path || !state.ctx) return;
  if (db.personnages.includes(state.ctx) && !peutModifier(state.ctx)) return;
  if (state.ctx === state.editRecapObj && !estAdmin()) return;
  setP(state.ctx, path, t.type === 'checkbox' ? t.checked : t.value);
  if (state.ctx === state.draft) return; // le sort n'est enregistré qu'au clic sur le bouton
  state.ctx.maj = Date.now();
  if (path === 'nom') $('#ptitle').textContent = t.value || 'Sans nom';
  const m = path.match(/^caracs\.(\w+)\.val$/);
  if (m && $('#mod-' + m[1])) $('#mod-' + m[1]).textContent = t.value === '' ? '—' : R.signe(R.mod(t.value));
  save();
  if (t.hasAttribute('data-rerender')) render();
});
/* Entrée enregistre la note rapide (Maj + Entrée pour aller à la ligne) */
document.addEventListener('keydown', ev => {
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
  const libres = ['new-perso', 'creer-perso', 'perso-en-ligne', 'revendiquer', 'export-perso', 'import', 'export-all', 'export-sorts', 'reset-sorts', 'code-verifier', 'code-oublier'];
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
      for (let n = 1; n <= max; n++) if (!have.has(n)) p.progression.push(nouveauNiveau(n));
      save(); render();
      break;
    }
    case 'add-level': {
      p.progression = p.progression || [];
      const n = p.progression.reduce((m, l) => Math.max(m, l.niveau), 0) + 1;
      p.progression.push(nouveauNiveau(n)); state.ouverts.add(n); save(); render();
      break;
    }
    case 'del-level':
      if (confirm(`Supprimer le niveau ${p.progression[idx].niveau} et ce qu'il contient ?`)) {
        p.progression.splice(idx, 1); save(); render();
      }
      break;
    case 'save-sort': {
      const d = state.draft;
      if (!String(d.nom || '').trim()) { toast('Donne un nom au sort'); break; }
      const { niveauxTxt: nt, _for, ...sort } = d;
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
        { type: 'campagne', version: APP_VERSION, personnages: db.personnages, sessions: db.sessions || [], recaps: db.recaps || [], sorts: db.sorts.filter(s => s.source === 'Maison') });
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
      const txt = [`Session ${r.numero}${r.titre ? ' : ' + r.titre : ''}`, '', sansMentions(r.texte)].join('\n');
      navigator.clipboard?.writeText(txt).then(() => toast('Texte copié'), () => toast('Copie impossible sur ce navigateur'));
      break;
    }
    case 'export-recaps':
      download('recaps.json', { type: 'recaps', version: 1, maj: Date.now(),
        recaps: recapsTous().map(({ id, numero, date, titre, auteur, texte, maj }) => ({ id, numero, date, titre, auteur, texte, maj })) });
      break;
    case 'jq-effacer':
      state.jq = ''; go('#/notes');
      break;
    case 'img-choisir':
      state.imgType = b.dataset.type;
      $('#imginput').value = '';
      $('#imginput').click();
      break;
    case 'img-retirer':
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
    const recapsImp = data.type === 'recaps' || data.type === 'campagne' ? data.recaps || [] : [];
    if (!persos.length && !sorts.length && !sessions.length && !recapsImp.length) throw new Error('ce fichier ne vient pas du Codex de campagne');

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
      const cur = findRecap(r.id);
      if (cur && champsRecap(cur) === champsRecap(r)) continue;
      const i = db.recaps.findIndex(x => x.id === r.id);
      if (i >= 0) db.recaps[i] = r; else db.recaps.push(r);
      db.recapsSupprimes = (db.recapsSupprimes || []).filter(x => x !== r.id);
      recapsMaj++;
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
    toast(`Import terminé : ${persos.length} personnage(s), ${nouvellesSessions} session(s) de notes, ${recapsMaj} récapitulatif(s), ${nouveauxSorts} nouveau(x) sort(s)`);
    go(persos.length === 1 ? `#/perso/${persos[0].id}/fiche` : persos.length ? '#/persos' : recapsImp.length ? '#/recaps' : sessions.length ? '#/notes' : '#/sorts');
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
$('#imginput').addEventListener('change', async ev => {
  const file = ev.target.files[0];
  const p = state.ctx;
  if (!file || !p || !state.imgType) return;
  try {
    const portrait = state.imgType === 'portrait';
    p[state.imgType] = await reduireImage(file, portrait ? 640 : 256, portrait ? 'image/jpeg' : 'image/webp');
    p.maj = Date.now();
    saveNow(); persoModifie(p); render();
    toast(portrait ? 'Portrait ajouté' : 'Emblème ajouté');
  } catch (e) {
    alert('Image impossible à charger : ' + e.message);
  }
});

/* ---------- Démarrage ---------- */
(async function start() {
  load();
  db.personnages.forEach(migrer);
  migrerSessions(db.sessions);
  render();
  await Promise.all([initSorts(), chargerRecaps(), chargerPersos()]);
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
