import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checkAuditWaivers,
  parseListedIds,
  parseWaiverBlocks,
  validateWaivers,
} from "./check-audit-waivers.mjs";

const toml = (body) => `[advisories]\nignore = [\n${body}\n]\n`;

const waived = (id, { reviewBy = "2099-01-01", fields = true } = {}) =>
  [
    `# WAIVER: ${id}`,
    ...(fields
      ? [
          "# Justification: dev-only dependency, not reachable at runtime",
          "# Link: https://github.com/Favourorg/Stellar-forge/issues/1",
          `# Review-by: ${reviewBy}`,
        ]
      : []),
    `  "${id}",`,
  ].join("\n");

const check = (text, today = "2026-07-20") =>
  validateWaivers({ text, listKey: "ignore", label: "audit.toml", today });

describe("check-audit-waivers", () => {
  it("parses active ids and skips commented-out entries", () => {
    const text = toml(
      ['  "RUSTSEC-2024-0001",', '#  "RUSTSEC-2024-0002",'].join("\n"),
    );
    assert.deepEqual(parseListedIds(text, "ignore"), ["RUSTSEC-2024-0001"]);
  });

  it("parses jsonc allowlists with // comments", () => {
    const text = '{\n  "allowlist": [\n    "GHSA-aaaa-bbbb-cccc"\n  ]\n}';
    assert.deepEqual(parseListedIds(text, "allowlist"), [
      "GHSA-aaaa-bbbb-cccc",
    ]);
  });

  it("throws when the list is absent", () => {
    assert.throws(
      () => parseListedIds("[advisories]\n", "ignore"),
      /Missing "ignore"/,
    );
  });

  it("parses a waiver block's fields", () => {
    const [block] = parseWaiverBlocks(toml(waived("RUSTSEC-2024-0001")));
    assert.equal(block.id, "RUSTSEC-2024-0001");
    assert.equal(block.fields["Review-by"], "2099-01-01");
    assert.match(block.fields.Justification, /dev-only/);
  });

  it("accepts a fully documented, unexpired waiver", () => {
    const result = check(toml(waived("RUSTSEC-2024-0001")));
    assert.deepEqual(result.errors, []);
    assert.deepEqual(result.expired, []);
    assert.equal(result.count, 1);
  });

  it("accepts an empty ignore list", () => {
    const result = check(toml(""));
    assert.deepEqual(result.errors, []);
    assert.equal(result.count, 0);
  });

  it("rejects a waived advisory with no waiver block", () => {
    const result = check(toml('  "RUSTSEC-2024-0001",'));
    assert.equal(result.errors.length, 1);
    assert.match(
      result.errors[0],
      /has no "# WAIVER: RUSTSEC-2024-0001" block/,
    );
  });

  it("rejects a waiver block missing required fields", () => {
    const result = check(toml(waived("RUSTSEC-2024-0001", { fields: false })));
    assert.equal(result.errors.length, 3);
    for (const field of ["Justification", "Link", "Review-by"]) {
      assert.ok(result.errors.some((error) => error.includes(field)));
    }
  });

  it("rejects a malformed Review-by date", () => {
    const result = check(
      toml(waived("RUSTSEC-2024-0001", { reviewBy: "next year" })),
    );
    assert.match(result.errors[0], /invalid Review-by date/);
  });

  it("rejects duplicate entries", () => {
    const text = toml(`${waived("RUSTSEC-2024-0001")}\n  "RUSTSEC-2024-0001",`);
    assert.match(check(text).errors[0], /listed more than once/);
  });

  it("rejects an orphaned waiver block", () => {
    const text = toml('# WAIVER: RUSTSEC-2024-0001\n  "RUSTSEC-2024-0002",');
    assert.ok(
      check(text).errors.some((error) =>
        error.includes("has no matching entry"),
      ),
    );
  });

  it("reports a past Review-by date as expired, not as an error", () => {
    const result = check(
      toml(waived("RUSTSEC-2024-0001", { reviewBy: "2026-07-19" })),
    );
    assert.deepEqual(result.errors, []);
    assert.equal(result.expired.length, 1);
    assert.match(result.expired[0], /due for re-triage on 2026-07-19/);
  });

  it("treats a Review-by date of today as still valid", () => {
    const result = check(
      toml(waived("RUSTSEC-2024-0001", { reviewBy: "2026-07-20" })),
    );
    assert.deepEqual(result.expired, []);
  });

  it("reports a missing waiver file", async () => {
    const { errors } = await checkAuditWaivers({
      root: "/nonexistent",
      files: [{ path: "audit.toml", listKey: "ignore", tool: "cargo audit" }],
      today: "2026-07-20",
    });
    assert.match(errors[0], /waiver file is missing/);
  });

  it("validates the checked-in waiver files", async () => {
    const { errors, summary } = await checkAuditWaivers({
      today: "2026-07-20",
    });
    assert.deepEqual(errors, []);
    assert.equal(summary.length, 2);
  });
});
