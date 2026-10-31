#!/usr/bin/env bash
# Runs only the tests that the changed files can reach, using the CodeGraph index.
# Runs the full suite on pushes to main, when shared config or tooling changes, or when
# the base is unknown. Usage: scripts/affected-tests.sh [path-prefix]
set -euo pipefail

prefix="${1:-}"
base="${BASE_SHA:-origin/main}"
changed="$(git diff --name-only "$base"...HEAD || true)"

if [[ -z "$changed" ]]; then
  echo "affected-tests: no changed files, nothing to run"
  exit 0
fi

full=0
if [[ "${GITHUB_EVENT_NAME:-}" != "pull_request" ]]; then
  full=1
fi
if echo "$changed" | grep -Eq '^(package\.json|bun\.lock|tsconfig[^/]*\.json|biome\.json|\.dependency-cruiser\.cjs|\.github/|scripts/|ops/|packages/test-kit/)'; then
  full=1
fi

if [[ "$full" == 1 ]]; then
  echo "affected-tests: full run"
  bun test $prefix
  exit 0
fi

existing=()
while IFS= read -r file; do
  [[ -e "$file" ]] && existing+=("$file")
done <<< "$changed"

tests=()
if [[ ${#existing[@]} -gt 0 ]]; then
  while IFS= read -r test; do
    [[ -n "$test" && "$test" == "$prefix"* ]] && tests+=("$test")
  done < <(printf '%s\n' "${existing[@]}" | codegraph affected --stdin -q --depth 5 --filter '*.test.ts')
fi

if [[ ${#tests[@]} -eq 0 ]]; then
  echo "affected-tests: no tests reach the changed files${prefix:+ under $prefix}"
  exit 0
fi

echo "affected-tests: ${#tests[@]} test file(s)"
printf '  %s\n' "${tests[@]}"
bun test "${tests[@]}"
