/* Veil service worker: Web Push for phones and desktop. Payloads never contain message content. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    /* ignore */
  }
  const type = data.data && data.data.type;
  if (type === "call_cancel") {
    // The caller hung up: same tag, so this replaces "Incoming call". It must show something,
    // because iOS can cancel the subscription of a site whose pushes show nothing.
    event.waitUntil(
      self.registration.showNotification("Veil", { body: "Missed call", tag: data.tag, icon: "/icons/icon-192.png", badge: "/icons/icon-192.png", data: data.data || {} }),
    );
    return;
  }
  if (!data.title) return;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Skip only if the app is really on screen: it shows its own in-app notification.
      // A window on a locked phone can still report focused, so check visibility as well.
      if (clients.some((c) => c.focused && c.visibilityState === "visible")) return;
      return self.registration.showNotification(data.title, {
        body: data.body,
        tag: data.tag,
        renotify: !!data.tag,
        icon: "/icons/icon-192.png",
        badge: "/icons/icon-192.png",
        vibrate: type === "call" ? [400, 200, 400, 200, 400] : [200, 100, 200],
        requireInteraction: type === "call",
        data: data.data || {},
      });
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const chatId = event.notification.data && event.notification.data.chatId;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const existing = clients[0];
      if (existing) {
        existing.focus();
        if (chatId) existing.postMessage({ type: "open-chat", chatId });
        return;
      }
      return self.clients.openWindow("/");
    }),
  );
});
