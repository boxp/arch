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

assert_not_contains() {
  local haystack="$1"
  local needle="$2"
  ! grep -Fq "$needle" <<<"${haystack}" || fail "expected output not to contain: ${needle}"
}

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT
vault="${tmp}/vault"
mkdir -p "${vault}/Infrastructure/Recurring Events/Events" "${vault}/Tickets" "${vault}/Boards"

cat >"${vault}/Boards/Task Board.md" <<'BOARD'
# Task Board

## Backlog

- [ ] [[Tickets/BOXP-8|BOXP-8: Stale card]] #ticket status::backlog priority::medium occurrence::stale-card:2026-07-08

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

Prepare tax return from custom template.

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

cat >"${vault}/Infrastructure/Recurring Events/Events/default-body.md" <<'EVENT'
---
id: default-body
title: Default body
description: Default body description.
enabled: true
schedule:
  type: cron
  value: "0 9 15 6 *"
time-zone: Asia/Tokyo
lead-days: 5
priority: medium
project: BOXP
initial-lane: Backlog
ticket-template:
  title: "Default body {{scheduled-date}}"
---

## Draft

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

cat >"${vault}/Infrastructure/Recurring Events/Events/invalid-cron-token.md" <<'EVENT'
---
id: invalid-cron-token
title: Invalid cron token
description: Invalid cron token.
enabled: true
schedule:
  type: cron
  value: "0 9 * JAN *"
time-zone: Asia/Tokyo
lead-days: 1
priority: medium
project: BOXP
initial-lane: Backlog
ticket-template:
  title: Invalid cron token
---
EVENT

cat >"${vault}/Infrastructure/Recurring Events/Events/missing-frontmatter.md" <<'EVENT'
# Missing frontmatter

This malformed event note should not stop the whole dry-run.
EVENT

cat >"${vault}/Infrastructure/Recurring Events/Events/unclosed-frontmatter.md" <<'EVENT'
---
id: unclosed-frontmatter
title: Unclosed frontmatter
description: This malformed event note should be reported as invalid.
enabled: true
EVENT

cat >"${vault}/Infrastructure/Recurring Events/Events/invalid-occurrence-missing-date.md" <<'EVENT'
---
id: invalid-occurrence-missing-date
title: Invalid occurrence missing date
description: Invalid occurrence item.
enabled: true
schedule:
  type: occurrences
  items:
    - key: "x"
    - scheduled-date: 2026-07-08
      target-period: "test"
      title-suffix: "test"
time-zone: Asia/Tokyo
lead-days: 0
priority: medium
project: BOXP
initial-lane: Backlog
ticket-template:
  title: Invalid occurrence missing date
---
EVENT

cat >"${vault}/Infrastructure/Recurring Events/Events/invalid-occurrence-bad-date.md" <<'EVENT'
---
id: invalid-occurrence-bad-date
title: Invalid occurrence bad date
description: Invalid occurrence item.
enabled: true
schedule:
  type: occurrences
  items:
    - key: "x"
      scheduled-date: 2026-99-99
      target-period: "test"
      title-suffix: "test"
time-zone: Asia/Tokyo
lead-days: 0
priority: medium
project: BOXP
initial-lane: Backlog
ticket-template:
  title: Invalid occurrence bad date
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

cat >"${vault}/Infrastructure/Recurring Events/Events/stale-card.md" <<'EVENT'
---
id: stale-card
title: Stale card
description: Existing card without state.
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
  title: Stale card
---
EVENT

out="$(bb "${RUNNER}" --vault "${vault}" --today 2026-06-10 dry-run)"
assert_contains "${out}" $'candidate	kubernetes-upgrade-planning	kubernetes-upgrade-planning:2026-07-01'
assert_not_contains "${out}" 'kubernetes-upgrade-planning:2026-07-02'
assert_contains "${out}" $'candidate	default-body	default-body:2026-06-15'
default_block="$(sed -n '/# BOXP-N: Default body 2026-06-15/,/- dry-run:/p' <<<"${out}")"
[[ "$(grep -Fc '元イベントファイル' <<<"${default_block}")" == "1" ]] || fail "default ticket metadata was duplicated"
assert_contains "${out}" $'not-yet	tax-return-preparation'
assert_contains "${out}" $'invalid	invalid-event'
assert_contains "${out}" $'invalid	invalid-occurrence-missing-date'
assert_contains "${out}" 'schedule.items[0].scheduled-date is required'
assert_contains "${out}" 'schedule.items[0].target-period is required'
assert_contains "${out}" 'schedule.items[0].title-suffix is required'
assert_contains "${out}" 'schedule.items[1].key is required'
assert_contains "${out}" $'invalid	invalid-occurrence-bad-date'
assert_contains "${out}" 'schedule.items[0].scheduled-date must be YYYY-MM-DD'
assert_contains "${out}" $'invalid	invalid-cron-token'
assert_contains "${out}" 'schedule.value must be a valid 5-field cron'
assert_contains "${out}" $'invalid	missing-frontmatter'
assert_contains "${out}" 'event note is missing YAML frontmatter'
assert_contains "${out}" $'invalid	unclosed-frontmatter'
assert_contains "${out}" 'event note frontmatter is not closed'

