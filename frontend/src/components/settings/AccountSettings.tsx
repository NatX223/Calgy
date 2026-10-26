"use client";

import { useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";
import { linkErrorMessage } from "@/lib/auth/linking";
import { OfflineGate } from "../sync/OfflineGate";
import { btn, btnDark, Card, SettingsPage } from "./SettingsPage";

/** §12 Account: "Save your data across devices". */
export function AccountSettings() {
  const { user, isAnonymous, linkWithGoogle, sendEmailLink, signOut } = useAuth();
  const [email, setEmail] = useState("");
  const [showEmail, setShowEmail] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [busy, setBusy] = useState<"google" | "email" | "out" | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const linkedAs =
    user?.email ??
    user?.providerData.find((p) => p.email)?.email ??
    (user?.providerData.some((p) => p.providerId === "google.com") ? "your Google account" : "your account");

  const run = async (kind: "google" | "email" | "out", fn: () => Promise<void>) => {
    setBusy(kind);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      const m = linkErrorMessage(e);
      if (m !== "Cancelled.") setErr(m);
    } finally {
      setBusy(null);
    }
  };

  return (
    <SettingsPage title="Account">
      <Card>
        <span className="text-[13px] font-mono uppercase tracking-[0.08em] text-muted">Status</span>
        <span className="text-[17px] font-semibold">{isAnonymous ? "Not saved to an account" : `Saved to ${linkedAs}`}</span>
        <span className="text-[15px] leading-[1.45] text-body-2">
          {isAnonymous
            ? "Your entries are saved on this device. Save them to an account to keep them if you change phone or clear your browser."
            : "Sign in with the same account on another device to see your entries there."}
        </span>
      </Card>

      {isAnonymous ? (
        <OfflineGate>
          <Card>
            <span className="text-base font-semibold">Save your data across devices</span>
            <button type="button" disabled={!!busy} onClick={() => run("google", linkWithGoogle)} className={btnDark}>
              {busy === "google" ? "Opening Google…" : "Save with Google"}
            </button>
            {sentTo ? (
              <span className="rounded-xl bg-light-soft px-3 py-2.5 text-[15px] leading-[1.45]">
                Check {sentTo} and open the link on this phone.
              </span>
            ) : showEmail ? (
              <form
                className="flex flex-col gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  const v = email.trim();
                  if (v) void run("email", async () => {
                    await sendEmailLink(v);
                    setSentTo(v);
                  });
                }}
              >
                <input
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  aria-label="Email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-[50px] rounded-xl border-[1.5px] border-line bg-paper px-3 text-[17px] outline-none"
                />
                <button type="submit" disabled={!!busy} className={btn}>
                  {busy === "email" ? "Sending…" : "Send me a sign-in link"}
                </button>
              </form>
            ) : (
              <button type="button" disabled={!!busy} onClick={() => setShowEmail(true)} className={btn}>
                Save with email link
              </button>
            )}
            {err && <span className="font-mono text-xs text-red">{err}</span>}
          </Card>
        </OfflineGate>
      ) : (
        <OfflineGate>
          <Card>
            <span className="text-[15px] leading-[1.45] text-body-2">
              Signing out clears Calgy from this device. Your entries stay in your account.
            </span>
            <button type="button" disabled={!!busy} onClick={() => run("out", signOut)} className={btn}>
              {busy === "out" ? "Signing out…" : "Sign out"}
            </button>
            {err && <span className="font-mono text-xs text-red">{err}</span>}
          </Card>
        </OfflineGate>
      )}
    </SettingsPage>
  );
}
