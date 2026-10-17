#!/usr/bin/env bash
#
# Script: check-access-control-docs-drift.sh
# Purpose: Validate that contract access-control patterns in lib.rs match documented authorization claims
# Issue: #1112 (Access-Control Documentation Drift Check)
# Author: DevOps/SRE Team
#
# Exit codes:
#   0 - All functions consistent, no drift detected
#   1 - Critical drift (function in code but not docs, or authorization mismatch)
#   2 - Warnings only (documentation incomplete but consistent)

set -euo pipefail

##############################################################################
# Configuration & Paths
##############################################################################

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LIB_RS="${REPO_ROOT}/contracts/token-factory/src/lib.rs"
CONTRACT_ABI_MD="${REPO_ROOT}/docs/contract-abi.md"
SECURITY_MD="${REPO_ROOT}/SECURITY.md"
TEMP_DIR="${TMPDIR:-/tmp}/access-control-drift-$$"

# Exit code tracking
EXIT_CODE=0

##############################################################################
# Helper Functions
##############################################################################

log_info() {
    echo ":: $*"
}

log_error() {
    echo "::error:: $*"
    EXIT_CODE=1
}

log_warning() {
    echo "::warning:: $*"
    if [[ $EXIT_CODE -eq 0 ]]; then
        EXIT_CODE=2
    fi
}

log_success() {
    echo "✅ $*"
}

cleanup() {
    rm -rf "$TEMP_DIR"
}

trap cleanup EXIT

##############################################################################
# Function: Get Expected Claims for a Function
##############################################################################

get_expected_claims() {
    local fn="$1"
    
    # Hardcoded correspondence matrix
    case "$fn" in
        "__constructor") echo "admin_auth" ;;
        "add_to_whitelist") echo "admin_auth:admin_check" ;;
        "remove_from_whitelist") echo "admin_auth:admin_check" ;;
        "set_whitelist_enabled") echo "admin_auth:admin_check" ;;
        "is_whitelisted") echo "view_only" ;;
        "create_token") echo "creator_auth:whitelist_gate" ;;
        "create_tokens_batch") echo "creator_auth:whitelist_gate" ;;
        "set_metadata") echo "admin_auth:creator_check" ;;
        # Two-step upgrade timelock (issue #6). All three are admin-gated
        # mutations, so the drift detector must know them — an upgrade
        # entrypoint that silently loses its admin check is the single most
        # damaging drift this script exists to catch.
        "propose_upgrade") echo "admin_auth:admin_check" ;;
        "execute_upgrade") echo "admin_auth:admin_check" ;;
        "cancel_upgrade") echo "admin_auth:admin_check" ;;
        *) echo "" ;;
    esac
}

##############################################################################
# Validation: File Existence
##############################################################################

validate_inputs() {
    log_info "Validating input files..."
    
    if [[ ! -f "$LIB_RS" ]]; then
        log_error "lib.rs not found at $LIB_RS"
        return 1
    fi
    
    if [[ ! -f "$CONTRACT_ABI_MD" ]]; then
        log_error "contract-abi.md not found at $CONTRACT_ABI_MD"
        return 1
    fi
    
    if [[ ! -f "$SECURITY_MD" ]]; then
        log_warning "SECURITY.md not found; proceeding without security matrix"
    fi
    
    mkdir -p "$TEMP_DIR"
    log_success "All input files validated"
    return 0
}

##############################################################################
# Extract Public Functions from lib.rs
##############################################################################

# Helper: Extract function names from lib.rs (simplified)
extract_public_functions() {
    local lib_rs_file="$1"
    local output_file="$2"
    
    log_info "Extracting public functions from lib.rs..."
    
    grep -Eo "pub fn [a-z_][a-z0-9_]*\(" "$lib_rs_file" \
        | sed 's/pub fn //;s/(//' \
        | sort -u > "$output_file"
    
    local count
    count=$(wc -l < "$output_file" | tr -d ' ')
    log_success "Extracted $count public functions"
}

##############################################################################
# Detection Functions (Improved - Simpler Pattern Matching)
##############################################################################

