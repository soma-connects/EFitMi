# Verifies the card-based scale calibration arithmetic in isolation, with no
# camera, no MediaPipe and no torch — so it runs fast and can be checked
# before trusting anything the full service returns.
#
# This proves the pixels -> cm conversion is arithmetically right. It does NOT
# prove the measurements are anatomically correct: the correction multipliers
# inherited from the reference project (shoulder x1.1, chest x1.15, waist
# x1.16, hip x1.35) were tuned against that project's height-guess
# calibration, and are still unverified against a real tape measure.

import math

from measurement_math import CARD_WIDTH_CM, refine_width, scale_factor


def test_scale_factor_matches_card_width():
    # A card measured as exactly 100px wide means 1px = 0.0856cm.
    assert math.isclose(scale_factor(100), 0.0856)


def test_card_measures_itself_correctly():
    # Round trip: the card's own pixel width must convert back to 8.56cm.
    for px in (40, 100, 237.5, 800):
        assert math.isclose(px * scale_factor(px), CARD_WIDTH_CM)


def test_closer_camera_gives_smaller_scale_factor():
    # Standing closer makes the card occupy more pixels, so each pixel
    # represents less real-world distance.
    assert scale_factor(200) < scale_factor(100)


def test_plausible_shoulder_width():
    # A 1280px-wide photo where the card reads ~95px and the shoulder span
    # reads ~430px: a realistic adult shoulder width, not 15cm or 300cm.
    shoulder_px = 430
    raw_cm = shoulder_px * scale_factor(95)
    corrected_cm = raw_cm * 1.1  # multiplier inherited from reference repo
    assert 30 < corrected_cm < 60, corrected_cm


def test_scale_is_independent_of_image_resolution():
    # Downscaling the photo shrinks card and body by the same factor, so the
    # measured result must not change.
    full_res = 500 * scale_factor(100)
    half_res = 250 * scale_factor(50)
    assert math.isclose(full_res, half_res)


def test_refine_width_prefers_corroborating_contour():
    # A contour reading close to the landmark estimate carries real extra
    # detail, so it wins.
    assert refine_width(100.0, 115.0) == 115.0


def test_refine_width_rejects_implausible_contour():
    # A contour reading far outside the landmark estimate is an artefact
    # (shadow, dark background, loose clothing) and must not win. The
    # reference project's max() let exactly this inflate the result.
    assert refine_width(100.0, 900.0) == 100.0
    assert refine_width(100.0, 5.0) == 100.0


def test_refine_width_falls_back_when_scan_failed():
    # A failed scan reports None, not a substitute number.
    assert refine_width(100.0, None) == 100.0


def test_widths_scale_linearly_with_card_width():
    # Regression test for the hip non-linearity: every measurement is a
    # fixed pixel quantity times the scale factor, so halving the card's
    # pixel width must exactly double every result. This held for shoulder
    # and chest but not hip, because hip mixed in a contour reading via
    # max() while a stateful pose detector made the pixel widths drift
    # between requests.
    landmark_px, contour_px = 400.0, 430.0
    width_px = refine_width(landmark_px, contour_px)

    near = width_px * scale_factor(120)
    far = width_px * scale_factor(60)
    assert math.isclose(far, near * 2)


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("\nAll calibration checks passed.")
