package app.efitmi.validation

import app.efitmi.core.Checked
import app.efitmi.core.GirthModel
import app.efitmi.core.GirthTarget
import app.efitmi.core.LevelProfile
import app.efitmi.core.Measurer
import app.efitmi.core.Refusal
import java.io.File
import kotlin.math.abs
import kotlin.math.ceil

/** The girths BodyM gives a tape-equivalent figure for, taken from the 3D scans. */
private val TARGETS = listOf("chest", "waist", "hip")

private val DATA_ROOT = File("data/bodym")
private val MODEL_FILE = File("core/src/main/resources/app/efitmi/core/girth-model.txt")
private val REPORT_FILE = File("docs/validation.md")

// ---------------------------------------------------------------------------
// Extraction: run the SAME core code the app uses over every photo.
// ---------------------------------------------------------------------------

private class Scored(val photoId: String, val subject: Subject, val perimeters: DoubleArray)

private class Extraction(val total: Int, val scored: List<Scored>, val refusals: Map<Refusal, Int>) {
    fun only(filter: SubjectFilter) = scored.filter { filter.accepts(it.subject.id) }
}

private fun extract(split: Split, heightOf: (Subject) -> Double): Extraction {
    val outcomes = split.photos.parallelStream().map { photo ->
        val subject = split.subjects.getValue(photo.subjectId)
        Triple(photo, subject, LevelProfile.build(split.frontMask(photo.id), split.sideMask(photo.id), heightOf(subject)))
    }.toList()
    val scored = ArrayList<Scored>()
    val refusals = HashMap<Refusal, Int>()
    for ((photo, subject, result) in outcomes) {
        when (result) {
            is Checked.Ok -> scored += Scored(photo.id, subject, result.value.perimeterCm)
            is Checked.Refused -> refusals.merge(result.reason, 1, Int::plus)
        }
    }
    return Extraction(split.photos.size, scored, refusals)
}

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

private class Row(val subject: Subject, val predicted: Map<String, Double>)

private class Stats(val photos: Int, val subjects: Int, val mae: Double, val bias: Double, val p90: Double)

private fun stats(rows: List<Row>, target: String): Stats {
    val errors = rows.map { it.predicted.getValue(target) - it.subject.measurements.getValue(target) }
    val abs = errors.map { abs(it) }.sorted()
    val p90 = abs[minOf(abs.size - 1, ceil(0.9 * abs.size).toInt() - 1)]
    return Stats(rows.size, rows.map { it.subject.id }.distinct().size, abs.average(), errors.average(), p90)
}

private fun fmt(d: Double) = "%.2f".format(d)

private fun table(title: String, sets: List<Pair<String, List<Row>>>): String = buildString {
    appendLine("**$title**")
    appendLine()
    appendLine("| set | photos | people | girth | mean abs error (cm) | bias (cm) | 90th pct error (cm) |")
    appendLine("|---|---:|---:|---|---:|---:|---:|")
    for ((name, rows) in sets) for (t in TARGETS) {
        val s = stats(rows, t)
        appendLine("| $name | ${s.photos} | ${s.subjects} | $t | ${fmt(s.mae)} | ${"%+.2f".format(s.bias)} | ${fmt(s.p90)} |")
    }
}

private fun refusalTable(extractions: Map<String, Extraction>): String = buildString {
    appendLine("| set | photos | read | refused | why |")
    appendLine("|---|---:|---:|---:|---|")
    for ((name, e) in extractions) {
        val refused = e.total - e.scored.size
        val why = e.refusals.entries.sortedByDescending { it.value }.joinToString(", ") { "${it.key.name.lowercase()} ${it.value}" }
        appendLine("| $name | ${e.total} | ${e.scored.size} | $refused (${100 * refused / e.total}%) | ${why.ifEmpty { "-" }} |")
    }
}

// ---------------------------------------------------------------------------
// train
// ---------------------------------------------------------------------------

private fun train(opts: Options) {
    val heightOf: (Subject) -> Double = if (opts.scanHeight) { s -> s.scanHeightCm } else { s -> s.typedHeightCm }
    val splits = listOf("train", "testA", "testB").associateWith { Split.load(DATA_ROOT, it) }
    val ex = splits.mapValues { (name, split) ->
        print("reading $name (${split.photos.size} photos)... ")
        extract(split, heightOf).also { println("${it.scored.size} read, ${it.total - it.scored.size} refused") }
    }

    // What the model is fitted on, and what it is scored on. The in-the-wild
    // set (testB) is split by person: with --with-b-half, half of its people
    // join the fit and only the other half is held out. Otherwise none of
    // testB is fitted and all of it is held out.
    val fitRows = ex.getValue("train").scored +
        if (opts.withBHalf) ex.getValue("testB").only(SubjectFilter.EVEN) else emptyList()
    val heldOutB = if (opts.withBHalf) ex.getValue("testB").only(SubjectFilter.ODD) else ex.getValue("testB").scored

    println("\nfitting on ${fitRows.size} photos from ${fitRows.map { it.subject.id }.distinct().size} people")
    val x = fitRows.map { it.perimeters }
    val ids = fitRows.map { it.subject.id }
    val fits = TARGETS.associateWith { t ->
        val y = DoubleArray(fitRows.size) { fitRows[it].subject.measurements.getValue(t) }
        val (alpha, cv) = Ridge.chooseAlpha(x, y, ids)
        println("  $t: alpha $alpha (cross-validated error inside the fit set: ${fmt(cv)} cm)")
        Ridge.fit(x, y, alpha) to alpha
    }

    fun rows(scored: List<Scored>) = scored.map { s ->
        Row(s.subject, TARGETS.associateWith { fits.getValue(it).first.predict(s.perimeters) })
    }
    val report = StringBuilder()
    report.appendLine(refusalTable(ex))
    report.appendLine(
        table(
            "Held-out error (the model never saw these people)",
            if (opts.withBHalf) {
                listOf(
                    "testA (lab photos)" to rows(ex.getValue("testA").scored),
                    "testB (in-the-wild photos, held-out half)" to rows(heldOutB),
                )
            } else {
                listOf(
                    "testA (lab photos)" to rows(ex.getValue("testA").scored),
                    "testB (in-the-wild photos)" to rows(heldOutB),
                )
            },
        ),
    )
    println("\n$report")

    if (opts.write) {
        val fractions = LevelProfile.DEFAULT_FRACTIONS
        val heights = fitRows.map { heightOf(it.subject) }
        val heldOutRows = rows(heldOutB)
        val targets = TARGETS.map { t ->
            val s = stats(heldOutRows, t)
            GirthTarget(t, fits.getValue(t).first.intercept, fits.getValue(t).first.weights, s.mae, s.p90)
        }
        val provenance = "BodyM (CC BY-NC 4.0). Fitted on ${if (opts.withBHalf) "train + half of testB" else "train"}: " +
            "${fitRows.size} photos from ${fitRows.map { it.subject.id }.distinct().size} people. " +
            "Ridge on the ellipse perimeter at ${fractions.size} body levels. " +
            "Scale from ${if (opts.scanHeight) "scan height (oracle)" else "typed height"}. " +
            "Stated errors are from testB held-out people (${heldOutRows.size} photos, " +
            "${heldOutRows.map { it.subject.id }.distinct().size} people)."
        val model = GirthModel(fractions, heights.min()..heights.max(), targets, provenance)
        MODEL_FILE.writeText(model.toText())
        println("wrote ${MODEL_FILE.path}")
    } else {
        println("(model file not written; pass --write to replace ${MODEL_FILE.path})")
    }
}

