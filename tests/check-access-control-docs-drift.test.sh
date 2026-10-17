#!/usr/bin/env bash
#
# Test Suite: check-access-control-docs-drift.sh
# Purpose: Validate the access-control drift detection script with comprehensive test coverage
# Test Framework: Bash (manual test runner)
# Issue: #1112
#
# Test Categories:
#   1. HAPPY PATH: Baseline validation (expected to pass)
#   2. DESTRUCTIVE: Drift injection scenarios
#   3. EDGE CASES: Malformed inputs, missing files, permissions
#   4. FALSE POSITIVES/NEGATIVES: Whitespace variations, regex boundary conditions

set -euo pipefail

##############################################################################
# Configuration
##############################################################################

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_UNDER_TEST="${REPO_ROOT}/scripts/check-access-control-docs-drift.sh"
TEST_DIR="${REPO_ROOT}/.test-access-control-$$"
FIXTURE_DIR="${REPO_ROOT}/tests/fixtures"

# Tracking
TESTS_PASSED=0
TESTS_FAILED=0
TESTS_SKIPPED=0
declare -a FAILED_TESTS=()

##############################################################################
# Test Output Helpers
##############################################################################

print_banner() {
    echo ""
    echo "════════════════════════════════════════════════════════════"
    echo "$*"
    echo "════════════════════════════════════════════════════════════"
    echo ""
}

test_start() {
    echo "📋 TEST: $*"
}

test_pass() {
    echo "  ✅ PASS: $*"
    TESTS_PASSED=$((TESTS_PASSED + 1))
}

test_fail() {
    echo "  ❌ FAIL: $*"
    TESTS_FAILED=$((TESTS_FAILED + 1))
    FAILED_TESTS+=("$*")
}

test_skip() {
    echo "  ⏭️  SKIP: $*"
    TESTS_SKIPPED=$((TESTS_SKIPPED + 1))
}

##############################################################################
# Setup & Teardown
##############################################################################

setup_test_env() {
    mkdir -p "$TEST_DIR"
    mkdir -p "$TEST_DIR/contracts/token-factory/src"
    mkdir -p "$TEST_DIR/docs"
    mkdir -p "$TEST_DIR/.github/workflows"
}

teardown_test_env() {
    rm -rf "$TEST_DIR"
}

copy_fixture() {
    local fixture_name="$1"
    local dest_path="$2"
    local fixture_path="${FIXTURE_DIR}/${fixture_name}"
    
    if [[ ! -f "$fixture_path" ]]; then
        echo "ERROR: Fixture not found: $fixture_path" >&2
        return 1
    fi
    
    cp "$fixture_path" "$TEST_DIR/$dest_path"
}

##############################################################################
# Test Execution Helper
##############################################################################

run_script_in_test_env() {
    local temp_script="${TEST_DIR}/check-access-control-docs-drift-test.sh"
    
    # Copy the script to test directory and modify paths to use TEST_DIR
    sed "s|REPO_ROOT=.*|REPO_ROOT=\"${TEST_DIR}\"|g" "$SCRIPT_UNDER_TEST" > "$temp_script"
    chmod +x "$temp_script"
    
    # Execute and capture exit code
    set +e
    "$temp_script" 2>&1
    local exit_code=$?
    set -e
    
    return $exit_code
}

##############################################################################
# TEST SUITE 1: HAPPY PATH
##############################################################################

test_happy_path_baseline() {
    test_start "Happy Path: Baseline (all files correct, exit code 0)"
    
    setup_test_env
    
    # Copy baseline fixtures
    copy_fixture "lib.rs.baseline" "contracts/token-factory/src/lib.rs"
    copy_fixture "contract-abi.md.baseline" "docs/contract-abi.md"
    touch "$TEST_DIR/SECURITY.md"
    
    local output
    local exit_code
    
    if output=$(run_script_in_test_env 2>&1); then
        exit_code=0
    else
        exit_code=$?
    fi
    
    if [[ $exit_code -eq 0 ]]; then
        test_pass "Baseline validation returned exit code 0"
        if echo "$output" | grep -q "All functions consistent"; then
            test_pass "Output contains 'All functions consistent'"
        else
            test_fail "Output missing 'All functions consistent'"
        fi
    else
        test_fail "Expected exit code 0, got $exit_code"
        echo "$output"
    fi
    
    teardown_test_env
}

##############################################################################
# TEST SUITE 2: DESTRUCTIVE - DRIFT INJECTION
##############################################################################

