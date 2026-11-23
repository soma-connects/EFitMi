package app.efitmi.core

import kotlin.math.max
import kotlin.math.roundToInt

enum class View { FRONT, SIDE }

/**
 * One cleaned photo of the person: a single connected body that fits
 * entirely inside the frame, with known top and bottom rows.
 *
 * The scale of the photo comes from here. The person types their height;
 * the rows between the top of the head and the soles are that height; so
 * `height / rows` is centimetres per pixel.
 *
 * Each view is scaled on its own. In BodyM, the front and side photos of
 * one photo id differ in scale by a median of about 5% and by 11% at the
 * 90th percentile, and from photo to photo the pixels per centimetre vary by
 * 6-10% (std / mean). Any single shared or assumed scale would put that
 * straight into every result.
 */
class Silhouette private constructor(
    val mask: Mask,
    /** First row containing the person (top of the head). */
    val top: Int,
    /** Last row containing the person (soles of the feet). */
    val bottom: Int,
) {
    /** Rows from head to soles, inclusive. */
    val heightPx: Int get() = bottom - top + 1

    /** Narrowest stretch of person pixels that counts as a body part, in pixels. */
    val minRunPx: Int = max(1, (MIN_RUN_FRACTION * heightPx).roundToInt())

    fun cmPerPx(heightCm: Double): Double = heightCm / heightPx

    companion object {
        /**
         * Below this many rows the top and bottom edges can't pin the scale:
         * one pixel of edge error at 200 rows is 0.5% of stature (about
         * 0.9 cm), and it shows up in every centimetre computed from it.
         */
        const val MIN_BODY_PX = 200

        /** A stretch must be at least this fraction of the body height to count (about 0.7 cm). */
        const val MIN_RUN_FRACTION = 0.004

        fun from(raw: Mask, view: View): Checked<Silhouette> {
            val mask = raw.largestComponent()
            val rows = mask.rowSpan() ?: return Checked.Refused(
                if (view == View.FRONT) Refusal.FRONT_EMPTY else Refusal.SIDE_EMPTY,
                "The ${view.name.lowercase()} mask has no person pixels.",
            )
            if (mask.touchesBorder()) return Checked.Refused(
                if (view == View.FRONT) Refusal.FRONT_CROPPED else Refusal.SIDE_CROPPED,
                "The body touches the edge of the ${view.name.lowercase()} photo, so its true " +
                    "top-to-toe height (the scale) cannot be read.",
            )
            if (rows.count() < MIN_BODY_PX) return Checked.Refused(
                Refusal.BODY_TOO_SMALL,
                "The body is ${rows.count()} rows tall in the ${view.name.lowercase()} photo; " +
                    "at least $MIN_BODY_PX are needed to pin the scale.",
            )
            return Checked.Ok(Silhouette(mask, rows.first, rows.last))
        }
    }
}
