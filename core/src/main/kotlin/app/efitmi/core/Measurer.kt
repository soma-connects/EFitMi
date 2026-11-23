package app.efitmi.core

/** The outcome of a successful measurement: the girths, and the profile they came from. */
class Measurement(
    val girths: List<Girth>,
    /** Kept so the screen can show the person exactly what was read from their photos. */
    val profile: LevelProfile,
)

/**
 * The whole pipeline: two masks and a height in, girths out, or a [Refusal].
 *
 * Every input to the result is something the person supplied: the front
 * photo, the side photo and the height they typed. There is no default
 * height and no assumed body size to fall back on. If any input can't
 * support a measurement the answer is a refusal that says what to fix.
 *
 * The one thing that isn't theirs is the fitted [model]. Its constants
 * come from other people's measurements and the model file records the
 * error they showed on photos they were not fitted to.
 */
class Measurer(private val model: GirthModel = GirthModel.bundled()) {

    fun measure(front: Mask, side: Mask, heightCm: Double): Checked<Measurement> {
        if (!heightCm.isFinite() || heightCm !in model.validatedHeightCm) {
            return Checked.Refused(
                Refusal.HEIGHT_OUT_OF_RANGE,
                "Height $heightCm cm is outside ${model.validatedHeightCm.start}-" +
                    "${model.validatedHeightCm.endInclusive} cm, the range this model was " +
                    "validated on. Beyond it, accuracy is unknown.",
            )
        }
        val profile = when (val r = LevelProfile.build(front, side, heightCm, model.levelFractions)) {
            is Checked.Ok -> r.value
            is Checked.Refused -> return r
        }
        return Checked.Ok(Measurement(model.predict(profile.perimeterCm), profile))
    }
}
