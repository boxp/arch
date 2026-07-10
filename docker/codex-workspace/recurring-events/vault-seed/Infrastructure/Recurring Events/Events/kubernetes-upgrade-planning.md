---
id: kubernetes-upgrade-planning
title: Kubernetes upgrade planning
description: Kubernetes minor upgrade の調査と計画を起票する。
enabled: true
schedule:
  type: cron
  value: 0 9 1 */3 *
time-zone: Asia/Tokyo
lead-days: 21
priority: medium
project: BOXP
repo: boxp/arch boxp/lolice
assignee: boxp
initial-lane: Backlog
ticket-template:
  title: "Kubernetes upgrade planning: {{scheduled-date}}"
---

# Kubernetes upgrade planning

## Draft

四半期ごとに Kubernetes minor upgrade の調査と作業計画を起票する。

## Ticket Template

### Summary

Kubernetes minor upgrade のリリース状況、lolice cluster への影響、事前検証手順を確認し、実施計画を作る。

### Acceptance Criteria

- [ ] 現在稼働中の Kubernetes version と次の候補 version を確認する。
- [ ] release notes / breaking changes / known issues を確認する。
- [ ] ansible / GitHub Actions / kubeadm upgrade 手順の変更要否を確認する。
- [ ] 実施チケットまたは見送り判断を Notes に残す。

### Context

- repo: boxp/arch
- 対象: lolice Kubernetes cluster

### Plan

- [ ] 現状 version を確認する。
- [ ] upstream release notes を読む。
- [ ] 既存 upgrade automation の差分要否を確認する。
- [ ] follow-up ticket を切るか、見送り理由を書く。

## Notes

cron 型サンプルイベント。
