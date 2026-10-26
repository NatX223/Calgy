import { expect, type Page } from "@playwright/test";

export const PROJECT = "demo-calgy";
const FIRESTORE = `http://localhost:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
// "Bearer owner" lets the emulator REST API bypass security rules.
const OWNER = { Authorization: "Bearer owner" };

/** Open the app and wait for the anonymous user; returns its uid. */
export async function launch(page: Page, path = "/app"): Promise<string> {
  await page.goto(path);
  await page.waitForFunction(() => !!(window as unknown as { __calgy?: { uid: string } }).__calgy?.uid);
  return page.evaluate(() => (window as unknown as { __calgy: { uid: string } }).__calgy.uid);
}

export const authState = (page: Page) =>
  page.evaluate(() => (window as unknown as { __calgy: { uid: string; isAnonymous: boolean } }).__calgy);

/** First launch lands on onboarding: skip to Home. */
export async function skipToHome(page: Page) {
  await page.getByRole("button", { name: "Skip for now" }).click();
  await expect(page.getByRole("button", { name: "+ Fuel" })).toBeVisible();
}

export async function logFuel(page: Page, naira: number) {
  await page.getByRole("button", { name: "+ Fuel" }).click();
  await page.getByLabel("Amount paid").fill(String(naira));
  await page.getByRole("button", { name: /^Save ₦/ }).click();
}

export async function emulatorDocs(path: string): Promise<{ name: string; fields: Record<string, unknown> }[]> {
  const res = await fetch(`${FIRESTORE}/${path}`, { headers: OWNER });
  if (res.status === 404) return [];
  const body = (await res.json()) as { documents?: { name: string; fields: Record<string, unknown> }[] };
  return body.documents ?? [];
}

export async function emulatorDoc(path: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(`${FIRESTORE}/${path}`, { headers: OWNER });
  return res.ok ? ((await res.json()) as Record<string, unknown>) : null;
}

/** Latest sign-in link the Auth emulator "sent" to an address. */
export async function emailLinkFor(email: string): Promise<string> {
  const res = await fetch(`http://localhost:9099/emulator/v1/projects/${PROJECT}/oobCodes`);
  const { oobCodes } = (await res.json()) as { oobCodes: { email: string; oobLink: string; requestType: string }[] };
  const code = oobCodes.filter((c) => c.email === email && c.requestType === "EMAIL_SIGNIN").at(-1);
  if (!code) throw new Error(`No sign-in link for ${email}`);
  return code.oobLink;
}
