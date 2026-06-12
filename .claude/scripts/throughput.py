#!/usr/bin/env python3
"""
throughput.py — standalone throughput + flow extractor (DEC-S026).

Replaces velocity.py's effort-hours-per-point model. Reads GitHub via `gh`; it
NEVER parses RETROSPECTIVES.md or any session transcript.

WHY (DEC-S026): hrs/pt needed the session transcript to subtract breaks, and the
transcript is unreachable for ~every web/Desktop session — so the headline kept
degrading to wall_clock/pt, the one number the guide forbids. Issue dates +
labels live in GitHub forever, so the signal is measurable on every repo and
reconstructable retroactively.

WHAT IT REPORTS (validated 2026-06-11 against bushel/crewbook/muster/helm)
  1. Active-weeks throughput — the headline. Two lifetime rates:
       points / calendar-weeks   (includes idle weeks = realized pace)
       points / active-weeks     (weeks with ≥1 close = intensity when shipping)
     NOT a trailing-window band. The fleet is burst-shaped — every project is a
     1–6 week sprint then done — so there is no calendar "trail" to roll over.
     A rolling band is shown only when a repo has ≥2×window weeks of history.
  2. Per phase — points, pts/issue (pointing-stability signal), calendar span in
     days, and a pts/week rate ONLY when the phase spans ≥7 days. Sub-week
     phases are flagged "burst" instead of quoting an exploding rate.
  3. PR merge latency (open→merge) — median + p85 in HOURS, a flow-health signal
     (do PRs sit unmerged?). NOT a build-effort forecast: the PR opens AFTER the
     work is done, so open→merge can't see build time and is flat across point
     sizes (validated on bushel — a 5-pointer merges as fast as a 2). Reported as
     a distribution, never summed — which also sidesteps the overlapping-window
     bug that broke DEC-S024.
  4. Per-repo and combined; --issues adds the points:N histogram.

POINTS ATTRIBUTION (load-bearing — do NOT "improve" into PR-pairing):
  - Each CLOSED issue carrying a points:N label credits N points on the ISO week
    of its OWN closedAt. PRs are NEVER counted directly for throughput.
  - An issue with no points:N label is SKIPPED, never guessed.
  - Never re-pair PR-open -> PR-merge to recover "effort": that window math is
    exactly the DEC-S024 bug. Merge latency uses each PR's OWN open→merge span
    and only reports the distribution — it never sums spans across PRs.

USAGE
  python3 throughput.py [REPO_PATH ...]          # one or more repos; default: cwd
  python3 throughput.py --window 8 ~/GitHub/bushel
  python3 throughput.py --issues ~/GitHub/bushel  # also show points:N histogram
  python3 throughput.py --self-test               # offline logic check, no gh

HONEST LIMITS (by design)
  - Every rate is in ACTIVE-TIME units. The tool measures the work; YOU supply
    the calendar. A calendar date = a rate here ÷ your real availability.
  - Retroactive only as far back as the points:N labelling ritual — a project
    that predates the labels is invisible (sailbook). Throughput doesn't widen
    that blind spot, but it doesn't fix it either.
  - Even more project-shape-specific than hrs/pt. NEVER forecast a new project
    from another's numbers.
"""

import sys
import os
import json
import math
import statistics
import subprocess
from collections import defaultdict
from datetime import datetime, timedelta

POINT_VALUES = (1, 2, 3, 5, 8, 13)


# ---------------------------------------------------------------------------
# Parsing helpers (pure — unit-tested by --self-test)
# ---------------------------------------------------------------------------

def parse_dt(s):
    """ISO8601 from gh (e.g. 2026-05-08T14:23:01Z) -> aware datetime. None if blank."""
    if not s:
        return None
    return datetime.fromisoformat(s.replace('Z', '+00:00'))


def iso_week_key(dt):
    """(iso_year, iso_week) bucket key for a datetime."""
    iso = dt.isocalendar()
    return (iso[0], iso[1])


def week_monday(key):
    """Monday (date at 00:00) of an (iso_year, iso_week) key."""
    y, w = key
    return datetime.fromisocalendar(y, w, 1)


def label_points(labels):
    """Int N from a points:N label among label name strings, or None."""
    for name in labels:
        if name.startswith('points:'):
            try:
                return int(name.split(':', 1)[1])
            except ValueError:
                continue
    return None


def label_phase(labels):
    """phase:N value (as string) among label name strings, or None."""
    for name in labels:
        if name.startswith('phase:'):
            return name.split(':', 1)[1]
    return None


