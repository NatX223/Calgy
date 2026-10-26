// Calgy service worker: push reminders only. No fetch handler: API responses are never cached here,
// and Firestore keeps entries offline in IndexedDB.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  const title = data.title || "Check your meter";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: data.body || "One number keeps your Calgy estimates accurate.",
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      tag: data.tag || "calgy-reminder",
      data: { url: data.url || "/app" },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/app", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((tabs) => {
      const tab = tabs.find((c) => new URL(c.url).origin === self.location.origin);
      if (tab) return tab.focus().then((c) => (c && c.url !== url && "navigate" in c ? c.navigate(url) : c));
      return self.clients.openWindow(url);
    }),
  );
});
