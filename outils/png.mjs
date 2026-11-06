// Décodeur PNG minimal, sans dépendance : 8 bits par canal, gris, RVB, gris + alpha ou RVBA,
// non entrelacé (ce que produisent les navigateurs et la plupart des logiciels). Rend
// { largeur, hauteur, rgba } avec un Uint8ClampedArray RVBA, alpha composé sur blanc.

import { inflateSync } from 'node:zlib';

export function lirePng(octets) {
  const d = Buffer.from(octets);
  if (d.readUInt32BE(0) !== 0x89504e47) throw new Error('pas un PNG');
  let p = 8, largeur = 0, hauteur = 0, profondeur = 0, type = 0, entrelace = 0;
  const donnees = [];
  while (p < d.length) {
    const n = d.readUInt32BE(p), nom = d.toString('ascii', p + 4, p + 8);
    const corps = d.subarray(p + 8, p + 8 + n);
    if (nom === 'IHDR') { largeur = corps.readUInt32BE(0); hauteur = corps.readUInt32BE(4); profondeur = corps[8]; type = corps[9]; entrelace = corps[12]; }
    else if (nom === 'IDAT') donnees.push(corps);
    else if (nom === 'IEND') break;
    p += 12 + n;
  }
  const canaux = { 0: 1, 2: 3, 4: 2, 6: 4 }[type];
  if (profondeur !== 8 || !canaux || entrelace) throw new Error(`PNG non pris en charge (type ${type}, ${profondeur} bits, entrelacé ${entrelace})`);
  const brut = inflateSync(Buffer.concat(donnees));
  const ligne = largeur * canaux, px = new Uint8Array(ligne * hauteur);
  for (let y = 0; y < hauteur; y++) {
    const filtre = brut[y * (ligne + 1)], src = y * (ligne + 1) + 1, dst = y * ligne;
    for (let i = 0; i < ligne; i++) {
      const a = i >= canaux ? px[dst + i - canaux] : 0, b = y ? px[dst - ligne + i] : 0, c = y && i >= canaux ? px[dst - ligne + i - canaux] : 0;
      let v = brut[src + i];
      if (filtre === 1) v += a;
      else if (filtre === 2) v += b;
      else if (filtre === 3) v += (a + b) >> 1;
      else if (filtre === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[dst + i] = v & 255;
    }
  }
  const rgba = new Uint8ClampedArray(largeur * hauteur * 4);
  for (let i = 0; i < largeur * hauteur; i++) {
    const s = i * canaux;
    const [r, g, b, al] = canaux === 1 ? [px[s], px[s], px[s], 255] : canaux === 2 ? [px[s], px[s], px[s], px[s + 1]] : canaux === 3 ? [px[s], px[s + 1], px[s + 2], 255] : [px[s], px[s + 1], px[s + 2], px[s + 3]];
    const k = al / 255;
    rgba[i * 4] = r * k + 255 * (1 - k); rgba[i * 4 + 1] = g * k + 255 * (1 - k); rgba[i * 4 + 2] = b * k + 255 * (1 - k); rgba[i * 4 + 3] = 255;
  }
  return { largeur, hauteur, rgba };
}
