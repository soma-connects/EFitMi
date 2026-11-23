package app.efitmi.validation

import app.efitmi.core.Mask
import java.io.File
import javax.imageio.ImageIO

/** One person in BodyM, with the numbers taken from their 3D body scan. */
class Subject(
    val id: String,
    /** The height in hwg_metadata.csv: the stand-in for "the height the user types". */
    val typedHeightCm: Double,
    /** The height measured off the scan. Used only to show what a perfect height would change. */
    val scanHeightCm: Double,
    val measurements: Map<String, Double>,
)

class Photo(val id: String, val subjectId: String)

/**
 * Which subjects of a split to use. Photos are split by SUBJECT, never by
 * photo, because several photos of one person share silhouettes and would
 * leak between fitting and scoring.
 */
enum class SubjectFilter {
    ALL, EVEN, ODD;

    fun accepts(subjectId: String): Boolean = when (this) {
        ALL -> true
        EVEN -> subjectId.hashCode() and 1 == 0
        ODD -> subjectId.hashCode() and 1 == 1
    }
}

/**
 * One BodyM split (train, testA or testB), laid out as tools/fetch-bodym.sh writes it.
 *
 * `mask/` holds the front silhouettes and `mask_left/` the side ones; a photo
 * id names a front and a side silhouette taken together.
 */
class Split(val name: String, private val dir: File, val subjects: Map<String, Subject>, val photos: List<Photo>) {

    fun frontMask(photoId: String): Mask = readMask(File(dir, "mask/$photoId.png"))
    fun sideMask(photoId: String): Mask = readMask(File(dir, "mask_left/$photoId.png"))

    private fun readMask(file: File): Mask {
        val image = ImageIO.read(file) ?: error("cannot decode ${file.path}")
        val w = image.width
        val h = image.height
        val grey = IntArray(w * h)
        image.raster.getSamples(0, 0, w, h, 0, grey)
        return Mask.fromGrey(w, h, grey)
    }

    companion object {
        fun load(root: File, name: String): Split {
            val dir = File(root, name)
            require(File(dir, "measurements.csv").exists()) {
                "No BodyM data in ${dir.path}. Run tools/fetch-bodym.sh first."
            }
            val meta = readCsv(File(dir, "hwg_metadata.csv")).associateBy { it.getValue("subject_id") }
            val subjects = readCsv(File(dir, "measurements.csv")).associate { row ->
                val id = row.getValue("subject_id")
                id to Subject(
                    id = id,
                    typedHeightCm = meta.getValue(id).getValue("height_cm").toDouble(),
                    scanHeightCm = row.getValue("height").toDouble(),
                    measurements = row.filterKeys { it != "subject_id" }.mapValues { it.value.toDouble() },
                )
            }
            val photos = readCsv(File(dir, "subject_to_photo_map.csv"))
                .map { Photo(it.getValue("photo_id"), it.getValue("subject_id")) }
            return Split(name, dir, subjects, photos)
        }

        private fun readCsv(file: File): List<Map<String, String>> {
            val lines = file.readLines().filter { it.isNotBlank() }
            val header = lines.first().trim().split(',')
            return lines.drop(1).map { line ->
                val cells = line.trim().split(',')
                require(cells.size == header.size) { "${file.name}: bad row: $line" }
                header.zip(cells).toMap()
            }
        }
    }
}
