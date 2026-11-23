package app.efitmi.core

import kotlin.math.roundToInt

/**
 * A body whose true dimensions are known exactly, drawn as front and side masks.
 *
 * The torso is an ellipse-shaped stack: [torsoWidthCm] wide from the front,
 * [torsoDepthCm] deep from the side. If the measuring code is right it must
 * hand those numbers back, whatever the picture's size or scale.
 *
 * Levels (as fractions of stature above the floor): legs below 0.47, torso
 * 0.47-0.80, shoulders 0.80-0.83, head and neck above.
 */
class SyntheticBody(
    val heightCm: Double = 172.0,
    val torsoWidthCm: Double = 32.0,
    val torsoDepthCm: Double = 22.0,
    /** Arms held away from the torso, joined to it only at the shoulders. */
    val withArms: Boolean = false,
) {
    private fun frontIntervals(level: Double): List<ClosedFloatingPointRange<Double>> {
        val f = level / heightCm
        val half = torsoWidthCm / 2
        val out = ArrayList<ClosedFloatingPointRange<Double>>()
        when {
            f < 0.47 -> { out += -15.0..-3.0; out += 3.0..15.0 } // two legs, 6 cm apart
            f < 0.80 -> out += -half..half
            f < 0.83 -> out += -22.0..22.0
            else -> out += -7.0..7.0
        }
        if (withArms && f >= 0.45 && f < 0.83) {
            if (f < 0.80) {
                // detached: a 6 cm gap between torso edge and arm
                out += -(half + 14)..-(half + 6)
                out += (half + 6)..(half + 14)
            } else {
                // joined to the shoulders
                out += -30.0..-20.0
                out += 20.0..30.0
            }
        }
        return out
    }

    private fun sideIntervals(level: Double): List<ClosedFloatingPointRange<Double>> {
        val f = level / heightCm
        return when {
            level < 5 -> listOf(-5.0..20.0)           // foot
            f < 0.47 -> listOf(-7.0..7.0)             // legs
            f < 0.80 -> listOf(-torsoDepthCm / 2..torsoDepthCm / 2)
            f < 0.83 -> listOf(-10.0..10.0)
            else -> listOf(-9.0..9.0)
        }
    }

    fun front(
        pxPerCm: Double = 4.8,
        marginPx: Int = 40,
        strayBlob: Boolean = false,
    ): Mask = render(pxPerCm, marginPx, strayBlob, ::frontIntervals)

    fun side(
        pxPerCm: Double = 4.8,
        marginPx: Int = 40,
        strayBlob: Boolean = false,
    ): Mask = render(pxPerCm, marginPx, strayBlob, ::sideIntervals)

    private fun render(
        pxPerCm: Double,
        marginPx: Int,
        strayBlob: Boolean,
        intervals: (Double) -> List<ClosedFloatingPointRange<Double>>,
    ): Mask {
        val heightPx = (heightCm * pxPerCm).roundToInt()
        val imgH = heightPx + 2 * marginPx
        val imgW = (150.0 * pxPerCm).roundToInt()
        val bits = BooleanArray(imgW * imgH)
        val bottomRow = imgH - 1 - marginPx
        val topRow = bottomRow - heightPx + 1
        val cmPerPx = heightCm / heightPx
        val cx = imgW / 2.0

        for (y in topRow..bottomRow) {
            val level = (bottomRow - y) * cmPerPx // the same convention the core reads with
            for (iv in intervals(level)) {
                for (x in 0 until imgW) {
                    val c = (x + 0.5 - cx) * cmPerPx
                    if (c >= iv.start && c <= iv.endInclusive) bits[y * imgW + x] = true
                }
            }
        }
        if (strayBlob) {
            // A shoe-like piece detached from the body and BELOW the soles.
            // If it were counted, it would stretch the body's height.
            val blobTop = bottomRow + (marginPx / 4)
            for (y in blobTop until minOf(blobTop + marginPx / 2, imgH - 1)) {
                for (x in imgW - 60 until imgW - 20) bits[y * imgW + x] = true
            }
        }
        return Mask(imgW, imgH, bits)
    }
}
