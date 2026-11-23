# EFitMi

Chest, waist and hip measurements from two phone photos (one from the front,
one from the side) and the person's height. Built for Android in Kotlin.

**Status: the measurement core is built, tested and validated against 2,505
real people. The Android app around it is not started.** This repo was
restarted from scratch after the first version (a web app built on a
borrowed pipeline) could not be made accurate. Its code is still in git
history, up to commit `04ff2bc`.

## How it measures

A girth (chest, waist, hip) is the length of a loop around the body. One
photo can't give you that: from the front you see how wide you are, not how
deep. So:

1. **Two silhouettes.** Front and side photo, whole body in frame, each turned
   into a black-and-white mask of the person.
2. **Scale from your height.** You type your height. The rows between the top
   of the head and the soles are that height, so each photo gets its own
   centimetres-per-pixel. Each photo is scaled separately: in BodyM the front
   and side photos of one capture differ in scale by a median of about 5%
   (11% at the 90th percentile), so sharing one scale would put that straight
   into every number.
3. **Width and depth at 47 levels** from 40% to 86% of your height. Width
   comes from the front mask and counts only the torso: arms held away from
   the body are excluded. Depth comes from the side mask.
4. **An ellipse at each level.** Width and depth give an ellipse; its
   perimeter is the girth at that level.
5. **A fitted model reads the perimeters** and returns chest, waist and hip,
   each with the error that model made on people it was never fitted to.

If a photo can't support a measurement (feet cut off, body too small, height
outside what was validated), the answer is a refusal that says what to fix. There is no
default height and no fallback value.

## How accurate it is

