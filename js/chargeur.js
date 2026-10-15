// Recouvrement qui bloque la page : chargement du moteur (barre, étape, phrases amusantes)
// ou message quand le navigateur bloque ce dont l'outil a besoin. Le reste de la page est
// rendu inerte tant que le recouvrement est ouvert. Il ne s'affiche qu'après un délai, pour
// qu'un chargement rapide (cache) ne fasse rien clignoter.

export const DELAI_MS = 400;
export const PHRASE_MS = 4000;
// Une fois affiché, le recouvrement reste au moins MINIMUM_MS : un éclair de 50 ms serait pris pour un défaut.
export const MINIMUM_MS = 700;

// Ordre aléatoire d'indices sans répétition avant d'avoir tout vu ; deux tirages de suite ne
// donnent jamais le même, même à la jonction de deux tours.
export function ordreAleatoire(n, hasard = Math.random) {
  let file = [];
  let dernier = -1;
  return () => {
    if (!file.length) {
      file = Array.from({ length: n }, (_, i) => i);
      for (let i = n - 1; i > 0; i--) {
        const j = Math.floor(hasard() * (i + 1));
        [file[i], file[j]] = [file[j], file[i]];
      }
      if (n > 1 && file[file.length - 1] === dernier) file.unshift(file.pop());
    }
    dernier = file.pop();
    return dernier;
  };
}

const $ = (id) => document.getElementById(id);

// `racines` : éléments de la page à rendre inertes ; `t(cle, valeurs)` : libellé dans la
// langue courante.
export function creerChargeur({ racines, t }) {
  const surface = $('chargeur');
  let ouvert = false, minuteur = null, rotation = null, avant = null, ordre = null, phrases = [], montreA = 0;

  function montrer() {
    if (ouvert) return;
    ouvert = true;
    montreA = performance.now();
    avant = document.activeElement;
    for (const r of racines) r.inert = true;
    document.body.classList.add('chargeur-ouvert');
    surface.hidden = false;
    $('chargeur-boite').focus({ preventScroll: true });
  }

  function arreterPhrases() {
    clearInterval(rotation);
    rotation = null;
  }

  function fermer() {
    clearTimeout(minuteur);
    minuteur = null;
    if (!ouvert) { arreterPhrases(); return; }
    const reste = MINIMUM_MS - (performance.now() - montreA);
    if (reste > 0) { minuteur = setTimeout(fermer, reste); return; }
    arreterPhrases();
    ouvert = false;
    surface.hidden = true;
    for (const r of racines) r.inert = false;
    document.body.classList.remove('chargeur-ouvert');
    if (avant && avant.isConnected) avant.focus({ preventScroll: true });
  }

  function phraseSuivante() {
    const p = $('chargeur-phrase');
    p.textContent = phrases[ordre()];
    p.classList.remove('change');
    void p.offsetWidth;
    p.classList.add('change');
  }

  // Les phrases se tirent à l'ouverture du chargement, dans la langue de la page.
  function demarrerPhrases() {
    phrases = t('chargeurPhrases');
    ordre = ordreAleatoire(phrases.length);
    phraseSuivante();
    arreterPhrases();
    rotation = setInterval(phraseSuivante, PHRASE_MS);
  }

  function modeChargement() {
    $('chargeur-titre').textContent = t('chargeurTitre');
    $('chargeur-chargement').hidden = false;
    $('chargeur-message').hidden = true;
    surface.setAttribute('aria-describedby', 'chargeur-etape');
    demarrerPhrases();
  }

  // Étape annoncée (zone vive) et détail chiffré, qui n'est pas annoncé.
  function etape(texte, detail = '', part = null) {
    if ($('chargeur-etape').textContent !== texte) $('chargeur-etape').textContent = texte;
    $('chargeur-detail').textContent = detail;
    const barre = $('chargeur-barre');
    if (part == null) barre.removeAttribute('value'); else barre.value = Math.max(0, Math.min(1, part));
    barre.setAttribute('aria-label', texte);
  }

  // Message avec des boutons [{ libelle, action, principal }] et, en option, un texte
  // « En savoir plus » ; rend la zone des boutons.
  function message({ titre, texte, boutons = [], plus = null, refus = null }) {
    arreterPhrases();
    $('chargeur-titre').textContent = titre;
    $('chargeur-chargement').hidden = true;
    $('chargeur-message').hidden = false;
    surface.setAttribute('aria-describedby', 'chargeur-texte');
    $('chargeur-texte').textContent = texte;
    $('chargeur-refus').hidden = !refus;
    $('chargeur-refus').textContent = refus || '';
    $('chargeur-plus').hidden = !plus;
    if (plus) $('chargeur-plus-texte').textContent = plus;
    $('chargeur-boutons').replaceChildren(...boutons.map((b) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = b.libelle;
      if (b.principal) el.className = 'principal';
      el.addEventListener('click', b.action);
      return el;
    }));
    montrer();
    const premier = $('chargeur-boutons').querySelector('button');
    if (premier) premier.focus({ preventScroll: true });
  }

  // Affiche le chargement après DELAI_MS, s'il n'est pas terminé avant.
  function chargementDiffere() {
    modeChargement();
    minuteur = setTimeout(montrer, DELAI_MS);
  }

  surface.addEventListener('keydown', (e) => { if (e.key === 'Escape') e.preventDefault(); });

  return { etape, message, chargementDiffere, fermer, estOuvert: () => ouvert };
}
