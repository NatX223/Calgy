"use client";

import { useState } from "react";
import type { Choice } from "@/lib/migration/migrate";
import { Dialog, dangerBtn, primaryBtn, secondaryBtn, textBtn } from "./Dialog";

/** §10.4: this device and the account both have entries. */
export function MigrationDialog({ onAnswer }: { onAnswer: (c: Choice) => void }) {
  const [confirmDevice, setConfirmDevice] = useState(false);
  return (
    <Dialog title="You have entries here and in your account">
      {confirmDevice ? (
        <>
          <span className="text-[15px] leading-[1.45] text-body-2">
            Your account&apos;s entries will be deleted and replaced with the ones on this device.
          </span>
          <button type="button" onClick={() => onAnswer("device")} className={dangerBtn}>
            Replace my account&apos;s entries
          </button>
          <button type="button" onClick={() => setConfirmDevice(false)} className={textBtn}>
            Back
          </button>
        </>
      ) : (
        <>
          <span className="text-[15px] leading-[1.45] text-body-2">
            Calgy now saves to your account. Choose what to keep.
          </span>
          <button type="button" onClick={() => onAnswer("merge")} className={primaryBtn}>
            Merge both
          </button>
          <button type="button" onClick={() => onAnswer("cloud")} className={secondaryBtn}>
            Keep my account&apos;s entries only
          </button>
          <button type="button" onClick={() => setConfirmDevice(true)} className={textBtn}>
            Keep this device&apos;s entries only
          </button>
        </>
      )}
    </Dialog>
  );
}
