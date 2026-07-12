// Minimal service worker for PWA installability (#391). Android Chrome gates the
// "Install app" prompt on a registered service worker that has a fetch handler —
// a valid manifest alone isn't always enough. This is exactly that and nothing
// more: a network pass-through with no caching (offline is a later concern). Its
// PRESENCE is what unlocks the install entry; it changes no runtime behaviour.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", () => {
  // Intentionally empty — no `respondWith`, so every request falls through to the
  // network as normal. A registered fetch listener is what the installability
  // check looks for; caching/offline can be layered on later if wanted.
});
