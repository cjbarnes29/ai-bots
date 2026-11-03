// A very small service worker so the dashboard can be installed as an app and opens fast.
// SAFETY: it never touches anything under /api/. Bot data, approvals and secrets are always fetched live
// and are never stored by the browser's cache. Only the page shell and its own build files are kept.
const CACHE = "awp-shell-v1";

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.add("/")).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // never cached, never intercepted

  if (req.mode === "navigate") {
    // Always try the network first so a new version shows up; fall back to the saved shell when offline.
    event.respondWith(fetch(req).catch(() => caches.match("/")));
    return;
  }
  if (url.pathname.startsWith("/assets/")) {
    // Build files have a fingerprint in their name, so a saved copy is always the right one.
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          }),
      ),
    );
  }
});

// Phone alerts. The push carries NO content: this worker asks the app (with the phone's own sign-in cookie) how many actions are waiting.
self.addEventListener("push", (event) => {
  event.waitUntil(
    (async () => {
      let body = "Something needs your attention.";
      try {
        const res = await fetch("/api/monitor/overview", { credentials: "same-origin" });
        if (res.ok) {
          const pending = (await res.json())?.approvals?.pending ?? 0;
          if (pending > 0) body = pending + (pending === 1 ? " action is" : " actions are") + " waiting for your approval";
        }
      } catch {
        /* offline: keep the general message */
      }
      await self.registration.showNotification("AI Workforce", { body, tag: "approvals", icon: "/icon-192.png", data: { url: "/approvals" } });
    })(),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/approvals"));
});
