package app.efitmi.core

/**
 * One reported girth, with the evidence for how far to trust it.
 *
 * [typicalErrorCm] and [rareErrorCm] are not guesses and not a property of
 * this person: they are the mean and 90th-percentile absolute errors that the
 * model made on photos it was never fitted to, read from the model file.
 */
data class Girth(
    val name: String,
    val cm: Double,
    /** Mean absolute error on held-out photos. */
    val typicalErrorCm: Double,
    /** 90th-percentile absolute error on held-out photos. */
    val rareErrorCm: Double,
)

/** Weights that turn the ellipse perimeters of a [LevelProfile] into one girth. */
class GirthTarget(
    val name: String,
    val intercept: Double,
    val weights: DoubleArray,
    val heldOutMaeCm: Double,
    val heldOutP90Cm: Double,
)

/**
 * A fitted model: for each girth, a weighted sum of the ellipse perimeters
 * at the sampled levels.
 *
 * Plain linear regression, deliberately. It has no hidden state and one set
 * of numbers that can be read in the model file. It is also the one place
 * this app uses fitted constants, so the file records what they were fitted
 * on and what error they showed on data they hadn't seen.
 */
class GirthModel(
    val levelFractions: DoubleArray,
    /** Heights present in the fitting data. Outside this, accuracy is unknown, so we refuse. */
    val validatedHeightCm: ClosedFloatingPointRange<Double>,
    val targets: List<GirthTarget>,
    val provenance: String,
) {
    init {
        for (t in targets) {
            require(t.weights.size == levelFractions.size) {
                "target ${t.name} has ${t.weights.size} weights for ${levelFractions.size} levels"
            }
        }
    }

    fun predict(perimetersCm: DoubleArray): List<Girth> {
        require(perimetersCm.size == levelFractions.size) {
            "got ${perimetersCm.size} perimeters for ${levelFractions.size} levels"
        }
        return targets.map { t ->
            var cm = t.intercept
            for (i in perimetersCm.indices) cm += t.weights[i] * perimetersCm[i]
            Girth(t.name, cm, t.heldOutMaeCm, t.heldOutP90Cm)
        }
    }

    fun toText(): String = buildString {
        appendLine("efitmi-girth-model 1")
        appendLine("provenance=$provenance")
        appendLine("height_min_cm=${validatedHeightCm.start}")
        appendLine("height_max_cm=${validatedHeightCm.endInclusive}")
        appendLine("levels=${levelFractions.joinToString(",")}")
        for (t in targets) {
            appendLine("target=${t.name}")
            appendLine("intercept=${t.intercept}")
            appendLine("weights=${t.weights.joinToString(",")}")
            appendLine("held_out_mae_cm=${t.heldOutMaeCm}")
            appendLine("held_out_p90_cm=${t.heldOutP90Cm}")
        }
    }

    companion object {
        private const val RESOURCE = "/app/efitmi/core/girth-model.txt"

        /** The model shipped with the app. */
        fun bundled(): GirthModel {
            val stream = GirthModel::class.java.getResourceAsStream(RESOURCE)
                ?: error("girth-model.txt is missing; run `./gradlew :validation:run --args=train` to create it")
            return parse(stream.bufferedReader().readText())
        }

        fun parse(text: String): GirthModel {
            val lines = text.lines().map { it.trim() }.filter { it.isNotEmpty() && !it.startsWith("#") }
            require(lines.firstOrNull() == "efitmi-girth-model 1") { "not an efitmi girth model file" }

            fun kv(line: String): Pair<String, String> {
                val i = line.indexOf('=')
                require(i > 0) { "expected key=value, got: $line" }
                return line.substring(0, i) to line.substring(i + 1)
            }
            fun doubles(s: String) = s.split(',').map { it.trim().toDouble() }.toDoubleArray()

            var provenance = ""
            var hMin = Double.NaN
            var hMax = Double.NaN
            var levels = DoubleArray(0)
            val targets = ArrayList<GirthTarget>()
            var name: String? = null
            var intercept = Double.NaN
            var weights = DoubleArray(0)
            var mae = Double.NaN
            var p90 = Double.NaN

            fun flush() {
                val n = name ?: return
                targets.add(GirthTarget(n, intercept, weights, mae, p90))
                name = null
            }

            for (line in lines.drop(1)) {
                val (k, v) = kv(line)
                when (k) {
                    "provenance" -> provenance = v
                    "height_min_cm" -> hMin = v.toDouble()
                    "height_max_cm" -> hMax = v.toDouble()
                    "levels" -> levels = doubles(v)
                    "target" -> { flush(); name = v }
                    "intercept" -> intercept = v.toDouble()
                    "weights" -> weights = doubles(v)
                    "held_out_mae_cm" -> mae = v.toDouble()
                    "held_out_p90_cm" -> p90 = v.toDouble()
                    else -> error("unknown key in girth model: $k")
                }
            }
            flush()
            require(hMin.isFinite() && hMax.isFinite()) { "model file has no validated height range" }
            return GirthModel(levels, hMin..hMax, targets, provenance)
        }
    }
}
