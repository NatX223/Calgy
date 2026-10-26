import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { authState, emailLinkFor, emulatorDoc, emulatorDocs, launch, logFuel, skipToHome } from "./helpers";

test("first launch: anonymous user, user doc created by the dev shim, Home renders", async ({ page }) => {
  const uid = await launch(page);
  expect((await authState(page)).isAnonymous).toBe(true);
  await skipToHome(page);
  await expect.poll(() => emulatorDoc(`users/${uid}`), { timeout: 15_000 }).not.toBeNull();
});

test("offline: entries show at once with sync status, settings need a connection, then sync", async ({ page, context }) => {
  const uid = await launch(page);
  await skipToHome(page);

  await context.setOffline(true);
  await logFuel(page, 4500);
  await expect(page.getByText("₦4,500").first()).toBeVisible();
  await expect(page.getByText("(will sync when online)")).toBeVisible();
  await expect(page.getByText("Offline · your entries are saved and will sync.")).toBeVisible();
  expect(await emulatorDocs(`users/${uid}/fuelPurchases`)).toHaveLength(0);

  await context.setOffline(false);
  await expect(page.getByText(/Offline ·|syncing…/)).toHaveCount(0, { timeout: 20_000 });
  await expect.poll(async () => (await emulatorDocs(`users/${uid}/fuelPurchases`)).length).toBe(1);
});

test("settings controls are disabled offline", async ({ page, context }) => {
  await launch(page, "/app/settings/privacy");
  const exportBtn = page.getByRole("button", { name: "Export JSON" });
  await expect(exportBtn).toBeEnabled();
  await context.setOffline(true);
  await expect(exportBtn).toBeDisabled();
  await expect(page.getByText("Needs a connection.").first()).toBeVisible();
  await context.setOffline(false);
});

test("link with email link keeps the same uid", async ({ page }) => {
  const uid = await launch(page, "/app/settings/account");
  const email = `e2e-${Date.now()}@example.com`;
  await page.getByRole("button", { name: "Save with email link" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByRole("button", { name: "Send me a sign-in link" }).click();
  await expect(page.getByText(`Check ${email}`)).toBeVisible();

  // The emulator's link points at the auth handler; follow it through to our continue URL.
  const link = new URL(await emailLinkFor(email));
  const target = new URL(link.searchParams.get("continueUrl") ?? "/auth/email-link", page.url());
  for (const [k, v] of link.searchParams) target.searchParams.set(k, v);
  await page.goto(target.toString());
  await expect(page.getByText("Your data is saved to your account.").first()).toBeVisible();
  const after = await authState(page);
  expect(after.uid).toBe(uid);
  expect(after.isAnonymous).toBe(false);
});

test("export, then import into a fresh user, gives the same entries", async ({ page }) => {
  const first = await launch(page);
  await skipToHome(page);
  await logFuel(page, 3000);
  await logFuel(page, 7000);
  await expect.poll(async () => (await emulatorDocs(`users/${first}/fuelPurchases`)).length).toBe(2);

  await page.goto("/app/settings/privacy");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Export JSON" }).click()]);
  expect(download.suggestedFilename()).toMatch(/^calgy-export-\d{4}-\d\d-\d\d\.json$/);
  const file = await download.path();
  expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ version: 1, fuelPurchases: [{}, {}] });

  // Fresh anonymous user in a new context.
  const fresh = await page.context().browser()!.newContext();
  const page2 = await fresh.newPage();
  const second = await launch(page2, "/app/settings/privacy");
  expect(second).not.toBe(first);
  await page2.locator('input[type="file"]').setInputFiles(file);
  await expect(page2.getByText("Imported 2 · skipped 0 already here")).toBeVisible();
  await expect.poll(async () => (await emulatorDocs(`users/${second}/fuelPurchases`)).length).toBe(2);
  await fresh.close();
});

test("delete my data: docs gone, new anonymous user on reload", async ({ page }) => {
  const uid = await launch(page);
  await skipToHome(page);
  await logFuel(page, 2500);
  await expect.poll(async () => (await emulatorDocs(`users/${uid}/fuelPurchases`)).length).toBe(1);

  await page.goto("/app/settings/privacy");
  await page.getByRole("button", { name: "Delete my data" }).click();
  await page.getByLabel("Type DELETE to confirm").fill("DELETE");
  await page.getByRole("dialog").getByRole("button", { name: "Delete my data" }).click();

  await page.waitForURL("**/app");
  await page.waitForFunction((old) => (window as unknown as { __calgy?: { uid: string } }).__calgy?.uid !== old, uid);
  expect(await emulatorDocs(`users/${uid}/fuelPurchases`)).toHaveLength(0);
  expect(await emulatorDoc(`users/${uid}`)).toBeNull();
});
