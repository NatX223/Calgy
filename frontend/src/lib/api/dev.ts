// Dev API shim (NEXT_PUBLIC_API_MODE=dev) until the VM backend exists. It writes users/{uid} directly,
// which only the dev Firestore rules allow (firebase/firestore.dev.rules). Never used in production:
// env() refuses dev mode in a production build, and this is the only module that writes users/{uid}.
import {
  applyUserDocPatch, COLLECTIONS, defaultUserDoc, UserDocPatchSchema, type UserDoc, type UserDocPatch,
} from "@calgy/shared";
import { deleteDoc, doc, getDoc, getDocsFromServer, collection, serverTimestamp, setDoc, writeBatch } from "firebase/firestore";
import { waitForUser } from "../auth/current";
import { env } from "../env";
import { db } from "../firebase";
import { background, chunk } from "../data/collection";
import { userDocConverter } from "../data/converters";
import { ApiError, type ApiClient } from "./types";

const notInDev = () =>
  Promise.reject(new ApiError({ code: "not_available_in_dev", message: "Available when the server is connected." }));

const online = () => typeof navigator === "undefined" || navigator.onLine !== false;

export class DevApi implements ApiClient {
  constructor() {
    if (env().apiMode !== "dev") throw new Error("DevApi is only for NEXT_PUBLIC_API_MODE=dev.");
  }

  private async ref() {
    const u = await waitForUser();
    if (!u) throw new ApiError({ status: 401, code: "unauthenticated", message: "Not signed in." });
    return { uid: u.uid, user: u, ref: doc(db(), "users", u.uid).withConverter(userDocConverter) };
  }

  private async read(): Promise<{ uid: string; doc: UserDoc | null }> {
    const { uid, ref } = await this.ref();
    try {
      const snap = await getDoc(ref);
      return { uid, doc: snap.exists() ? snap.data() : null };
    } catch {
      throw new ApiError({ code: "offline", message: "You're offline." });
    }
  }

  async createSession(): Promise<UserDoc> {
    const { uid, doc: existing } = await this.read();
    if (existing) return existing;
    const d = defaultUserDoc(uid);
    const { ref } = await this.ref();
    background(setDoc(ref, { ...d, createdAt: serverTimestamp(), updatedAt: serverTimestamp() } as unknown as UserDoc));
    return d;
  }

  async logout() {}

  async getMe(): Promise<UserDoc> {
    const { uid, doc: d } = await this.read();
    return d ?? defaultUserDoc(uid);
  }

  /** Same validation and merge rules as PATCH /v1/me. */
  async updateMe(patch: UserDocPatch): Promise<UserDoc> {
    const parsed = UserDocPatchSchema.safeParse(patch);
    if (!parsed.success)
      throw new ApiError({
        status: 400,
        code: "bad_request",
        message: "Invalid settings.",
        fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join("."), i.message])),
      });
    const { uid, doc: current } = await this.read();
    const now = new Date().toISOString();
    const base = current ?? defaultUserDoc(uid, now);
    const next = applyUserDocPatch(base, parsed.data, now);
    const { ref } = await this.ref();
    const write = current
      ? { ...parsed.data, updatedAt: serverTimestamp() }
      : { ...next, createdAt: serverTimestamp(), updatedAt: serverTimestamp() };
    background(setDoc(ref, write as unknown as UserDoc, { merge: true }));
    return next;
  }

  mergeAccount(): Promise<{ merged: number }> {
    return notInDev();
  }
  discardAnonymous(): Promise<void> {
    return notInDev();
  }

  /** Client-side recursive delete of the user's docs, then the Firebase user. */
  async deleteAccount() {
    if (!online()) throw new ApiError({ code: "offline", message: "You're offline." });
    const { uid, user, ref } = await this.ref();
    for (const name of COLLECTIONS) {
      const snap = await getDocsFromServer(collection(db(), "users", uid, name));
      for (const part of chunk(snap.docs)) {
        const b = writeBatch(db());
        part.forEach((d) => b.delete(d.ref));
        await b.commit();
      }
    }
    await deleteDoc(ref);
    await user.delete();
  }

  getVapidKey(): Promise<string> {
    return notInDev();
  }
  subscribePush(): Promise<void> {
    return notInDev();
  }
  unsubscribePush(): Promise<void> {
    return notInDev();
  }
  testPush(): Promise<void> {
    return notInDev();
  }
}
