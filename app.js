'use strict';

/* ============================================================
   Codex de campagne : fiches, grimoire et progression (D&D 3.5)
   Données stockées dans le navigateur (localStorage).
   ============================================================ */

const STORE_KEY = 'codex-dd35-v1';
const APP_VERSION = 1;

const CARACS = [
  { k: 'for', l: 'FOR', n: 'Force' },
  { k: 'dex', l: 'DEX', n: 'Dextérité' },
  { k: 'con', l: 'CON', n: 'Constitution' },
  { k: 'int', l: 'INT', n: 'Intelligence' },
  { k: 'sag', l: 'SAG', n: 'Sagesse' },
  { k: 'cha', l: 'CHA', n: 'Charisme' },
];
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
let db = { version: APP_VERSION, personnages: [], sorts: [], sortsInitialises: false };

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

/* ---------- Modèles ---------- */
function nouveauPerso() {
  return {
    id: uid(), nom: 'Nouveau personnage', joueur: '', race: '', classes: '', niveau: '', xp: '',
    alignement: '', divinite: '', taille: '', age: '', sexe: '', taillePoids: '', langues: '', apparence: '',
    caracs: Object.fromEntries(CARACS.map(c => [c.k, { val: '', mod: '' }])),
    pvMax: '', ca: '', caContact: '', caDepourvu: '', initiative: '', vitesse: '', bba: '', lutte: '',
    vig: '', ref: '', vol: '', rm: '', rd: '', attaques: '',
    competences: [], dons: [], capacites: [], equipement: [],
    argent: { pp: '', po: '', pa: '', pc: '' }, notes: '',
    sorts: [], progression: [], maj: Date.now(),
  };
}
const LIST_TEMPLATES = {
  competences: () => ({ nom: '', total: '', notes: '' }),
  dons: () => ({ nom: '', description: '' }),
  capacites: () => ({ nom: '', description: '' }),
  equipement: () => ({ nom: '', qte: '', poids: '', notes: '' }),
};

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
};