def percentile(xs, p):
    """Nearest-rank percentile (p in 0..100). None if empty. Coarse for small n."""
    if not xs:
        return None
    s = sorted(xs)
    if len(s) == 1:
        return s[0]
    k = max(0, math.ceil(p / 100 * len(s)) - 1)
    return s[k]


# ---------------------------------------------------------------------------
# Computation (pure — unit-tested by --self-test)
# ---------------------------------------------------------------------------

def weekly_points(issues):
    """dict {(iso_year, iso_week): points} summed over each issue's closedAt."""
    wk = defaultdict(float)
    for it in issues:
        wk[iso_week_key(it['closedAt'])] += it['points']
    return dict(wk)


def week_range(keys):
    """Inclusive (iso_year, iso_week) list from earliest to latest key, gaps filled.

    A quiet week is real signal (throughput includes availability), so the range
    is filled rather than collapsed to active weeks only."""
    keys = list(keys)
    if not keys:
        return []
    start, end = week_monday(min(keys, key=week_monday)), week_monday(max(keys, key=week_monday))
    out, d = [], start
    while d <= end:
        iso = d.isocalendar()
        out.append((iso[0], iso[1]))
        d += timedelta(weeks=1)
    return out


def lifetime_rates(issues):
    """The headline. Two lifetime rates + the spans they divide. None if empty.

    cal_rate    = points / calendar-weeks   (incl. idle weeks — realized pace)
    active_rate = points / active-weeks     (weeks with ≥1 close — shipping intensity)
    """
    if not issues:
        return None
    wp = weekly_points(issues)
    weeks = week_range(wp.keys())
    n_cal = len(weeks)
    n_active = sum(1 for wk in weeks if wp.get(wk, 0) > 0)
    total = sum(i['points'] for i in issues)
    closes = [i['closedAt'] for i in issues]
    return {
        'total': total, 'n_cal': n_cal, 'n_active': n_active,
        'cal_rate': total / n_cal if n_cal else 0.0,
        'active_rate': total / n_active if n_active else 0.0,
        'first': min(closes), 'last': max(closes),
    }


def rolling_band(issues, window):
    """Dense weekly series + rolling-window average series (shown only when a repo
    has ≥2×window weeks — see report). {'series': [(key, pts)], 'rolls': [avg]}."""
    wp = weekly_points(issues)
    weeks = week_range(wp.keys())
    series = [(wk, wp.get(wk, 0.0)) for wk in weeks]
    pts = [p for _, p in series]
    rolls = []
    if len(pts) >= window >= 1:
        for i in range(window - 1, len(pts)):
            rolls.append(sum(pts[i - window + 1:i + 1]) / window)
    return {'series': series, 'rolls': rolls}


def phase_stats(issues):
    """Per-phase list: {phase, n, points, pts_per_issue, span_days, rate}, sorted.

    rate (points/week) is set ONLY when span_days >= 7; otherwise None ("burst"),
    because dividing points by a sub-week span explodes into a meaningless rate."""
    by = defaultdict(list)
    for it in issues:
        if it['phase'] is not None:
            by[it['phase']].append(it)
    out = []
    for ph, items in by.items():
        points = sum(i['points'] for i in items)
        n = len(items)
        closes = [i['closedAt'] for i in items]
        starts = [i['createdAt'] for i in items if i['createdAt']]
        first = min(starts) if starts else min(closes)
        last = max(closes)
        span_days = (last - first).total_seconds() / 86400
        out.append({
            'phase': ph, 'n': n, 'points': points,
            'pts_per_issue': points / n if n else 0.0,
            'span_days': span_days,
            'rate': points / (span_days / 7) if span_days >= 7 else None,
        })

    def sortkey(d):
        try:
            return (0, int(d['phase']))
        except (ValueError, TypeError):
            return (1, str(d['phase']))
    return sorted(out, key=sortkey)


def merge_latency(prs):
    """PR open→merge latency in HOURS over merged PRs. {'hours': sorted[], 'n': int}.

    A flow-health signal (do PRs sit unmerged?), NOT a build-effort forecast:
    open→merge can't see build time because the PR opens after the work is done,
    so it's flat across point sizes. Each PR's OWN span only — never summed."""
    hrs = []
    for pr in prs:
        if pr['createdAt'] is None or pr['mergedAt'] is None:
            continue
        h = (pr['mergedAt'] - pr['createdAt']).total_seconds() / 3600
        if h < 0:
            continue
        hrs.append(h)
    return {'hours': sorted(hrs), 'n': len(hrs)}


