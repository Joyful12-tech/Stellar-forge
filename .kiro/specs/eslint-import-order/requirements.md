# ESLint Import Order Spec

## Status

**Closed / Resolved**

## Summary

Spec for enforcing import ordering via ESLint plugin.

## Resolution & Rationale

- Code formatting and import organization are handled via Prettier (`.prettierrc`) and ESLint flat config (`frontend/eslint.config.js`).
- Additional strict import ordering rules via `eslint-plugin-import` were evaluated and determined to be unneeded due to existing Prettier and TypeScript formatting workflows.

## Configuration References

- ESLint Flat Config: `frontend/eslint.config.js`
- Prettier Config: `.prettierrc`

## Related Issues

- Issue #1117: Multiple `.kiro/specs` directories are abandoned stubs
