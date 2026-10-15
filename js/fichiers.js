// Adresses des fichiers lourds de vendor/, à un seul endroit : lecture.js, detection.js et
// prechargement.js demandent exactement les mêmes, pour que le cache HTTP serve les
// téléchargements du préchargement. Les adresses sont absolues : le travailleur de
// Tesseract les résout depuis sa propre adresse.

export const VENDOR = new URL('../vendor/', import.meta.url);
const vers = (chemin) => new URL(chemin, VENDOR).href;

export const TESSERACT = vers('tesseract/tesseract.min.js?v=7d9fcb2a91');
export const TESSERACT_WORKER = vers('tesseract/worker.min.js?v=7d9fcb2a91');
export const TESSERACT_CORE_DOSSIER = vers('tesseract-core/');
// Le moteur est demandé par Tesseract.js sans suffixe de version : le nom est assemblé pour
// que outils/version.mjs n'en ajoute pas.
export const TESSERACT_CORE = vers(`tesseract-core/${['tesseract-core-simd-lstm', 'wasm', 'js'].join('.')}`);
export const TESSDATA_DOSSIER = vers('tessdata/');
export const ORT = vers('onnxruntime/ort.wasm.min.js?v=7d9fcb2a91');
export const ORT_MJS = vers('onnxruntime/ort-wasm-simd-threaded.mjs?v=7d9fcb2a91');
export const ORT_WASM = vers('onnxruntime/ort-wasm-simd-threaded.wasm');
export const MODELE = vers('modele/ch_PP-OCRv3_det_infer.onnx');
export const LANGUES_OCR = ['fra', 'deu', 'eng'];
export const tessdata = (langue) => vers(`tessdata/${langue}.traineddata.gz`);
