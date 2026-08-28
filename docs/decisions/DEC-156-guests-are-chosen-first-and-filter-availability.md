---
schema: 1
id: DEC-156
title: "Never show a customer a departure they cannot buy"
topic: "Reservations & payments"
status: "active"
date: "2026-08-16"
ruling: "The browse surface never offers a customer something they cannot buy. Party size is asked first and filters everything, and a day whose boats are all too small says so rather than saying sold out."
claims:
  - kind: "spec"
    target: "§2.8.13"
  - kind: "file"
    target: "src/reservations/availability-screen.ts"
  - kind: "test"
    target: "src/reservations/availability-screen.test.ts"
revisit_if: "a waitlist ships, which would deliberately show a customer a departure they cannot buy today"
---

## DEC-156: Never show a customer a departure they cannot buy

Party size is the first thing that decides what a customer can buy, and it was the last thing
we asked. The hero advertised the largest hull on the offering, so a party of twenty was told
"up to twenty-four", browsed a month of dates where only a twelve-seat boat was free, picked
one, and found out at checkout. Every day on that calendar looked bookable.

The operator's standard, and the reason this is a decision rather than a layout: **never show a
customer something they cannot buy.**

Two consequences follow from it that a later reader might otherwise undo. Sold-out and too-big
must stay distinct, because collapsing them tells a party of fifteen they were unlucky about a
week of empty boats. And the address must be updated even when nothing visibly changes — on a
12/14/16 offering only two steps in the whole range alter what is bookable, so skipping the
update is tempting and leaves every link on the page one count behind.

The order, the filtering and the bounds are `SPEC.md` §2.8.13.
