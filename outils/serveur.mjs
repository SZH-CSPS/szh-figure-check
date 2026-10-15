// Serveur statique de développement : node outils/serveur.mjs [port]. Les modules ES ne se
// chargent pas depuis file://.

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const racine = resolve(fileURLToPath(new URL('..', import.meta.url)));
const port = Number(process.argv[2]) || 8123;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.ttf': 'font/ttf', '.pdf': 'application/pdf', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8',
};

// SERVEUR_CACHE=1 : cache dix minutes, comme GitHub Pages (pour mesurer ce que le cache HTTP sert).
const ENTETES_CACHE = process.env.SERVEUR_CACHE ? { 'cache-control': 'max-age=600' } : {};

createServer(async (req, res) => {
  const chemin = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const fichier = normalize(join(racine, chemin.endsWith('/') ? chemin + 'index.html' : chemin));
  if (!fichier.startsWith(racine)) { res.writeHead(403).end(); return; }
  try {
    const contenu = await readFile(fichier);
    res.writeHead(200, { 'content-type': TYPES[extname(fichier)] || 'application/octet-stream', ...ENTETES_CACHE }).end(contenu);
  } catch {
    res.writeHead(404).end();
  }
}).listen(port, () => console.log(`http://localhost:${port}/`));
