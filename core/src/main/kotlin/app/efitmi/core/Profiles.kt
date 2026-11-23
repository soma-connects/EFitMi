package app.efitmi.core

import kotlin.math.PI
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sqrt

/**
 * Reading widths and depths off a silhouette, one value per pixel row.
 *
 * Every array here is indexed from the TOP of the head (index 0) and holds
 * pixels, or NaN where the row has nothing readable.
 */
internal object Profiles {
    /** The head is the top 8% of the body; its centre defines the vertical axis. */
    private const val HEAD_FRACTION = 0.08

    /**
     * Width of the body's own central part in each row of the FRONT photo.
     *
     * Arms are the reason this is not simply "leftmost to rightmost pixel".
     * Held away from the body, they would be counted as chest, waist and hip.
     * So in each row we take only the stretch of body the vertical axis passes
     * through. Below the armpits that is the torso, because the arms have
     * detached and sit apart from it.
     *
     * Where the axis passes through a gap instead (between the legs), we span
     * from the nearest stretch on the left to the nearest on the right: both
     * legs.
     */
    fun frontCentralWidthsPx(s: Silhouette): DoubleArray {
        val mask = s.mask
        val headRows = maxOf(3, (HEAD_FRACTION * s.heightPx).toInt())
        var sum = 0.0
        var count = 0
        for (y in s.top until min(s.top + headRows, s.bottom + 1)) {
            for (x in 0 until mask.width) if (mask[x, y]) { sum += x; count++ }
        }
        val axis = sum / count // the top row has person pixels, so count > 0

        return DoubleArray(s.heightPx) { i ->
            val runs = mask.runs(s.top + i, s.minRunPx)
            if (runs.isEmpty()) return@DoubleArray Double.NaN
            val through = runs.firstOrNull { axis >= it.first && axis <= it.last }
            val span = through ?: run {
                val left = runs.lastOrNull { it.last < axis }
                val right = runs.firstOrNull { it.first > axis }
                when {
                    left != null && right != null -> left.first..right.last
                    left != null -> left
                    else -> right!!
                }
            }
            (span.last - span.first + 1).toDouble()
        }
    }

    /**
     * Front-to-back depth in each row of the SIDE photo: the longest stretch
     * of body in the row, so a hand hanging apart from the hip is not added to it.
     */
    fun sideDepthsPx(s: Silhouette): DoubleArray = DoubleArray(s.heightPx) { i ->
        s.mask.runs(s.top + i, s.minRunPx).maxOfOrNull { it.last - it.first + 1 }?.toDouble()
            ?: Double.NaN
    }

    /**
     * The value at [levelCm] above the floor, interpolated between the two
     * nearest rows so the answer doesn't jump when the photo's resolution
     * changes. NaN if either row is unreadable or the level is off the body.
     */
    fun valueAtLevel(valuesPx: DoubleArray, levelCm: Double, cmPerPx: Double): Double {
        val last = valuesPx.size - 1
        val row = last - levelCm / cmPerPx
        if (row < 0.0 || row > last) return Double.NaN
        val lo = floor(row).toInt()
        val t = row - lo
        if (t == 0.0) return valuesPx[lo]
        return valuesPx[lo] * (1 - t) + valuesPx[min(lo + 1, last)] * t
    }
}

/**
 * Perimeter of an ellipse with full width [widthCm] and full depth [depthCm]
 * (Ramanujan's second approximation, accurate to a few parts per million for
 * body-like shapes).
 *
 * A girth is the length of a loop around the body. A front photo gives the
 * loop's width and a side photo gives its depth; treating the cross-section
 * as an ellipse is what turns those two numbers into a length. It is an
 * approximation, and its error is part of what the validation measures.
 */
fun ellipsePerimeter(widthCm: Double, depthCm: Double): Double {
    val a = widthCm / 2.0
    val b = depthCm / 2.0
    val h = (a - b) * (a - b) / ((a + b) * (a + b))
    return PI * (a + b) * (1 + 3 * h / (10 + sqrt(4 - 3 * h)))
}
