// La page ne charge rien depuis un autre serveur : pas d'URL externe dans ce qui est servi,
// une politique de sécurité de contenu limitée au site, et les bibliothèques présentes dans
// vendor/ avec les empreintes annoncées.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = fileURLToPath(new URL('..', import.meta.url));
const lire = (chemin) => readFileSync(join(racine, chemin), 'utf8');
const servis = ['index.html', ...readdirSync(racine).filter((f) => f.endsWith('.css')), ...readdirSync(join(racine, 'js')).map((f) => `js/${f}`)];

test('aucune URL externe dans les fichiers de la page', () => {
  for (const f of servis) {
    const urls = lire(f).match(/https?:\/\/[^\s'"`)]+/g) || [];
    const externes = urls.filter((u) => !u.startsWith('http://www.w3.org/'));
    assert.deepEqual(externes, [], f);
  }
});

test('la politique de sécurité de contenu n’autorise que le site lui-même', () => {
  const html = lire('index.html');
  const csp = /http-equiv="Content-Security-Policy" content="([^"]+)"/.exec(html);
  assert.ok(csp, 'CSP absente');
  for (const directive of csp[1].split(';').map((d) => d.trim()).filter(Boolean)) {
    const [nom, ...sources] = directive.split(/\s+/);
    for (const s of sources) {
      assert.ok(["'self'", "'none'", "'wasm-unsafe-eval'", "'unsafe-inline'", 'blob:', 'data:'].includes(s), `${nom} ${s}`);
    }
  }
});

test('les bibliothèques de vendor/ ont les empreintes annoncées', () => {
  const bloc = /```\n([\s\S]+?)```/.exec(lire('vendor/README.md'))[1];
  const lignes = bloc.trim().split('\n').map((l) => l.split(/\s+/));
  assert.ok(lignes.length >= 13);
  for (const [empreinte, chemin] of lignes) {
    const calcul = createHash('sha256').update(readFileSync(join(racine, 'vendor', chemin))).digest('hex');
    assert.equal(calcul, empreinte, chemin);
  }
});

test('la table des tailles du préchargement correspond aux fichiers de vendor/', async () => {
  const { TABLE } = await import('../js/prechargement.js');
  const { VENDOR } = await import('../js/fichiers.js');
  for (const f of TABLE) {
    const adresse = new URL(f.url);
    assert.ok(f.url.startsWith(VENDOR.href), f.url);
    const disque = fileURLToPath(new URL(adresse.pathname, 'file:///'));
    assert.equal(statSync(disque).size, f.taille, adresse.pathname);
  }
  assert.equal(new Set(TABLE.map((f) => f.url)).size, TABLE.length);
});
