/**
 * Validates and enforces size limits on TokenMetadata JSON.
 * Ensures payloads conform to expected schema before upload to IPFS.
 */

export interface TokenMetadata {
  name: string;
  description: string;
  image: string; // Must be ipfs://CID format
}

const MAX_METADATA_JSON_SIZE = 8 * 1024; // 8 KiB strict limit
const MAX_NAME_LENGTH = 128;
const MAX_DESCRIPTION_LENGTH = 2000;
const IPFS_URI_PATTERN = /^ipfs:\/\/[a-zA-Z0-9]+$/;

// CIDv0: Qm + 44 base58 chars (total 46); CIDv1: b + base32 (lowercase)
const CID_V0_PATTERN = /^Qm[1-9A-HJ-NP-Za-km-z]{44}$/;
const CID_V1_PATTERN = /^b[a-z2-7]{58,}$/;

/** Validates a bare IPFS CID (no `ipfs://` prefix), CIDv0 or CIDv1. */
export function isValidCid(cid: string): boolean {
  return CID_V0_PATTERN.test(cid) || CID_V1_PATTERN.test(cid);
}

/**
 * Validate a TokenMetadata object and its JSON serialization.
 * @param metadata - The metadata object to validate
 * @param jsonString - The JSON string (for size check)
 * @returns { valid: true } or { valid: false, error: string }
 */
export function validateTokenMetadata(
  metadata: unknown,
  jsonString: string,
): { valid: true } | { valid: false; error: string } {
  // Check JSON size first (before parsing/validation)
  if (jsonString.length > MAX_METADATA_JSON_SIZE) {
    return {
      valid: false,
      error: `Metadata exceeds maximum size of ${MAX_METADATA_JSON_SIZE} bytes.`,
    };
  }

  // Type check
  if (typeof metadata !== "object" || metadata === null) {
    return { valid: false, error: "Metadata must be a JSON object." };
  }

  const obj = metadata as Record<string, unknown>;

  // Required fields
  if (
    typeof obj.name !== "string" ||
    obj.name.length === 0 ||
    obj.name.length > MAX_NAME_LENGTH
  ) {
    return {
      valid: false,
      error: `name must be a non-empty string, max ${MAX_NAME_LENGTH} characters.`,
    };
  }

  if (
    typeof obj.description !== "string" ||
    obj.description.length === 0 ||
    obj.description.length > MAX_DESCRIPTION_LENGTH
  ) {
    return {
      valid: false,
      error: `description must be a non-empty string, max ${MAX_DESCRIPTION_LENGTH} characters.`,
    };
  }

  if (typeof obj.image !== "string" || !IPFS_URI_PATTERN.test(obj.image)) {
    return {
      valid: false,
      error: "image must be in ipfs://CID format (e.g., ipfs://QmXxxx).",
    };
  }

  // No extra fields allowed
  const allowedKeys = new Set(["name", "description", "image"]);
  for (const key of Object.keys(obj)) {
    if (!allowedKeys.has(key)) {
      return { valid: false, error: `Unexpected field: ${key}.` };
    }
  }

  return { valid: true };
}
