// FirestoreUserStore against the Firestore emulator (needs Java 21+). Run with: npm run test:emulator -w backend
import assert from "node:assert/strict";
import { after, before, beforeEach, describe, test } from "node:test";
import { initializeApp, deleteApp, type App } from "firebase-admin/app";
import { getFirestore, Timestamp, type Firestore } from "firebase-admin/firestore";
import { FirestoreUserStore, pushSubscriptionId } from "../../src/services/firestore-store.ts";

const PROJECT = "demo-calgy";
const ANON = { isAnonymous: true, authProviders: ["anonymous"] };
const GOOGLE = { isAnonymous: false, authProviders: ["google.com"] };

describe("FirestoreUserStore", { skip: !process.env.FIRESTORE_EMULATOR_HOST && "FIRESTORE_EMULATOR_HOST not set" }, () => {
  let app: App;
  let db: Firestore;
  let store: FirestoreUserStore;

  before(() => {
    app = initializeApp({ projectId: PROJECT }, "store-test");
    db = getFirestore(app);
    store = new FirestoreUserStore(db);
  });
  after(() => deleteApp(app));
  beforeEach(async () => {
    await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });
  });

  const log = (id: string, extra: object = {}) => ({ clientId: id, createdAt: Timestamp.now(), updatedAt: Timestamp.now(), ...extra });

  test("ensure creates the doc once and records linking", async () => {
    const first = await store.ensure("u1", ANON);
    const again = await store.ensure("u1", ANON);
    assert.deepEqual(again, first);
    const raw = (await db.doc("users/u1").get()).data()!;
    assert.ok(raw.createdAt instanceof Timestamp);
    assert.equal(raw.isAnonymous, true);
    assert.equal(raw.linkedAt, null);

    await store.ensure("u1", GOOGLE);
    const linked = (await db.doc("users/u1").get()).data()!;
    assert.equal(linked.isAnonymous, false);
    assert.deepEqual(linked.authProviders, ["google.com"]);
    assert.ok(linked.linkedAt instanceof Timestamp);
  });

  test("patch keeps server fields and stamps gridHours.updatedAt", async () => {
    await store.ensure("u1", GOOGLE);
    await db.doc("users/u1").update({ "settings.reminder.lastSentAt": Timestamp.fromMillis(0) });
    const doc = await store.patch("u1", { gridHours: { source: "user", value: 6 }, settings: { reminder: { enabled: true } } }, GOOGLE);
    assert.equal(doc.gridHours.value, 6);
    const raw = (await db.doc("users/u1").get()).data()!;
    assert.ok(raw.gridHours.updatedAt instanceof Timestamp);
    assert.equal(raw.settings.reminder.enabled, true);
    assert.equal(raw.settings.reminder.lastSentAt.toMillis(), 0);
    assert.equal(raw.authProviders[0], "google.com");
  });

  test("mergeInto copies logs and push subs, skips existing ids, fills defaults, is re-runnable", async () => {
    await store.ensure("anon", ANON);
    await store.patch("anon", { household: { fuelWeekly: 7000 } }, ANON);
    await store.ensure("me", GOOGLE);
    await db.doc("users/anon/tokenLoads/t1").set(log("t1", { amountNaira: 1 }));
    await db.doc("users/anon/tokenLoads/t2").set(log("t2", { amountNaira: 2 }));
    await db.doc("users/me/tokenLoads/t1").set(log("t1", { amountNaira: 99 }));
    for (let i = 0; i < 305; i++) await db.doc(`users/anon/devices/d${i}`).set(log(`d${i}`)); // > one page
    await store.addPushSubscription("anon", { endpoint: "https://push.example/1", keys: { p256dh: "p", auth: "a" } }, null);

    assert.equal(await store.mergeInto("anon", "me"), 1 + 305 + 1);
    assert.equal((await db.doc("users/me/tokenLoads/t1").get()).get("amountNaira"), 99);
    assert.equal((await db.collection("users/me/devices").count().get()).data().count, 305);
    assert.ok((await db.doc(`users/me/pushSubscriptions/${pushSubscriptionId("https://push.example/1")}`).get()).exists);
    assert.equal((await db.doc("users/me").get()).get("household.fuelWeekly"), 7000);

    assert.equal(await store.mergeInto("anon", "me"), 0);
  });

  test("deleteAll removes the doc and every subcollection", async () => {
    await store.ensure("u1", GOOGLE);
    await db.doc("users/u1/meterReadings/r1").set(log("r1"));
    await store.addPushSubscription("u1", { endpoint: "https://push.example/2", keys: { p256dh: "p", auth: "a" } }, "UA");
    await store.deleteAll("u1");
    assert.equal((await db.doc("users/u1").get()).exists, false);
    assert.equal((await db.collection("users/u1/meterReadings").get()).size, 0);
    assert.equal((await store.listPushSubscriptions("u1")).length, 0);
  });
});
