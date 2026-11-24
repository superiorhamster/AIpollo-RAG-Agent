#!/usr/bin/env bash
set -euo pipefail
artifact_dir="$PWD/test-results/formula-extraction"
mkdir -p "$artifact_dir"
compose=(docker compose --env-file .env -f compose.dev.yaml)
"${compose[@]}" --profile phase01-test build phase01-browser-tests
browser_image=$("${compose[@]}" --profile phase01-test config --format json | python3 -c 'import json,sys; c=json.load(sys.stdin); print(c["services"]["phase01-browser-tests"].get("image",c["name"]+"-phase01-browser-tests"))')
browser_container="rag-formula-browser-$$-$RANDOM"
parser_container="rag-formula-parser-$$-$RANDOM"
cleanup() {
  result=$?
  trap - EXIT
  docker rm -f "$browser_container" "$parser_container" >/dev/null 2>&1 || true
  exit "$result"
}
trap cleanup EXIT
docker run --name "$browser_container" --network none -e FORMULA_OUTPUT=/tests/formula-output/formulas.pdf \
  -v "$PWD/tests/eval:/tests/eval:ro" \
  "$browser_image" node /tests/eval/generate-formulas.mjs
docker cp "$browser_container:/tests/formula-output/formulas.pdf" "$artifact_dir/formulas.pdf"
"${compose[@]}" run --name "$parser_container" --no-deps -T -e PYTHONPATH=/app:/app/shared:/eval \
  -v "$artifact_dir:/corpus:ro" -v "$PWD/tests/eval:/eval:ro" document-parser \
  python /eval/formula_extract.py --pdf /corpus/formulas.pdf --manifest /eval/formula_cases.json \
  > "$artifact_dir/report.json" 2> "$artifact_dir/parser.log"
python3 - "$artifact_dir/report.json" <<'PY'
import json,sys
report=json.load(open(sys.argv[1]))
print('Formula extraction report written. Accuracy:',report['extraction_accuracy'],
      'human reviewed:',report['human_review_confirmed'],'inspector enabled:',report['inspector_enabled'])
PY