Measured against 3D-scan girths from [BodyM](https://registry.opendata.aws/bodym/)
(Amazon: front and side silhouettes of real people plus scan measurements).
The model is fitted on the `train` split (1,600 people) and scored on people
it never saw. Full table: [`docs/validation.md`](docs/validation.md).

| | **test A** (lab photos) | **test B** (real, less-controlled photos) |
|---|---|---|
| | mean error · 90th percentile | mean error · 90th percentile |
| chest | 2.95 cm · 6.6 cm | **4.03 cm** · 8.7 cm |
| waist | 3.65 cm · 7.6 cm | **4.92 cm** · 11.0 cm |
| hip | 2.41 cm · 4.7 cm | **3.96 cm** · 8.2 cm |

Test B is the honest column. The dataset describes it as photographed in a
less-controlled environment, with varied camera orientations and lighting,
which is closest to what a phone will produce. **Typically 4-5 cm off, and 8-11
cm off one time in ten, is not tailor-grade.** It is the real accuracy of this
approach so far.
The app should show each result with these error figures attached; the model
file carries them for that reason.

### What these numbers do not cover

- **Only photos with the whole body in frame were scored.** 26% of train, 37%
  of test A and 46% of test B photos were refused, nearly all because the side
  photo cuts off the feet. The app's capture screen has to prevent that; the
  error figures say nothing about photos that would have been refused.
- **Clean silhouettes, no clothes.** BodyM masks come from near-nude scans.
  Loose clothing adds girth, and a phone's own segmentation is noisier than
  these masks. Neither is measured yet.
- **Waist reads about 2.5 cm high** on both test sets. Part of that may be a
  population difference (test A's men are thinner than the training men: waist
  86 cm against 93 cm), but test B's men are similar to the training men and
  the bias is still there. The cause is not known.
- **Heights 141-197 cm only.** That is the range of the fit data; outside it the
  model refuses.
- **The model is fitted on BodyM, which is licensed CC BY-NC 4.0.** Fine for
  development and research. Before any commercial release it has to be
  re-derived from data collected with consent.

### What was tried, and what it was worth

Mean error in cm (chest / waist / hip), always on people the fit never saw.
The rows marked *prototype* come from a quick Python script, not the shipped
Kotlin code (which reproduces the prototype's shipped-model row to within
0.02 cm).

**Scored on all of test B** (618 photos, 336 people):

| approach | chest / waist / hip |
|---|---|
| ellipse at one fixed height, one-line fit (*prototype*) | 5.7 / 6.1 / 4.7 |
| **ellipse perimeter at 47 levels, ridge fit (shipped)** | **4.0 / 4.9 / 4.0** |
| plus typed weight (*prototype*) | 3.5 / 4.1 / 3.0 |
| plus typed weight, BMI and sex (*prototype*) | 3.0 / 3.9 / 2.5 |

**Scored on half of test B** (300 photos, 160 people), because the last two
variants fit on the other half:

| approach | chest / waist / hip |
|---|---|
| shipped model | 4.2 / 4.9 / 4.1 |
| same, but scaled from the scan's exact height instead of the typed one | 3.9 / 4.8 / 3.7 |
| same as shipped, also fitted on the other half of test B | 4.1 / 4.7 / 4.0 |

Reading it: the multi-level profile is the big step (5.7 to 4.0 on chest).
Exact height and extra real-photo training data each recover about 0.3 cm at
most, so neither the typed height nor a domain gap is the bottleneck. Weight is the
one input that moves the number, and is an open decision (below).

## Layout

```
core/         Pure Kotlin. Mask -> silhouette -> level profile -> girths.
              No Android classes, so this exact code ships in the app.
validation/   JVM tool: runs core on BodyM, fits the model, writes the report.
tools/        fetch-bodym.sh downloads the dataset into data/ (gitignored).
docs/         validation.md, generated by `report`.
```

## Running it

Needs JDK 17+ (built with 21). First time:

```bash
tools/fetch-bodym.sh          # ~140 MB, safe to re-run after a dropped connection
```

```bash
./gradlew :core:test                                        # unit tests, no data needed
./gradlew :validation:run --args="report --write"           # score the shipped model, rewrite docs/validation.md
./gradlew :validation:run --args="train"                    # refit and score; does NOT replace the model
./gradlew :validation:run --args="train --write"            # refit and replace core/.../girth-model.txt
```

The dataset is only needed to re-run the validation. The tests and the app do
not use it, and the committed `docs/validation.md` already holds the results.

### On Windows

- **Install a JDK first.** Gradle is a Java program and will say
  `JAVA_HOME is not set` without one. `winget install EclipseAdoptium.Temurin.21.JDK`
  works, or use the installer from adoptium.net and tick "Set JAVA_HOME" and
  "Add to PATH". Then open a *new* terminal; an open one doesn't see the change.
- **In PowerShell, run Gradle as `.\gradlew`** (`.\gradlew :core:test`).
- **`tools/fetch-bodym.sh` is a bash script.** PowerShell can't run it and will
  silently do nothing. Run it from Git Bash (installed with Git for Windows):
  `bash tools/fetch-bodym.sh`.

## Open decisions

- **Ask for weight?** Worth roughly 1 cm on real photos (table above), at the cost
  of one more question and a partial lean on a population prior. Not added.
- **Silhouette landmarks.** Levels are fractions of height. Locating the
  armpit and crotch in each silhouette and measuring relative to those may
  cut error, and is the next experiment the harness is ready for.
- **Shoulder width** needs its own model; it is not a girth.
- **The Android app.** Needs the Android SDK, whose download host
  (`dl.google.com`) is blocked in the current cloud environment. Camera
  capture, a person-segmentation model for the masks, and a gravity-sensor
  level check are the pieces.

## Credit

Data: BodyM, Amazon (CC BY-NC 4.0). The girth-from-cross-section idea follows
[SMPL-Anthropometry](https://github.com/DavidBoja/SMPL-Anthropometry) and the
front-plus-side-silhouette setup follows Amazon's BodyM paper, "Human Body
Measurement Estimation with Adversarial Augmentation". The
first version of this project adapted
[JavTahir/Live-Measurements-Api](https://github.com/JavTahir/Live-Measurements-Api)
(MIT); none of that code remains.
