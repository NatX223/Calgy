"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAuth, type EmailLinkResult } from "@/lib/auth/AuthProvider";
import { linkErrorMessage } from "@/lib/auth/linking";
import { Logo } from "@/components/ui";

type State = { kind: "working" } | { kind: EmailLinkResult } | { kind: "error"; msg: string };

/** Lands from the email (§5.4). Asks for the email again when the link was opened on another device. */
export function EmailLinkView() {
  const { completeEmailLink } = useAuth();
  const [state, setState] = useState<State>({ kind: "working" });
  const [email, setEmail] = useState("");
  const started = useRef(false);

  const run = (typed?: string) => {
    setState({ kind: "working" });
    completeEmailLink(typed)
      .then((kind) => setState({ kind }))
      .catch((e) => setState({ kind: "error", msg: linkErrorMessage(e) }));
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on landing
  }, []);

  const body = (() => {
    switch (state.kind) {
      case "working":
        return <span className="font-mono text-xs text-muted">Saving to your account…</span>;
      case "linked":
      case "signed_in":
        return (
          <>
            <span className="text-[17px] font-semibold">Your data is saved to your account.</span>
            <Link href="/app" className="inline-flex h-12 items-center rounded-xl bg-ink px-5 font-bold text-card no-underline">
              Open Calgy
            </Link>
          </>
        );
      case "conflict":
        return <span className="text-[15px] text-body-2">Choose what to do with this device&apos;s data.</span>;
      case "invalid":
        return (
          <>
            <span className="text-[15px] text-body-2">This link isn&apos;t valid. Send a new one from Settings.</span>
            <Link href="/app/settings/account" className="font-semibold text-light">
              Go to Settings
            </Link>
          </>
        );
      case "needs_email":
        return (
          <form
            className="flex w-full max-w-[360px] flex-col gap-2.5"
            onSubmit={(e) => {
              e.preventDefault();
              if (email.trim()) run(email);
            }}
          >
            <label className="flex flex-col gap-1.5 text-left">
              <span className="text-[15px] font-semibold">Confirm your email</span>
              <span className="text-[13px] text-muted">You opened the link on a different device or browser.</span>
              <input
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="h-[50px] rounded-xl border-[1.5px] border-line bg-card px-3 text-[17px] outline-none"
              />
            </label>
            <button type="submit" className="h-[52px] rounded-[14px] bg-ink text-[15px] font-bold text-card">
              Continue
            </button>
          </form>
        );
      case "error":
        return (
          <>
            <span className="text-[15px] text-red">{state.msg}</span>
            <Link href="/app/settings/account" className="font-semibold text-light">
              Back to Settings
            </Link>
          </>
        );
    }
  })();

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-5 bg-paper px-5 text-center">
      <Logo size={32} />
      {body}
    </main>
  );
}
