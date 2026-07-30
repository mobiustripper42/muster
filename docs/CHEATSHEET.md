SEEDS WORKFLOW CHEATSHEET                                v2026-07-25

  /its-alive  ->  [ task ]  ->  /kill-this  -+->  /its-dead
                     ^              |        |
                     |              +--------+  ( once per task )
                     +--- /pause-this <--- /restart-this
                                                 /its-dead: once per window


SESSION
  /its-alive       start. stamps time, opens session file, reads
                   context, recommends task. waits for confirmation.
  /pause-this      walking away. build check + WIP commit.
  /restart-this    resume from /pause-this. reloads context.
  /kill-this       PER TASK. verify + commit + PR + @code-review,
                   appends a ## Task <N> block. run N times.
  /its-dead        ONCE per window. stamps ended, tallies points,
                   shows wall_clock gut-check, finalizes file.

PHASE
  /start-phase     materialize current phase as Issues
                   ( phase:N + points:X labels )
  /retro           close phase. mark [x], reconcile drift,
                   compute throughput, write retro, bump minor.

SEMVER  ( dev projects only — needs package.json )
  /bump-major      breaking change. manual. tag on main.
  /promote-production patch-bump + tag main, then ff-merge
                   main->production + push. this is where
                   patches come from on projects with a
                   production branch. ( DEC-S022 )
  patch bumps      /promote-production on ship. projects with no
                   production branch get them from /retro instead.
                   never /its-dead.

REFLECT / SYNC
  /read-the-tape   scan a session for anti-patterns.
                   arg: number, file path, or none = latest.
  /push-seeds      backport workflow wins to seeds.
  /pull-seeds      pull seeds improvements into this project.
                   gated on `seeds-version` match.
  /doc-consistency-check
                   ad-hoc only, never on a calendar. cross-refs
                   docs/*.md + CLAUDE.md. report-only.

INFRA                              DOMAIN
  /update-config                     /stripe-best-practices
  /fewer-permission-prompts          /stripe-projects
  /keybindings-help                  /upgrade-stripe
                                     /claude-api
  /simplify
  /loop <interval> <cmd>           BUILT-IN
  /init                              /review
                                     /security-review

DEV IDENTITY      ~/.claude/devname  ( one line, e.g. "eric" )
SESSION FILE      sessions/YYYY-MM-DD-HHMM-<dev>-<slug>.md
TRANSCRIPT PATH   in YAML frontmatter, captured at /its-alive


THE SHORT VERSION
  start of work:     /its-alive
  break:             /pause-this    ->  /restart-this
  end of work:       /kill-this     ->  /its-dead
  start of phase:    /start-phase
  end of phase:      /retro
  after a rough one: /read-the-tape
  after a good one:  /push-seeds
  refresh template:  /pull-seeds
