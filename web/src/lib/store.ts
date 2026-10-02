// Local-only persistence (US-2.3, US-14.1). Everything lives in this
// browser's IndexedDB; nothing is ever sent anywhere.
import { clear, createStore, del, get, keys, set } from "idb-keyval";
import { useCallback, useEffect, useState } from "react";

const personal = createStore("zerosignal-personal", "kv");
export const packStore = createStore("zerosignal-packs", "packs");

const cache = new Map<string, unknown>();
const listeners = new Map<string, Set<(v: unknown) => void>>();

export async function load<T>(key: string, fallback: T): Promise<T> {
  if (cache.has(key)) return cache.get(key) as T;
  const v = (await get<T>(key, personal)) ?? fallback;
  cache.set(key, v);
  return v;
}

export async function save<T>(key: string, value: T): Promise<void> {
  cache.set(key, value);
  listeners.get(key)?.forEach((fn) => fn(value));
  await set(key, value, personal);
}

/** React state backed by IndexedDB, shared across components. */
export function usePersistent<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void, boolean] {
  const [value, setValue] = useState<T>(() => (cache.has(key) ? (cache.get(key) as T) : fallback));
  const [ready, setReady] = useState(cache.has(key));

  useEffect(() => {
    let alive = true;
    load(key, fallback).then((v) => {
      if (alive) {
        setValue(v);
        setReady(true);
      }
    });
    const fn = (v: unknown) => setValue(v as T);
    if (!listeners.has(key)) listeners.set(key, new Set());
    listeners.get(key)!.add(fn);
    return () => {
      alive = false;
      listeners.get(key)?.delete(fn);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = useCallback(
    (v: T | ((prev: T) => T)) => {
      const prev = (cache.has(key) ? cache.get(key) : fallback) as T;
      const next = typeof v === "function" ? (v as (p: T) => T)(prev) : v;
      void save(key, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );
  return [value, update, ready];
}

/** US-14.2: wipe history, contacts, supplies, bookmarks, etc. in one action. */
export async function wipePersonalData(): Promise<void> {
  const all = await keys(personal);
  await Promise.all(all.map((k) => del(k, personal)));
  await clear(personal);
  for (const [key, fns] of listeners) {
    cache.delete(key);
    fns.forEach((fn) => fn(undefined));
  }
  cache.clear();
}

export const KEYS = {
  settings: "settings",
  onboarding: "onboarding-done",
  disclaimer: "disclaimer-ack",
  bookmarks: "bookmarks",
  recents: "recent-guides",
  searches: "recent-searches",
  contacts: "emergency-contacts",
  supplies: "supplies",
  lastLocation: "last-location",
  timerLog: "timer-log",
  checklists: "kit-checklists",
  vehicle: "vehicle-profile",
  askHistory: "ask-history",
  bearing: "marked-bearing",
} as const;
