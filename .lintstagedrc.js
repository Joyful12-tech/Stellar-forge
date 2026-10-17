export default {
  // Use frontend's own prettier binary (its package.json pins a newer
  // version than the repo root) for every frontend-scoped step below, so
  // formatting decisions match `npm run format:check` in CI exactly. The
  // root-level `prettier --write` steps further down are fine as-is since
  // they only ever touch non-frontend files.
  "frontend/**/*.{js,jsx,ts,tsx}": [
    "bash -c 'cd frontend && ./node_modules/.bin/eslint --fix \"$@\"' --",
    "bash -c 'cd frontend && ./node_modules/.bin/prettier --write \"$@\"' --",
  ],
  "**/*.{json,css,md}": ["prettier --write"],
  "*.{js,ts,mjs,cjs}": ["prettier --write"],
  "frontend/src/i18n/*.json": [
    "bash -c 'cd frontend && node scripts/check-i18n-parity.mjs'",
    "bash -c 'cd frontend && ./node_modules/.bin/prettier --write \"$@\"' --",
  ],
};
