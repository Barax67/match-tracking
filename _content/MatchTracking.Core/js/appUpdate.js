// Ciclo di vita del service worker: unico punto dell'app che tocca quell'API.
// Sul Desktop (BlazorWebView) non c'e' nessun service worker: init ritorna false
// e tutta l'interfaccia di aggiornamento resta nascosta.

let registration = null;
let dotNetRef = null;
let applyRequested = false;

export async function init(ref) {
    if (!('serviceWorker' in navigator)) return false;
    try {
        registration = await navigator.serviceWorker.getRegistration();
    } catch {
        return false;
    }
    if (!registration) return false;

    dotNetRef = ref;

    // Reload solo se l'aggiornamento l'abbiamo chiesto noi: un controllerchange
    // spontaneo ricaricherebbe la pagina sotto le mani dell'utente.
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (applyRequested) location.reload();
    });

    // Il worker puo' essere gia' in attesa da una visita precedente, oppure gia' in
    // installazione: register() parte all'inizio del caricamento e updatefound scatta
    // spesso prima che Blazor abbia finito di bootare, quindi il solo listener non basta.
    if (registration.waiting) notifyReady();
    else track(registration.installing);

    registration.addEventListener('updatefound', () => track(registration.installing));

    return true;
}

function track(worker) {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
        if (worker.state === 'installed') notifyReady();
    });
}

// Solo se la pagina e' gia' controllata: alla primissima visita il worker si
// installa e basta — e' un'installazione, non un aggiornamento.
function notifyReady() {
    if (!navigator.serviceWorker.controller || !dotNetRef) return;
    dotNetRef.invokeMethodAsync('OnUpdateReady');
}

export async function checkForUpdate() {
    if (!registration) return false;
    try {
        await registration.update();
    } catch {
        return false;
    }
    // Senza agganciare qui il worker trovato, "Cerca aggiornamenti" puo' dire
    // "Aggiornamento in arrivo..." e poi non mostrare mai il banner: nessuno
    // starebbe osservando la transizione di questo installing/waiting.
    if (registration.waiting) notifyReady();
    else track(registration.installing);
    return !!(registration.installing || registration.waiting);
}

export function applyUpdate() {
    if (!registration || !registration.waiting) return false;
    applyRequested = true;
    registration.waiting.postMessage('skipWaiting');
    return true;
}

export function version() {
    const meta = document.querySelector('meta[name="app-version"]');
    return meta ? meta.content : '';
}
