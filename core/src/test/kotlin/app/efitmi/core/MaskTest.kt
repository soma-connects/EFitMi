package app.efitmi.core

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MaskTest {
    private fun mask(vararg rows: String): Mask {
        val h = rows.size
        val w = rows[0].length
        return Mask(w, h, BooleanArray(w * h) { rows[it / w][it % w] == '#' })
    }

    @Test
    fun `largest component drops a detached piece`() {
        val m = mask(
            "#####....",
            "#####....",
            "#####..##",
            ".........",
        )
        val kept = m.largestComponent()
        assertTrue(kept[0, 0])
        assertFalse(kept[7, 2], "the small piece must be gone")
        assertEquals(15, (0 until 3).sumOf { y -> (0 until 9).count { x -> kept[x, y] } })
    }

    @Test
    fun `pieces touching only at a corner are separate`() {
        // 4-connectivity: a diagonal touch is not a connection.
        // Top-left piece: 4 px. Lower-right piece: 6 px. They touch only
        // diagonally, at (1,1)-(2,2).
        val m = mask(
            "##....",
            "##....",
            "..##..",
            "..####",
        )
        val kept = m.largestComponent()
        assertTrue(kept[2, 2], "the bigger piece (6 px) is kept")
        assertFalse(kept[0, 0], "the diagonal neighbour (4 px) is dropped")
    }

    @Test
    fun `runs ignore specks narrower than the minimum`() {
        val m = mask("#..###..##.")
        assertEquals(listOf(3..5, 8..9), m.runs(0, minLength = 2))
        assertEquals(listOf(3..5), m.runs(0, minLength = 3))
    }

    @Test
    fun `border contact is detected on every side`() {
        assertFalse(mask(".....", ".###.", ".....").touchesBorder())
        assertTrue(mask("#....", ".....", ".....").touchesBorder())
        assertTrue(mask(".....", ".....", "....#").touchesBorder())
        assertTrue(mask(".....", "#....", ".....").touchesBorder())
        assertTrue(mask(".....", "....#", ".....").touchesBorder())
    }

    @Test
    fun `row span of an empty mask is null`() {
        assertNull(mask("...", "...").rowSpan())
        assertEquals(1..2, mask("...", ".#.", ".#.", "...").rowSpan())
    }
}
