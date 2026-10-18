JIG WORKFLOW CHEATSHEET                                  v6

  /its-alive  ->  [ work -> /kill-this -> /save-this -> /clear ] ...  ->  /its-dead


SESSION
  /its-alive       start. opens the session file, reads context,
                   runs the drift + permission-policy checks,
                   recommends a task. waits for confirmation.
  /build-task      3+ point task, spec in the issue. @test-writer
                   writes failing tests, @implementer makes them
                   pass, the Lead verifies and runs /kill-this.
                   running it approves the spec.
  /kill-this       per task. build + commit + PR + @code-review.
                   run it once per task, not once per session.
  /save-this       between tasks, before /clear. writes next task,
                   standing rules, parking lot and carry-over to
                   the session file; the cleared context reads it.
  /its-dead        end. stamps ended, tallies points, shows the
                   wall-clock gut-check, closes the session file.

PHASE
  /start-phase     materialize the phase as Issues
                   ( phase:N + points:X labels )
  /retro           close phase. mark [x], write a one-screen
                   retro (numbers, what happened, your take,
                   PM read), bump.

SEMVER  ( needs package.json with a version field )
  /bump-major      breaking change. manual. tag on main.
  /promote-production  main -> production ff-merge + push, then waits for the deploy.
                   ( needs origin/production )
  patch bumps      /promote-production on ship, or /retro per
                   merged PR where there is no production branch.

AGENTS
  @architect       Opus. coherence vs SPEC + decisions.
  @code-review     Sonnet. wired into /kill-this.
  @pm              Sonnet. progress, risk, scope cuts.
  @ui-reviewer     Sonnet. design quality. reads ui-context.md.
  @test-writer     Opus. failing tests from the issue spec.
  @implementer     Sonnet. makes the tests pass. can't edit them.

GATES  ( npm run verify )
  check:decisions  record shape, index freshness, dangling refs
  check:dictionary unregistered vocabulary
  check:denied     docs spelling a denied command
  check:context    paths cited by the always-loaded files
  check:docs       rosters, links, and the rest of the doc set

THE STOP
  proof passes -> the session runs /kill-this itself, then
  stops with the PR link and shows anything a person looks
  at. no proof, or a decision the plan didn't settle -> stop
  and ask, unshipped. reaching the same end state by hand
  skips @code-review and announces that to nobody. (DEC-J014)

NOT CARRIED  ( these existed in seeds and do not here )
  read-the-tape pause-this restart-this doc-consistency-check
  @workout @doc-consistency @ideas @tape-reader
