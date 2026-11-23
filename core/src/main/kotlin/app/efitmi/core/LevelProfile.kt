package app.efitmi.core

/**
 * What the two photos say about the body at a series of heights.
 *
 * For each level (a height above the floor) this holds the body's width from
 * the front photo, its depth from the side photo, and the perimeter of the
 * ellipse those two imply. The perimeters are what the girth model reads.
 *
 * All values are centimetres, converted with each photo's own scale.
 */
class LevelProfile(
    val levelsCm: DoubleArray,
    val frontWidthCm: DoubleArray,
    val sideDepthCm: DoubleArray,
    val perimeterCm: DoubleArray,
    val frontCmPerPx: Double,
    val sideCmPerPx: Double,
) {
    companion object {
        /**
         * Levels sampled, as fractions of stature above the floor: 0.40 to 0.86
         * in steps of 0.01. This spans from roughly the thighs to the
         * shoulders, which holds every girth the app reports.
         */
        val DEFAULT_FRACTIONS: DoubleArray = DoubleArray(47) { Math.round((0.40 + 0.01 * it) * 100) / 100.0 }

        /**
         * Measures both photos at [fractions] of [heightCm].
         *
         * Does not judge whether [heightCm] is sensible for the model; that is
         * the model's call (see [Measurer]). It only needs a positive number to scale by.
         */
        fun build(
            front: Mask,
            side: Mask,
            heightCm: Double,
            fractions: DoubleArray = DEFAULT_FRACTIONS,
        ): Checked<LevelProfile> {
            if (!heightCm.isFinite() || heightCm <= 0) {
                return Checked.Refused(Refusal.HEIGHT_OUT_OF_RANGE, "Height must be a positive number of centimetres.")
            }
            val f = when (val r = Silhouette.from(front, View.FRONT)) {
                is Checked.Ok -> r.value
                is Checked.Refused -> return r
            }
            val s = when (val r = Silhouette.from(side, View.SIDE)) {
                is Checked.Ok -> r.value
                is Checked.Refused -> return r
            }

            val fScale = f.cmPerPx(heightCm)
            val sScale = s.cmPerPx(heightCm)
            val widthsPx = Profiles.frontCentralWidthsPx(f)
            val depthsPx = Profiles.sideDepthsPx(s)

            val levels = DoubleArray(fractions.size) { fractions[it] * heightCm }
            val width = DoubleArray(levels.size) { Profiles.valueAtLevel(widthsPx, levels[it], fScale) * fScale }
            val depth = DoubleArray(levels.size) { Profiles.valueAtLevel(depthsPx, levels[it], sScale) * sScale }
            val perimeter = DoubleArray(levels.size) { ellipsePerimeter(width[it], depth[it]) }

            if (perimeter.any { !it.isFinite() }) {
                return Checked.Refused(
                    Refusal.LEVELS_UNREADABLE,
                    "No body outline at one or more of the ${levels.size} sampled levels.",
                )
            }
            return Checked.Ok(LevelProfile(levels, width, depth, perimeter, fScale, sScale))
        }
    }
}