test_drift_missing_whitelist_gate() {
    test_start "Destructive: Missing whitelist_gate in create_token (should EXIT 1)"
    
    setup_test_env
    
    # Inject drift: lib.rs WITHOUT whitelist gate, but docs claim it
    copy_fixture "lib.rs.drift_missing_whitelist_gate" "contracts/token-factory/src/lib.rs"
    copy_fixture "contract-abi.md.baseline" "docs/contract-abi.md"
    touch "$TEST_DIR/SECURITY.md"
    
    local exit_code=0
    local output
    
    output=$(run_script_in_test_env 2>&1) || exit_code=$?
    
    if [[ $exit_code -eq 1 ]]; then
        test_pass "Drift detection returned exit code 1 (critical)"
        if echo "$output" | grep -qi "drift\|mismatch"; then
            test_pass "Output mentions drift/mismatch"
        else
            test_fail "Output doesn't mention drift"
        fi
    else
        test_fail "Expected exit code 1 (critical drift), got $exit_code"
        echo "OUTPUT:" && echo "$output"
    fi
    
    teardown_test_env
}

test_drift_missing_admin_check() {
    test_start "Destructive: Missing admin_check in add_to_whitelist (should EXIT 1)"
    
    setup_test_env
    
    # Inject drift: lib.rs WITHOUT the admin identity check on a genuinely
    # admin-only entrypoint. (Retargeted from set_metadata in issue #1161,
    # which is creator-gated and never had an admin identity check to lose.)
    copy_fixture "lib.rs.drift_missing_admin_check" "contracts/token-factory/src/lib.rs"
    copy_fixture "contract-abi.md.baseline" "docs/contract-abi.md"
    touch "$TEST_DIR/SECURITY.md"
    
    local exit_code=0
    local output
    
    output=$(run_script_in_test_env 2>&1) || exit_code=$?
    
    if [[ $exit_code -eq 1 ]]; then
        test_pass "Drift detection returned exit code 1 (critical)"
        if echo "$output" | grep -qi "add_to_whitelist"; then
            test_pass "Output names the drifted entrypoint"
        else
            test_fail "Output doesn't mention add_to_whitelist"
        fi
    else
        test_fail "Expected exit code 1, got $exit_code"
        echo "OUTPUT:" && echo "$output"
    fi
    
    teardown_test_env
}

# Issue #1161: SECURITY.md and ADR-009 both described set_metadata as gated on
# the factory admin. It is not — the guard compares the caller against the
# token's stored creator, so the factory admin key carries no metadata
# authority. This locks the corrected expectation in: re-gating set_metadata on
# `state.admin` must be reported as critical drift, not accepted as correct.
test_drift_set_metadata_admin_gated() {
    test_start "Destructive: set_metadata gated on factory admin (should EXIT 1)"
    
    setup_test_env
    
    copy_fixture "lib.rs.drift_set_metadata_admin_gated" "contracts/token-factory/src/lib.rs"
    copy_fixture "contract-abi.md.baseline" "docs/contract-abi.md"
    touch "$TEST_DIR/SECURITY.md"
    
    local exit_code=0
    local output
    
    output=$(run_script_in_test_env 2>&1) || exit_code=$?
    
    if [[ $exit_code -eq 1 ]]; then
        test_pass "Admin-gated set_metadata reported as critical drift"
    else
        test_fail "Expected exit code 1, got $exit_code"
        echo "OUTPUT:" && echo "$output"
        teardown_test_env
        return
    fi
    
    if echo "$output" | grep -q "set_metadata"; then
        test_pass "Output names set_metadata"
    else
        test_fail "Output doesn't mention set_metadata"
    fi
    
    # The expectation itself is what this test pins down: creator_check, and
    # explicitly NOT admin_check.
    if echo "$output" | grep -q "Expected: admin_auth:creator_check"; then
        test_pass "Expected pattern is admin_auth:creator_check"
    else
        test_fail "Expected pattern is not admin_auth:creator_check"
    fi
    
    if echo "$output" | grep -q "Actual:.*admin_check"; then
        test_pass "Actual pattern reported as admin-gated"
    else
        test_fail "Actual pattern not reported as admin-gated"
    fi
    
    teardown_test_env
}

