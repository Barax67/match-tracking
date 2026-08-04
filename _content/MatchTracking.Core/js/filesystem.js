// POC File System Access API: scegliere la cartella del video, leggere i file
// e scrivere un bundle (sidecar) accanto al video. Solo Chromium desktop.

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"];
const BUNDLE_SUFFIX = ".matchtracking";
const BUNDLE_FILE = "match.json";

// Handle della cartella scelta dall'utente, mantenuto a livello di modulo
// (il modulo è cached da import(), quindi sopravvive tra le chiamate interop).
let dirHandle = null;

export function isSupported() {
    return typeof window.showDirectoryPicker === "function";
}

// --- IndexedDB: persistenza del directory handle tra sessioni (Step B) ---

const DB_NAME = "matchtracking";
const HANDLE_STORE = "handles";

function openDb() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(HANDLE_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function idbPut(key, value) {
    const db = await openDb();
    await new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, "readwrite");
        tx.objectStore(HANDLE_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    });
    db.close();
}

async function idbGet(key) {
    const db = await openDb();
    const result = await new Promise((resolve, reject) => {
        const tx = db.transaction(HANDLE_STORE, "readonly");
        const r = tx.objectStore(HANDLE_STORE).get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
    db.close();
    return result;
}

// Salva il directory handle corrente + il video associato per questo match.
export async function saveHandle(matchId, videoName) {
    if (!dirHandle) return;
    await idbPut(matchId, { dirHandle, videoName });
}

// Tenta di ripristinare il handle salvato. NON chiede permessi (serve un gesto utente).
// Ritorna { videoName, permission } oppure null se non c'è nulla di salvato.
export async function tryRestore(matchId) {
    const rec = await idbGet(matchId);
    if (!rec || !rec.dirHandle) return null;
    dirHandle = rec.dirHandle;
    let permission = "prompt";
    try { permission = await dirHandle.queryPermission({ mode: "readwrite" }); } catch (e) { /* ignora */ }
    return { videoName: rec.videoName ?? null, permission };
}

// Richiede (se serve) il permesso readwrite sul handle ripristinato. Va chiamata da un gesto utente.
export async function ensurePermission() {
    if (!dirHandle) return "denied";
    try {
        let p = await dirHandle.queryPermission({ mode: "readwrite" });
        if (p === "granted") return p;
        return await dirHandle.requestPermission({ mode: "readwrite" });
    } catch (e) { return "denied"; }
}

function baseName(fileName) {
    const dot = fileName.lastIndexOf(".");
    return dot > 0 ? fileName.substring(0, dot) : fileName;
}

function isVideo(fileName) {
    const lower = fileName.toLowerCase();
    return VIDEO_EXTENSIONS.some(ext => lower.endsWith(ext));
}

// Apre il directory picker (readwrite). Ritorna { name, videos } oppure null se annullato.
export async function pickDirectory() {
    try {
        dirHandle = await window.showDirectoryPicker({ mode: "readwrite", id: "match-video" });
    } catch (e) {
        if (e && e.name === "AbortError") return null; // utente ha annullato
        throw e;
    }

    const videos = [];
    for await (const entry of dirHandle.values()) {
        if (entry.kind === "file" && isVideo(entry.name)) {
            videos.push(entry.name);
        }
    }
    videos.sort();
    return { name: dirHandle.name, videos };
}

// Scrive <basename>.matchtracking/match.json dentro la cartella scelta.
// Ritorna il path relativo scritto.
export async function writeBundle(videoName, jsonContent) {
    if (!dirHandle) throw new Error("Nessuna cartella selezionata.");
    const folderName = baseName(videoName) + BUNDLE_SUFFIX;
    const sub = await dirHandle.getDirectoryHandle(folderName, { create: true });
    const fileHandle = await sub.getFileHandle(BUNDLE_FILE, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(jsonContent);
    await writable.close();
    return `${dirHandle.name}/${folderName}/${BUNDLE_FILE}`;
}

// Apre un file video della cartella e ritorna un object URL da assegnare a <video src>.
export async function openVideoUrl(videoName) {
    if (!dirHandle) throw new Error("Nessuna cartella selezionata.");
    const fileHandle = await dirHandle.getFileHandle(videoName);
    const file = await fileHandle.getFile();
    return URL.createObjectURL(file);
}

let clipHandler = null;

// Riproduce un breve spezzone da `fromSeconds` e mette in pausa a `untilSeconds`.
// L'utente può poi riprendere con il play.
export function playClip(videoEl, fromSeconds, untilSeconds) {
    if (!videoEl) return;
    if (clipHandler) { videoEl.removeEventListener("timeupdate", clipHandler); clipHandler = null; }
    videoEl.currentTime = Math.max(0, fromSeconds);
    clipHandler = () => {
        if (videoEl.currentTime >= untilSeconds) {
            videoEl.pause();
            videoEl.removeEventListener("timeupdate", clipHandler);
            clipHandler = null;
        }
    };
    videoEl.addEventListener("timeupdate", clipHandler);
    const p = videoEl.play();
    if (p && p.catch) p.catch(() => { /* autoplay bloccato: resta fermo sul punto */ });
}

// Legge il tempo corrente del video (secondi), 0 se non disponibile.
export function getCurrentTime(videoEl) {
    return videoEl && Number.isFinite(videoEl.currentTime) ? videoEl.currentTime : 0;
}

// --- Controlli avanzati (Step C) ---

export function setPlaybackRate(videoEl, rate) {
    if (videoEl) videoEl.playbackRate = rate;
}

// Sposta il video di `delta` secondi (negativo = indietro).
export function nudge(videoEl, delta) {
    if (!videoEl) return;
    videoEl.currentTime = Math.max(0, videoEl.currentTime + delta);
}

// Registra lo spezzone [fromSeconds..toSeconds] (in tempo reale) e lo salva come WebM
// in <nome-video>.matchtracking/clips/<clipName>. Ritorna il path scritto.
export async function exportClip(videoEl, videoName, clipName, fromSeconds, toSeconds) {
    if (!dirHandle) throw new Error("Nessuna cartella selezionata.");
    if (!videoEl || typeof videoEl.captureStream !== "function") {
        throw new Error("Export non supportato da questo browser.");
    }
    const stream = videoEl.captureStream();
    const chunks = [];
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm" });
    recorder.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
    const stopped = new Promise(res => { recorder.onstop = res; });

    videoEl.pause();
    videoEl.currentTime = Math.max(0, fromSeconds);
    await new Promise(res => videoEl.addEventListener("seeked", res, { once: true }));

    recorder.start();
    await videoEl.play();
    await new Promise(res => {
        const onTime = () => {
            if (videoEl.currentTime >= toSeconds) {
                videoEl.removeEventListener("timeupdate", onTime);
                videoEl.pause();
                res();
            }
        };
        videoEl.addEventListener("timeupdate", onTime);
    });
    recorder.stop();
    await stopped;

    const blob = new Blob(chunks, { type: "video/webm" });
    const folderName = baseName(videoName) + BUNDLE_SUFFIX;
    const sub = await dirHandle.getDirectoryHandle(folderName, { create: true });
    const clips = await sub.getDirectoryHandle("clips", { create: true });
    const fh = await clips.getFileHandle(clipName, { create: true });
    const writable = await fh.createWritable();
    await writable.write(blob);
    await writable.close();
    return `${dirHandle.name}/${folderName}/clips/${clipName}`;
}

// Legge le proposte AI dal bundle (<base>.matchtracking/proposals.json). Null se assente.
export async function readProposals(videoName) {
    if (!dirHandle) throw new Error("Nessuna cartella selezionata.");
    const folderName = baseName(videoName) + BUNDLE_SUFFIX;
    try {
        const sub = await dirHandle.getDirectoryHandle(folderName);
        const fileHandle = await sub.getFileHandle("proposals.json");
        const file = await fileHandle.getFile();
        return await file.text();
    } catch (e) {
        if (e && e.name === "NotFoundError") return null;
        throw e;
    }
}

// Rilegge il bundle scritto. Ritorna il contenuto, o null se non esiste.
export async function readBundle(videoName) {
    if (!dirHandle) throw new Error("Nessuna cartella selezionata.");
    const folderName = baseName(videoName) + BUNDLE_SUFFIX;
    try {
        const sub = await dirHandle.getDirectoryHandle(folderName);
        const fileHandle = await sub.getFileHandle(BUNDLE_FILE);
        const file = await fileHandle.getFile();
        return await file.text();
    } catch (e) {
        if (e && e.name === "NotFoundError") return null;
        throw e;
    }
}
