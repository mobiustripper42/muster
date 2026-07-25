# Seeds backport manifest — doc consistency run 2026-07-25

`CLAUDE.md` is a seeds-managed shell (DEC-S019): it normally syncs from seeds untouched, and
edits made here are overwritten by the next `/pull-seeds`. This run edits it anyway, by operator
decision — the drift is real and waiting on a seeds round-trip would block the audit.

**Every edit to `CLAUDE.md` (or any other seeds-managed file) made during this run gets a row
below.** `/push-seeds` reads this file as its worklist.

| # | file:line | what changed | why | backported? |
|---|-----------|--------------|-----|-------------|
| _(none yet)_ | | | | |
