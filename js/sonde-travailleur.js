// Travailleur d'essai : dit si WebAssembly existe dans un Web Worker (un bloqueur peut le
// retirer des travailleurs seulement, alors que la page l'a).
postMessage(typeof WebAssembly === 'object');