def issue_histogram(issues):
    """Count of closed points-labelled issues per point value."""
    out = {n: 0 for n in POINT_VALUES}
    for it in issues:
        if it['points'] in out:
            out[it['points']] += 1
    return out


# ---------------------------------------------------------------------------
# GitHub fetch (the only impure boundary)
# ---------------------------------------------------------------------------

def fetch_issues(repo):
    """Closed points-labelled issues via gh -> dicts
    {number, points, phase, closedAt(dt), createdAt(dt)}. None on gh failure."""
    try:
        r = subprocess.run(
            ['gh', 'issue', 'list', '--state', 'closed',
             '--json', 'number,closedAt,createdAt,labels', '--limit', '1000'],
            cwd=repo, capture_output=True, text=True, timeout=60)
    except Exception:
        return None
    if r.returncode != 0:
        return None
    try:
        raw = json.loads(r.stdout or '[]')
    except json.JSONDecodeError:
        return None
    issues = []
    for it in raw:
        labels = [l.get('name', '') for l in it.get('labels', [])]
        pts = label_points(labels)
        if pts is None:
            continue
        closed = parse_dt(it.get('closedAt'))
        if closed is None:
            continue
        issues.append({
            'number': it.get('number'), 'points': pts,
            'phase': label_phase(labels),
            'closedAt': closed, 'createdAt': parse_dt(it.get('createdAt')),
        })
    return issues


def fetch_prs(repo):
    """Merged PRs via gh -> dicts {createdAt(dt), mergedAt(dt)}. None on gh failure
    (returns [] for a repo with zero merged PRs). Only open/merge timestamps are
    needed — merge latency is a flow signal, not joined to issues."""
    try:
        r = subprocess.run(
            ['gh', 'pr', 'list', '--state', 'merged',
             '--json', 'createdAt,mergedAt', '--limit', '1000'],
            cwd=repo, capture_output=True, text=True, timeout=60)
    except Exception:
        return None
    if r.returncode != 0:
        return None
    try:
        raw = json.loads(r.stdout or '[]')
    except json.JSONDecodeError:
        return None
    return [{'createdAt': parse_dt(pr.get('createdAt')), 'mergedAt': parse_dt(pr.get('mergedAt'))}
            for pr in raw]


# ---------------------------------------------------------------------------
# Reporting
# ---------------------------------------------------------------------------

def fmt(x, n=2):
    return '—' if x is None else f'{x:.{n}f}'


def week_label(key):
    y, w = key
    return f'{y}-W{w:02d}'


def report(res, window):
    repo = res['repo']
    issues = res['issues']
    print(f"\n{'=' * 64}\n{repo}\n{'=' * 64}")
    if not issues:
        print("  no points-labelled closed issues — nothing to measure.")
        return

    lr = res['lifetime']
    band = res['band']
    series, rolls = band['series'], band['rolls']

    print(f"  {len(issues)} closed points-labelled issues, {fmt(lr['total'], 0)} points, "
          f"{lr['first'].date()} → {lr['last'].date()} "
          f"({lr['n_cal']} calendar weeks, {lr['n_active']} active).")

    # 1. Headline — two lifetime rates (NOT a trailing band).
    print("\n  Active-weeks throughput (lifetime):")
    print(f"    {fmt(lr['cal_rate'], 2)} pts / calendar-week   (realized pace, incl. idle weeks)")
    print(f"    {fmt(lr['active_rate'], 2)} pts / active-week     (intensity when shipping)")
    print("    → active-time rates; a calendar date = divide by your real availability.")

    # Weekly bar chart.
    print("\n  Points shipped per ISO week:")
    for key, p in series:
        print(f"    {week_label(key)}  {fmt(p, 0):>3}  {'█' * int(round(p))}")

    # Rolling band only when there is genuinely enough history.
    if len(series) >= 2 * window:
        print(f"\n  Trailing {window}-week band (rolling avg pts/wk): "
              f"min {min(rolls):.2f}  median {statistics.median(rolls):.2f}  max {max(rolls):.2f}")
        if min(rolls) > 0 and max(rolls) / min(rolls) >= 2:
            print("    ⚠ band swings ≥2× — dominated by individual weeks; widen --window.")
    else:
        print(f"\n  (trailing band needs ≥{2 * window} weeks for independent windows; "
              f"you have {len(series)} — use the lifetime rates above.)")

    # 2. Per phase — points, pointing stability, span, rate-when-meaningful.
    phases = res['phases']
    if phases:
        print("\n  Per phase (pts/issue = pointing stability; rate only when span ≥7d):")
        print(f"    {'Phase':<9}{'Iss':>4}{'Points':>7}{'pts/iss':>9}{'Span(d)':>9}{'pts/wk':>9}")
        ppis = []
        for ph in phases:
            ppis.append(ph['pts_per_issue'])
            rate = f"{ph['rate']:.2f}" if ph['rate'] is not None else "burst"
            print(f"    {('phase:' + str(ph['phase']))[:9]:<9}{ph['n']:>4}{fmt(ph['points'], 0):>7}"
                  f"{fmt(ph['pts_per_issue'], 2):>9}{fmt(ph['span_days'], 1):>9}{rate:>9}")
        if len(ppis) >= 2:
            spread = max(ppis) - min(ppis)
            verdict = "tight — pointing is consistent" if spread <= 1.5 else "drifting — check for point inflation"
            print(f"    pts/issue range {min(ppis):.2f}–{max(ppis):.2f} across {len(ppis)} phases — {verdict}.")

    # 3. PR merge latency — flow health (NOT a build-effort forecast; see DEC-S026).
    ml = res['latency']
    if ml is None:
        print("\n  PR merge latency: gh PR data unavailable (skipped).")
    elif ml['n']:
        print("\n  PR merge latency, open→merge — flow health, not a build-effort forecast:")
        print(f"    median {percentile(ml['hours'], 50):.1f}h  p85 {percentile(ml['hours'], 85):.1f}h  "
              f"across {ml['n']} merged PRs")
        print("    (open→merge opens after the work is done — it can't see build time, "
              "so it's flat across point sizes.)")
    else:
        print("\n  PR merge latency: no merged PRs found.")

    # --issues histogram.
    if res['show_issues']:
        hist = issue_histogram(issues)
        print("\n  Closed points:N histogram (pointing-habit view — NOT joined to weeks):")
        for n in POINT_VALUES:
            print(f"    {n:>2}-pt: {hist.get(n, 0)}")


