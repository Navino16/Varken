#!/usr/bin/env bash
# Appends tsc, type tests and test suite results to a refresh report; exits 1 when one of them fails.
set -u

report="$1"
log="$(mktemp)"
status=0

printf '\n## Verification\n\n' >> "$report"

check() {
  local name="$1"
  shift
  if "$@" > "$log" 2>&1; then
    printf -- '- %s: pass\n' "$name" >> "$report"
  else
    status=1
    # Failing tests and type errors first, then the summary lines.
    details="$( { grep -E '(FAIL|×| error TS)' "$log" | sort -u | head -n 40; tail -n 8 "$log"; } )"
    printf -- '- %s: **fail**\n\n```\n%s\n```\n\n' "$name" "$details" >> "$report"
  fi
}

check 'tsc' npx tsc --noEmit
check 'typecheck' npm run typecheck
check 'tests' npx vitest run

rm -f "$log"
exit "$status"
