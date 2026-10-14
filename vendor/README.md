# Bibliothèques servies avec la page

Tout ce que la page charge vient de ce dossier : aucune connexion vers un autre serveur
(voir la politique de sécurité de contenu dans `index.html`). Les fichiers sont copiés tels
quels des paquets npm, sans modification.

| Dossier | Paquet npm | Fichiers | Licence |
|---|---|---|---|
| `tesseract/` | `tesseract.js@5.1.1`, `dist/` | `tesseract.min.js`, `worker.min.js` | Apache 2.0 (`tesseract/LICENSE.md`) |
| `tesseract-core/` | `tesseract.js-core@5.1.1` | `tesseract-core-simd-lstm.wasm.js`, `tesseract-core-lstm.wasm.js` (sans SIMD) | Apache 2.0 (`tesseract-core/LICENSE`) |
| `tessdata/` | `@tesseract.js-data/{fra,deu,eng}@1.0.0`, `4.0.0_best_int/` | `fra`, `deu`, `eng.traineddata.gz` | modèles tessdata_best de Tesseract, Apache 2.0 ; paquet MIT |
| `pdfjs/` | `pdfjs-dist@4.4.168`, `build/` | `pdf.min.mjs`, `pdf.worker.min.mjs` | Apache 2.0 (`pdfjs/LICENSE`) |

Seuls les moteurs « LSTM » sont copiés : l'OCR tourne en mode 1 (LSTM seul). Ce sont les
mêmes fichiers que Tesseract.js irait chercher sur jsDelivr avec ses réglages par défaut.

Empreintes SHA-256 :

```
895c72c332dbd608a07ae54003e5e42741c566ade52ddbd2a00c8e57ffa35d9d  pdfjs/pdf.min.mjs
a7cf858ab0bbe21a00ef438c24a4ef5833c3d05935a294382c8d0773a8958f50  pdfjs/pdf.worker.min.mjs
306c4280d0cbed46fbff727486bd43b92730181bae80f56941a091f363bdf28b  tessdata/deu.traineddata.gz
45b4cb346724ac1774f1c36f42f182b887bcdb28ebe63e6fff90ac41f3fcff91  tessdata/eng.traineddata.gz
d611139672b3752c7097e671e4a1d9209dfd37f2aeb081ef6487fba3351e9255  tessdata/fra.traineddata.gz
8f04aa0cc81e7bde33f80e92fa01a7a665f0b4884d098acf5de9c7104a11dfaa  tesseract-core/tesseract-core-lstm.wasm.js
ce20eda9533cbed1e6c2b4276fbae1e0adc61b6754b5513084be601787b457cf  tesseract-core/tesseract-core-simd-lstm.wasm.js
a8e29918d098b2b06e1012bdaeffb4aec0445c5d5654709023e0bd1f442a80e8  tesseract/tesseract.min.js
aca1229639fc9907d86f96e825955a2b7c5716d17f3bc3acd71f9c7ab66181fc  tesseract/worker.min.js
```

Pour mettre à jour : `npm pack <paquet>@<version>`, copier les mêmes fichiers, relancer
`node --test test/*.test.mjs` et `CAPTURE_HORS_LIGNE=1 node outils/capture.mjs …` (README
principal), puis mettre à jour ce tableau et les empreintes.
