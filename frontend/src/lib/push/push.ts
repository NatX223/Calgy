// Web Push for the weekly meter reminder (§12 Reminders). The API stores subscriptions and sends.
import { getApi } from "../api";

export type PushSupport = "supported" | "unsupported" | "ios_needs_install";

const isIos = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
export const isStandalone = () =>
  window.matchMedia?.("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/** iOS Safari only allows push once Calgy is added to the home screen. */
export function pushSupport(): PushSupport {
  if (typeof window === "undefined") return "unsupported";
  if (isIos() && !isStandalone()) return "ios_needs_install";
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window ? "supported" : "unsupported";
}

export const notificationPermission = (): NotificationPermission | "unsupported" =>
  typeof Notification === "undefined" ? "unsupported" : Notification.permission;

/** VAPID public keys come base64url-encoded; pushManager wants bytes. */
export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    return await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  } catch (e) {
    console.error("Calgy: service worker registration failed", e);
    return null;
  }
}

export class PushPermissionError extends Error {
  name = "PushPermissionError";
  constructor(readonly permission: NotificationPermission) {
    super(`Notification permission: ${permission}`);
  }
}

/** Permission → VAPID key → subscribe → tell the API. Throws PushPermissionError or ApiError. */
export async function enablePush(): Promise<void> {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new PushPermissionError(permission);
  const reg = (await navigator.serviceWorker.getRegistration()) ?? (await registerServiceWorker());
  if (!reg) throw new Error("No service worker");
  await navigator.serviceWorker.ready;
  const key = await getApi().getVapidKey();
  const existing = await reg.pushManager.getSubscription();
  const sub = existing ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) }));
  await getApi().subscribePush(sub.toJSON() as Parameters<ReturnType<typeof getApi>["subscribePush"]>[0]);
}

/** Unsubscribe this browser and tell the API. Safe to call when not subscribed. */
export async function disablePush(): Promise<void> {
  if (!("serviceWorker" in navigator)) return;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await sub.unsubscribe();
  await getApi().unsubscribePush(endpoint);
}

export async function isPushSubscribed(): Promise<boolean> {
  if (pushSupport() !== "supported") return false;
  const reg = await navigator.serviceWorker.getRegistration();
  return !!(await reg?.pushManager.getSubscription());
}
