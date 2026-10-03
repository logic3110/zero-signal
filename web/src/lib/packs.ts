// Knowledge pack management for the web client (US-12.2, 12.3, 1.4).
//
// The core packs ship inside the app (public/packs, precached by the service
// worker), so the library works on first launch offline. Updates are only
// installed when the user asks: the new bundle is downloaded, its SHA-256 is
// checked against the catalog, and only then does it replace the old one
// (a single IndexedDB write, so the old pack stays usable until then).
import { del, get, set } from "idb-keyval";
import { packStore } from "./store";
import type { CatalogPack, PackBundle } from "./types";

export const BUNDLED_PACKS = ["core", "medical-core", "survival-core", "vehicle-core"];
export const APP_VERSION = "0.1.0";

export interface InstalledPack {
  pack_id: string;
  version: string;
  sha256: string;
  size: number;
  installed_at: string;
  bundle: PackBundle;
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cmpVersion(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

export function isNewer(candidate: string, installed: string) {
  return cmpVersion(candidate, installed) > 0;
}

async function activeIds(): Promise<string[]> {
  return (await get<string[]>("active", packStore)) ?? BUNDLED_PACKS;
}

async function fetchBundled(id: string): Promise<InstalledPack> {
  const res = await fetch(`/packs/${id}.json`);
  if (!res.ok) throw new Error(`bundled pack ${id} missing`);
  const buf = await res.arrayBuffer();
  const bundle = JSON.parse(new TextDecoder().decode(buf)) as PackBundle;
  return {
    pack_id: id,
    version: bundle.manifest.version,
    sha256: crypto.subtle ? await sha256Hex(buf) : "",
    size: buf.byteLength,
    installed_at: new Date().toISOString(),
    bundle,
  };
}

/** Load all active packs, seeding IndexedDB from the bundled copies on first run. */
export async function loadPacks(): Promise<InstalledPack[]> {
  const ids = await activeIds();
  const out: InstalledPack[] = [];
  for (const id of ids) {
    let p = await get<InstalledPack>(`pack:${id}`, packStore);
    if (!p && BUNDLED_PACKS.includes(id)) {
      p = await fetchBundled(id);
      await set(`pack:${id}`, p, packStore);
    }
    if (p) out.push(p);
  }
  return out;
}

export interface Progress {
  loaded: number;
  total: number;
  startedAt: number;
}

async function download(url: string, total: number, onProgress: (p: Progress) => void, signal?: AbortSignal) {
  const res = await fetch(url, { cache: "no-store", signal });
  if (!res.ok || !res.body) throw new Error(`download failed (${res.status})`);
  const reader = res.body.getReader();
  const parts: Uint8Array[] = [];
  const startedAt = performance.now();
  let loaded = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.byteLength;
    onProgress({ loaded, total, startedAt });
  }
  const buf = new Uint8Array(loaded);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.byteLength;
  }
  return buf.buffer;
}

/** Download, verify (SHA-256, min app version) and atomically install a pack. */
export async function installPack(
  cp: CatalogPack,
  onProgress: (p: Progress) => void,
  signal?: AbortSignal,
): Promise<InstalledPack> {
  if (isNewer(cp.min_app_version, APP_VERSION)) {
    throw new Error(`${cp.title} needs app version ${cp.min_app_version} or newer`);
  }
  let buf: ArrayBuffer | null = null;
  // One automatic re-fetch if the checksum fails (corrupt download).
  for (let attempt = 0; attempt < 2; attempt++) {
    const candidate = await download(cp.web.url, cp.web.size, onProgress, signal);
    if ((await sha256Hex(candidate)) === cp.web.sha256) {
      buf = candidate;
      break;
    }
  }
  if (!buf) throw new Error("Checksum mismatch - the download was corrupt. Nothing was changed.");
  const bundle = JSON.parse(new TextDecoder().decode(buf)) as PackBundle;
  if (bundle.manifest.pack_id !== cp.pack_id) throw new Error("Pack id mismatch");
  const installed: InstalledPack = {
    pack_id: cp.pack_id,
    version: bundle.manifest.version,
    sha256: cp.web.sha256,
    size: buf.byteLength,
    installed_at: new Date().toISOString(),
    bundle,
  };
  await set(`pack:${cp.pack_id}`, installed, packStore);
  const ids = await activeIds();
  if (!ids.includes(cp.pack_id)) await set("active", [...ids, cp.pack_id], packStore);
  return installed;
}

export async function removePack(id: string): Promise<void> {
  const ids = (await activeIds()).filter((x) => x !== id);
  await set("active", ids, packStore);
  await del(`pack:${id}`, packStore);
}

/** Restore the pack that shipped with the app (e.g. after deleting an update). */
export async function restoreBundled(id: string): Promise<void> {
  const p = await fetchBundled(id);
  await set(`pack:${id}`, p, packStore);
  const ids = await activeIds();
  if (!ids.includes(id)) await set("active", [...ids, id], packStore);
}
