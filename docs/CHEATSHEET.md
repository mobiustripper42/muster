JIG WORKFLOW CHEATSHEET                                  v6

  /its-alive  ->  [ work ]  ->  /kill-this  ->  /its-dead


SESSION
  /its-alive       start. opens the session file, reads context,
                   runs the drift + permission-policy checks,
                   recommends a task. waits for confirmation.
  /kill-this       per task. build + commit + PR + @code-review.
                   run it once per task, not once per session.
  /its-dead        end. stamps ended, tallies points, shows the
                   wall-clock gut-check, closes the session file.

PHASE
  /start-phase     materialize the phase as Issues
                   ( phase:N + points:X labels )
  /retro           close phase. mark [x], compute throughput +
                   estimate calibration, write the retro, bump.

SEMVER  ( needs package.json with a version field )
  /bump-major      breaking change. manual. tag on main.
  /promote-production  main -> production ff-merge + push.
                   ( needs origin/production )
  patch bumps      /promote-production on ship, or /retro per
                   merged PR where there is no production branch.

AGENTS
  @architect       Opus. coherence vs SPEC + decisions.
  @code-review     Sonnet. wired into /kill-this.
  @pm              Sonnet. progress, risk, scope cuts.
  @ui-reviewer     Sonnet. design quality. reads ui-context.md.

GATES  ( npm run verify )
  check:decisions  record shape, index freshness, dangling refs
  check:dictionary unregistered vocabulary
  check:denied     docs spelling a denied command
  check:context    paths cited by the always-loaded files
  check:docs       rosters, links, and the rest of the doc set

THE STOP
  step 8 is a hard stop. built is not shipped. report what
  changed and wait. /kill-this is invoked by the operator,
  never by the session. reaching the same end state by hand
  skips @code-review and announces that to nobody.

NOT CARRIED  ( these existed in seeds and do not here )
  read-the-tape pause-this restart-this doc-consistency-check
  @workout @doc-consistency @ideas @tape-reader
