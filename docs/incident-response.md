# StellarForge Incident Response Runbook

> **Audience:** On-call team, protocol maintainers, anyone with admin key access.
>
> **Scope:** Compromised or lost admin key for the StellarForge token-factory contract on mainnet.
>
> **Status:** Active — review and re-approve after every mainnet deployment and after any change to admin key custody.

---

## Table of contents

1. [Threat model](#1-threat-model)
2. [How compromise would be detected](#2-how-compromise-would-be-detected)
3. [Authority and contacts](#3-authority-and-contacts)
4. [Immediate response (first five minutes)](#4-immediate-response-first-five-minutes)
5. [Short-term stabilisation (first hour)](#5-short-term-stabilisation-first-hour)
6. [Recovery (first 24 hours)](#6-recovery-first-24-hours)
7. [Break-glass recovery mechanism](#7-break-glass-recovery-mechanism)
8. [Post-incident steps](#8-post-incident-steps)
9. [Communication plan](#9-communication-plan)
10. [Tabletop exercise checklist](#10-tabletop-exercise-checklist)
11. [IPFS pin mass-unpin](#11-ipfs-pin-mass-unpin)

---

## 1. Threat model

The factory contract's `admin` address is a single point of catastrophic trust. An attacker in possession of the admin key can:

| Action                                       | Effect                                                                                                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `update_fees(admin, base_fee, metadata_fee)` | Set arbitrarily high fees to drain users who call the contract                                                                                                            |
| `set_fee_split(admin, splits)`               | Redirect collected fees to an attacker-controlled address                                                                                                                 |
| `propose_upgrade` + `execute_upgrade`        | Schedule and (after ~28 hours) apply a WASM swap to attacker-controlled code — mitigated by the timelock and `upg_prop` event which gives operators a cancellation window |
| `propose_admin(admin, attacker_address)`     | Begin a rotation to an attacker-controlled address; the attacker then calls `accept_admin` to complete the transfer                                                       |
| `pause(admin)`                               | Halt the factory, denying service to all token creators                                                                                                                   |

**Two-step rotation reduces but does not eliminate admin-rotation risk.** The two-step model (`propose_admin` + `accept_admin`) prevents accidental rotation to an uncontrolled address — the incoming key must prove it can sign. However, an attacker who already holds the current admin key can still complete the rotation to their own address by controlling both steps. Detection window: a `propose_admin` call emits an `adm_prop` event that is visible on-chain _before_ `accept_admin` completes the transfer, giving operators a window to cancel via `cancel_admin_proposal` if the proposal is unauthorized.

**Upgrade timelock (active defense, issue #6 resolved):** The single-step `upgrade` entrypoint has been replaced by a mandatory two-step flow with a ~28-hour timelock:

1. `propose_upgrade(admin, new_wasm_hash)` — records the pending hash and a `ready_at` ledger (`current + UPGRADE_TIMELOCK_LEDGERS`). Emits `upg_prop` immediately, making the scheduled upgrade observable on-chain _before_ it goes live.
2. `execute_upgrade(admin, new_wasm_hash)` — performs the WASM swap, but only once the current ledger ≥ `ready_at`, _and_ only if `new_wasm_hash` exactly matches the proposed hash. Emits `upg_exec`.
3. `cancel_upgrade(admin)` — aborts a pending proposal at any time before execution. Emits `upg_can`.

This window is the primary on-chain defense against a compromised admin key performing an atomic WASM swap with no community warning. Alert on `upg_prop` events and cancel any unexpected proposals within the ~28-hour window using `cancel_upgrade`. WASM-hash polling (see §2.4) remains a defense-in-depth layer but is no longer the _only_ detection mechanism.

---

## 2. How compromise would be detected

Detection relies on multiple independent signals. Any single signal is enough to begin the response procedure.

### 2.1 Sentry error correlation (fastest for client-side anomalies)

All Sentry events captured during transaction lifecycles are tagged with `network`, `contractId`, and `functionName` (see issue #944). An unusual spike in:

- `functionName: deployToken` errors with `InsufficientFee` codes (fee manipulation)
- `functionName: pollTransaction` failures across many unrelated users

should trigger investigation of the admin state.

Set a Sentry alert rule:

- Filter: `network = mainnet`, `functionName = deployToken`, `code = InsufficientFee`
- Condition: event count > 3 in 5 minutes
- Action: page on-call channel immediately

### 2.2 On-chain event monitoring (authoritative)

Subscribe to factory contract events via Horizon's Server-Sent Events (SSE) endpoint:

```bash
curl -N "https://horizon.stellar.org/accounts/<FACTORY_CONTRACT>/operations?cursor=now"
```

Alert on:

- Any `adm_prop` event (admin rotation proposed — act immediately if unexpected; you have until `accept_admin` is called or the proposal expires to cancel via `cancel_admin_proposal`)
- Any `adm_acc` event (admin rotation completed — if unexpected, the admin key is compromised)
- Any `adm_dep` event (a rotation was proposed through the deprecated `transfer_admin` / `update_admin` entrypoints — the caller's tooling may still assume rotation completes in one transaction; see [§2.6](#26-stale-pending-admin-proposals))
- Any `fees` event with unusually large values
- Any `pause` event not preceded by a planned maintenance notice

### 2.3 Upgrade event monitoring (primary signal)

The two-step upgrade flow emits on-chain events at every stage. Subscribe to the factory contract's event stream and alert on:

- **`upg_prop`** — an upgrade has been proposed. Review the `new_wasm_hash` in the event payload immediately. If unexpected, call `cancel_upgrade` before `UPGRADE_TIMELOCK_LEDGERS` (~17,280 ledgers ≈ 28.8 hours) elapse.
- **`upg_exec`** — a proposed upgrade executed. If unexpected, the admin key is compromised; begin the key rotation procedure immediately.
- **`upg_can`** — a pending upgrade was cancelled. Log for audit trail.

```bash
# Subscribe to upgrade events (adjust cursor=now to your baseline ledger):
curl -N "https://horizon.stellar.org/accounts/<FACTORY_CONTRACT>/operations?cursor=now"
# or use stellar-sdk's EventEmitter to filter by topic:
#   topics: [["factory"], ["upg_prop", "upg_exec", "upg_can"]]
```

### 2.4 WASM hash polling (defense-in-depth)

Even with event-based detection, poll the on-chain WASM hash as a defense-in-depth layer. The `token_wasm_hash` field in `get_state()` is updated atomically by `execute_upgrade`:

```bash
#!/usr/bin/env bash
# check-wasm-hash.sh — run this on a cron schedule (every 5 minutes on mainnet)
EXPECTED_HASH="<paste-the-deployed-wasm-hash-here>"
CURRENT_HASH=$(stellar contract invoke \
  --id "$FACTORY_CONTRACT_ID" \
  --network mainnet \
  -- get_state | jq -r '.token_wasm_hash // empty')

if [ "$CURRENT_HASH" != "$EXPECTED_HASH" ]; then
  echo "ALERT: WASM hash changed from $EXPECTED_HASH to $CURRENT_HASH" | \
    curl -X POST -d @- "$ALERT_WEBHOOK_URL"
fi
```

Store `EXPECTED_HASH` after each intentional `execute_upgrade` and update the script immediately.

### 2.5 User reports

Token creators reporting sudden fee increases or failed `create_token` calls with no contract-level change on your end are a strong indicator of fee manipulation.

### 2.6 Stale pending admin proposals

**What this catches:** a rotation that was started and never finished. `propose_admin` (and the deprecated `transfer_admin` / `update_admin` aliases, which delegate to it) only _records_ a successor — the rotation takes effect when the proposed admin calls `accept_admin`, and the proposal lapses after `ADMIN_PROPOSAL_TTL_LEDGERS` (17,280 ledgers ≈ **28.8 hours**). A proposal left pending is not merely untidy: if the outgoing key is decommissioned in the belief that the rotation completed, the factory is permanently stuck under a key that no longer exists once the proposal expires. There is no guardian override and no timelock bypass (issue #1159).

**Alert on:** a pending proposal older than **6 hours** (warn) or **12 hours** (page). Both thresholds sit far enough inside the ~28.8-hour TTL that a human can still act — either by getting `accept_admin` signed, or by cancelling and restarting the rotation while the _current_ admin key is unquestionably still available.

Run `scripts/check-pending-admin-proposal.sh` on a cron schedule (every 15 minutes is ample):

```bash
FACTORY_CONTRACT_ID=C... \
STELLAR_NETWORK=mainnet \
WARN_AFTER_HOURS=6 \
PAGE_AFTER_HOURS=12 \
  ./scripts/check-pending-admin-proposal.sh
```

It reads `get_state()`, and exits `0` when no proposal is pending, `1` on a warn-threshold breach, `2` on a page-threshold breach, and `3` when the proposal has already expired (the rotation must now be restarted from the current admin key). Wire non-zero exits into the same alert channel as `check-wasm-hash.sh`.

**On alert, in order:**

1. Confirm the proposal is expected. If it is **not**, call `cancel_admin_proposal` from the current admin immediately — an unexpected proposal is an admin-key compromise until proven otherwise (see [§4 step 3](#step-3--attempt-to-pause-the-factory-if-admin-key-is-still-operable)).
2. If it is expected, contact the incoming key's custodian and get `accept_admin` signed.
3. If the incoming custodian cannot sign before expiry, cancel the proposal rather than letting it lapse silently, and re-propose when both parties are ready. **Do not** retire the outgoing key in the meantime.

**Why the TTL is not longer.** A 28.8-hour window was kept deliberately rather than extended, and there is no "renew" entrypoint: extending a live proposal would require a call from the _current_ admin, which is exactly the key that is unavailable in the scenario a longer TTL is meant to rescue — so it buys nothing there, while a long-lived proposal is a standing, accept-anytime claim on the factory if the proposed key is later lost or changes hands. The mitigation for a slow handover is procedural, not on-chain: verify the incoming key can sign _before_ proposing (see the deployment checklist), monitor with the script above, and re-propose if the window lapses. Re-proposing is always available while the current admin key exists — which is why that key must not be decommissioned until `accept_admin` has succeeded.

---

## 3. Authority and contacts

Maintain a live copy of this table in a private team channel. Do not embed real names or personal contact details in this public document.

| Role                      | Responsibility                                                               | Contact                 |
| ------------------------- | ---------------------------------------------------------------------------- | ----------------------- |
| **Incident commander**    | Declares the incident, coordinates all actions, is the single decision-maker | _See team contact list_ |
| **Admin key custodian**   | Has access to the hardware wallet / multisig device holding the admin key    | _See team contact list_ |
| **Break-glass custodian** | Has access to the backup admin (break-glass) account                         | _See team contact list_ |
| **Communications lead**   | Drafts and publishes user-facing notices                                     | _See team contact list_ |
| **Legal / compliance**    | Advises on disclosure obligations                                            | _See team contact list_ |

Minimum team size for executing on-chain recovery: **two people** (incident commander + admin key custodian). Never execute admin-level transactions alone.

---

## 4. Immediate response (first five minutes)

### Step 1 — Confirm the compromise

Do not act on a single noisy signal. Cross-check two or more of the detection signals in section 2 before proceeding.

```bash
# 1. Check current admin address
stellar contract invoke \
  --id "$FACTORY_CONTRACT_ID" \
  --network mainnet \
  -- get_state | jq '.admin'

# 2. Check current fees
stellar contract invoke \
  --id "$FACTORY_CONTRACT_ID" \
  --network mainnet \
  -- get_base_fee

# 3. Check current WASM hash against known-good value
stellar contract invoke \
  --id "$FACTORY_CONTRACT_ID" \
  --network mainnet \
  -- get_state | jq '.wasm_hash'
```

### Step 2 — Call the incident commander

Even if you are the admin key custodian, do not act alone. Call the incident commander first. If unreachable within 2 minutes, escalate to the next person in the authority chain.

### Step 3 — Attempt to pause the factory (if admin key is still operable)

If the admin key has not yet been used by the attacker to transfer admin rights away:

```bash
stellar contract invoke \
  --id "$FACTORY_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network mainnet \
  -- pause \
  --admin "$ADMIN_ADDRESS"
```

`pause` halts `create_token`, `create_tokens_batch`, `mint_tokens`, and `set_metadata`. It does **not** halt `burn`, so users can always recover their own balances. Fees already collected cannot be retrieved via this mechanism.

> ⚠️ **If the attacker has already called `propose_admin` followed by `accept_admin`** to transfer admin rights to their address, your `pause` call will fail with `Unauthorized`. Skip to step 4.
>
> ⚠️ **If you see an unexpected `adm_prop` event** but `accept_admin` has not yet been called, act immediately: call `cancel_admin_proposal` before the attacker can call `accept_admin`. You have up to ~28 hours (the proposal TTL) to cancel.

### Step 4 — Rotate admin to the break-glass address (two-step)

If the admin key is still operable but you suspect imminent key-theft (e.g. private key was exposed in logs), rotate to the pre-agreed break-glass account using the two-step flow:

**Step 4a — Propose the break-glass address as new admin:**

```bash
stellar contract invoke \
  --id "$FACTORY_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network mainnet \
  -- propose_admin \
  --current_admin "$ADMIN_ADDRESS" \
  --new_admin "$BREAK_GLASS_ADDRESS"
```

**Step 4b — Accept from the break-glass account (must be done within ~28 hours):**

```bash
stellar contract invoke \
  --id "$FACTORY_CONTRACT_ID" \
  --source "$BREAK_GLASS_SECRET_KEY" \
  --network mainnet \
  -- accept_admin \
  --new_admin "$BREAK_GLASS_ADDRESS"
```

Once `accept_admin` succeeds, the compromised key is locked out of all admin-gated operations. See [section 7](#7-break-glass-recovery-mechanism) for break-glass account details.

> 💡 **Why two steps?** The two-step model prevents accidental rotation to a typo'd address by requiring the incoming key to prove it can sign. In an emergency you need both the admin key (step 4a) and the break-glass key (step 4b) available — verify break-glass account access before any incident occurs (see the deployment checklist).

### Step 5 — Post to the incident channel

Immediately post the following to the team's incident Slack/Discord channel:

```
🚨 INCIDENT DECLARED — StellarForge mainnet factory
Time: <UTC timestamp>
Incident commander: <name>
Suspected action: <fee manipulation | admin transfer | WASM upgrade | unknown>
Admin key status: <operable | compromised — transferred away | unknown>
Factory paused: yes / no / failed
Next action: <describe>
```

---

## 5. Short-term stabilisation (first hour)

### 5.1 If the factory was paused successfully

- Monitor Sentry and Horizon for continued anomalous transactions.
- Assess whether funds were drained via `set_fee_split` before the pause.
- **Do not unpause** until the admin key custody situation is fully resolved and a new admin address has been established.

### 5.2 If the attacker has already transferred admin rights

- The contract is now under attacker control.
- **Do not attempt to call contract functions with the old admin key** — the transactions will fail and may leak information about your response timing.
- Begin the break-glass procedure in [section 7](#7-break-glass-recovery-mechanism).
- Note: if the attacker calls `upgrade` with a malicious WASM, the contract code itself is replaced. Verify the WASM hash before trusting any contract return values.

### 5.3 Fee impact assessment

Determine whether users were overcharged:

```bash
# Look for fee events with unusually high values
stellar contract invoke \
  --id "$FACTORY_CONTRACT_ID" \
  --network mainnet \
  -- get_base_fee
```

Compare against the last known legitimate value from the deployment log. Document all affected transactions for later user communication.

### 5.4 WASM integrity check

```bash
# Get the current on-chain WASM hash
CURRENT_HASH=$(stellar contract invoke \
  --id "$FACTORY_CONTRACT_ID" \
  --network mainnet \
  -- get_state | jq -r '.wasm_hash')

# Compare against the known-good hash from the deployment log
echo "Deployed hash: $KNOWN_GOOD_HASH"
echo "On-chain hash: $CURRENT_HASH"
```

If the hashes differ and no authorised upgrade was performed, treat the contract as fully compromised. Do not use it until re-deployed with a new contract ID (see issue #32 for the forensic WASM-comparison process).

---

## 6. Recovery (first 24 hours)

### 6.1 Rotate the admin key

1. Generate a new admin keypair on an air-gapped machine or hardware wallet.
2. Confirm the new keypair can sign a transaction on mainnet **before** it is proposed as admin.
3. Once the break-glass account holds admin rights, call `propose_admin` from the break-glass account naming the new admin address.
4. Call `accept_admin` **from the new admin key**, then verify with `get_state()` that `admin` is the new address and `pending_admin` is `null`. The rotation is not complete until this check passes.
5. Revoke the compromised key from all systems immediately. Do not revoke the break-glass key until step 4 has been verified.

### 6.2 Re-audit admin key custody

Before unpausing the factory, conduct an emergency review of how the admin key was compromised:

- Was it stored insecurely (clipboard, environment variable, unencrypted file)?
- Was the hardware wallet device physically accessed?
- Was phishing involved?

Document findings and apply remediation before resuming operations.

### 6.3 If WASM was replaced by attacker code

A `upgrade` to attacker-controlled WASM is the most severe scenario. The existing contract at the original address is now malicious and **must not be used**.

Recovery steps:

1. Deploy a **new** factory contract at a fresh contract address.
2. Re-initialize with the new admin address.
3. Notify all integrators and the frontend config must be updated.
4. Publish a security advisory explaining the impact.

### 6.4 Unpause

Only unpause after:

- [ ] Admin key custody is restored to a known-good state.
- [ ] WASM integrity is confirmed against the known-good hash.
- [ ] Fee configuration is verified to be correct.
- [ ] At least one additional team member has independently verified steps 1–3.

```bash
stellar contract invoke \
  --id "$FACTORY_CONTRACT_ID" \
  --source "$NEW_ADMIN_SECRET_KEY" \
  --network mainnet \
  -- unpause \
  --admin "$NEW_ADMIN_ADDRESS"
```

---

## 7. Break-glass recovery mechanism

This section documents the pre-agreed backup admin account that allows recovery from a scenario where the primary admin key is lost or the attacker has not yet taken over admin rights.

### 7.1 What the break-glass account is

The break-glass account is a **separate Stellar keypair** held by a designated break-glass custodian. It is never used for routine operations. Its sole purpose is to receive admin rights — by calling `accept_admin` on a proposal raised by the current admin — in an emergency, then:

1. Pause the factory.
2. Rotate admin to a freshly-generated recovery key (`propose_admin` from break-glass, `accept_admin` from the recovery key).
3. Facilitate any necessary fee or WASM restoration.

Because acceptance requires the incoming key to sign, the break-glass custodian must be reachable and able to sign **within ~28.8 hours** of the proposal, or the rotation lapses and has to be restarted from the compromised key.

### 7.2 Custody requirements

| Requirement | Detail                                                                          |
| ----------- | ------------------------------------------------------------------------------- |
| Storage     | Hardware wallet (Ledger or equivalent) held by the break-glass custodian        |
| Location    | Physically separate from the primary admin hardware wallet                      |
| Access      | Break-glass custodian only; known to the incident commander                     |
| Testing     | Confirmed usable (non-zero XLM balance, key unlocked) at least once per quarter |

### 7.3 Setting up the break-glass address

> Do this **before** mainnet deployment. Record the result in the deployment log.

```bash
# Generate the break-glass keypair on an air-gapped machine
stellar keys generate break-glass --offline

# Fund the break-glass account with at least 5 XLM for transaction fees
stellar keys address break-glass
# Transfer 5+ XLM to this address from the treasury

# Record the break-glass public address (never commit the private key)
BREAK_GLASS_ADDRESS=$(stellar keys address break-glass)
echo "Break-glass address: $BREAK_GLASS_ADDRESS"
```

Add `BREAK_GLASS_ADDRESS` to the deployment log. The private key stays on the hardware wallet.

### 7.4 Activating the break-glass account

When a compromise is confirmed and the primary admin key is still operable, rotate admin rights to the break-glass address. This is **two transactions** — the first alone changes nothing.

**Step 1 — propose, from the primary admin key:**

```bash
stellar contract invoke \
  --id "$FACTORY_CONTRACT_ID" \
  --source "$ADMIN_SECRET_KEY" \
  --network mainnet \
  -- propose_admin \
  --current_admin "$ADMIN_ADDRESS" \
  --new_admin "$BREAK_GLASS_ADDRESS"
```

**Step 2 — accept, from the break-glass key (required; within ~28.8 hours):**

```bash
stellar contract invoke \
  --id "$FACTORY_CONTRACT_ID" \
  --source "$BREAK_GLASS_SECRET_KEY" \
  --network mainnet \
  -- accept_admin \
  --new_admin "$BREAK_GLASS_ADDRESS"
```

**Step 3 — verify before treating the rotation as done:**

```bash
stellar contract invoke --id "$FACTORY_CONTRACT_ID" --network mainnet -- get_state \
  | jq '{admin, pending_admin}'
# admin must be $BREAK_GLASS_ADDRESS and pending_admin must be null
```

> ⚠️ **Do not use the deprecated `transfer_admin` / `update_admin` entrypoints.** They delegate to `propose_admin` and complete nothing on their own — they return `rotation_complete: false` and emit `adm_dep` to say so, but any runbook or script that treats their success as "rotated" is wrong (issue #1159). If step 2 is never executed, the proposal expires and admin stays with the original key; if that key has been retired in the meantime, the factory's governance is lost permanently.

### 7.5 Multisig threshold (recommended for mainnet)

For higher assurance, configure the admin address as a multisig account requiring M-of-N signers before executing any administrative transaction. This means a single leaked key cannot take any unilateral action.

Setup outline (Stellar multisig):

```bash
# Set the admin account to require 2-of-3 signers
stellar transaction new \
  --source "$ADMIN_ADDRESS" \
  --network mainnet \
  -- set-options \
  --master-weight 1 \
  --low-threshold 2 \
  --med-threshold 2 \
  --high-threshold 2 \
  --signer "$SIGNER_B_PUBLIC_KEY:1" \
  --signer "$SIGNER_C_PUBLIC_KEY:1"
```

With multisig, `propose_admin` / `accept_admin` and `upgrade` calls require assembling a transaction and collecting M signatures before submission — note this applies to **both** halves of a rotation, so budget signing time for each within the ~28.8-hour proposal TTL. This introduces latency in an emergency but dramatically reduces the blast radius of any single key compromise.

---

## 8. Post-incident steps

Complete all of the following after the immediate threat is neutralised.

### 8.1 Forensic WASM comparison (see issue #32)

```bash
# Decompile and diff the on-chain WASM against the last known-good build
stellar contract fetch \
  --id "$FACTORY_CONTRACT_ID" \
  --network mainnet \
  --out-file recovered.wasm

# Compare
diff <(wasm-dis known-good.wasm) <(wasm-dis recovered.wasm)
```

Document any differences as potential attacker modifications.

### 8.2 Full deployment log audit

Review:

- When did the admin key leave the hardware wallet?
- Which machines accessed it?
- What processes had `ADMIN_SECRET_KEY` in their environment?

### 8.3 Rotate all related secrets

- Treasury account keys (if the attacker potentially had access to the same environment).
- Pinata API keys (IPFS).
- Sentry DSN (if the compromise involved the deployment environment).
- Any CI/CD secrets that co-existed with the admin key.

### 8.4 User impact assessment

- Identify all `create_token` or `mint_tokens` calls that were charged inflated fees.
- Identify creators who paid an inflated `metadata_fee` on a `set_metadata` call while the attacker
  controlled fees. Scope this as **overcharging, not tampering**: `set_metadata` is authorized against the
  token's stored creator, never `state.admin`, so a compromised admin key cannot rewrite anyone's metadata
  under the deployed contract (see [SECURITY.md](../SECURITY.md#admin-key-is-a-single-point-of-trust)). If a
  malicious `upgrade` landed, that guarantee is void from the upgrade onward and metadata must be re-verified.
- Determine whether any funds in the treasury account were drained via `set_fee_split`.

### 8.5 Disclosure timeline

| Time   | Action                                    |
| ------ | ----------------------------------------- |
| T+0    | Incident declared, factory paused         |
| T+1 h  | Internal post-mortem started              |
| T+24 h | Initial public notice posted (see below)  |
| T+72 h | Full incident report published            |
| T+30 d | Follow-up confirming remediation complete |

> Note: StellarForge operates in the "emerging markets fintech-adjacent" space. Depending on the jurisdiction of affected users and the scale of financial impact, applicable data-breach or financial-services notification laws may set shorter or stricter timelines than those above. Consult Legal before publishing the T+24 h notice.

---

## 9. Communication plan

### 9.1 Initial public notice template (publish at T+24 h or sooner if significant user impact)

```
Subject: Security Incident Notice — StellarForge Token Factory

We are writing to inform you of a security incident affecting the StellarForge
token factory contract on Stellar mainnet.

What happened: [brief description — e.g. admin key was compromised; attacker
  temporarily set an inflated creation fee]

When: [UTC time range]

Impact: [number of affected transactions / users; estimated fee overcharge;
  any data that was exposed]

What we've done: The factory was paused at [time]. The admin key has been
  rotated. [Other remediation steps.]

What you should do: [any user action required, e.g. contact support for fee
  refund, do not use the old contract address]

More information: [link to full incident report]

We sincerely apologise for this incident and will publish a full post-mortem
within 72 hours.
```

### 9.2 Channels

- GitHub Security Advisory (private → public after 30 days or sooner)
- Project Discord / Telegram announcement channel
- Direct email to known token creators (if email addresses are available)
- Update the frontend banner to display a maintenance / incident notice

---

## 10. Tabletop exercise checklist

Run this exercise with the actual team at least once before mainnet launch and once per quarter thereafter. It should take approximately 90 minutes.

- [ ] Each team member has read the full runbook.
- [ ] Break-glass address is confirmed funded and accessible.
- [ ] WASM hash monitoring script is deployed and confirmed alerting.
- [ ] Sentry alert rules for anomalous fee events are active.
- [ ] Incident commander and break-glass custodian can reach each other out of band (phone, not just Slack).
- [ ] Walk through section 4 step-by-step on testnet: pause, `propose_admin` to break-glass, `accept_admin` **from the break-glass key**, then verify `get_state()` reports the new `admin` with `pending_admin: null`. Rehearse both signatures — a rotation that stops after the proposal is the failure mode this exercise exists to catch.
- [ ] Confirm the stale-proposal monitor (`check-pending-admin-proposal.sh`) fires: leave a testnet proposal pending and check the alert lands.
- [ ] Walk through section 5.4 WASM integrity check on testnet.
- [ ] Confirm that the communication templates in section 9 are up to date.
- [ ] Document who participated and the date. File in the deployment log.

---

## 11. IPFS pin mass-unpin

> **Scope note:** unlike the rest of this runbook, this section is not about a compromised key. It is an operational failure mode with the same blast radius: permanent, irreversible loss of user data, caused by ordinary timing rather than an attacker.

### 11.1 The failure mode

`/api/cron/reconcile-pins` reclaims orphaned IPFS pins by unpinning every CID that the indexer does not list as referenced and that is older than the 24-hour grace window. That inference is only valid when the indexer's token set is complete. Three states leave it incomplete while every query still returns HTTP 200 (issue #1156):

| State                      | Trigger                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Store degraded to memory   | One failed Postgres connect on a cold start; the instance serves an empty in-memory store.                                        |
| Backfill unfinished        | Backfill processes 200 tokens per 5-minute run — a few thousand tokens take many hours, and reconciliation runs on its own clock. |
| Steady-state ingest behind | Recent `meta` events not yet applied.                                                                                             |

In any of them the reconciler would have concluded that live, on-chain-referenced metadata was unreferenced garbage and unpinned it. The pins cannot be restored: the upload session and the original file are long gone, and users see broken images and descriptions everywhere their `ipfs://` URI is resolved.

### 11.2 Safeguards now in place

1. **Readiness gate.** `checkReconciliationReadiness()` refuses the unpin phase unless the store is durable and connected, `backfillComplete === true`, and `lagSeconds <= 15 min`. A refusal is logged as `[pin-reconciliation] skipping unpin phase — <reason>` and returned in the cron response as `skipped: true` with `skipReason: "not_ready"`.
2. **No cached degrade.** `getStore()` retries the durable connection after 30s instead of caching an empty in-memory store for the instance's lifetime, and reports `durableConfigured && !usingDurableStore` through `getStoreHealth()`.
3. **Circuit breaker.** A run that would unpin more than 10% of the account (above an absolute floor of 5 pins) refuses and logs `[pin-reconciliation] circuit breaker tripped`, whatever the gate said.
4. **Dry run.** `?dryRun=1` (or `RECONCILE_PINS_DRY_RUN=true`) classifies and logs without calling Pinata.
5. **Health signal.** `/api/health/indexer` exposes `reconciliationReady`, `reconciliationBlocker` and `durableStoreConnected`.

### 11.3 Detection

```bash
# Is reconciliation allowed to delete anything right now, and if not, why?
curl -s https://<deployment>/api/health/indexer | jq '{
  reconciliationReady, reconciliationBlocker, durableStoreConnected,
  backfillComplete, lagSeconds, indexedCount
}'
```

Page on either of these:

- `durableStoreConnected = false` while `durable = true` — the instance is reading an empty store.
- Any `cleaned` value in a reconcile-pins run that is large relative to the account, or a log line containing `circuit breaker tripped`.

### 11.4 If a mass unpin has already happened

1. **Stop further runs immediately.** Remove `/api/cron/reconcile-pins` from the root `vercel.json` `crons` array and redeploy, or unset `CRON_SECRET` in the project so every invocation returns 401. Do not wait to finish diagnosing.
2. **Establish the blast radius.** Diff the affected CIDs against the on-chain `meta` events (the authoritative reference set) rather than against the indexer, which is the component under suspicion.
3. **Attempt recovery before the data ages out.** A CID that any other IPFS node still holds can be re-pinned by hash — `POST /pinning/pinByHash` with `hashToPin` — and public gateways may still have it cached. This window is short; try it first, in parallel with the rest of the response.
4. **Fix the underlying state** (restore the durable store, let backfill finish) and confirm `reconciliationReady = true` on the health endpoint.
5. **Re-enable with a dry run first.** Invoke `?dryRun=1` manually and read `wouldUnpin` in the response before restoring the schedule.
6. **Notify affected token creators** using the template in section 9.1, adapted: their metadata is unrecoverable unless re-uploaded, and re-uploading requires a new `set_metadata` transaction.

### 11.5 Deliberately exceeding the circuit breaker

Only after a dry run has been reviewed by a second person:

```bash
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://<deployment>/api/cron/reconcile-pins?dryRun=1" | jq '.wouldUnpin'

# Reviewed and confirmed as genuine orphans:
curl -s -H "Authorization: Bearer $CRON_SECRET" \
  "https://<deployment>/api/cron/reconcile-pins?override=1" | jq '{cleaned, errors}'
```

---

## See also

- [Mainnet deployment checklist](./mainnet-deployment-checklist.md)
- [SECURITY.md](../SECURITY.md) — responsible disclosure policy
- [docs/contract-abi.md](./contract-abi.md) — contract interface reference
- [docs/indexer.md](./indexer.md) — indexer freshness, and the safety gate destructive consumers must pass
- Issue #9 — upgrade event emission (closes the WASM-change detection gap)
- Issue #32 — forensic WASM comparison tooling
- Issue #36 — Sentry correlation for faster anomaly detection
- Issue #1156 — pin reconciliation mass-unpin (section 11)
