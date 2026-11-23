package app.efitmi.core

/**
 * A black-and-white picture of a person: `true` where the person is.
 *
 * Row-major, with (0, 0) at the top left. This is the only image type the
 * measurement code ever sees. Where the mask comes from (a segmentation
 * model on the phone, a dataset file in the validation tool) is not its
 * concern, which is what lets the same code run in both places.
 */
class Mask(val width: Int, val height: Int, private val bits: BooleanArray) {
    init {
        require(width > 0 && height > 0) { "mask must be at least 1x1, got ${width}x$height" }
        require(bits.size == width * height) { "mask is ${width}x$height but holds ${bits.size} pixels" }
    }

    operator fun get(x: Int, y: Int): Boolean = bits[y * width + x]

    fun isEmpty(): Boolean = bits.none { it }

    /** True if any person pixel sits on the outermost row or column. */
    fun touchesBorder(): Boolean {
        for (x in 0 until width) if (this[x, 0] || this[x, height - 1]) return true
        for (y in 0 until height) if (this[0, y] || this[width - 1, y]) return true
        return false
    }

    /** First and last row that contains any person pixel, or null if empty. */
    fun rowSpan(): IntRange? {
        var first = -1
        var last = -1
        for (y in 0 until height) {
            var any = false
            for (x in 0 until width) if (this[x, y]) { any = true; break }
            if (any) {
                if (first < 0) first = y
                last = y
            }
        }
        return if (first < 0) null else first..last
    }

    /**
     * The person pixels of row [y] as maximal horizontal stretches, dropping
     * any stretch narrower than [minLength] (single-pixel specks along a
     * ragged edge are not body parts).
     */
    fun runs(y: Int, minLength: Int): List<IntRange> {
        val out = ArrayList<IntRange>(4)
        var x = 0
        while (x < width) {
            if (!this[x, y]) { x++; continue }
            val start = x
            while (x < width && this[x, y]) x++
            if (x - start >= minLength) out.add(start until x)
        }
        return out
    }

    /**
     * Keeps only the largest 4-connected piece.
     *
     * Segmentation masks routinely carry stray pieces: a shoe detached from
     * the leg, a bit of background mistaken for person. 20-30% of the side
     * masks in BodyM have one. Left in, they stretch the top-to-toe height
     * that every centimetre in the result is scaled from.
     */
    fun largestComponent(): Mask {
        val n = width * height
        val label = IntArray(n) // 0 = not yet visited
        val stack = IntArray(n) // each pixel is pushed at most once, so n is enough
        var bestLabel = 0
        var bestSize = 0
        var nextLabel = 0

        for (start in 0 until n) {
            if (!bits[start] || label[start] != 0) continue
            nextLabel++
            var sp = 0
            stack[sp++] = start
            label[start] = nextLabel
            var size = 0
            while (sp > 0) {
                val p = stack[--sp]
                size++
                val x = p % width
                val y = p / width
                if (x > 0 && bits[p - 1] && label[p - 1] == 0) { label[p - 1] = nextLabel; stack[sp++] = p - 1 }
                if (x < width - 1 && bits[p + 1] && label[p + 1] == 0) { label[p + 1] = nextLabel; stack[sp++] = p + 1 }
                if (y > 0 && bits[p - width] && label[p - width] == 0) { label[p - width] = nextLabel; stack[sp++] = p - width }
                if (y < height - 1 && bits[p + width] && label[p + width] == 0) { label[p + width] = nextLabel; stack[sp++] = p + width }
            }
            if (size > bestSize) { bestSize = size; bestLabel = nextLabel }
        }
        if (bestLabel == 0) return this
        return Mask(width, height, BooleanArray(n) { label[it] == bestLabel })
    }

    companion object {
        /** Builds a mask from 8-bit grey values; anything brighter than [threshold] is person. */
        fun fromGrey(width: Int, height: Int, grey: IntArray, threshold: Int = 127): Mask =
            Mask(width, height, BooleanArray(grey.size) { grey[it] > threshold })
    }
}
