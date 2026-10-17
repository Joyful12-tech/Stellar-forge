# Token Metadata Display Spec

## Status

**Shipped & Verified**

## Summary

Display IPFS-hosted token metadata, including token logo image, name, symbol, and description with fallbacks and loading states.

## Specifications & Shipped Functionality

1. **IPFS Image Retrieval**: Fetches IPFS metadata CIDs via IPFS gateway (`ipfsToGatewayUrl`).
2. **Skeleton & Fallbacks**: Displays circular skeleton loader while fetching, and fallback placeholder image when URI/metadata is missing or broken.
3. **Unit Tests**: Full test suite verifying loading, resolved, and placeholder states (`TokenMetadata.test.tsx`).

## Implementation References

- Component: `frontend/src/components/TokenMetadata.tsx`
- Unit Test: `frontend/src/components/TokenMetadata.test.tsx`
- Service: `frontend/src/services/ipfs.ts`

## Related Issues

- Issue #1117: Multiple `.kiro/specs` directories are abandoned stubs
