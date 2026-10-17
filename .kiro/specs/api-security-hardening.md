# API Security Hardening: IPFS Upload Endpoints

## Overview
Harden the serverless IPFS upload proxy (`api/ipfs/upload-{file,json}.ts`) against:
1. Unauthenticated abuse (no auth required currently)
2. Bypassable rate limiting (in-memory, IP-spoofable)
3. Oversized JSON payloads with no schema validation
4. Client-controlled MIME type trust (no magic byte validation)

## Architecture

### Authentication Strategy
Use wallet-based challenge-response signing (Freighter `signMessage`):
- Client requests a time-limited challenge from `/api/auth/challenge` 
- Client signs challenge with Freighter wallet
- Proxy verifies signature and issues a short-lived (5 min) JWT
- Subsequent upload requests require valid JWT in `Authorization: Bearer <token>` header
- Per-wallet quotas replace per-IP limits

### Rate Limiting
Replace in-memory limiter with **Vercel KV** (or Upstash Redis):
- Key: `ratelimit:<wallet_address>:<bucket_type>` 
  - Bucket types: `window` (15-min rolling), `daily` (24-hr)
- Per-window: 10 uploads (or configurable via env)
- Per-day: 100 uploads
- Token-valid claims include quotas; refresh on each request

### JSON Schema Validation
Use schema validator for `TokenMetadata`:
- Required: `name` (string, 1-128 chars), `description` (string, 1-2000 chars), `image` (ipfs:// CID)
- Max JSON size: 8 KiB strict

### File Magic-Byte Validation
Check file signature before trusting MIME type:
- PNG: `89 50 4E 47`
- JPEG: `FF D8 FF`
- GIF: `47 49 46 38` (87a/89a)

## Tasks

### 1. Setup Auth Infrastructure
- [ ] Create `api/_lib/jwt.ts` – sign/verify short-lived tokens with wallet address claim
- [ ] Create `api/auth/challenge.ts` – issue time-bound challenges, validate and issue JWTs
- [ ] Update `api/_lib/rateLimit.ts` – swap in-memory for Vercel KV store
- [ ] Environment setup (VERCEL_KV_REST_API_URL, VERCEL_KV_REST_API_TOKEN in Vercel)

### 2. Harden Upload Endpoints
- [ ] `api/ipfs/upload-file.ts` – require valid JWT, check magic bytes, extract clientIp from Vercel rightmost-hop
- [ ] `api/ipfs/upload-json.ts` – require valid JWT, validate TokenMetadata schema, enforce 8 KiB max

### 3. Frontend Integration
- [ ] `frontend/src/services/ipfs.ts` – fetch challenge, sign with Freighter, attach JWT to uploads

### 4. Comprehensive Tests
- [ ] Auth tests: unauthenticated request rejection, JWT expiry, wallet mismatch
- [ ] Rate limiting: per-wallet daily/window quotas, KV persistence, no header-spoofing bypass
- [ ] JSON schema: oversized/malformed metadata rejection, magic byte validation
- [ ] Happy path: signed challenge → JWT → valid uploads

## Acceptance Criteria
- [ ] Unauthenticated requests return 401
- [ ] Rate limits survive instance recycling (durable KV store)
- [ ] Spoofed x-forwarded-for headers don't reset limits
- [ ] Only valid TokenMetadata schema + signature-verified files accepted
- [ ] All tests pass: auth, rate limiting, schema, magic bytes