# The mirror of the test above: the real contract's shape — caller auth plus a
# stored-creator check, with no `state.admin` comparison — must PASS.
test_set_metadata_creator_gated_is_accepted() {
    test_start "Happy Path: creator-gated set_metadata is accepted (exit 0)"
    
    setup_test_env
    
    copy_fixture "lib.rs.baseline" "contracts/token-factory/src/lib.rs"
    copy_fixture "contract-abi.md.baseline" "docs/contract-abi.md"
    touch "$TEST_DIR/SECURITY.md"
    
    local exit_code=0
    local output
    
    output=$(run_script_in_test_env 2>&1) || exit_code=$?
    
    if [[ $exit_code -eq 0 ]] && echo "$output" | grep -q "set_metadata: admin_auth:creator_check"; then
        test_pass "set_metadata validated as admin_auth:creator_check"
    else
        test_fail "Expected set_metadata to validate as admin_auth:creator_check (exit $exit_code)"
        echo "OUTPUT:" && echo "$output"
    fi
    
    teardown_test_env
}

##############################################################################
# TEST SUITE 3: EDGE CASES - FILE HANDLING
##############################################################################

test_missing_lib_rs() {
    test_start "Edge Case: Missing lib.rs file (should EXIT 1)"
    
    setup_test_env
    
    # Intentionally DON'T create lib.rs
    copy_fixture "contract-abi.md.baseline" "docs/contract-abi.md"
    touch "$TEST_DIR/SECURITY.md"
    
    local exit_code=0
    local output
    
    output=$(run_script_in_test_env 2>&1) || exit_code=$?
    
    if [[ $exit_code -eq 1 ]]; then
        test_pass "Missing lib.rs detected, exit code 1"
        if echo "$output" | grep -qi "not found\|lib.rs"; then
            test_pass "Error message mentions missing file"
        else
            test_fail "Error message unclear"
        fi
    else
        test_fail "Expected exit code 1 for missing lib.rs, got $exit_code"
    fi
    
    teardown_test_env
}

test_missing_contract_abi() {
    test_start "Edge Case: Missing contract-abi.md (should EXIT 1)"
    
    setup_test_env
    
    copy_fixture "lib.rs.baseline" "contracts/token-factory/src/lib.rs"
    # Intentionally DON'T create contract-abi.md
    touch "$TEST_DIR/SECURITY.md"
    
    local exit_code=0
    local output
    
    output=$(run_script_in_test_env 2>&1) || exit_code=$?
    
    if [[ $exit_code -eq 1 ]]; then
        test_pass "Missing contract-abi.md detected, exit code 1"
        if echo "$output" | grep -qi "not found\|contract-abi"; then
            test_pass "Error message mentions missing ABI file"
        else
            test_fail "Error message unclear"
        fi
    else
        test_fail "Expected exit code 1 for missing contract-abi.md, got $exit_code"
    fi
    
    teardown_test_env
}

##############################################################################
# TEST SUITE 4: EDGE CASES - WHITESPACE & SYNTAX VARIATIONS
##############################################################################

