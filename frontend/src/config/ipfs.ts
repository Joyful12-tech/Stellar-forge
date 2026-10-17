// IPFS configuration
//
// Public endpoints only. Credentials are server-side (see api/_lib/pinata.ts);
// anything secret placed here would be inlined into the browser bundle.
export const IPFS_CONFIG = {
  pinataApiUrl: 'https://api.pinata.cloud',
  pinataGateway: 'https://gateway.pinata.cloud/ipfs',
}
