// Ouvre une figure déposée : image bitmap, SVG ou première page d'un PDF. Chaque source
// donne une URL pour <img>, son rapport hauteur / largeur, sa taille intrinsèque en px CSS
// (ou null), son espace de coordonnées d'origine (`espace`, celui de l'export : pixels de
// l'image, unités du SVG, points du PDF), une fonction qui la dessine sur un canevas d'une
// largeur donnée et, pour le SVG et le PDF, la liste exacte de ses textes.

const PDFJS = new URL('../vendor/pdfjs/', import.meta.url).href;

const UNITES_PX = { '': 1, px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96 };

function longueurPx(valeur) {
  const m = /^\s*([\d.]+)\s*(px|pt|pc|mm|cm|in)?\s*$/.exec(valeur || '');
  return m ? parseFloat(m[1]) * UNITES_PX[m[2] || ''] : null;
}

function canevas(l, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(l));
  c.height = Math.max(1, Math.round(h));
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';                // la page est blanche : la transparence aussi
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  return c;
}

export async function ouvrir(fichier) {
  const nom = fichier.name.toLowerCase();
  if (fichier.type === 'application/pdf' || nom.endsWith('.pdf')) return ouvrirPdf(fichier);
  if (fichier.type === 'image/svg+xml' || nom.endsWith('.svg')) return ouvrirSvg(fichier);
  return ouvrirBitmap(fichier);
}

async function ouvrirBitmap(fichier) {
  const image = await createImageBitmap(fichier);
  return {
    type: 'bitmap',
    nom: fichier.name,
    url: URL.createObjectURL(fichier),
    ratio: image.height / image.width,
    naturel: { l: image.width, h: image.height },
    pixels: { l: image.width, h: image.height },
    espace: { l: image.width, h: image.height },
    dessiner(l) {
      const c = canevas(l, l * image.height / image.width);
      c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
      return c;
    },
    textesExacts: null,
  };
}

// Retire ce qui pourrait s'exécuter : le SVG est ensuite inséré dans la page pour mesurer
// ses textes.
function nettoyerSvg(racine) {
  racine.querySelectorAll('script, foreignObject, iframe').forEach((n) => n.remove());
  for (const el of racine.querySelectorAll('*')) {
    for (const a of [...el.attributes]) {
      if (/^on/i.test(a.name) || /javascript:/i.test(a.value)) el.removeAttribute(a.name);
    }
  }
}

async function ouvrirSvg(fichier) {
  const doc = new DOMParser().parseFromString(await fichier.text(), 'image/svg+xml');
  const svg = doc.documentElement;
  if (svg.nodeName !== 'svg') throw new Error('svg-illisible');
  nettoyerSvg(svg);
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const lAttr = longueurPx(svg.getAttribute('width'));
  const hAttr = longueurPx(svg.getAttribute('height'));
  const lVb = vb.length === 4 ? vb[2] : null, hVb = vb.length === 4 ? vb[3] : null;
  const l = lAttr || lVb || 300, h = hAttr || hVb || 150;
  if (!svg.getAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${l} ${h}`);
  const source = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([source], { type: 'image/svg+xml' }));
  const image = new Image();
  image.src = url;
  await image.decode();
  return {
    type: 'svg',
    nom: fichier.name,
    url,
    ratio: h / l,
    naturel: lAttr ? { l: lAttr, h: hAttr || lAttr * h / l } : null,
    pixels: null,
    espace: { l, h },
    svgSource: source,                   // pour lire les formes (objets.js)
    dessiner(largeur) {
      const c = canevas(largeur, largeur * h / l);
      c.getContext('2d').drawImage(image, 0, 0, c.width, c.height);
      return c;
    },
    textesExacts(largeur) {
      const hote = document.createElement('div');
      hote.style.cssText = 'position:absolute;left:-100000px;top:0;visibility:hidden';
      hote.innerHTML = source;
      const s = hote.firstElementChild;
      s.setAttribute('width', largeur);
      s.setAttribute('height', largeur * h / l);
      document.body.append(hote);
      const cadre = s.getBoundingClientRect();
      const textes = [];
      for (const el of s.querySelectorAll('text, tspan')) {
        const propre = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.data).join('').trim();
        if (!propre) continue;
        const r = el.getBoundingClientRect();
        const m = el.getScreenCTM();
        const corps = parseFloat(getComputedStyle(el).fontSize) * Math.hypot(m.c, m.d);
        textes.push({
          texte: el.textContent.trim(),
          bbox: { x0: r.left - cadre.left, y0: r.top - cadre.top, x1: r.right - cadre.left, y1: r.bottom - cadre.top },
          corpsPx: corps,
        });
      }
      hote.remove();
      return textes;
    },
  };
}

let pdfjs = null;

async function ouvrirPdf(fichier) {
  if (!pdfjs) {
    pdfjs = await import(PDFJS + 'pdf.min.mjs?v=a709c71204');
    pdfjs.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.mjs?v=a709c71204';
  }
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(await fichier.arrayBuffer()), isEvalSupported: false }).promise;
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const rendre = async (largeur) => {
    const vue = page.getViewport({ scale: largeur / base.width });
    const brut = document.createElement('canvas');
    brut.width = Math.round(vue.width);
    brut.height = Math.round(vue.height);
    await page.render({ canvasContext: brut.getContext('2d'), viewport: vue }).promise;
    const c = canevas(brut.width, brut.height);
    c.getContext('2d').drawImage(brut, 0, 0);
    return c;
  };
  const apercu = await rendre(1600);
  const url = URL.createObjectURL(await new Promise((ok) => apercu.toBlob(ok, 'image/png')));
  return {
    type: 'pdf',
    nom: fichier.name,
    url,
    ratio: base.height / base.width,
    naturel: { l: base.width * 96 / 72, h: base.height * 96 / 72 },
    pixels: null,
    espace: { l: base.width, h: base.height },
    pdfPage: page,                       // pour lire les tracés (objets.js)
    pdfOps: pdfjs.OPS,
    dessiner: rendre,
    async textesExacts(largeur) {
      const vue = page.getViewport({ scale: largeur / base.width });
      const contenu = await page.getTextContent();
      const textes = [];
      for (const item of contenu.items) {
        if (!item.str || !item.str.trim()) continue;
        const t = pdfjs.Util.transform(vue.transform, item.transform);
        const corps = Math.hypot(t[2], t[3]);
        const x = t[4], ligneBase = t[5];
        const l = item.width * vue.scale;
        textes.push({
          texte: item.str.trim(),
          bbox: { x0: x, y0: ligneBase - corps * 0.8, x1: x + l, y1: ligneBase + corps * 0.2 },
          corpsPx: corps,
        });
      }
      return textes;
    },
  };
}
