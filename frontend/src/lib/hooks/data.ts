"use client";

// React hooks over the data layer. Each returns plain objects (ISO dates) ready for @calgy/engine.
import type { CollectionName, GeneratorDoc, LogDocs } from "@calgy/shared";
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import type { ListOpts, LogCollection } from "../data/collection";
import { devices } from "../data/devices";
import { fuelPurchases } from "../data/fuel-purchases";
import { generators } from "../data/generators";
import { meterReadings } from "../data/meter-readings";
import { tokenLoads } from "../data/token-loads";

export type CollectionState<T> = { data: T; loading: boolean; hasPendingWrites: boolean; fromCache: boolean };

function useCollection<K extends CollectionName>(col: LogCollection<K>, opts?: ListOpts): CollectionState<LogDocs[K][]> {
  const { uid } = useAuth();
  const sinceDays = opts?.sinceDays;
  const [state, setState] = useState<CollectionState<LogDocs[K][]> & { uid: string | null }>({
    uid: null, data: [], loading: true, hasPendingWrites: false, fromCache: true,
  });
  useEffect(() => {
    if (!uid) return;
    return col.subscribe(
      uid,
      (s) => setState({ uid, data: s.data, loading: false, hasPendingWrites: s.hasPendingWrites, fromCache: s.fromCache }),
      sinceDays == null ? undefined : { sinceDays },
      () => setState((p) => ({ ...p, uid, loading: false })),
    );
  }, [col, uid, sinceDays]);
  // A stale uid's docs never show for the next user.
  if (state.uid !== uid) return { data: [], loading: true, hasPendingWrites: false, fromCache: true };
  return state;
}

export const useDevices = () => useCollection(devices);
export const useReadings = (opts: { sinceDays?: number } = {}) => useCollection(meterReadings, opts);
export const useTokens = () => useCollection(tokenLoads);
export const useFuelPurchases = () => useCollection(fuelPurchases);

/** The home's generator (one per home for now), or null. */
export function useGenerator(): CollectionState<GeneratorDoc | null> {
  const s = useCollection(generators);
  return { ...s, data: s.data[0] ?? null };
}
