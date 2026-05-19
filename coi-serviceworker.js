/* coi-serviceworker.js - Cross-Origin Isolation for SharedArrayBuffer
 * Enables FFmpeg.wasm on platforms that don't send COOP/COEP headers (e.g. GitHub Pages)
 * Based on https://github.com/gzuidhof/coi-serviceworker with permission.
 * License: MIT
 */

'use strict';

let isCoiEnabled = false;

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(clients.claim()));

self.addEventListener('fetch', function (e) {
    const request = e.request;
    if (request.cache === 'only-if-cached' && request.mode !== 'same-origin') return;

    // Only intercept same-origin requests
    if (request.url.startsWith(self.location.origin)) {
        e.respondWith(
            fetch(request)
                .then((response) => {
                    const newHeaders = new Headers(response.headers);
                    newHeaders.set('Cross-Origin-Opener-Policy', 'same-origin');
                    newHeaders.set('Cross-Origin-Embedder-Policy', 'require-corp');
                    newHeaders.set('Cross-Origin-Resource-Policy', 'cross-origin');

                    return new Response(response.body, {
                        status: response.status,
                        statusText: response.statusText,
                        headers: newHeaders,
                    });
                })
                .catch(() => {
                    // If fetch fails (e.g. offline), return a basic response
                    return new Response('', { status: 503 });
                })
        );
    }
});
