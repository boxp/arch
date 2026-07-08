---
id: tax-return-preparation
title: Tax return preparation
description: 確定申告準備の作業を起票する。
enabled: true
schedule:
  type: occurrences
  items:
    - key: "2026"
      scheduled-date: 2027-02-01
      target-period: "2026 tax year"
      title-suffix: "2026年分"
    - key: "2027"
      scheduled-date: 2028-02-01
      target-period: "2027 tax year"
      title-suffix: "2027年分"
time-zone: Asia/Tokyo
lead-days: 45
priority: high
project: BOXP
assignee: boxp
initial-lane: Backlog
ticket-template:
  title: "Tax return preparation: {{title-suffix}}"
---

# Tax return preparation

## Draft

年ごとの確定申告準備を、締切が近づく前に Backlog へ起票する。

## Ticket Template

### Summary

対象期間の確定申告に必要な資料を集め、申告作業に着手できる状態にする。

### Acceptance Criteria

- [ ] 収入・経費・控除に関係する資料を集める。
- [ ] 不足資料と取得先を洗い出す。
- [ ] 申告作業の実施日または依頼先を決める。

### Context

- target-period: {{target-period}}
- occurrence: {{occurrence-key}}

### Plan

- [ ] 口座・カード・証券・寄付・医療費などの資料を確認する。
- [ ] 不足している証憑を取得する。
- [ ] 作業日程を決める。

## Notes

明示 occurrences 型サンプルイベント。