// ---------------------------------------------------------------------------
// report: the SHIPPED model, through the full Measurer
// ---------------------------------------------------------------------------

private fun report(opts: Options) {
    val model = GirthModel.bundled()
    val measurer = Measurer(model)
    val sets = ArrayList<Pair<String, List<Row>>>()
    val refusals = LinkedHashMap<String, Pair<Int, Map<Refusal, Int>>>()
    val read = LinkedHashMap<String, Int>()

    for (name in listOf("train", "testA", "testB")) {
        val split = Split.load(DATA_ROOT, name)
        val outcomes = split.photos.parallelStream().map { photo ->
            val subject = split.subjects.getValue(photo.subjectId)
            subject to measurer.measure(split.frontMask(photo.id), split.sideMask(photo.id), subject.typedHeightCm)
        }.toList()
        val rows = ArrayList<Row>()
        val why = HashMap<Refusal, Int>()
        for ((subject, r) in outcomes) when (r) {
            is Checked.Ok -> rows += Row(subject, r.value.girths.associate { it.name to it.cm })
            is Checked.Refused -> why.merge(r.reason, 1, Int::plus)
        }
        read[name] = rows.size
        refusals[name] = split.photos.size to why
        val halfFitted = "half of testB" in model.provenance
        sets += when (name) {
            "train" -> listOf("train (fitted on these)" to rows)
            "testA" -> listOf("testA (lab photos)" to rows)
            else -> if (halfFitted) {
                listOf("testB held-out half (in-the-wild photos)" to rows.filter { SubjectFilter.ODD.accepts(it.subject.id) })
            } else {
                listOf("testB (in-the-wild photos)" to rows)
            }
        }
        println("$name: ${rows.size}/${split.photos.size} photos read")
    }

    val md = buildString {
        appendLine("# Validation report")
        appendLine()
        appendLine("Generated by `./gradlew :validation:run --args=report`. It runs the shipped model")
        appendLine("(`core/src/main/resources/app/efitmi/core/girth-model.txt`) through `Measurer`,")
        appendLine("the same path the app uses, on the BodyM dataset.")
        appendLine()
        appendLine("> ${model.provenance}")
        appendLine()
        appendLine("## What was refused")
        appendLine()
        appendLine("| set | photos | read | refused | why |")
        appendLine("|---|---:|---:|---:|---|")
        for ((name, pair) in refusals) {
            val (total, why) = pair
            val refused = total - read.getValue(name)
            val reasons = why.entries.sortedByDescending { it.value }.joinToString(", ") { "${it.key.name.lowercase()} ${it.value}" }
            appendLine("| $name | $total | ${read.getValue(name)} | $refused (${100 * refused / total}%) | ${reasons.ifEmpty { "-" }} |")
        }
        appendLine()
        appendLine("## Error against the 3D-scan girths")
        appendLine()
        appendLine(table("Photos the model read", sets))
    }
    println("\n$md")
    if (opts.write) {
        REPORT_FILE.parentFile.mkdirs()
        REPORT_FILE.writeText(md)
        println("wrote ${REPORT_FILE.path}")
    }
}

// ---------------------------------------------------------------------------

private class Options(val withBHalf: Boolean, val scanHeight: Boolean, val write: Boolean)

fun main(args: Array<String>) {
    val opts = Options(
        withBHalf = "--with-b-half" in args,
        scanHeight = "--scan-height" in args,
        write = "--write" in args,
    )
    when (args.firstOrNull()) {
        "train" -> train(opts)
        "report" -> report(opts)
        else -> println(
            """
            usage: ./gradlew :validation:run --args="<command> [flags]"

              train    fit on training people, score on people the fit never saw
                         --with-b-half   also fit on half of testB's people
                         --scan-height   scale from the scan's height instead of the typed one
                         --write         replace the shipped model file
              report   score the shipped model end to end
                         --write         also write docs/validation.md
            """.trimIndent(),
        )
    }
}
