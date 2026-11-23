# EFitMi: working notes

Read `README.md` first for what this is and how accurate it currently is.
These are the things that are easy to get wrong and expensive to rediscover.

## The one rule

**Every number the app shows must trace back to something the person
supplied: their front photo, their side photo and the height they typed.**
An assumed value that reaches a result (a default height, a guessed body
size, a fallback width) is the bug this project exists to avoid, however
plausible the output looks. The first version failed exactly here.

Consequences to preserve:

- **There is no default height.** `Measurer.measure` takes a height and
  refuses if it is not in the range the model was validated on. Don't add
  a fallback.
- **Refuse rather than guess.** Cropped feet, a body too small to pin the
  scale, an unreadable outline: each is a `Refusal` with a sentence telling
  the person what to fix. Never return a number from photos that can't
  support one.
- **Each photo is scaled from its own pixel height.** Front and side photos
  of one capture differ in scale by a median of ~5% (11% at p90). Never share
  one scale between them. A test guards this.

## The one exception, and what it costs

The fitted model (`core/src/main/resources/.../girth-model.txt`) is the only
place constants from other people's data enter. That is allowed on two
conditions, and neither may be dropped:

1. **Fit and score on different people.** Split by *subject*, never by photo:
   several photos of one person share silhouettes and would leak between
   fitting and scoring. Never tune anything on test A or test B.
2. **Ship the held-out error with the model.** `GirthModel` carries the mean
   and 90th-percentile error per girth and `Measurer` returns them next to
   each number. A figure without its error bar is the old bug in a new place.

BodyM is CC BY-NC 4.0: development and research only. Anything fitted to it
must be re-derived from consented data before a commercial release.

## Architecture

`core/` is pure Kotlin with **no Android classes**, so the code validated on a
laptop is the code that ships in the app. Keep it that way: no `android.*`
imports, no files, no clocks. Masks come in as `Mask`; where they came from is
not core's business.

Flow: `Mask` -> `Silhouette` (largest piece, in-frame check, scale) ->
`Profiles` (torso-only width from the front, depth from the side) ->
`LevelProfile` (47 levels, ellipse perimeter at each) -> `GirthModel` (ridge
weights) -> `Girth`s.

`validation/` trains and scores against BodyM using the same core. There is
deliberately no second implementation of the geometry: an earlier version of
this project kept a Python and a TypeScript copy and spent effort keeping
them in step.

## Things that bit us

- **A hard step in a test body breaks resolution tests.** Comparing a profile
  at two resolutions fails at the exact level where the synthetic body changes
  shape, because each rendering lands on a different side of the edge. Compare
  only levels clear of the steps (`torsoLevels` in `LevelProfileTest`).
- **`./gradlew -q` hides test failures.** The `FAILED` lines are lifecycle
  output and quiet mode suppresses them, so a loop that greps for them reports
  "all green" no matter what. Read `core/build/test-results/test/*.xml`
  instead.
- **`mavenCentral()` returns HTTP 429 in the cloud sandbox.** It resolves to
  `repo.maven.apache.org`; `settings.gradle.kts` points at `repo1.maven.org`,
  which serves the same artifacts.
- **`tools/fetch-bodym.sh` used to die after the first split.** `pipefail`
  plus one failed `curl` aborted everything, and connections were being reset
  at 16 in parallel (not at 6; the proxy is the likely cause but that was not
  confirmed). It now runs 8, retries only what is missing, and lists what is
  still absent. Keep it re-runnable.
- **Check what a "refused" count really means before quoting an error.** 26-46%
  of BodyM photos are refused (feet cropped in the side view). Error figures
  describe only the photos that were read; say so wherever they are quoted.
- **Don't trust a one-off result that says "nothing happened".** A mutation
  check once reported every guard untested because the script grepped output
  that `-q` had removed. Verify the harness can see a failure before believing
  it can't see any.

## Verifying changes

```bash
./gradlew :core:test                                  # fast, no data needed
./gradlew :validation:run --args="report"             # needs data/bodym; ~40 s
```

When you add a test for a bug, **reintroduce the bug and confirm the test
fails.** Done today for: side scaled with the front's scale, arms counted as
torso, stray pieces kept, cropped photos accepted, ellipse replaced by a
circle. Each is caught by the intended test. A test that can't fail is worse
than none, because it reads as evidence.

If you change the geometry, the shipped model is stale: refit with
`train --write`, then `report --write`, and commit both with
`docs/validation.md` so the README's numbers stay true.

## Scope

In: capture-to-girth measurement for chest, waist and hip, validated on real
data. Out until asked: fabric capture, garment generation, try-on, accounts,
persistence, an iOS app, and automatic card detection (no card is used any
more). Shoulder width needs its own model and is not done. Flag scope creep
rather than building it.

The Android app needs the Android SDK, and `dl.google.com` is blocked in the
cloud environment. Ask for that host to be allowed before starting on it.
