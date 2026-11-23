package app.efitmi.core

import kotlin.test.Test
import kotlin.test.assertContentEquals
import kotlin.test.assertEquals
import kotlin.test.assertIs

class MeasurerTest {
    private val fractions = LevelProfile.DEFAULT_FRACTIONS

    /** A model whose single girth is just the average ellipse perimeter: easy to predict by hand. */
    private val averaging = GirthModel(
        levelFractions = fractions,
        validatedHeightCm = 140.0..198.0,
        targets = listOf(
            GirthTarget("mean-perimeter", 0.0, DoubleArray(fractions.size) { 1.0 / fractions.size }, 2.0, 5.0),
        ),
        provenance = "test",
    )

    @Test
    fun `girth is the model applied to the profile, with its recorded error attached`() {
        val body = SyntheticBody()
        val result = Measurer(averaging).measure(body.front(), body.side(), body.heightCm)
        assertIs<Checked.Ok<Measurement>>(result)
        val m = result.value
        val g = m.girths.single()
        assertEquals(m.profile.perimeterCm.average(), g.cm, 1e-9)
        assertEquals(2.0, g.typicalErrorCm)
        assertEquals(5.0, g.rareErrorCm)
    }

    @Test
    fun `refuses heights outside the range the model was validated on`() {
        val body = SyntheticBody()
        for (h in listOf(120.0, 139.9, 198.1, 230.0, Double.NaN)) {
            val r = Measurer(averaging).measure(body.front(), body.side(), h)
            assertIs<Checked.Refused>(r, "height $h should be refused")
            assertEquals(Refusal.HEIGHT_OUT_OF_RANGE, r.reason)
        }
    }

    @Test
    fun `passes photo refusals through unchanged`() {
        val body = SyntheticBody()
        val r = Measurer(averaging).measure(body.front(marginPx = 0), body.side(), body.heightCm)
        assertIs<Checked.Refused>(r)
        assertEquals(Refusal.FRONT_CROPPED, r.reason)
    }

    @Test
    fun `the bundled model loads and states its own evidence`() {
        val model = GirthModel.bundled()
        assertEquals(listOf("chest", "waist", "hip"), model.targets.map { it.name })
        assertEquals(LevelProfile.DEFAULT_FRACTIONS.size, model.levelFractions.size)
        // A shipped model must say how far to trust it, and where that came from.
        for (t in model.targets) {
            assert(t.heldOutMaeCm > 0.0 && t.heldOutP90Cm >= t.heldOutMaeCm) { "${t.name}: error figures missing" }
        }
        assert(model.provenance.contains("BodyM")) { "provenance must name the data it was fitted on" }
        assert(model.validatedHeightCm.start in 100.0..200.0 && model.validatedHeightCm.endInclusive in 150.0..230.0)
    }

    @Test
    fun `model file text round-trips exactly`() {
        val model = GirthModel(
            levelFractions = doubleArrayOf(0.5, 0.6, 0.7),
            validatedHeightCm = 141.5..197.25,
            targets = listOf(
                GirthTarget("chest", 12.5, doubleArrayOf(0.1, -0.2, 0.3), 2.8, 5.8),
                GirthTarget("waist", -3.0, doubleArrayOf(0.0, 0.5, 0.25), 3.2, 6.8),
            ),
            provenance = "unit test",
        )
        val back = GirthModel.parse(model.toText())
        assertContentEquals(model.levelFractions, back.levelFractions)
        assertEquals(model.validatedHeightCm, back.validatedHeightCm)
        assertEquals(model.provenance, back.provenance)
        assertEquals(2, back.targets.size)
        for ((a, b) in model.targets.zip(back.targets)) {
            assertEquals(a.name, b.name)
            assertEquals(a.intercept, b.intercept)
            assertContentEquals(a.weights, b.weights)
            assertEquals(a.heldOutMaeCm, b.heldOutMaeCm)
            assertEquals(a.heldOutP90Cm, b.heldOutP90Cm)
        }
    }
}