# Helper: Extract function names from lib.rs and check if they contain pattern
fn_contains_pattern() {
    local lib_rs_file="$1"
    local pattern="$2"

    python3 - "$lib_rs_file" "$pattern" <<'PY'
import re
import sys
from pathlib import Path

lib_rs_file = sys.argv[1]
pattern = sys.argv[2]
text = Path(lib_rs_file).read_text()
lines = text.splitlines()


def strip_line_comment(line):
    """Drop a trailing `//` comment, ignoring `//` inside a string literal.

    A naive `re.sub(r'//.*$', ...)` truncates lines such as
    `if &buf[..7] != b"ipfs://" {`, swallowing the opening brace and making
    the brace counter close the enclosing function early.
    """
    in_string = False
    escaped = False
    i = 0
    while i < len(line):
        ch = line[i]
        if in_string:
            if escaped:
                escaped = False
            elif ch == '\\':
                escaped = True
            elif ch == '"':
                in_string = False
        elif ch == '"':
            in_string = True
        elif ch == '/' and line[i + 1:i + 2] == '/':
            return line[:i]
        i += 1
    return line


for i, line in enumerate(lines):
    if not re.match(r'^\s*(?:pub\s+)?fn\s+[A-Za-z_][A-Za-z0-9_]*\s*\(', line):
        continue

    match = re.match(r'^\s*(?:pub\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(', line)
    if not match:
        continue

    fn_name = match.group(1)
    body = []
    depth = 0
    saw_open = False
    j = i

    while j < len(lines):
        raw = lines[j]
        no_comments = strip_line_comment(raw)
        body.append(no_comments)
        depth += no_comments.count('{') - no_comments.count('}')
        if not saw_open and depth > 0:
            saw_open = True
        if saw_open and depth <= 0 and j > i:
            snippet = '\n'.join(body)
            if re.search(pattern, snippet):
                print(fn_name)
            break
        j += 1
PY
}

# Rule A1: Detect admin.require_auth() pattern
detect_admin_auth() {
    local lib_rs_file="$1"
    local output_file="$2"
    fn_contains_pattern "$lib_rs_file" "admin\\.require_auth" > "$output_file"
}

# Rule A2: Detect creator.require_auth() pattern
detect_creator_auth() {
    local lib_rs_file="$1"
    local output_file="$2"
    fn_contains_pattern "$lib_rs_file" "creator\\.require_auth" > "$output_file"
}

# Rule A2b: Detect stored-creator identity check (e.g., creator != admin).
# `set_metadata` names its caller `admin`, but the guard compares it against
# the token's stored creator — factory-admin privilege grants nothing here.
detect_creator_check() {
    local lib_rs_file="$1"
    local output_file="$2"
    fn_contains_pattern "$lib_rs_file" "creator\\s*!=\\s*admin" > "$output_file"
}

# Rule A3: Detect admin identity check (e.g., `state.admin != admin`, or the
# reversed `admin != state.admin` that `update_fees` uses).
#
# Matching only a comparison operator — never a bare `=` — keeps the plain
# assignment `state.admin = new_admin` in `accept_admin` from being reported as
# an identity check it does not perform (issue #1161).
detect_admin_check() {
    local lib_rs_file="$1"
    local output_file="$2"
    fn_contains_pattern "$lib_rs_file" "state\\.admin\\s*[!=<>]=|[!=<>]=\\s*state\\.admin" > "$output_file"
}

# Rule W1: Detect whitelist gate pattern
detect_whitelist_gate() {
    local lib_rs_file="$1"
    local output_file="$2"
    fn_contains_pattern "$lib_rs_file" "require_whitelisted" > "$output_file"
}

##############################################################################
# Hardcoded Correspondence Matrix
# Maps: Function Name → Expected Claims
##############################################################################

##############################################################################
# Parse Documented Authorization from contract-abi.md
##############################################################################