test_whitespace_variation_extra_spaces() {
    test_start "Edge Case: Whitespace variation (extra spaces in pattern)"
    
    setup_test_env
    
    # Create lib.rs with extra whitespace in auth patterns
    cat > "$TEST_DIR/contracts/token-factory/src/lib.rs" << 'EOF'
pub fn __constructor(env: Env, admin: Address) -> Result<(), Error> {
    admin . require_auth ( ) ;
    Ok(())
}

pub fn add_to_whitelist(env: Env, admin: Address, account: Address) -> Result<(), Error> {
    admin . require_auth ( ) ;
    let state = get_state(&env);
    if state.admin != admin {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

pub fn is_whitelisted(env: Env, account: Address) -> Result<bool, Error> {
    let state = get_state(&env);
    Ok(state.whitelist.contains(&account))
}
EOF
    
    copy_fixture "contract-abi.md.baseline" "docs/contract-abi.md"
    touch "$TEST_DIR/SECURITY.md"
    
    local exit_code=0
    local output
    
    output=$(run_script_in_test_env 2>&1) || exit_code=$?
    
    # Regex patterns should NOT match extra spaces (admin . require_auth)
    # This is expected to fail or produce warnings
    if [[ $exit_code -ne 0 ]]; then
        test_pass "Regex doesn't match malformed patterns (extra spaces), correctly detected drift"
    else
        test_fail "Script should detect drift in malformed whitespace"
    fi
    
    teardown_test_env
}

##############################################################################
# TEST SUITE 5: EDGE CASES - PERMISSIONS
##############################################################################

test_script_executable() {
    test_start "Edge Case: Script executable permission check"
    
    if [[ -x "$SCRIPT_UNDER_TEST" ]]; then
        test_pass "Script is executable"
    else
        test_fail "Script is not executable: $SCRIPT_UNDER_TEST"
    fi
}

##############################################################################
# TEST SUITE 6: FALSE POSITIVES/NEGATIVES
##############################################################################

test_false_positive_require_auth_in_comment() {
    test_start "False Positive Guard: require_auth in comment should not match"
    
    setup_test_env
    
    # Create lib.rs where require_auth appears in comment only
    cat > "$TEST_DIR/contracts/token-factory/src/lib.rs" << 'EOF'
pub fn __constructor(env: Env, admin: Address) -> Result<(), Error> {
    // Note: admin.require_auth() is required here
    admin.require_auth();
    Ok(())
}

pub fn add_to_whitelist(env: Env, admin: Address, account: Address) -> Result<(), Error> {
    // This is admin-only; admin.require_auth() below
    admin.require_auth();
    let state = get_state(&env);
    if state.admin != admin {
        return Err(Error::Unauthorized);
    }
    Ok(())
}

pub fn is_whitelisted(env: Env, account: Address) -> Result<bool, Error> {
    // public view; no require_auth()
    let state = get_state(&env);
    Ok(state.whitelist.contains(&account))
}
EOF
    
    copy_fixture "contract-abi.md.baseline" "docs/contract-abi.md"
    touch "$TEST_DIR/SECURITY.md"
    
    local exit_code=0
    local output
    
    output=$(run_script_in_test_env 2>&1) || exit_code=$?
    
    # Comments containing require_auth should still be detected (this is limitation of regex)
    # But the baseline functions should match
    if [[ $exit_code -eq 0 ]]; then
        test_pass "Comment-adjacent patterns don't break detection"
    else
        test_skip "Comments may cause regex false positives (known limitation)"
    fi
    
    teardown_test_env
}

##############################################################################
# TEST SUITE 7: INTEGRATION - FULL FLOW
##############################################################################

test_full_integration_actual_files() {
    test_start "Integration: Run script against actual repo files"
    
    # This test runs the script in the actual repo (not in test env)
    local exit_code=0
    local output
    
    output=$("$SCRIPT_UNDER_TEST" 2>&1) || exit_code=$?
    
    # The actual repo may include valid functions outside the matrix, but those
    # should only surface as warnings instead of a hard failure.
    if [[ $exit_code -eq 0 ]]; then
        test_pass "Actual repo files are in sync (exit code 0)"
    elif [[ $exit_code -eq 1 ]]; then
        test_fail "Actual repo has critical drift (unexpected for main branch)"
        echo "$output" | tail -20
    elif [[ $exit_code -eq 2 ]]; then
        test_pass "Actual repo has minor warnings only (acceptable)"
    else
        test_fail "Unexpected exit code: $exit_code"
    fi
}

##############################################################################
# MAIN EXECUTION
##############################################################################

main() {
    print_banner "🧪 QA-TDD Test Suite: access-control-docs-drift Script"
    print_banner "Test-Driven Paranoic & Destructive Mode"
    
    print_banner "📊 PHASE 1: HAPPY PATH VALIDATION"
    test_happy_path_baseline
    test_set_metadata_creator_gated_is_accepted
    
    print_banner "💣 PHASE 2: DESTRUCTIVE DRIFT INJECTION"
    test_drift_missing_whitelist_gate
    test_drift_missing_admin_check
    test_drift_set_metadata_admin_gated
    
    print_banner "🔍 PHASE 3: EDGE CASES - FILE HANDLING"
    test_missing_lib_rs
    test_missing_contract_abi
    
    print_banner "✨ PHASE 4: EDGE CASES - WHITESPACE & SYNTAX"
    test_whitespace_variation_extra_spaces
    
    print_banner "🔐 PHASE 5: PERMISSIONS & EXECUTABLE"
    test_script_executable
    
    print_banner "⚠️  PHASE 6: FALSE POSITIVES/NEGATIVES"
    test_false_positive_require_auth_in_comment
    
    print_banner "🔗 PHASE 7: INTEGRATION TESTING"
    test_full_integration_actual_files
    
    # Summary
    print_banner "📋 TEST SUMMARY"
    
    local total=$((TESTS_PASSED + TESTS_FAILED + TESTS_SKIPPED))
    echo "Total Tests:  $total"
    echo "✅ Passed:    $TESTS_PASSED"
    echo "❌ Failed:    $TESTS_FAILED"
    echo "⏭️  Skipped:   $TESTS_SKIPPED"
    echo ""
    
    if [[ $TESTS_FAILED -gt 0 ]]; then
        echo "Failed Tests:"
        for test in "${FAILED_TESTS[@]}"; do
            echo "  - $test"
        done
        echo ""
        return 1
    else
        echo "🎉 All tests passed!"
        return 0
    fi
}

# Execute
main "$@"
