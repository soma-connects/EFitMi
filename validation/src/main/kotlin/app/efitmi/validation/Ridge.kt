package app.efitmi.validation

import kotlin.math.abs
import kotlin.math.sqrt

/** A fitted line: `intercept + sum(weights[i] * x[i])`, in the original (unstandardised) units. */
class LinearFit(val intercept: Double, val weights: DoubleArray) {
    fun predict(x: DoubleArray): Double {
        var y = intercept
        for (i in x.indices) y += weights[i] * x[i]
        return y
    }
}

/**
 * Ridge regression: least squares with a penalty [alpha] on the size of the
 * weights.
 *
 * The 47 ellipse perimeters (one per body level) are almost the same number
 * repeated: the perimeter at 0.60 of stature is nearly the perimeter at
 * 0.61. Plain least squares then splits the credit between neighbours
 * arbitrarily, giving huge opposite-signed weights that fit noise. The
 * penalty keeps the weights small and smooth, and the held-out error says
 * whether that was enough.
 */
object Ridge {
    fun fit(x: List<DoubleArray>, y: DoubleArray, alpha: Double): LinearFit {
        val n = x.size
        val p = x.first().size
        val mean = DoubleArray(p)
        val sd = DoubleArray(p)
        for (row in x) for (j in 0 until p) mean[j] += row[j]
        for (j in 0 until p) mean[j] /= n
        for (row in x) for (j in 0 until p) sd[j] += (row[j] - mean[j]) * (row[j] - mean[j])
        for (j in 0 until p) sd[j] = sqrt(sd[j] / n) + 1e-9
        val yMean = y.average()

        // Normal equations on standardised inputs: (Z'Z + alpha I) w = Z'(y - mean y)
        val a = Array(p) { DoubleArray(p) }
        val b = DoubleArray(p)
        val z = DoubleArray(p)
        for (r in 0 until n) {
            for (j in 0 until p) z[j] = (x[r][j] - mean[j]) / sd[j]
            val yc = y[r] - yMean
            for (j in 0 until p) {
                b[j] += z[j] * yc
                for (k in j until p) a[j][k] += z[j] * z[k]
            }
        }
        for (j in 0 until p) {
            for (k in 0 until j) a[j][k] = a[k][j]
            a[j][j] += alpha
        }
        val wStd = solveSpd(a, b)

        // Fold the standardisation back in so the model reads raw perimeters.
        val w = DoubleArray(p) { wStd[it] / sd[it] }
        var intercept = yMean
        for (j in 0 until p) intercept -= w[j] * mean[j]
        return LinearFit(intercept, w)
    }

    /**
     * Picks alpha by [folds]-fold cross-validation grouped by subject, so no
     * person is ever in both the fitting and the checking half.
     */
    fun chooseAlpha(
        x: List<DoubleArray>,
        y: DoubleArray,
        subjectIds: List<String>,
        alphas: List<Double> = listOf(1.0, 3.0, 10.0, 30.0, 100.0, 300.0, 1000.0, 3000.0),
        folds: Int = 5,
    ): Pair<Double, Double> {
        val order = subjectIds.distinct().sorted().shuffled(java.util.Random(0))
        val foldOf = order.withIndex().associate { (i, id) -> id to i % folds }
        val fold = IntArray(x.size) { foldOf.getValue(subjectIds[it]) }
        var best = alphas.first() to Double.POSITIVE_INFINITY
        for (alpha in alphas) {
            var sum = 0.0
            for (k in 0 until folds) {
                val trainIdx = x.indices.filter { fold[it] != k }
                val testIdx = x.indices.filter { fold[it] == k }
                val fit = fit(trainIdx.map { x[it] }, DoubleArray(trainIdx.size) { y[trainIdx[it]] }, alpha)
                for (i in testIdx) sum += abs(fit.predict(x[i]) - y[i])
            }
            val mae = sum / x.size
            if (mae < best.second) best = alpha to mae
        }
        return best
    }

    /** Solves A w = b for symmetric positive-definite A by Cholesky factorisation. */
    private fun solveSpd(a: Array<DoubleArray>, b: DoubleArray): DoubleArray {
        val n = b.size
        val l = Array(n) { DoubleArray(n) }
        for (i in 0 until n) {
            for (j in 0..i) {
                var s = a[i][j]
                for (k in 0 until j) s -= l[i][k] * l[j][k]
                if (i == j) {
                    check(s > 0) { "matrix is not positive definite; raise alpha" }
                    l[i][i] = sqrt(s)
                } else {
                    l[i][j] = s / l[j][j]
                }
            }
        }
        val y = DoubleArray(n)
        for (i in 0 until n) {
            var s = b[i]
            for (k in 0 until i) s -= l[i][k] * y[k]
            y[i] = s / l[i][i]
        }
        val w = DoubleArray(n)
        for (i in n - 1 downTo 0) {
            var s = y[i]
            for (k in i + 1 until n) s -= l[k][i] * w[k]
            w[i] = s / l[i][i]
        }
        return w
    }
}
