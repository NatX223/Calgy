"use client";

import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/lib/auth/AuthProvider";

const DISMISS_KEY = "calgy_link_nudge_dismissed";
export const NUDGE_AFTER_ENTRIES = 5;
export const NUDGE_AFTER_DAYS = 7;

/** Should an anonymous user see "save to an account"? Pure, for tests. */
export function shouldNudge(o: { isAnonymous: boolean; entries: number; createdAt: string | null; dismissed: boolean; now: number }) {
  if (!o.isAnonymous || o.dismissed) return false;
  const days = o.createdAt ? (o.now - Date.parse(o.createdAt)) / 864e5 : 0;
  return o.entries >= NUDGE_AFTER_ENTRIES || days >= NUDGE_AFTER_DAYS;
}

/** §5.8: once on Home, after 5 entries or a week. */
export function LinkNudge({ entries }: { entries: number }) {
  const { isAnonymous, userDoc, isDefaultDoc } = useAuth();
  // Client-only: the app gate renders screens only once auth has resolved in the browser.
  const [dismissed, setDismissed] = useState(() => {
    try {
      return !!localStorage.getItem(DISMISS_KEY);
    } catch {
      return false;
    }
  });
  const [now] = useState(() => Date.now());

  const createdAt = isDefaultDoc ? null : (userDoc?.createdAt ?? null);
  if (!shouldNudge({ isAnonymous, entries, createdAt, dismissed, now })) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, new Date().toISOString());
    } catch {
      // shows again next launch
    }
  };

  return (
    <div className="mt-6 flex flex-col gap-2.5 rounded-[18px] border border-line bg-card p-[18px]">
      <span className="text-[15px] leading-[1.45] font-semibold">Keep your data if you change phone. Save it to an account.</span>
      <div className="flex items-center gap-2">
        <Link
          href="/app/settings/account"
          className="inline-flex h-11 items-center rounded-xl bg-ink px-4 text-sm font-bold text-card no-underline"
        >
          Save to an account
        </Link>
        <button type="button" onClick={dismiss} className="h-11 px-3 text-sm font-semibold text-muted">
          Not now
        </button>
      </div>
    </div>
  );
}
