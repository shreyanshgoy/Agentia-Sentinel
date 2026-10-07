#!/usr/bin/env bash
# 2-minute demo. Works with the real agentia (npm i -g @copado/agentia-cli@beta) or with AGENTIA_BIN pointing at the fixture.
set -u
cd "$(dirname "$0")"
export SENTINEL_HOME="$(mktemp -d)"
S="node bin/sentinel.js"
say() { printf '\n\033[1m== %s\033[0m\n' "$*"; }
say "1. An agent reads pipeline state: allowed, audited";  $S exec -- agentia cicd promotion list --help | head -3
say "2. An agent tries to delete a user story: denied"; $S exec -- agentia cicd work delete a0B000000000000AAA; echo "exit=$?"
say "3. An agent tries to promote with deploy: needs a human"; $S exec -- agentia cicd cloud promote a0B000000000000AAA --deploy; echo "exit=$?"
say "4. What would policy say? (no execution)"; $S check -- agentia cicd promotion run a0B000000000000AAA --operation merge
say "5. Pending queue, as the release manager sees it"; $S pending
say "6. The audit trail is a verifiable hash chain"; $S audit verify
say "7. Report for the release manager"; $S audit report