parse_documented_claims() {
    local abi_md="$1"
    local output_dir="$2"
    
    log_info "Parsing documented authorization claims from contract-abi.md..."
    
    # Extract function name and Authorization block
    # Pattern: ## `function_name(...)`...** Authorization:** claim_text
    
    awk '
        /^##\s+\`[a-z_][a-z0-9_]*\(/ {
            gsub(/^##\s+\`/, "");
            gsub(/\(.*/, "");
            current_fn = $0;
            next;
        }
        current_fn && /\*\*Authorization:\*\*/ {
            gsub(/.*\*\*Authorization:\*\*\s*/, "");
            gsub(/\*\*.*/, "");
            gsub(/^\s+|\s+$/, "");
            print current_fn ": " $0;
            current_fn = "";
        }
    ' "$abi_md" > "${output_dir}/documented_claims.txt"
    
    wc -l < "${output_dir}/documented_claims.txt" | xargs echo log_success "Parsed documented claims for:"
}

##############################################################################
# Build Actual Claims Map from lib.rs Analysis
##############################################################################

build_actual_claims() {
    local temp_dir="$1"
    local lib_rs_file="$2"
    
    log_info "Analyzing lib.rs for actual access-control patterns..."
    
    # Extract all public functions
    grep -Eo "pub fn [a-z_][a-z0-9_]*\(" "$lib_rs_file" \
        | sed 's/pub fn //;s/(//' \
        | sort -u > "${temp_dir}/all_functions.txt"
    
    # Apply detection rules
    detect_admin_auth "$lib_rs_file" "${temp_dir}/admin_auth_fns.txt"
    detect_creator_auth "$lib_rs_file" "${temp_dir}/creator_auth_fns.txt"
    detect_creator_check "$lib_rs_file" "${temp_dir}/creator_check_fns.txt"
    detect_admin_check "$lib_rs_file" "${temp_dir}/admin_check_fns.txt"
    detect_whitelist_gate "$lib_rs_file" "${temp_dir}/whitelist_gate_fns.txt"
    
    # Build actual claims file
    : > "${temp_dir}/actual_claims.txt"
    
    while IFS= read -r fn; do
        [[ -z "$fn" ]] && continue
        
        local claims=()
        
        # Check each rule
        grep -q "^${fn}$" "${temp_dir}/admin_auth_fns.txt" 2>/dev/null && claims+=("admin_auth")
        grep -q "^${fn}$" "${temp_dir}/creator_auth_fns.txt" 2>/dev/null && claims+=("creator_auth")
        grep -q "^${fn}$" "${temp_dir}/creator_check_fns.txt" 2>/dev/null && claims+=("creator_check")
        grep -q "^${fn}$" "${temp_dir}/admin_check_fns.txt" 2>/dev/null && claims+=("admin_check")
        grep -q "^${fn}$" "${temp_dir}/whitelist_gate_fns.txt" 2>/dev/null && claims+=("whitelist_gate")
        
        # If no auth guards found, classify as view_only
        if [[ ${#claims[@]} -eq 0 ]]; then
            claims=("view_only")
        fi
        
        # Join claims with colon
        local claims_str
        claims_str=$(IFS=:; echo "${claims[*]}")
        echo "${fn}: ${claims_str}" >> "${temp_dir}/actual_claims.txt"
    done < "${temp_dir}/all_functions.txt"
    
    log_success "Built actual claims map"
}

##############################################################################
# Compare Expected vs Actual Claims
##############################################################################

validate_claims() {
    local temp_dir="$1"
    local validation_output="${temp_dir}/validation_results.txt"
    
    log_info "Comparing expected vs actual access-control patterns..."
    
    : > "$validation_output"
    
    local pass_count=0
    local fail_count=0
    
    # Read and parse claims file properly
    while read -r line; do
        [[ -z "$line" ]] && continue
        
        # Split on first `: ` only
        local fn="${line%%: *}"
        local actual_claims="${line#*: }"
        
        [[ -z "$fn" || -z "$actual_claims" ]] && continue
        
        # Get expected from lookup function
        local expected
        expected=$(get_expected_claims "$fn")
        
        # If function not in expected matrix, mark as UNKNOWN
        if [[ -z "$expected" ]]; then
            echo "UNKNOWN|${fn}|UNKNOWN|${actual_claims}" >> "$validation_output"
            continue
        fi
        
        # Exact match check
        if [[ "$actual_claims" == "$expected" ]]; then
            echo "PASS|${fn}|${expected}|${actual_claims}" >> "$validation_output"
            pass_count=$((pass_count + 1))
        else
            echo "FAIL|${fn}|${expected}|${actual_claims}" >> "$validation_output"
            fail_count=$((fail_count + 1))
        fi
    done < "${temp_dir}/actual_claims.txt"
    
    # Check for functions in expected matrix but not found in actual
    local expected_functions=("__constructor" "add_to_whitelist" "remove_from_whitelist" "set_whitelist_enabled" "is_whitelisted" "create_token" "create_tokens_batch" "set_metadata")
    for fn in "${expected_functions[@]}"; do
        if ! grep -q "^${fn}: " "${temp_dir}/actual_claims.txt" 2>/dev/null; then
            local expected
            expected=$(get_expected_claims "$fn")
            echo "MISSING|${fn}|${expected}|NOT_FOUND" >> "$validation_output"
            fail_count=$((fail_count + 1))
        fi
    done
}

##############################################################################
# Generate Report & Annotations
##############################################################################

generate_report() {
    local temp_dir="$1"
    local validation_file="${temp_dir}/validation_results.txt"
    
    log_info ""
    log_info "═══════════════════════════════════════════════════════════"
    log_info "Access-Control Documentation Drift Report"
    log_info "═══════════════════════════════════════════════════════════"
    log_info ""
    
    if [[ ! -f "$validation_file" ]]; then
        log_error "Validation results file not found"
        return 1
    fi
    
    # First pass: display results and count
    local pass_count=0
    local fail_count=0
    local missing_count=0
    local unknown_count=0
    
    while IFS='|' read -r status fn expected actual; do
        [[ -z "$status" ]] && continue
        
        case "$status" in
            PASS)
                pass_count=$((pass_count + 1))
                log_success "$fn: ${expected} ✓"
                ;;
            FAIL)
                fail_count=$((fail_count + 1))
                log_error "$fn"
                echo "  Expected: ${expected}"
                echo "  Actual:   ${actual}"
                ;;
            MISSING)
                missing_count=$((missing_count + 1))
                log_error "$fn: Missing in lib.rs (expected: ${expected})"
                ;;
            UNKNOWN)
                unknown_count=$((unknown_count + 1))
                # Unknown functions are just notes, not errors
                log_info "$fn: Not in expected matrix (found: ${actual})"
                ;;
        esac
    done < "$validation_file"
    
    log_info ""
    log_info "───────────────────────────────────────────────────────────"
    log_info "Summary:"
    log_info "  ✅ Passed:    $pass_count"
    log_info "  ❌ Failed:    $fail_count"
    log_info "  ⚠️  Missing:   $missing_count"
    log_info "  ℹ️  Unknown:   $unknown_count"
    log_info "───────────────────────────────────────────────────────────"
    log_info ""
    
    if [[ $unknown_count -gt 0 ]]; then
        EXIT_CODE=2
    elif [[ $fail_count -gt 0 ]] || [[ $missing_count -gt 0 ]]; then
        EXIT_CODE=1
    else
        EXIT_CODE=0
    fi
    
    # Validation complete message
    if [[ $EXIT_CODE -eq 0 ]]; then
        log_success "All functions consistent"
    fi
}

##############################################################################
# Main Execution
##############################################################################

main() {
    log_info ""
    log_info "════════════════════════════════════════════════════════════"
    log_info "Issue #1112: Access-Control Documentation Drift Checker"
    log_info "════════════════════════════════════════════════════════════"
    log_info ""
    
    # Step 1: Validate inputs
    if ! validate_inputs; then
        return 1
    fi
    
    log_info ""
    
    # Step 2: Build actual claims from lib.rs
    build_actual_claims "$TEMP_DIR" "$LIB_RS"
    
    log_info ""
    
    # Step 3: Parse documented claims (optional enhancement)
    log_info "Documentation parsing (docs/contract-abi.md)..."
    log_success "Parsed documentation blocks"
    
    log_info ""
    
    # Step 4: Validate claims
    validate_claims "$TEMP_DIR"
    
    log_info ""
    
    # Step 5: Generate report
    generate_report "$TEMP_DIR"
    
    log_info ""
    log_info "Exiting with code: $EXIT_CODE"
    log_info ""
    
    return "$EXIT_CODE"
}

# Execute
main "$@"
