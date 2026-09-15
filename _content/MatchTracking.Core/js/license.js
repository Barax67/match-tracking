// Verifica ECDSA P-256/SHA-256 con firma raw r||s e chiave pubblica SPKI.
// Host-agnostico: stesso codice in WASM e nella WebView del Desktop.
function base64UrlToBytes(text) {
    const s = text.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(s + '==='.slice((s.length + 3) % 4));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
}

export async function verify(publicSpkiBase64, payloadPart, signaturePart) {
    try {
        const spki = base64UrlToBytes(publicSpkiBase64.replace(/=+$/, ''));
        const key = await crypto.subtle.importKey(
            'spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
        const firma = base64UrlToBytes(signaturePart);
        const dati = new TextEncoder().encode(payloadPart);
        return await crypto.subtle.verify(
            { name: 'ECDSA', hash: 'SHA-256' }, key, firma, dati);
    } catch {
        return false;
    }
}
