# Vercel Deployment

This repository is deployed to Vercel as **two separate projects**, each governed by its own `vercel.json`:

| File                                              | Project root | Governs                                                                                                                         |
| ------------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| [`vercel.json`](../vercel.json)                   | repo root    | The project deployed from the repo root, including the `/api/cron/index-tokens` scheduled function (`crons`).                   |
| [`frontend/vercel.json`](../frontend/vercel.json) | `frontend/`  | The project deployed via the README's "Deploy with Vercel" button, which sets `root=frontend` and serves only the frontend SPA. |

Both projects serve HTTP responses to browsers, so **both files must carry the same security-relevant `headers` block** (`Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`). If you change one file's `headers`, update the other to match in the same change.

## Environment variables

Both projects require the environment variables described in the [README's "Deploy with Vercel" button](../README.md) (`VITE_FACTORY_CONTRACT_ID`, `VITE_TOKEN_WASM_HASH`, `PINATA_API_KEY`, `PINATA_API_SECRET`).

## Verifying headers on a live deployment

After deploying, confirm all five headers are present:

```bash
curl -I https://<your-deployment-domain>/
```
