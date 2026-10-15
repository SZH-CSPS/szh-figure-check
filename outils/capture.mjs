// Ouvre une page dans Edge ou Chrome sans fenêtre, attend `body[data-etat="fini"]`,
// imprime le tableau des textes et enregistre une capture de la page entière, ou le
// rapport imprimé si la sortie finit par .pdf.
//   node outils/capture.mjs <url> <capture.png> [navigateur]

import { spawn } from 'node:child_process';
import { writeFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [url, sortie, navigateur = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'] = process.argv.slice(2);
const PORT = 9333;
const profil = await mkdtemp(join(tmpdir(), 'szh-capture-'));
const proc = spawn(navigateur, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profil}`,
  '--window-size=1280,1000', '--hide-scrollbars',
  // CAPTURE_HORS_LIGNE : tout nom d'hôte autre que celui de la page est introuvable ;
  // prouve que la page ne dépend d'aucun autre serveur.
  ...(process.env.CAPTURE_HORS_LIGNE ? [`--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE ${new URL(url).hostname}`] : []),
  'about:blank',
], { stdio: 'ignore' });

// Ferme le navigateur et efface son profil temporaire.
async function fermer() {
  ws.close();
  proc.kill();
  await new Promise((ok) => proc.once('exit', ok));
  await rm(profil, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  process.exit(0);
}

const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));
let cible;
for (let i = 0; i < 50 && !cible; i++) {
  await attendre(200);
  try {
    const liste = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
    cible = liste.find((c) => c.type === 'page');
  } catch { /* navigateur pas encore prêt */ }
}
const ws = new WebSocket(cible.webSocketDebuggerUrl);
await new Promise((ok) => ws.addEventListener('open', ok));
let id = 0;
const enAttente = new Map();
ws.addEventListener('message', (e) => {
  const m = JSON.parse(e.data);
  if (m.id && enAttente.has(m.id)) { enAttente.get(m.id)(m); enAttente.delete(m.id); }
  if (m.method === 'Runtime.consoleAPICalled') console.log('[console]', m.params.args.map((a) => a.value ?? a.description).join(' '));
  if (m.method === 'Log.entryAdded') console.log('[log]', m.params.entry.level, m.params.entry.text, m.params.entry.url || '');
  if (m.method === 'Runtime.exceptionThrown') console.log('[exception]', m.params.exceptionDetails.exception?.description);
});
const cdp = (method, params = {}) => new Promise((ok) => { const n = ++id; enAttente.set(n, ok); ws.send(JSON.stringify({ id: n, method, params })); });
const evaluer = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.result.value;

await cdp('Runtime.enable');
await cdp('Log.enable');
await cdp('Page.enable');
await cdp('Page.navigate', { url });
const debut = Date.now();
while (Date.now() - debut < 300000) {
  await attendre(1000);
  if (await evaluer('document.body && document.body.dataset.etat')) break;
}
console.log('etat :', await evaluer('document.body.dataset.etat'), `(${Math.round((Date.now() - debut) / 1000)} s)`);
console.log(await evaluer(`[document.getElementById('dimensions').textContent,
  ...[...document.querySelectorAll('#alertes-page li, #bilan p, #ensemble p, #zones-titre, .zone, #zones-reste')].map(e => e.textContent),
  ...[...document.querySelectorAll('#table-textes tbody tr')].map(tr => [...tr.cells].map(c => c.textContent).join(' | ')),
  document.getElementById('erreur').hidden ? '' : 'ERREUR ' + document.getElementById('erreur').textContent].join('\\n')`));
// CAPTURE_JS : script joué avant la capture (survol simulé, par exemple) ;
// CAPTURE_CLIP : sélecteur de l'élément à capturer seul ;
// CAPTURE_MEDIA=print : la page telle que l'imprimante la voit, en capture d'écran.
if (process.env.CAPTURE_JS) await evaluer(process.env.CAPTURE_JS);
if (process.env.CAPTURE_MEDIA) await cdp('Emulation.setEmulatedMedia', { media: process.env.CAPTURE_MEDIA });
if (sortie.endsWith('.pdf')) {
  // Rapport imprimé, tel que le donne le bouton « Imprimer le rapport » ; avec
  // CAPTURE_IMPRESSION=page, la page simulée seule, comme le bouton « Imprimer à 100 % ».
  if (process.env.CAPTURE_IMPRESSION !== 'page') await evaluer(`document.body.dataset.impression = 'rapport';
    document.getElementById('style-impression').textContent = '@page { size: A4; margin: 15mm; }';
    document.getElementById('details-textes').open = true;`);
  const pdf = await cdp('Page.printToPDF', { preferCSSPageSize: true, printBackground: true });
  await writeFile(sortie, Buffer.from(pdf.result.data, 'base64'));
  await fermer();
}
const { cssContentSize } = (await cdp('Page.getLayoutMetrics')).result;
const capture = await cdp('Page.captureScreenshot', {
  format: 'png', captureBeyondViewport: true,
  clip: process.env.CAPTURE_CLIP
    ? { ...(await evaluer(`(() => { const r = document.querySelector(${JSON.stringify(process.env.CAPTURE_CLIP)}).getBoundingClientRect(); return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height }; })()`)), scale: 1 }
    : { x: 0, y: 0, width: cssContentSize.width, height: cssContentSize.height, scale: 1 },
});
await writeFile(sortie, Buffer.from(capture.result.data, 'base64'));
await fermer();
