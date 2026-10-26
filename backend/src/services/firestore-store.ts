import { createHash } from "node:crypto";
import { applyUserDocPatch, COLLECTIONS, type PushSubscriptionBody } from "@calgy/shared";
import { FieldPath, Timestamp, type Firestore } from "firebase-admin/firestore";
import type { Identity, StoredPushSubscription, UserStore } from "../deps.js";
import {
  decodeUserDoc, encodeUserDoc, fillFromAnonymous, newMeta, sameIdentity, syncIdentity, type ServerMeta,
} from "./user-doc.js";

export const PUSH_SUBSCRIPTIONS = "pushSubscriptions";
const PAGE = 300;
const ALREADY_EXISTS = 6; // gRPC status

/** Subscription doc id: endpoints are long URLs, so hash them. */
export const pushSubscriptionId = (endpoint: string) => createHash("sha256").update(endpoint).digest("hex");

export class FirestoreUserStore implements UserStore {
  constructor(private readonly db: Firestore) {}

  private user(uid: string) {
    return this.db.collection("users").doc(uid);
  }

  async ensure(uid: string, identity: Identity) {
    const ref = this.user(uid);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = new Date().toISOString();
      if (!snap.exists) {
        const { doc } = decodeUserDoc(undefined, uid);
        const fresh = { ...doc, createdAt: now, updatedAt: now };
        tx.create(ref, encodeUserDoc(fresh, newMeta(identity)));
        return fresh;
      }
      const { doc, meta } = decodeUserDoc(snap.data(), uid);
      if (!sameIdentity(meta, identity)) {
        const next = syncIdentity(meta, identity, now);
        tx.update(ref, {
          isAnonymous: next.isAnonymous,
          authProviders: next.authProviders,
          linkedAt: next.linkedAt ? Timestamp.fromDate(new Date(next.linkedAt)) : null,
        });
      }
      return doc;
    });
  }

  async patch(uid: string, patch: Parameters<UserStore["patch"]>[1], identity: Identity) {
    const ref = this.user(uid);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const now = new Date().toISOString();
      const { doc, meta } = snap.exists
        ? decodeUserDoc(snap.data(), uid)
        : { doc: { ...decodeUserDoc(undefined, uid).doc, createdAt: now }, meta: newMeta(identity) };
      const next = applyUserDocPatch(doc, patch, now);
      const nextMeta: ServerMeta = patch.gridHours ? { ...meta, gridHoursUpdatedAt: now } : meta;
      tx.set(ref, encodeUserDoc(next, nextMeta));
      return next;
    });
  }

  async mergeInto(fromUid: string, toUid: string) {
    let written = 0;
    const writer = this.db.bulkWriter();
    // Same clientId already in the account → keep the account's copy (create fails, don't retry it).
    writer.onWriteError((e) => e.code !== ALREADY_EXISTS && e.failedAttempts < 5);
    const copies: Promise<void>[] = [];
    for (const name of [...COLLECTIONS, PUSH_SUBSCRIPTIONS]) {
      const from = this.user(fromUid).collection(name);
      const to = this.user(toUid).collection(name);
      let last: string | null = null;
      for (;;) {
        let q = from.orderBy(FieldPath.documentId()).limit(PAGE);
        if (last) q = q.startAfter(last);
        const page = await q.get();
        for (const d of page.docs) {
          copies.push(
            writer.create(to.doc(d.id), d.data()).then(
              () => void written++,
              (e: { code?: number }) => {
                if (e.code !== ALREADY_EXISTS) throw e;
              },
            ),
          );
        }
        if (page.size < PAGE) break;
        last = page.docs[page.docs.length - 1].id;
      }
    }
    await writer.close();
    await Promise.all(copies);

    const fromSnap = await this.user(fromUid).get();
    if (fromSnap.exists) {
      const source = decodeUserDoc(fromSnap.data(), fromUid).doc;
      const ref = this.user(toUid);
      await this.db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return; // POST /v1/session creates it before the client merges
        const { doc, meta } = decodeUserDoc(snap.data(), toUid);
        const fill = fillFromAnonymous(doc, source);
        if (Object.keys(fill).length === 0) return;
        const nextMeta = fill.gridHours ? { ...meta, gridHoursUpdatedAt: new Date().toISOString() } : meta;
        tx.set(ref, encodeUserDoc(applyUserDocPatch(doc, fill, new Date().toISOString()), nextMeta));
      });
    }
    return written;
  }

  async deleteAll(uid: string) {
    await this.db.recursiveDelete(this.user(uid));
  }

  private subs(uid: string) {
    return this.user(uid).collection(PUSH_SUBSCRIPTIONS);
  }

  async addPushSubscription(uid: string, sub: PushSubscriptionBody, userAgent: string | null) {
    const ref = this.subs(uid).doc(pushSubscriptionId(sub.endpoint));
    await ref.set({
      endpoint: sub.endpoint,
      keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
      createdAt: Timestamp.now(),
      ...(userAgent ? { userAgent: userAgent.slice(0, 300) } : {}),
    });
  }

  async removePushSubscription(uid: string, endpoint: string) {
    await this.subs(uid).doc(pushSubscriptionId(endpoint)).delete();
  }

  async listPushSubscriptions(uid: string): Promise<StoredPushSubscription[]> {
    const snap = await this.subs(uid).get();
    return snap.docs.flatMap((d) => {
      const v = d.data();
      return typeof v.endpoint === "string" && v.keys?.p256dh && v.keys?.auth
        ? [{ id: d.id, endpoint: v.endpoint, keys: { p256dh: v.keys.p256dh, auth: v.keys.auth } }]
        : [];
    });
  }

  async deletePushSubscription(uid: string, id: string) {
    await this.subs(uid).doc(id).delete();
  }
}
