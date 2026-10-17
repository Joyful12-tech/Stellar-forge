/**
 * Tracks which wallet address pinned a given IPFS CID, so the unpin endpoint
 * can verify ownership before deleting content from Pinata on someone's
 * behalf. Recorded at upload time by upload-json.ts / upload-file.ts.
 *
 * Uses Vercel KV for durability across serverless instances, matching the
 * pattern in rateLimit.ts. Falls back to per-instance memory when KV isn't
 * configured — note that this fallback fails *closed*: a CID pinned by one
 * instance won't be found by a different instance's in-memory map, so
 * getPinOwner() returns null and the caller denies the unpin. Configure
 * Vercel KV in production so legitimate owners aren't denied.
 */

import { isKvConfigured, kvDel, kvGet, kvSet } from './kv'

interface PinOwnerRecord {
  ownerAddress: string
  pinnedAt: number
}

const memoryRegistry = new Map<string, PinOwnerRecord>()

function pinKey(cid: string): string {
  return `pinowner:${cid}`
}

/** Records the wallet address that pinned `cid`. Called after a successful Pinata pin. */
export async function recordPinOwner(cid: string, ownerAddress: string): Promise<void> {
  const record: PinOwnerRecord = { ownerAddress, pinnedAt: Date.now() }

  if (isKvConfigured()) {
    try {
      // No expiry: ownership must outlive the pin, however long that is.
      await kvSet(pinKey(cid), JSON.stringify(record))
      return
    } catch (err) {
      console.error('Failed to record pin owner in KV, falling back to memory:', err)
    }
  }

  memoryRegistry.set(cid, record)
}

/**
 * {@link recordPinOwner} for upload handlers: the content is already pinned,
 * so a bookkeeping failure is logged rather than failing the upload.
 */
export async function recordPinOwnerBestEffort(cid: string, ownerAddress: string): Promise<void> {
  try {
    await recordPinOwner(cid, ownerAddress)
  } catch (err) {
    console.error('Failed to record pin owner:', err)
  }
}

/**
 * Returns the wallet address that pinned `cid`, or null if the CID is not
 * indexed. Callers MUST treat null as "ownership cannot be verified" and
 * deny the request — never allow-by-default for an unknown CID.
 */
export async function getPinOwner(cid: string): Promise<string | null> {
  if (isKvConfigured()) {
    try {
      const data = await kvGet(pinKey(cid))
      if (!data) return null
      const record = JSON.parse(data) as PinOwnerRecord
      return record.ownerAddress
    } catch (err) {
      console.error('Failed to read pin owner from KV:', err)
      return null
    }
  }

  return memoryRegistry.get(cid)?.ownerAddress ?? null
}

/** Removes ownership tracking for `cid` after it has been successfully unpinned. */
export async function clearPinOwner(cid: string): Promise<void> {
  if (isKvConfigured()) {
    try {
      await kvDel(pinKey(cid))
      return
    } catch (err) {
      console.error('Failed to clear pin owner from KV:', err)
    }
  }

  memoryRegistry.delete(cid)
}
