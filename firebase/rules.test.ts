// Run with: npm run test:rules (starts the Firestore emulator, then vitest).
import { readFileSync } from "node:fs";
import {
  assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment,
} from "@firebase/rules-unit-testing";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc, Timestamp } from "firebase/firestore";
import { afterAll, afterEach, beforeAll, describe, test } from "vitest";

const log = (id: string) => ({ clientId: id, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), amountNaira: 5000 });

function suite(name: string, rulesFile: string, body: (env: () => RulesTestEnvironment) => void) {
  describe(name, () => {
    let env: RulesTestEnvironment;
    beforeAll(async () => {
      env = await initializeTestEnvironment({
        projectId: "demo-calgy",
        firestore: { rules: readFileSync(new URL(rulesFile, import.meta.url), "utf8") },
      });
    });
    afterEach(() => env.clearFirestore());
    afterAll(() => env.cleanup());
    body(() => env);
  });
}

suite("production rules", "./firestore.rules", (env) => {
  test("owner can read but not write their user doc", async () => {
    const db = env().authenticatedContext("alice").firestore();
    await assertSucceeds(getDoc(doc(db, "users/alice")));
    await assertFails(setDoc(doc(db, "users/alice"), { household: { fuelWeekly: 1 } }));
  });

  test("nobody else can read the user doc", async () => {
    await assertFails(getDoc(doc(env().authenticatedContext("bob").firestore(), "users/alice")));
    await assertFails(getDoc(doc(env().unauthenticatedContext().firestore(), "users/alice")));
  });

  test("owner writes logs with clientId == doc id and server updatedAt", async () => {
    const db = env().authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(db, "users/alice/tokenLoads/t1"), log("t1")));
    await assertSucceeds(
      setDoc(doc(db, "users/alice/fuelPurchases/f1"), { ...log("f1"), createdAt: Timestamp.fromDate(new Date("2025-01-01")) }),
    );
    await assertFails(setDoc(doc(db, "users/alice/tokenLoads/t2"), log("other")));
    await assertFails(setDoc(doc(db, "users/alice/tokenLoads/t3"), { ...log("t3"), updatedAt: Timestamp.now() }));
    await assertSucceeds(deleteDoc(doc(db, "users/alice/tokenLoads/t1")));
  });

  test("no writes to other users or unknown collections", async () => {
    const db = env().authenticatedContext("bob").firestore();
    await assertFails(setDoc(doc(db, "users/alice/tokenLoads/t1"), log("t1")));
    const alice = env().authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(alice, "users/alice/secrets/s1"), log("s1")));
  });

  test("log values are sanity-checked", async () => {
    const db = env().authenticatedContext("alice").firestore();
    await assertFails(setDoc(doc(db, "users/alice/tokenLoads/t1"), { ...log("t1"), amountNaira: 0 }));
    await assertSucceeds(setDoc(doc(db, "users/alice/fuelPurchases/f1"), { ...log("f1"), litres: null }));
    await assertFails(setDoc(doc(db, "users/alice/fuelPurchases/f2"), { ...log("f2"), litres: 0 }));
    await assertSucceeds(setDoc(doc(db, "users/alice/meterReadings/r1"), { ...log("r1"), unitsLeft: 0 }));
    await assertFails(setDoc(doc(db, "users/alice/meterReadings/r2"), { ...log("r2"), unitsLeft: 100001 }));
  });

  test("push subscriptions are backend-only, even for the owner", async () => {
    const db = env().authenticatedContext("alice").firestore();
    await assertFails(getDoc(doc(db, "users/alice/pushSubscriptions/p1")));
    await assertFails(setDoc(doc(db, "users/alice/pushSubscriptions/p1"), log("p1")));
  });

  test("aggregates: signed-in read only", async () => {
    await assertSucceeds(getDoc(doc(env().authenticatedContext("alice").firestore(), "aggregates/tariff")));
    await assertFails(getDoc(doc(env().unauthenticatedContext().firestore(), "aggregates/tariff")));
    await assertFails(setDoc(doc(env().authenticatedContext("alice").firestore(), "aggregates/tariff"), { buckets: [] }));
  });
});

suite("dev rules", "./firestore.dev.rules", (env) => {
  test("owner can write their user doc", async () => {
    const db = env().authenticatedContext("alice").firestore();
    await assertSucceeds(setDoc(doc(db, "users/alice"), { household: { fuelWeekly: 1 } }));
  });

  test("others can't", async () => {
    await assertFails(setDoc(doc(env().authenticatedContext("bob").firestore(), "users/alice"), { x: 1 }));
    await assertFails(getDoc(doc(env().unauthenticatedContext().firestore(), "users/alice")));
  });
});
