// Mécanique commune des vues à puces numérotées et panneau (textes, objets du graphique).
// Le survol d'une puce montre un aperçu, le clic la rend active, sortir de la rangée de
// puces revient à l'endroit actif. Le panneau dit s'il montre l'endroit actif ou un aperçu.
//   panneau    élément qui reçoit l'en-tête et la carte
//   boutons    une puce par endroit, dans l'ordre des numéros
//   rangee     conteneur des puces, dont la sortie du pointeur rend l'actif
//   carteDe(i) carte de l'endroit i
//   surFigure(i) met l'endroit i en évidence sur la figure (null : aucun)
//   vide       phrase du panneau quand aucun endroit n'est montré
//   actif      endroit actif au départ (null : aucun)
//   auChoix(i) appelé quand un autre endroit devient actif
// Renvoie { montrer, epingler, epingle } ; `epingle()` est l'endroit actif.
export function explorateur({ panneau, boutons, rangee, total, carteDe, surFigure, vide, actif, auChoix, t }) {
  const choix = { epingle: actif };
  let hauteur = 0;
  panneau.style.minHeight = '';
  const montrer = (i) => {
    surFigure(i);
    boutons.forEach((b, k) => {
      const courant = k === choix.epingle;
      b.setAttribute('aria-pressed', String(courant));
      b.tabIndex = courant ? 0 : -1;
      b.classList.toggle('apercu', k === i && !courant);
    });
    if (i == null) {
      const p = document.createElement('p');
      p.className = 'discret';
      p.textContent = vide;
      panneau.replaceChildren(p);
      return;
    }
    const apercu = i !== choix.epingle;
    const etat = document.createElement('p');
    etat.className = `panneau-etat${apercu ? ' apercu' : ''}`;
    etat.textContent = apercu ? t('panneauApercu', { n: i + 1, actif: choix.epingle + 1 }) : t('panneauActif', { n: i + 1, total });
    panneau.classList.toggle('apercu', apercu);
    panneau.replaceChildren(etat, carteDe(i));
    // Le panneau ne rapetisse jamais pendant qu'on passe d'un numéro à l'autre : en bas de
    // page, un panneau plus court ferait remonter la page, le numéro sortirait de sous la
    // souris et l'affichage clignoterait.
    hauteur = Math.max(hauteur, panneau.offsetHeight);
    panneau.style.minHeight = `${hauteur}px`;
  };
  const epingler = (i) => {
    const change = i !== choix.epingle;
    choix.epingle = i;
    montrer(i);
    if (change && auChoix) auChoix(i);
  };
  rangee.addEventListener('mouseleave', () => montrer(choix.epingle));
  boutons.forEach((b, i) => {
    b.addEventListener('mouseenter', () => montrer(i));
    b.addEventListener('focus', () => epingler(i));
    b.addEventListener('click', () => epingler(i));
    b.addEventListener('keydown', (e) => {
      const d = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
      if (!d) return;
      e.preventDefault();
      boutons[(i + d + boutons.length) % boutons.length].focus();
    });
  });
  montrer(choix.epingle);
  return { montrer, epingler, epingle: () => choix.epingle };
}

export const SYMBOLES = { corriger: '✕', ameliorer: '!', ok: '✓' };
const NIVEAUX = ['corriger', 'ameliorer', 'ok'];

function el(nom, attributs = {}, ...enfants) {
  const e = document.createElement(nom);
  for (const [k, v] of Object.entries(attributs)) {
    if (k === 'class') e.className = v;
    else e.setAttribute(k, v);
  }
  e.append(...enfants);
  return e;
}

// Une puce numérotée : le bouton de l'endroit `n`, à la couleur de son niveau.
export function puce(niveau, n, libelle, panneau = 'panneau') {
  return el('button', { type: 'button', 'aria-pressed': 'false', 'aria-controls': panneau, class: `puce ${niveau}`, 'aria-label': libelle }, String(n));
}

// Les boîtes « À corriger », « À améliorer » et « Conforme », chacune avec le compte de ses
// endroits, sa légende et ses puces ; `niveaux[i]` est le niveau de `boutons[i]`. Une boîte
// sans endroit n'est pas rendue. Renvoie la rangée à placer dans le conteneur des puces.
export function rangeeNiveaux(boutons, niveaux, t) {
  return el('div', { class: 'boites-niveaux' }, ...NIVEAUX.filter((niveau) => niveaux.includes(niveau)).map((niveau) => {
    const ici = boutons.filter((b, i) => niveaux[i] === niveau);
    return el('section', { class: `boite-niveau ${niveau}`, 'aria-label': t(`niveau_${niveau}`) },
      el('p', { class: 'boite-titre' },
        el('span', { class: 'symbole', 'aria-hidden': 'true' }, SYMBOLES[niveau]), ' ',
        el('b', {}, t(`niveau_${niveau}`)), ' ',
        el('span', { class: 'discret' }, t('nEndroits', { n: ici.length }))),
      el('p', { class: 'boite-legende discret' }, t(`legende_${niveau}`)),
      el('div', { class: 'boite-puces' }, ...ici));
  }));
}
