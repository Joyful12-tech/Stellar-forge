# Changelog Automation Spec

## Status

**Shipped & Verified**

## Summary

Automate `CHANGELOG.md` updates from conventional commit messages during automated releases.

## Specifications & Shipped Functionality

1. **Semantic Release Integration**: `.releaserc.json` includes `@semantic-release/changelog` and `@semantic-release/git`.
2. **Automated Commit & Release Notes**: On release, semantic-release generates release notes and updates `CHANGELOG.md` in root.
3. **Repository Tracked**: `CHANGELOG.md` is committed and up to date in repository root.

## Configuration References

- Release Config: `.releaserc.json`
- Changelog File: `CHANGELOG.md`

## Related Issues

- Issue #1117: Multiple `.kiro/specs` directories are abandoned stubs
