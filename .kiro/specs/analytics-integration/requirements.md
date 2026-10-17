# Analytics Integration Spec

> **Superseded by ADR-005.** This historical stub is retained only to record
> the discrepancy found in Issue #1118. Its opt-in `CookieConsentBanner`
> language is not normative; the implemented policy is ADR-005's explicit
> opt-out via `AnalyticsOptOut`.

## Status

**Superseded — do not implement**

## Summary

Integrates privacy-preserving telemetry and user consent tracking into the StellarForge frontend application following strict opt-in guidelines.

## Specifications & Requirements

1. **Consent First**: Analytics telemetry MUST be disabled by default until explicit user opt-in consent is provided via CookieConsentBanner.
2. **Opt-Out & Bypass Protection**: Automated checks (`scripts/check-analytics-bypass.mjs`) must verify that telemetry cannot be triggered when consent is missing or revoked.
3. **ADR Alignment**: Privacy guarantees must conform to ADR-005 specifications.

## Implementation & Verification

- Privacy Architecture: `docs/adr/ADR-005-analytics-privacy-consent.md`
- Telemetry Service: `frontend/src/services/analytics.ts`
- React Hook & Consent: `frontend/src/hooks/useAnalytics.ts`, `frontend/src/components/CookieConsentBanner.tsx`
- Automated Enforcement: `frontend/scripts/check-analytics-bypass.mjs`

## Related Issues

- Issue #1118: ADR-005's privacy guarantees have no traceable link to the code that implements them
- Issue #1117: Multiple `.kiro/specs` directories are abandoned stubs
