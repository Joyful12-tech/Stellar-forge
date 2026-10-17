#!/usr/bin/env node
/**
 * generate_seeds.mjs
 *
 * Generates binary corpus seed files for libfuzzer fuzz targets.
 * Each seed is a raw byte blob that the `arbitrary::Arbitrary`
 * implementation in the corresponding fuzz target will deserialise.
 *
 * Usage:
 *   node scripts/generate_seeds.mjs
 *
 * Output: writes .bin files into corpus/<target>/ directories.
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(__dirname, "..", "corpus");

// ── Binary helpers ───────────────────────────────────────────────────────────

/** Write a u32 in little-endian. */
function u32LE(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n, 0);
  return b;
}

/** Write an i128 in little-endian. */
function i128LE(n) {
  const b = Buffer.alloc(16);
  // Split i128 into two 64-bit halves (low first, then high).
  const low = BigInt.asIntN(64, n);
  const high = BigInt.asIntN(64, n >> 64n);
  b.writeBigInt64LE(low, 0);
  b.writeBigInt64LE(high, 8);
  return b;
}

/** Write an arbitrary Vec<u8>: u32 LE length prefix then the bytes. */
function vecU8(bytes) {
  return Buffer.concat([u32LE(bytes.length), Buffer.from(bytes)]);
}

/** serialise the FuzzCreateTokenInput struct for the arbitrary crate.
 *
 *  struct FuzzCreateTokenInput {
 *      name_bytes: Vec<u8>,    // length-prefixed
 *      symbol_bytes: Vec<u8>,  // length-prefixed
 *      decimals: u32,           // 4 bytes LE
 *      initial_supply: i128,    // 16 bytes LE
 *      fee_payment: i128,       // 16 bytes LE
 *  }
 */
function createTokenSeed({
  name,
  symbol,
  decimals,
  initialSupply,
  feePayment,
}) {
  return Buffer.concat([
    vecU8(Buffer.from(name, "utf8")),
    vecU8(Buffer.from(symbol, "utf8")),
    u32LE(decimals),
    i128LE(initialSupply),
    i128LE(feePayment),
  ]);
}

/**
 * serialise the FuzzMintTokensInput struct.
 *
 *  struct FuzzMintTokensInput {
 *      amount: i128,             // 16 bytes LE
 *      fee_payment: i128,        // 16 bytes LE
 *      base_fee: i128,           // 16 bytes LE
 *      max_supply: Option<i128>, // 1 byte discriminant (0=None, else=Some)
 *                                // + 16 bytes LE if Some
 *      current_supply: i128,     // 16 bytes LE
 *  }
 */
function mintTokensSeed({
  amount,
  feePayment,
  baseFee,
  maxSupply,
  currentSupply,
}) {
  const parts = [i128LE(amount), i128LE(feePayment), i128LE(baseFee)];
  if (maxSupply === null || maxSupply === undefined) {
    parts.push(Buffer.from([0x00])); // None
  } else {
    parts.push(Buffer.from([0x01])); // Some
    parts.push(i128LE(maxSupply));
  }
  parts.push(i128LE(currentSupply));
  return Buffer.concat(parts);
}

// ── Seed definitions ─────────────────────────────────────────────────────────

const SEEDS = {
  fuzz_create_token: [
    {
      name: "initial_supply_i128_max",
      data: createTokenSeed({
        name: "Token",
        symbol: "TKN",
        decimals: 7,
        initialSupply: 2n ** 127n - 1n, // i128::MAX
        feePayment: 1000n,
      }),
    },
    {
      name: "minimal_inputs",
      data: createTokenSeed({
        name: "T",
        symbol: "S",
        decimals: 0,
        initialSupply: 0n,
        feePayment: 0n,
      }),
    },
  ],

  fuzz_mint_tokens: [
    {
      name: "checked_add_overflow",
      data: mintTokensSeed({
        amount: 2n ** 127n - 1n, // i128::MAX
        feePayment: 1000n,
        baseFee: 100n,
        maxSupply: 10000n,
        currentSupply: 1n, // current + amount would overflow i128
      }),
    },
    {
      name: "max_supply_exceeded",
      data: mintTokensSeed({
        amount: 1000n,
        feePayment: 1000n,
        baseFee: 100n,
        maxSupply: 500n,
        currentSupply: 0n,
      }),
    },
    // Issue #1006: `current_supply` seeded from a nonzero `initial_supply`
    // (post-fix, `deploy_one` now writes `initial_supply` into the tracked
    // supply key when `max_supply` is set — these seeds model that starting
    // point instead of the pre-fix `0`).
    {
      // initial_supply == max_supply: token was "fully minted" at creation,
      // so any further mint_tokens call must fail with MaxSupplyExceeded.
      name: "initial_supply_equals_cap_any_mint_fails",
      data: mintTokensSeed({
        amount: 1n,
        feePayment: 1000n,
        baseFee: 100n,
        maxSupply: 1_000_000n,
        currentSupply: 1_000_000n,
      }),
    },
    {
      // initial_supply = cap - 10: minting exactly the remaining 10 must
      // succeed and land precisely on the cap.
      name: "initial_supply_near_cap_exact_remainder_succeeds",
      data: mintTokensSeed({
        amount: 10n,
        feePayment: 1000n,
        baseFee: 100n,
        maxSupply: 1000n,
        currentSupply: 990n,
      }),
    },
    {
      // initial_supply = cap - 10: minting 11 (one past the remaining
      // headroom) must fail with MaxSupplyExceeded.
      name: "initial_supply_near_cap_one_over_fails",
      data: mintTokensSeed({
        amount: 11n,
        feePayment: 1000n,
        baseFee: 100n,
        maxSupply: 1000n,
        currentSupply: 990n,
      }),
    },
  ],
};

// ── Write seeds ──────────────────────────────────────────────────────────────

for (const [target, seeds] of Object.entries(SEEDS)) {
  const dir = join(CORPUS, target);
  mkdirSync(dir, { recursive: true });
  for (const { name, data } of seeds) {
    const path = join(dir, `${name}.bin`);
    writeFileSync(path, data);
    console.log(`  wrote ${path} (${data.length} bytes)`);
  }
}

console.log("\n✅ Seeds generated successfully.");
