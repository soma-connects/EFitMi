# Pure measurement arithmetic — deliberately free of cv2, mediapipe and
# torch, so it can be imported and tested in milliseconds without loading a
# model or touching the network.

# ISO/IEC 7810 ID-1 card width (bank/ATM/debit cards worldwide), in cm.
CARD_WIDTH_CM = 8.56


def scale_factor(card_box_width_px):
    """cm per pixel, derived from the card's known real-world width.

    This is the whole basis of the measurement: the card is a physical
    object of fixed size in the same photo as the body, so it gives a
    measured scale rather than an assumed one.
    """
    return CARD_WIDTH_CM / card_box_width_px


def refine_width(landmark_width_px, detected_width_px, tolerance=0.5):
    """Prefer the contour reading, but only when it corroborates the pose
    landmarks rather than contradicting them.

    The contour scan is threshold-based, so a dark background, a shadow or a
    loose garment can make it read almost anything. Taking max() of the two
    (as the reference project did) means any such artefact silently wins and
    inflates the measurement. Bounding it against the landmark estimate keeps
    the contour's extra detail where it's plausible and discards it where
    it isn't.
    """
    if detected_width_px is None:
        return landmark_width_px
    lower = landmark_width_px * (1 - tolerance)
    upper = landmark_width_px * (1 + tolerance)
    if lower <= detected_width_px <= upper:
        return detected_width_px
    return landmark_width_px