/* ---------- Champs ---------- */
function fi(o, path, label, opt = {}) {
  return `<label class="f${opt.span ? ' span2' : ''}"><span>${esc(label)}</span>
    <input type="text" data-bind="${path}" value="${esc(getP(o, path))}" placeholder="${esc(opt.ph || '')}"${opt.num ? ' inputmode="text"' : ''}></label>`;
}
function ta(o, path, label, opt = {}) {
  return `<label class="f"><span>${esc(label)}</span>
    <textarea data-bind="${path}" rows="${opt.rows || 3}" placeholder="${esc(opt.ph || '')}">${esc(getP(o, path))}</textarea></label>`;
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

/* ---------- Pages ---------- */
function pagePersos() {
  const ps = [...db.personnages].sort(byNom);
  const cards = ps.map(p => `
    <a class="perso" href="#/perso/${p.id}/fiche">
      <h2>${esc(p.nom || 'Sans nom')}</h2>
      <p>${esc([p.race, p.classes].filter(Boolean).join(', ') || 'Race et classe à renseigner')}</p>
      <p>${p.joueur ? 'Joué par ' + esc(p.joueur) : ''}</p>
    </a>`).join('');
  return `
    <div class="pagehead">
      <div><h1>Personnages</h1><p class="sub">La troupe de la campagne</p></div>
      <div class="btns">
        <button class="btn" data-action="new-perso">Créer un personnage</button>
        <button class="btn ghost" data-action="import">Importer</button>
      </div>
    </div>
    ${cards ? `<div class="persos">${cards}</div>` : `
      <div class="card intro">
        <h3>Aucun personnage pour l'instant</h3>
        <p>Crée ta fiche, ou importe celle qu'un autre joueur t'a envoyée (fichier .json).</p>
      </div>`}`;
}

function pagePerso(id, tab) {
  const p = findPerso(id);
  if (!p) return `<p>Personnage introuvable. <a href="#/persos">Retour à la liste</a></p>`;
  state.ctx = p;
  tab = tab || 'fiche';
  const tabs = [['fiche', 'Fiche'], ['sorts', 'Sorts'], ['progression', 'Progression']]
    .map(([k, l]) => `<a href="#/perso/${p.id}/${k}" class="${tab === k ? 'active' : ''}">${l}</a>`).join('');
  const body = tab === 'sorts' ? ongletSorts(p) : tab === 'progression' ? ongletProgression(p) : ongletFiche(p);
  return `
    <div class="pagehead">
      <div><h1 id="ptitle">${esc(p.nom || 'Sans nom')}</h1>
      <p class="sub">${p.joueur ? 'Joué par ' + esc(p.joueur) : 'Joueur à renseigner'}</p></div>
      <div class="btns">
        <button class="btn ghost" data-action="export-perso">Exporter la fiche</button>
        <button class="btn danger" data-action="del-perso">Supprimer</button>
      </div>
    </div>
    <nav class="tabs" aria-label="Sections du personnage">${tabs}</nav>
    ${body}`;
}

function ongletFiche(p) {
  return `
  <section class="card"><h3>Identité</h3>
    <div class="grid">
      ${fi(p, 'nom', 'Nom', { span: 1 })}${fi(p, 'joueur', 'Joueur')}
      ${fi(p, 'race', 'Race')}${fi(p, 'classes', 'Classe(s) et niveaux', { ph: 'Moine 5 / Guerrier 1' })}
      ${fi(p, 'niveau', 'Niveau global')}${fi(p, 'xp', 'Points d\'expérience')}
      ${fi(p, 'alignement', 'Alignement')}${fi(p, 'divinite', 'Divinité')}
      ${fi(p, 'taille', 'Catégorie de taille', { ph: 'M' })}${fi(p, 'age', 'Âge')}
      ${fi(p, 'sexe', 'Sexe')}${fi(p, 'taillePoids', 'Taille et poids')}
      ${fi(p, 'langues', 'Langues', { span: 1 })}
    </div>
    ${ta(p, 'apparence', 'Apparence et historique')}
  </section>

  <section class="card"><h3>Caractéristiques</h3>
    <div class="caracs">
      ${CARACS.map(c => `<div class="carac"><b title="${c.n}">${c.l}</b>
        <input type="text" inputmode="numeric" data-bind="caracs.${c.k}.val" value="${esc(getP(p, `caracs.${c.k}.val`))}" aria-label="${c.n}">
        <input type="text" class="mod" data-bind="caracs.${c.k}.mod" value="${esc(getP(p, `caracs.${c.k}.mod`))}" placeholder="mod." aria-label="Modificateur de ${c.n}">
      </div>`).join('')}
    </div>
  </section>

  <section class="card"><h3>Défense et attaque</h3>
    <div class="grid">
      ${fi(p, 'pvMax', 'Points de vie max')}${fi(p, 'ca', 'Classe d\'armure')}
      ${fi(p, 'caContact', 'CA contact')}${fi(p, 'caDepourvu', 'CA pris au dépourvu')}
      ${fi(p, 'initiative', 'Initiative')}${fi(p, 'vitesse', 'Vitesse', { ph: '9 m' })}
      ${fi(p, 'bba', 'Bonus de base à l\'attaque')}${fi(p, 'lutte', 'Lutte')}
      ${fi(p, 'vig', 'Vigueur')}${fi(p, 'ref', 'Réflexes')}${fi(p, 'vol', 'Volonté')}
      ${fi(p, 'rm', 'Résistance à la magie')}${fi(p, 'rd', 'Réduction des dégâts')}
    </div>
    ${ta(p, 'attaques', 'Attaques', { ph: 'Ex. : Coup à mains nues +6 (1d8+2)' })}
  </section>

  <section class="card"><h3>Compétences</h3>
    ${liste(p, 'competences', [{ k: 'nom', l: 'Compétence' }, { k: 'total', l: 'Total', w: 's' }, { k: 'notes', l: 'Notes' }], 'Ajouter une compétence')}
  </section>

  <section class="card"><h3>Dons</h3>
    ${liste(p, 'dons', [{ k: 'nom', l: 'Nom du don' }, { k: 'description', l: 'Effet', type: 'area' }], 'Ajouter un don')}
  </section>

  <section class="card"><h3>Capacités spéciales</h3>
    ${liste(p, 'capacites', [{ k: 'nom', l: 'Capacité (raciale, de classe…)' }, { k: 'description', l: 'Effet', type: 'area' }], 'Ajouter une capacité')}
  </section>

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
      <input type="text" class="notes" data-bind="sorts.${i}.notes" value="${esc(e.notes)}" placeholder="Notes (nombre par jour, préparé ×2…)">
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

function ongletProgression(p) {
  const lv = [...(p.progression || [])].map((l, i) => ({ l, i })).sort((a, b) => a.l.niveau - b.l.niveau);
  const nextIdx = lv.find(x => !x.l.atteint)?.i;
  const cards = lv.map(({ l, i }) => {
    const cls = l.atteint ? 'done' : i === nextIdx ? 'next' : '';
    const champ = (k, label, ph) => `<label class="f"><span>${label}</span>
      <textarea data-bind="progression.${i}.${k}" rows="2" placeholder="${esc(ph)}">${esc(l[k])}</textarea></label>`;
    return `
    <div class="level ${cls}">
      <div class="pip" aria-hidden="true">${l.niveau}</div>
      <div class="card">
        <div class="levelhead">
          <b>Niveau ${l.niveau}</b>
          ${i === nextIdx ? '<span class="nextbadge">Prochain niveau</span>' : ''}
          <input type="text" data-bind="progression.${i}.classe" value="${esc(l.classe)}" placeholder="Classe prise à ce niveau" aria-label="Classe prise au niveau ${l.niveau}">
          <label><input type="checkbox" data-bind="progression.${i}.atteint" data-rerender ${l.atteint ? 'checked' : ''}> Atteint</label>
          <button class="icon" data-action="del-level" data-idx="${i}" aria-label="Supprimer le niveau ${l.niveau}">✕</button>
        </div>
        <div class="lvlgrid">
          ${champ('capacites', 'Capacités de classe', 'Ex. : Déluge de coups, Esquive totale')}
          ${champ('dons', 'Dons', 'Ex. : Science du croc-en-jambe')}
          ${champ('competences', 'Compétences', 'Ex. : +1 Acrobaties, +1 Équilibre')}
          ${champ('sorts', 'Sorts', 'Sorts appris ou nouveaux emplacements')}
          ${champ('carac', 'Caractéristiques et PV', 'Ex. : +1 SAG, 1d8 PV')}
          ${champ('notes', 'Notes', 'Prérequis à valider, objets à acheter…')}
        </div>
      </div>
    </div>`;
  }).join('');
  return `
  <div class="btns" style="margin-bottom:1rem">
    <button class="btn" data-action="gen-prog">Créer les niveaux jusqu'à…</button>
    <button class="btn ghost" data-action="add-level">Ajouter un niveau</button>
  </div>
  ${cards ? `<div class="levels">${cards}</div>` : `
    <div class="card intro"><h3>Aucun niveau prévu</h3>
    <p>Prépare la feuille de route du personnage : pour chaque niveau, ce qu'il gagne et ce que tu comptes prendre. Coche « Atteint » au fil de la campagne.</p></div>`}`;
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
    <dl class="stats">
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
    <div class="btns">
      <button class="btn" data-action="import">Importer un fichier</button>
      <button class="btn ghost" data-action="export-all">Exporter toute la campagne</button>
    </div>
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
function render() {
  const h = location.hash.replace(/^#\/?/, '') || 'persos';
  const [page, id, tab] = h.split('/');
  state.ctx = null;
  if (page !== 'sort-edit') state.draft = null;
  let html;
  switch (page) {
    case 'perso': html = pagePerso(id, tab); break;
    case 'sorts': html = pageSorts(); break;
    case 'sort': html = pageSort(id); break;
    case 'sort-edit': html = pageSortEdit(id); break;
    case 'donnees': html = pageDonnees(); break;
    default: html = pagePersos();
  }
  $('#app').innerHTML = html;
  const nav = page === 'perso' ? 'persos' : page.startsWith('sort') ? 'sorts' : page;
  document.querySelectorAll('[data-nav]').forEach(a => a.classList.toggle('active', a.dataset.nav === nav));
}
function go(hash) {
  if (location.hash === hash) render(); else location.hash = hash;
}
window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); });

/* ---------- Saisie ---------- */
document.addEventListener('input', ev => {
  const t = ev.target;
  if (t.id === 'pickq') {
    state.pickQ = t.value;
    if (state.ctx) $('#pickres').innerHTML = pickResults(state.ctx);
    return;
  }
  if (t.dataset.filtre) {
    state.filtres[t.dataset.filtre] = t.value;
    $('#sortres').innerHTML = resultatsSorts();
    return;
  }
  const path = t.dataset.bind;
  if (!path || !state.ctx) return;
  setP(state.ctx, path, t.type === 'checkbox' ? t.checked : t.value);
  if (state.ctx === state.draft) return; // le sort n'est enregistré qu'au clic sur le bouton
  state.ctx.maj = Date.now();
  if (path === 'nom') $('#ptitle').textContent = t.value || 'Sans nom';
  save();
  if (t.hasAttribute('data-rerender')) render();
});

/* ---------- Actions ---------- */
document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-action]');
  if (!b) return;
  const p = state.ctx;
  const a = b.dataset.action;
  const idx = Number(b.dataset.idx);

  switch (a) {
    case 'new-perso': {
      const np = nouveauPerso();
      db.personnages.push(np); saveNow();
      go(`#/perso/${np.id}/fiche`);
      setTimeout(() => { const i = $('[data-bind="nom"]'); i?.focus(); i?.select(); }, 50);
      break;
    }
    case 'del-perso':
      if (confirm(`Supprimer définitivement « ${p.nom} » de cet appareil ?`)) {
        db.personnages = db.personnages.filter(x => x.id !== p.id); saveNow();
        toast('Personnage supprimé'); go('#/persos');
      }
      break;
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
      p.progression.push(nouveauNiveau(n)); save(); render();
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
        { type: 'campagne', version: APP_VERSION, personnages: db.personnages, sorts: db.sorts.filter(s => s.source === 'Maison') });
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
    case 'import':
      $('#fileinput').value = '';
      $('#fileinput').click();
      break;
  }
});

