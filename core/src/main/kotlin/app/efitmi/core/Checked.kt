package app.efitmi.core

/**
 * Why the app declined to produce a number.
 *
 * Refusing is a first-class outcome here, not an error path. A wrong number
 * that looks plausible does more harm than no number, so every case where
 * the photos can't support a measurement ends in one of these, each phrased
 * so the screen can tell the person what to fix.
 */
enum class Refusal(val advice: String) {
    HEIGHT_OUT_OF_RANGE("Enter your height in centimetres."),
    FRONT_EMPTY("No person was found in the front photo."),
    SIDE_EMPTY("No person was found in the side photo."),
    FRONT_CROPPED("Your head or feet are cut off in the front photo. Step back until your whole body fits."),
    SIDE_CROPPED("Your head or feet are cut off in the side photo. Step back until your whole body fits."),
    BODY_TOO_SMALL("You are too far from the camera. Step closer so your body fills more of the photo."),
    LEVELS_UNREADABLE("The outline could not be read at every body level. Retake the photos against a plain background."),
}

/** A value, or a [Refusal] with a sentence explaining it. */
sealed interface Checked<out T> {
    data class Ok<T>(val value: T) : Checked<T>
    data class Refused(val reason: Refusal, val detail: String) : Checked<Nothing>
}
