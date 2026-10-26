// Account linking helpers (§5.4–5.5): which errors mean what, and the email-link round trip.
import { FirebaseError } from "firebase/app";

export const EMAIL_FOR_LINK_KEY = "calgy_email_for_link";
export const EMAIL_LINK_PATH = "/auth/email-link";

/** The credential belongs to another Firebase user: offer to merge. */
export const CONFLICT_CODES = new Set([
  "auth/credential-already-in-use",
  "auth/email-already-in-use",
  "auth/account-exists-with-different-credential",
]);

/** Popups don't work here: use a redirect instead. A user closing the popup is not one of these. */
export const POPUP_FALLBACK_CODES = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
  "auth/web-storage-unsupported",
]);

export const authCode = (e: unknown) => (e instanceof FirebaseError ? e.code : (e as { code?: string } | null)?.code);

export function linkErrorMessage(e: unknown): string {
  switch (authCode(e)) {
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
    case "auth/user-cancelled":
      return "Cancelled.";
    case "auth/network-request-failed":
      return "Needs a connection.";
    case "auth/invalid-email":
      return "That email doesn't look right.";
    case "auth/invalid-action-code":
    case "auth/expired-action-code":
      return "That link has expired or was already used. Send a new one.";
    case "auth/too-many-requests":
      return "Too many tries. Wait a minute and try again.";
    case "auth/unauthorized-domain":
      return "This site isn't allowed to sign in yet (Firebase authorized domains).";
    case "auth/requires-recent-login":
      return "For your security, sign in again first.";
    default:
      return "Couldn't save to your account. Try again.";
  }
}

export const emailLinkUrl = () => `${window.location.origin}${EMAIL_LINK_PATH}`;

export function rememberEmail(email: string) {
  try {
    localStorage.setItem(EMAIL_FOR_LINK_KEY, email);
  } catch {
    // they'll be asked again on the link page
  }
}

export function recalledEmail(): string | null {
  try {
    return localStorage.getItem(EMAIL_FOR_LINK_KEY);
  } catch {
    return null;
  }
}

export function forgetEmail() {
  try {
    localStorage.removeItem(EMAIL_FOR_LINK_KEY);
  } catch {
    // nothing stored
  }
}

/** Remove everything Calgy keeps in localStorage on this device (delete my data). */
export function clearAppStorage() {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("calgy")) localStorage.removeItem(k);
  } catch {
    // blocked storage: nothing to clear
  }
}