cat >"${vault}/Infrastructure/Recurring Events/Events/invalid-cron-range.md" <<'EVENT'
---
id: invalid-cron-range
title: Invalid cron range
description: Invalid cron range.
enabled: true
schedule:
  type: cron
  value: "0 99 * * *"
time-zone: Asia/Tokyo
lead-days: 1
priority: medium
project: BOXP
initial-lane: Backlog
ticket-template:
  title: Invalid cron range
---
EVENT
out="$(bb "${RUNNER}" --vault "${vault}" --today 2026-06-10 dry-run)"
assert_contains "${out}" $'invalid	invalid-cron-range'
assert_contains "${out}" 'schedule.value must be a valid 5-field cron'

out="$(bb "${RUNNER}" --vault "${vault}" --today 2026-12-20 dry-run)"
assert_contains "${out}" $'candidate	tax-return-preparation	tax-return-preparation:2026'
assert_contains "${out}" "Tax return preparation: 2026年分"

out="$(bb "${RUNNER}" --vault "${vault}" --today 2026-07-08 dry-run)"
assert_contains "${out}" $'already-created	already-created	already-created:2026-07-08'
assert_contains "${out}" $'disabled	disabled-event'
assert_contains "${out}" $'needs-human-check	needs-check	needs-check:2026-07-08'
assert_contains "${out}" $'needs-human-check	stale-card	stale-card:2026-07-08'

out="$(bb "${RUNNER}" --vault "${vault}" --today 2026-12-20 apply)"
assert_contains "${out}" $'created	BOXP-10	Backlog	Kubernetes upgrade planning: 2027-01-01'
assert_contains "${out}" $'created	BOXP-11	Backlog	Tax return preparation: 2026年分'
grep -Fq '[[Tickets/BOXP-11|BOXP-11: Tax return preparation: 2026年分]] #ticket status::backlog priority::high occurrence::tax-return-preparation:2026' "${vault}/Boards/Task Board.md" || fail "board card was not inserted"
grep -Fq 'occurrence-key: tax-return-preparation:2026' "${vault}/Tickets/BOXP-11.md" || fail "ticket metadata missing"
grep -Fq 'Prepare tax return from custom template.' "${vault}/Tickets/BOXP-11.md" || fail "ticket template body was not preserved"
grep -Fq '## Summary' "${vault}/Tickets/BOXP-11.md" || fail "ticket headings were not normalized"
grep -Fq '"tax-return-preparation:2026"' "${vault}/Infrastructure/Recurring Events/state.edn" || fail "state not updated"

seed_vault="${tmp}/seed-vault"
mkdir -p "${seed_vault}"
cp -R "${ROOT_DIR}/docker/codex-workspace/recurring-events/vault-seed/." "${seed_vault}/"
[[ -f "${seed_vault}/Infrastructure/Recurring Events/README.md" ]] || fail "seed README missing"
[[ -f "${seed_vault}/Templates/Recurring Event.md" ]] || fail "seed template missing"
[[ -f "${seed_vault}/Infrastructure/Codex Cron/prompts/recurring-events.md" ]] || fail "seed cron prompt missing"
grep -Fq ':id "recurring-events-dry-run"' "${seed_vault}/Infrastructure/Codex Cron/jobs.edn" || fail "seed cron job missing"
grep -Fq ':enabled false' "${seed_vault}/Infrastructure/Codex Cron/jobs.edn" || fail "seed cron job must start disabled"
out="$(bb "${RUNNER}" --vault "${seed_vault}" --today 2026-12-20 dry-run)"
assert_contains "${out}" $'candidate	kubernetes-upgrade-planning	kubernetes-upgrade-planning:2027-01-01'
assert_contains "${out}" $'candidate	tax-return-preparation	tax-return-preparation:2026'

echo "recurring events tests passed"