def report_combined(measurable, window):
    combined = [it for r in measurable for it in r['issues']]
    lr = lifetime_rates(combined)
    print(f"\n{'#' * 64}")
    print(f"COMBINED across {len(measurable)} repos: {fmt(lr['total'], 0)} points, "
          f"{lr['n_cal']} calendar weeks ({lr['n_active']} active).")
    print(f"  {fmt(lr['cal_rate'], 2)} pts/calendar-week   {fmt(lr['active_rate'], 2)} pts/active-week")
    print("  (summed across repos by week — not an average of per-repo numbers)")
    print('#' * 64)


# ---------------------------------------------------------------------------
# Offline self-test (proves the computation without gh / network)
# ---------------------------------------------------------------------------

def run_self_test(window):
    def iss(number, points, phase, created, closed):
        return {'number': number, 'points': points, 'phase': phase,
                'createdAt': parse_dt(created), 'closedAt': parse_dt(closed)}

    def pr(created, merged):
        return {'createdAt': parse_dt(created), 'mergedAt': parse_dt(merged)}

    # W03=8, gap W04, W05=8, gap W06, W07=5, gap W08, W09=2 (ISO weeks of 2026).
    # Times pinned to 00:00 so phase deltas are whole days (= whole weeks).
    issues = [
        iss(1, 5, '1', '2026-01-05T00:00:00Z', '2026-01-12T00:00:00Z'),  # W03
        iss(2, 3, '1', '2026-01-06T00:00:00Z', '2026-01-12T00:00:00Z'),  # W03
        iss(3, 8, '1', '2026-01-07T00:00:00Z', '2026-01-26T00:00:00Z'),  # W05
        iss(4, 5, '2', '2026-02-02T00:00:00Z', '2026-02-09T00:00:00Z'),  # W07
        iss(5, 2, '2', '2026-02-03T00:00:00Z', '2026-02-23T00:00:00Z'),  # W09
    ]
    fails = []

    def check(name, got, want):
        if got != want:
            fails.append(f"{name}: got {got!r}, want {want!r}")

    # weekly + dense series
    wp = weekly_points(issues)
    check('weekly W03', wp[(2026, 3)], 8.0)
    check('weekly has no gap key', (2026, 4) in wp, False)
    check('dense series', [p for _, p in rolling_band(issues, 4)['series']],
          [8.0, 0.0, 8.0, 0.0, 5.0, 0.0, 2.0])

    # lifetime rates: 23 pts, 7 calendar weeks, 4 active weeks
    lr = lifetime_rates(issues)
    check('lifetime total', lr['total'], 23)
    check('calendar weeks', lr['n_cal'], 7)
    check('active weeks', lr['n_active'], 4)
    check('cal_rate', round(lr['cal_rate'], 4), round(23 / 7, 4))
    check('active_rate', round(lr['active_rate'], 4), round(23 / 4, 4))

    # phases: stability + span + gated rate
    phases = phase_stats(issues)
    check('phase count', len(phases), 2)
    check('phase1 pts/issue', round(phases[0]['pts_per_issue'], 4), round(16 / 3, 4))
    check('phase1 span days', round(phases[0]['span_days'], 1), 21.0)
    check('phase1 rate (span≥7)', round(phases[0]['rate'], 4), round(16 / 3, 4))
    check('phase2 points', phases[1]['points'], 7)
    check('phase2 pts/issue', phases[1]['pts_per_issue'], 3.5)

    # sub-week phase -> rate is None ("burst")
    burst = phase_stats([iss(9, 5, '3', '2026-03-02T00:00:00Z', '2026-03-03T00:00:00Z')])
    check('sub-week phase rate is None', burst[0]['rate'], None)

    # percentile
    check('percentile p50', percentile([1, 2, 3, 4], 50), 2)
    check('percentile p85', percentile([1, 2, 3, 4], 85), 4)
    check('percentile empty', percentile([], 50), None)

    # merge latency: open→merge in hours, sorted; ignores anything but timestamps
    prs = [
        pr('2026-01-10T00:00:00Z', '2026-01-10T12:00:00Z'),  # 12h
        pr('2026-02-07T00:00:00Z', '2026-02-08T12:00:00Z'),  # 36h
        pr('2026-01-11T00:00:00Z', '2026-01-11T06:00:00Z'),  # 6h
        pr('2026-01-20T00:00:00Z', '2026-01-22T00:00:00Z'),  # 48h
    ]
    ml = merge_latency(prs)
    check('latency hours sorted', ml['hours'], [6.0, 12.0, 36.0, 48.0])
    check('latency n', ml['n'], 4)
    check('latency median (p50)', percentile(ml['hours'], 50), 12.0)
    check('latency p85', percentile(ml['hours'], 85), 48.0)
    check('empty latency', merge_latency([])['n'], 0)

    # histogram + empties
    check('histogram', [issue_histogram(issues)[n] for n in POINT_VALUES], [0, 1, 1, 2, 1, 0])
    check('empty weekly', weekly_points([]), {})
    check('empty lifetime', lifetime_rates([]), None)

    if fails:
        print("SELF-TEST FAILED:")
        for f in fails:
            print(f"  ✗ {f}")
        sys.exit(1)
    print("SELF-TEST PASSED — 26 assertions, computation verified offline (no gh).")
    print("Note: pure logic only. Real-repo validation (incl. PR merge latency) needs "
          "`gh` + the project repos (run on a dev machine).")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    argv = sys.argv[1:]
    show_issues = '--issues' in argv
    self_test = '--self-test' in argv
    rest = [a for a in argv if a not in ('--issues', '--self-test')]

    def int_window(s):
        try:
            return int(s)
        except ValueError:
            print("error: --window must be an integer", file=sys.stderr)
            sys.exit(2)

    window, positional, j = 4, [], 0
    while j < len(rest):
        a = rest[j]
        if a == '--window':
            if j + 1 >= len(rest):
                print("error: --window needs a value", file=sys.stderr)
                sys.exit(2)
            window, j = int_window(rest[j + 1]), j + 2
        elif a.startswith('--window='):
            window, j = int_window(a.split('=', 1)[1]), j + 1
        else:
            positional.append(a)
            j += 1

    if window < 1:
        print("error: --window must be >= 1", file=sys.stderr)
        sys.exit(2)

    if self_test:
        run_self_test(window)
        return

    repos = positional or [os.getcwd()]
    results = []
    for repo in repos:
        path = os.path.abspath(os.path.expanduser(repo))
        issues = fetch_issues(path)
        if issues is None:
            print(f"\nskip: {repo} — gh unavailable, not authed, or not a GitHub repo here.")
            continue
        prs = fetch_prs(path)
        results.append({
            'repo': path, 'issues': issues,
            'lifetime': lifetime_rates(issues),
            'band': rolling_band(issues, window),
            'phases': phase_stats(issues),
            'latency': merge_latency(prs) if prs is not None else None,
            'show_issues': show_issues,
        })

    for res in results:
        report(res, window)

    measurable = [r for r in results if r['issues']]
    if len(measurable) > 1:
        report_combined(measurable, window)


if __name__ == '__main__':
    main()
