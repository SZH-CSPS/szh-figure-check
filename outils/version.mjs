// Version des fichiers de la page : node outils/version.mjs, avant chaque publication.
// GitHub Pages sert chaque fichier avec un cache de dix minutes ; sans version, un
// navigateur peut associer le nouvel index.html à un ancien module. Chaque référence
// interne à un fichier .js, .mjs ou .css porte donc le suffixe ?v=<version>, le même
// partout, et un changement de version change toutes les adresses à la fois.
// La version est l'empreinte du contenu servi, suffixes retirés : elle ne change que si
// un fichier change, et le test vérifie qu'elle est à jour.

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = fileURLToPath(new URL('..', import.meta.url));

// Fichiers qui portent des références, et vendor/README.md, qui donne les empreintes des
// bibliothèques : une bibliothèque mise à jour change aussi la version.
export const FICHIERS = ['index.html', ...readdirSync(racine).filter((f) => f.endsWith('.css')), ...readdirSync(join(racine, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`)];
const EMPREINTES = ['vendor/README.md'];

// Une chaîne entre guillemets qui désigne un fichier local .js, .mjs ou .css, avec ou sans
// suffixe de version.
export const REFERENCE = /(['"`])((?!https?:|\/)[\w./-]+\.(?:m?js|css))(\?v=[0-9a-f]*)?\1/g;

const lire = (f) => readFileSync(join(racine, f), 'utf8');
const sansVersion = (texte) => texte.replace(REFERENCE, (_, q, chemin) => q + chemin + q);

export function versionAttendue() {
  const h = createHash('sha256');
  for (const f of [...FICHIERS, ...EMPREINTES]) h.update(f + '\0' + sansVersion(lire(f)) + '\0');
  return h.digest('hex').slice(0, 10);
}

// Les références trouvées dans chaque fichier : [{ fichier, chemin, version }].
export function references() {
  return FICHIERS.flatMap((fichier) => [...lire(fichier).matchAll(REFERENCE)]
    .map((m) => ({ fichier, chemin: m[2], version: m[3] ? m[3].slice(3) : null })));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const version = versionAttendue();
  let modifies = 0;
  for (const f of FICHIERS) {
    const avant = lire(f);
    const apres = avant.replace(REFERENCE, (_, q, chemin) => `${q}${chemin}?v=${version}${q}`);
    if (apres !== avant) { writeFileSync(join(racine, f), apres); modifies++; }
  }
  console.log(`version ${version} (${modifies} fichier${modifies > 1 ? 's' : ''} modifié${modifies > 1 ? 's' : ''})`);
}