function nouveauNiveau(n) {
  return { niveau: n, classe: '', atteint: false, capacites: '', dons: '', competences: '', sorts: '', carac: '', notes: '' };
}

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
    if (!persos.length && !sorts.length) throw new Error('ce fichier ne vient pas du Codex de campagne');

    const remplaces = persos.filter(p => findPerso(p.id)).map(p => p.nom);
    if (remplaces.length && !confirm(`Ces personnages existent déjà et seront remplacés par la version importée :\n${remplaces.join(', ')}\n\nContinuer ?`)) return;

    for (const p of persos) {
      const i = db.personnages.findIndex(x => x.id === p.id);
      if (i >= 0) db.personnages[i] = p; else db.personnages.push(p);
    }
    let nouveauxSorts = 0;
    for (const s of sorts) {
      const i = db.sorts.findIndex(x => x.id === s.id);
      if (i >= 0) db.sorts[i] = s; else { db.sorts.push(s); nouveauxSorts++; }
    }
    saveNow();
    toast(`Import terminé : ${persos.length} personnage(s), ${nouveauxSorts} nouveau(x) sort(s)`);
    go(persos.length === 1 ? `#/perso/${persos[0].id}/fiche` : persos.length ? '#/persos' : '#/sorts');
  } catch (e) {
    alert('Import impossible : ' + e.message);
  }
});

/* ---------- Démarrage ---------- */
(async function start() {
  load();
  render();
  await initSorts();
  render();
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('Service worker :', e));
  }
  navigator.storage?.persist?.().catch(() => {});
})();
