# Token Metadata Format

The contract stores only a `metadata_uri` string. Everything else — name, description, image — lives in a JSON document pinned to IPFS, which the frontend fetches and renders.

Because that document is pinned by whoever created the token, **it is untrusted input**. Anyone can pin metadata directly to IPFS and point a token at it without ever touching the StellarForge upload form, so the frontend validates it on read rather than trusting it was produced by our own UI.

This page documents the constraints the frontend enforces, so third-party integrators pinning their own metadata know what will and will not survive rendering.

## Content Integrity

The frontend verifies that fetched metadata content matches the provided CID before parsing or rendering it. This verification:

- Hashes the raw response bytes using the algorithm embedded in the CID
- Compares the computed hash against the CID's multihash
- Rejects content on mismatch, ensuring content-addressing integrity

This guarantee holds only if the configured IPFS gateway is trusted to serve authentic content for pinned CIDs. Against Pinata specifically (the project's own trusted gateway), this is a strong guarantee. For alternate gateways or user-configurable endpoints, the gateway is still the trust boundary — a malicious gateway can serve arbitrary content regardless of CID verification.

## Document shape

```json
{
  "name": "MyToken",
  "description": "A short human-readable description.",
  "image": "ipfs://bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi"
}
```

All three fields are **required** and must be strings. A document missing any of them, or with a non-string value, is rejected outright and the token renders without metadata.

Unrecognised extra fields are **stripped** — only `name`, `description`, and `image` are read. Do not rely on custom fields surviving.

## Constraints

| Field              | Constraint                          | Behaviour when exceeded                   |
| ------------------ | ----------------------------------- | ----------------------------------------- |
| `name`             | ≤ **128** characters                | Truncated, with `…` appended              |
| `description`      | ≤ **2,000** characters              | Truncated, with `…` appended              |
| `image`            | Must be a well-formed `ipfs://` URI | Replaced with an inline placeholder image |
| _(whole document)_ | ≤ **100 KB** raw JSON               | Rejected — metadata is dropped entirely   |

Lengths are counted in **Unicode code points**, not UTF-16 code units, so truncation never splits a surrogate pair and leaves half an emoji behind.

### Why truncate rather than reject

An over-long description makes for a bad token, not a broken one. Rejecting the whole document would also discard the name and image, leaving a strictly worse page. The 100 KB document cap is the exception: it is enforced _before_ `JSON.parse`, because parsing a multi-megabyte payload costs main-thread time whether or not the result is later discarded.

### Why `image` must be `ipfs://`

An arbitrary `https://` image URL would be fetched by every visitor's browser, handing the token creator a view-tracking beacon that leaks each visitor's IP and user-agent. Only `ipfs://` URIs are resolved, and always through the configured gateway. Anything else — `https://`, `javascript:`, `data:`, protocol-relative, or a URI with path traversal — renders as a neutral placeholder. See `ipfsToGatewayUrl` in `frontend/src/utils/formatting.ts`.

## Rendering bounds

Independently of the data-layer caps above, the UI bounds what it draws:

- **Token detail** clamps the description to 3 lines with a "Show more" toggle; expanded text gets a capped scroll region rather than unbounded growth.
- **Token explorer** clamps to 2 lines with no expand affordance, so one token cannot grow its row and push other results off-screen.

This is deliberate redundancy. A character cap does not bound _height_ — a few hundred newlines, or stacked combining marks, occupy far more vertical space than their length implies.

## Pin lifecycle

Every metadata upload through the StellarForge UI pins **two CIDs** to Pinata: one for the image file and one for the metadata JSON. The on-chain `set_metadata` call then links the metadata URI to the token.

### Orphaned pins

If the `set_metadata` transaction is rejected by the user, the contract returns an error, or the transaction is dropped before inclusion, the pins are **orphaned** — they are permanently billed but never referenced by any token on-chain.

### Unpin on failed transaction

The frontend handles **provably-not-applied** failures automatically:

- **User rejects the Freighter signature prompt** → pins are reclaimed immediately.
- **Transaction dropped/expired** (the envelope never reached the ledger) → pins are reclaimed.
- **Contract rejected the transaction** (`failed` status) → pins are reclaimed.
- **Unconfirmed** (network timeout — the envelope may still be live) → pins are **not** reclaimed. They are left for the reconciliation job below.

The IPFS service layer (`IPFSService.unpinLastUpload`) records the CIDs from the most recent upload and calls the authenticated `/api/ipfs/unpin` serverless proxy, which forwards the unpin to Pinata using server-side credentials.

### Reconciliation job

A scheduled cron job (`/api/cron/reconcile-pins`, every 15 minutes per `vercel.json`) acts as a safety net:

1. Checks that the indexer is trustworthy enough to delete anything — durable store connected, backfill finished, ingest lag within 15 minutes (`checkReconciliationReadiness()`). If not, the run stops here and unpins nothing.
2. Lists all pins from the Pinata account via `POST /data/pinList`.
3. Reads the set of on-chain-referenced metadata URIs from the indexer store.
4. For each pin whose CID is **not** referenced by any on-chain event and whose `date_pinned` is older than the **24‑hour grace window**, the job unpins it via `DELETE /pinning/unpin/{cid}`.

The grace window ensures in-flight uploads (where the user closed the tab before the transaction could be attempted) are not prematurely cleaned up.

Reconciliation is conservative by construction, because an unpin is irreversible. It preserves everything when the pin list or the reference-set query fails, when the readiness gate refuses, and when a single run would unpin more than 10% of the account — the circuit breaker against a wrong reference set (issue #1156). `?dryRun=1` classifies and reports without calling Pinata; `?override=1` is the manual, deliberate way past the circuit breaker. See [docs/incident-response.md §11](./incident-response.md#11-ipfs-pin-mass-unpin).

### Pinning credentials

Pinata API credentials (`PINATA_API_KEY`, `PINATA_API_SECRET`) live in the **serverless function environment** only. They are never inlined into the browser bundle, never sent to the client, and never exposed in the public repository. The frontend communicates with Pinata exclusively through same-origin `/api/ipfs/*` proxies that authenticate via wallet-signed JWT.

## Where these are enforced

| Layer                     | Location                                              | Notes                                                            |
| ------------------------- | ----------------------------------------------------- | ---------------------------------------------------------------- |
| Integrity (authoritative) | `verifyCIDMatch()` in `frontend/src/services/ipfs.ts` | Verifies CID matches content before parsing; rejects on mismatch |
| Read (authoritative)      | `getMetadata` in `frontend/src/services/ipfs.ts`      | The only check that binds for externally-pinned metadata         |
| Write (advisory)          | `MetadataForm.tsx`, `MetadataUploadForm.tsx`          | Better UX; trivially bypassed by pinning directly                |
| Render (defence in depth) | `TokenDetail.tsx`, `TokenExplorer.tsx`                | Bounds height regardless of character count                      |
| Layer                     | Location                                              | Notes                                                            |
| ------------------------- | ------------------------------------------------      | --------------------------------------------------------         |
| Read (authoritative)      | `getMetadata` in `frontend/src/services/ipfs.ts`      | The only check that binds for externally-pinned metadata         |
| Write (advisory)          | `MetadataForm.tsx`, `MetadataUploadForm.tsx`          | Better UX; trivially bypassed by pinning directly                |
| Render (defence in depth) | `TokenDetail.tsx`, `TokenExplorer.tsx`                | Bounds height regardless of character count                      |

Constants live in `frontend/src/services/ipfs.ts` as `MAX_METADATA_NAME_LENGTH` and `MAX_METADATA_DESCRIPTION_LENGTH`. Update this document if you change them.
