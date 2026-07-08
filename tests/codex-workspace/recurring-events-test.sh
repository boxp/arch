#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
RUNNER="${ROOT_DIR}/docker/codex-workspace/recurring-events/recurring_events.bb"

fail() {
  echo "error: $*" >&2
  exit 1
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  grep -Fq "$needle" <<<"${haystack}" || fail "expected output to contain: ${needle}"
}

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
vault="${tmp}/vault"
mkdir -p "${vault}/Infrastructure/Recurring Events/Events" "${vault}/Tickets" "${vault}/Boards"

cat >"${vault}/Boards/Task Board.md" <<'BOARD'
# Task Board

## Backlog

## Ready

## In Progress

## Blocked

## Review

## Done
BOARD

cat >"${vault}/Tickets/BOXP-1.md" <<'TICKET'
---
id: BOXP-1
---
TICKET

cat >"${vault}/Tickets/BOXP-9.md" <<'TICKET'
---
id: BOXP-9
---

occurrence-key: needs-check:2026-07-08
TICKET

cat >"${vault}/Infrastructure/Recurring Events/state.edn" <<'STATE'
{:version 1 :created-occurrences {"already-created:2026-07-08" {:event-id "already-created" :scheduled-date "2026-07-08" :created-ticket "BOXP-1" :created-at "2026-07-01T00:00:00Z" :source-file "test"}}}
STATE

cat >"${vault}/Infrastructure/Recurring Events/Events/cron.md" <<'EVENT'
---
id: kubernetes-upgrade-planning
title: Kubernetes upgrade planning
description: Kubernetes minor upgrade planning.
enabled: true
schedule:
  type: cron
  value: "0 9 1 */3 *"
time-zone: Asia/Tokyo
lead-days: 21
priority: medium
project: BOXP
repo: boxp/arch
initial-lane: Backlog
ticket-template:
  title: "Kubernetes upgrade planning: {{scheduled-date}}"
---

## Draft

## Ticket Template

## Summary

Kubernetes upgrade planning.

## Acceptance Criteria

- [ ] Plan is ready.

## Context

Generated from recurring event.

## Plan

- [ ] Check versions.

## Notes
EVENT

cat >"${vault}/Infrastructure/Recurring Events/Events/occurrence.md" <<'EVENT'
---
id: tax-return-preparation
title: Tax return preparation
description: Prepare tax return.
enabled: true
schedule:
  type: occurrences
  items:
    - key: "2026"
      scheduled-date: 2027-02-01
      target-period: "2026 tax year"
      title-suffix: "2026年分"
time-zone: Asia/Tokyo
lead-days: 45
priority: high
project: BOXP
initial-lane: Backlog
ticket-template:
  title: "Tax return preparation: {{title-suffix}}"
---

## Draft

## Ticket Template

## Summary

Prepare tax return.

## Acceptance Criteria

- [ ] Filed.

## Context

Generated from recurring event.

## Plan

- [ ] Collect documents.

## Notes
EVENT

cat >"${vault}/Infrastructure/Recurring Events/Events/already.md" <<'EVENT'
---
id: already-created
title: Already created
description: Already created event.
enabled: true
schedule:
  type: cron
  value: "0 9 8 7 *"
time-zone: Asia/Tokyo
lead-days: 0
priority: medium
project: BOXP
initial-lane: Backlog
ticket-template:
  title: "Already {{scheduled-date}}"
---

## Draft
## Ticket Template
## Summary
Already.
## Acceptance Criteria
- [ ] Done.
## Context
Already.
## Plan
- [ ] Done.
## Notes
EVENT

cat >"${vault}/Infrastructure/Recurring Events/Events/invalid.md" <<'EVENT'
---
id: invalid-event
title: Invalid
enabled: true
schedule:
  type: rrule
time-zone: Asia/Tokyo
lead-days: -1
priority: medium
project: BOXP
initial-lane: Later
ticket-template:
  title: Invalid
---
EVENT

cat >"${vault}/Infrastructure/Recurring Events/Events/disabled.md" <<'EVENT'
---
id: disabled-event
title: Disabled
description: Disabled event.
enabled: false
schedule:
  type: cron
  value: "0 9 8 7 *"
time-zone: Asia/Tokyo
lead-days: 0
priority: medium
project: BOXP
initial-lane: Backlog
ticket-template:
  title: Disabled
---
EVENT

cat >"${vault}/Infrastructure/Recurring Events/Events/needs-check.md" <<'EVENT'
---
id: needs-check
title: Needs check
description: Existing ticket without state.
enabled: true
schedule:
  type: cron
  value: "0 9 8 7 *"
time-zone: Asia/Tokyo
lead-days: 0
priority: medium
project: BOXP
initial-lane: Backlog
ticket-template:
  title: Needs check
---
EVENT

out="$(bb "${RUNNER}" --vault "${vault}" --today 2026-06-10 dry-run)"
assert_contains "${out}" $'candidate	kubernetes-upgrade-planning	kubernetes-upgrade-planning:2026-07-01'
assert_contains "${out}" $'not-yet	tax-return-preparation'
assert_contains "${out}" $'invalid	invalid-event'

out="$(bb "${RUNNER}" --vault "${vault}" --today 2026-12-20 dry-run)"
assert_contains "${out}" $'candidate	tax-return-preparation	tax-return-preparation:2026'
assert_contains "${out}" "Tax return preparation: 2026年分"

out="$(bb "${RUNNER}" --vault "${vault}" --today 2026-07-08 dry-run)"
assert_contains "${out}" $'already-created	already-created	already-created:2026-07-08'
assert_contains "${out}" $'disabled	disabled-event'
assert_contains "${out}" $'needs-human-check	needs-check	needs-check:2026-07-08'

out="$(bb "${RUNNER}" --vault "${vault}" --today 2026-12-20 apply)"
assert_contains "${out}" $'created	BOXP-10	Backlog	Kubernetes upgrade planning: 2027-01-01'
assert_contains "${out}" $'created	BOXP-11	Backlog	Tax return preparation: 2026年分'
grep -Fq '[[Tickets/BOXP-11|BOXP-11: Tax return preparation: 2026年分]] #ticket status::backlog priority::high' "${vault}/Boards/Task Board.md" || fail "board card was not inserted"
grep -Fq 'occurrence-key: tax-return-preparation:2026' "${vault}/Tickets/BOXP-11.md" || fail "ticket metadata missing"
grep -Fq '## Summary' "${vault}/Tickets/BOXP-11.md" || fail "ticket headings were not normalized"
grep -Fq '"tax-return-preparation:2026"' "${vault}/Infrastructure/Recurring Events/state.edn" || fail "state not updated"

echo "recurring events tests passed"
