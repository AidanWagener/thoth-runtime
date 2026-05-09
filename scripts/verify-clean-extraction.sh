#!/usr/bin/env bash
#
# verify-clean-extraction.sh
#
# Greps for forbidden source-of-private-data terms in the public OSS repo.
# CI fails if any are present in non-allowlisted paths.
#
# The denylist lives in scripts/.scrub-denylist.txt for easy maintenance.
# Allow-listed paths (where these terms ARE expected) are configured below.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DENYLIST_FILE="$REPO_ROOT/scripts/.scrub-denylist.txt"

if [[ ! -f "$DENYLIST_FILE" ]]; then
  echo "ERROR: denylist file not found at $DENYLIST_FILE" >&2
  exit 2
fi

# Paths SCANNED — public surface that must be clean
SCAN_PATHS=(
  "packages"
  "docs"
  "scripts"
  "README.md"
  "CHANGELOG.md"
  "CONTRIBUTING.md"
  "CODE_OF_CONDUCT.md"
  "SECURITY.md"
)

# Paths ALLOW-LISTED — Apex-tutel example may legitimately reference Tutel
ALLOWLIST_PATHS=(
  "examples/operator-agent"
)

VIOLATIONS=0

while IFS= read -r pattern || [[ -n "$pattern" ]]; do
  # Skip blank lines and comments
  [[ -z "$pattern" || "$pattern" =~ ^# ]] && continue

  # Build grep exclude args from allowlist
  EXCLUDE_ARGS=()
  for allow in "${ALLOWLIST_PATHS[@]}"; do
    EXCLUDE_ARGS+=(--exclude-dir="$(basename "$allow")")
  done

  # Search across SCAN_PATHS
  for scan in "${SCAN_PATHS[@]}"; do
    target="$REPO_ROOT/$scan"
    [[ ! -e "$target" ]] && continue

    if grep -rIn \
        --exclude-dir=node_modules \
        --exclude-dir=dist \
        --exclude-dir=.next \
        --exclude-dir=.changeset \
        --exclude-dir=operator-agent \
        --exclude="*.lock" \
        --exclude="pnpm-lock.yaml" \
        --exclude=".scrub-denylist.txt" \
        --exclude="verify-clean-extraction.sh" \
        --exclude="extraction-tutel-scrub.md" \
        -e "$pattern" \
        "$target" 2>/dev/null; then
      echo ""
      echo "❌ VIOLATION: pattern '$pattern' found in $scan/" >&2
      VIOLATIONS=$((VIOLATIONS + 1))
    fi
  done
done < "$DENYLIST_FILE"

echo ""
if [[ $VIOLATIONS -eq 0 ]]; then
  echo "✓ verify-clean-extraction: 0 violations"
  exit 0
else
  echo "✗ verify-clean-extraction: $VIOLATIONS violation(s) found" >&2
  echo ""
  echo "These terms must not appear in public-facing paths." >&2
  echo "If a reference is legitimate (e.g. in examples/operator-agent/), confirm" >&2
  echo "it's under an allow-listed path, or remove the reference." >&2
  exit 1
fi
