package org.ownsee.app.ui

import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.graphics.vector.addPathNodes
import androidx.compose.ui.unit.dp

/** The app's few icons, as 24-unit SVG paths (no icon library needed). */
object Icons {
    private fun stroke(name: String, vararg paths: String): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f).apply {
            paths.forEach {
                addPath(
                    addPathNodes(it),
                    stroke = SolidColor(Color.Black),
                    strokeLineWidth = 2f,
                    strokeLineCap = StrokeCap.Round,
                    strokeLineJoin = StrokeJoin.Round,
                )
            }
        }.build()

    private fun filled(name: String, path: String): ImageVector =
        ImageVector.Builder(name, 24.dp, 24.dp, 24f, 24f)
            .apply { addPath(addPathNodes(path), fill = SolidColor(Color.Black)) }
            .build()

    val Back = stroke("back", "M15 5l-7 7 7 7")
    val Camera = stroke(
        "camera",
        "M5 7h14a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2z",
        "M15.5 13.5a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0z",
        "M8 7l2-3h4l2 3",
    )
    val Download = stroke("download", "M12 4v11", "M7 11l5 5 5-5", "M4 20h16")
    val FullScreen = stroke("fullscreen", "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5")
    val Settings = stroke(
        "settings",
        "M4 7h9M19 7h1M4 17h1M11 17h9",
        "M18.5 7a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z",
        "M10.5 17a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z",
    )
    val Pause = filled("pause", "M6 4h4v16H6zM14 4h4v16h-4z")
    val Play = filled("play", "M7 4l13 8-13 8z")
}
