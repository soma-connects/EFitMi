package app.efitmi.core

import kotlin.math.abs
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class LevelProfileTest {
    private fun profile(front: Mask, side: Mask, heightCm: Double): LevelProfile {
        val r = LevelProfile.build(front, side, heightCm)
        assertIs<Checked.Ok<LevelProfile>>(r, "expected a profile but got $r")
        return r.value
    }

    private fun relDiff(a: Double, b: Double) = abs(a - b) / b

    /** Index of the level closest to [fraction] of stature. */
    private fun idx(fraction: Double) = LevelProfile.DEFAULT_FRACTIONS.indexOfFirst { abs(it - fraction) < 1e-9 }

    /**
     * Levels inside the torso (0.50-0.78 of stature), clear of the places
     * where the synthetic body changes shape in a hard step (0.47, 0.80,
     * 0.83). A step edge cannot agree to better than one pixel row between
     * two renderings, since each lands on a different side of it. Real bodies
     * are smooth, and these are the levels the girths are read from.
     */
    private val torsoLevels = LevelProfile.DEFAULT_FRACTIONS.indices
        .filter { LevelProfile.DEFAULT_FRACTIONS[it] in 0.50..0.78 }

    // ---- the ellipse itself --------------------------------------------

    @Test
    fun `ellipse perimeter matches known values`() {
        // A circle of diameter 20: 2*pi*10.
        assertEquals(62.8319, ellipsePerimeter(20.0, 20.0), 1e-3)
        // Semi-axes 5 and 3: the exact perimeter is 25.5270.
        assertEquals(25.5270, ellipsePerimeter(10.0, 6.0), 1e-3)
    }

    // ---- reading a body of known size ----------------------------------

    @Test
    fun `a torso of known width and depth is read back to within 1_5 percent`() {
        val body = SyntheticBody(heightCm = 172.0, torsoWidthCm = 32.0, torsoDepthCm = 22.0)
        val p = profile(body.front(), body.side(), body.heightCm)
        val expected = ellipsePerimeter(32.0, 22.0)
        for (fraction in listOf(0.50, 0.60, 0.70, 0.75)) {
            val i = idx(fraction)
            assertTrue(relDiff(p.frontWidthCm[i], 32.0) < 0.015, "width at $fraction: ${p.frontWidthCm[i]}")
            assertTrue(relDiff(p.sideDepthCm[i], 22.0) < 0.015, "depth at $fraction: ${p.sideDepthCm[i]}")
            assertTrue(relDiff(p.perimeterCm[i], expected) < 0.015, "perimeter at $fraction: ${p.perimeterCm[i]} vs $expected")
        }
    }

    // ---- the failure modes this project exists to avoid ----------------

    @Test
    fun `the same body photographed at two resolutions gives the same answer`() {
        val body = SyntheticBody()
        val lo = profile(body.front(4.8), body.side(4.8), body.heightCm)
        val hi = profile(body.front(9.6), body.side(9.6), body.heightCm)
        for (i in torsoLevels) {
            assertTrue(relDiff(lo.perimeterCm[i], hi.perimeterCm[i]) < 0.01, "level $i: ${lo.perimeterCm[i]} vs ${hi.perimeterCm[i]}")
        }
    }

    @Test
    fun `front and side photos at different scales still agree`() {
        // In BodyM the two views of one person differ in scale by 5-10%. Each
        // must be scaled from its own height; sharing one scale between them
        // would shrink or inflate every girth by that much.
        val body = SyntheticBody()
        val same = profile(body.front(4.8), body.side(4.8), body.heightCm)
        val mixed = profile(body.front(4.8), body.side(6.2), body.heightCm)
        for (i in torsoLevels) {
            assertTrue(relDiff(mixed.perimeterCm[i], same.perimeterCm[i]) < 0.01, "level $i: ${mixed.perimeterCm[i]} vs ${same.perimeterCm[i]}")
        }
    }

    @Test
    fun `arms held away from the torso are not counted as torso`() {
        val bare = SyntheticBody(withArms = false)
        val armed = SyntheticBody(withArms = true)
        val a = profile(bare.front(), bare.side(), 172.0)
        val b = profile(armed.front(), armed.side(), 172.0)
        for (fraction in listOf(0.50, 0.60, 0.70)) {
            val i = idx(fraction)
            assertTrue(relDiff(b.frontWidthCm[i], 32.0) < 0.015, "with arms, width at $fraction was ${b.frontWidthCm[i]} (torso is 32)")
            assertTrue(relDiff(b.perimeterCm[i], a.perimeterCm[i]) < 0.01)
        }
    }

    @Test
    fun `a stray piece below the feet does not change the answer`() {
        // The shoe blob seen in BodyM side masks. Counted, it would add rows to
        // the body's height and therefore change the scale of the whole photo.
        val body = SyntheticBody()
        val clean = profile(body.front(), body.side(), body.heightCm)
        val dirty = profile(body.front(strayBlob = true), body.side(strayBlob = true), body.heightCm)
        for (i in clean.perimeterCm.indices) {
            assertEquals(clean.perimeterCm[i], dirty.perimeterCm[i], 1e-9)
        }
    }

    @Test
    fun `height is the scale - a taller typed height scales every length by the same factor`() {
        val body = SyntheticBody()
        val at172 = profile(body.front(), body.side(), 172.0)
        val at189 = profile(body.front(), body.side(), 172.0 * 1.1)
        for (i in at172.perimeterCm.indices) {
            assertEquals(1.1, at189.perimeterCm[i] / at172.perimeterCm[i], 1e-9)
        }
    }

    // ---- refusing instead of guessing ----------------------------------

    @Test
    fun `refuses when the feet touch the edge of the front photo`() {
        val body = SyntheticBody()
        val r = LevelProfile.build(body.front(marginPx = 0), body.side(), body.heightCm)
        assertIs<Checked.Refused>(r)
        assertEquals(Refusal.FRONT_CROPPED, r.reason)
    }

    @Test
    fun `refuses when the feet touch the edge of the side photo`() {
        val body = SyntheticBody()
        val r = LevelProfile.build(body.front(), body.side(marginPx = 0), body.heightCm)
        assertIs<Checked.Refused>(r)
        assertEquals(Refusal.SIDE_CROPPED, r.reason)
    }

    @Test
    fun `refuses a body too small to pin the scale`() {
        val body = SyntheticBody()
        val r = LevelProfile.build(body.front(pxPerCm = 1.0), body.side(), body.heightCm)
        assertIs<Checked.Refused>(r)
        assertEquals(Refusal.BODY_TOO_SMALL, r.reason)
    }

    @Test
    fun `refuses an empty mask`() {
        val body = SyntheticBody()
        val empty = Mask(100, 100, BooleanArray(100 * 100))
        val r = LevelProfile.build(empty, body.side(), body.heightCm)
        assertIs<Checked.Refused>(r)
        assertEquals(Refusal.FRONT_EMPTY, r.reason)
    }

    @Test
    fun `refuses a height that is not a positive number`() {
        val body = SyntheticBody()
        for (bad in listOf(0.0, -5.0, Double.NaN, Double.POSITIVE_INFINITY)) {
            val r = LevelProfile.build(body.front(), body.side(), bad)
            assertIs<Checked.Refused>(r)
            assertEquals(Refusal.HEIGHT_OUT_OF_RANGE, r.reason)
        }
    }
}
