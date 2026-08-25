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

CARD_WIDTH_CM = 8.56


def scale_factor(card_box_width_px):
    return CARD_WIDTH_CM / card_box_width_px


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


if __name__ == "__main__":
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            print(f"ok  {name}")
    print("\nAll calibration checks passed.")
