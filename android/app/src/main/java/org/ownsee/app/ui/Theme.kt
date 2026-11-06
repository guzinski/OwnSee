package org.ownsee.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontVariation
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.ownsee.app.R

val Ground = Color(0xFFEEF1EA)
val Ink = Color(0xFF18282A)
val Muted = Color(0xFF47585A)
val Faint = Color(0xFF5E6E70)
val Cobalt = Color(0xFF2B45C8)
val CobaltTint = Color(0xFFC9D1F4)
val LiveGreen = Color(0xFF0B6B45)

private val Colors = lightColorScheme(
    primary = Cobalt,
    onPrimary = Color.White,
    background = Ground,
    onBackground = Ink,
    surface = Ground,
    onSurface = Ink,
    surfaceVariant = Color.White,
    onSurfaceVariant = Muted,
    outline = Faint,
)

// The fonts ship inside the app (licences in assets/licenses): downloadable
// fonts would mean a request to Google from every install.
private fun figtree(weight: Int) = Font(
    R.font.figtree,
    FontWeight(weight),
    variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
)

private fun bricolage(weight: Int) = Font(
    R.font.bricolage_grotesque,
    FontWeight(weight),
    variationSettings = FontVariation.Settings(FontVariation.weight(weight)),
)

val Body = FontFamily(figtree(400), figtree(500), figtree(600))
val Display = FontFamily(bricolage(600), bricolage(700))

private val Type = Typography().run {
    fun TextStyle.body() = copy(fontFamily = Body)
    copy(
        displayLarge = displayLarge.copy(fontFamily = Display),
        displayMedium = displayMedium.copy(fontFamily = Display),
        displaySmall = displaySmall.copy(fontFamily = Display),
        headlineLarge = TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 40.sp, lineHeight = 42.sp),
        headlineMedium = TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 34.sp, lineHeight = 38.sp),
        headlineSmall = TextStyle(fontFamily = Display, fontWeight = FontWeight.Bold, fontSize = 26.sp, lineHeight = 30.sp),
        titleLarge = titleLarge.body(),
        titleMedium = TextStyle(fontFamily = Body, fontWeight = FontWeight.SemiBold, fontSize = 18.sp, lineHeight = 24.sp),
        titleSmall = titleSmall.body(),
        bodyLarge = bodyLarge.body(),
        bodyMedium = TextStyle(fontFamily = Body, fontSize = 15.sp, lineHeight = 21.sp),
        bodySmall = TextStyle(fontFamily = Body, fontSize = 14.sp, lineHeight = 19.sp),
        labelLarge = labelLarge.body().copy(fontWeight = FontWeight.SemiBold),
        labelMedium = labelMedium.body(),
        labelSmall = labelSmall.body(),
    )
}

@Composable
fun OwnSeeTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = Colors, typography = Type, content = content)
}

/** White circular button that sits on top of video. */
@Composable
fun RoundIconButton(
    icon: ImageVector,
    label: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    size: Dp = 48.dp,
    enabled: Boolean = true,
) {
    Box(
        modifier
            .size(size)
            .alpha(if (enabled) 1f else 0.55f)
            .clip(CircleShape)
            .background(Color.White)
            .clickable(enabled = enabled, role = Role.Button, onClick = onClick),
        Alignment.Center,
    ) {
        Icon(icon, label, tint = Ink, modifier = Modifier.size(22.dp))
    }
}

/** A camera's name in a white pill, over its video. */
@Composable
fun NamePill(name: String, modifier: Modifier = Modifier) {
    Text(
        name,
        modifier
            .background(Color.White, RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 3.dp),
        style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
        color = Ink,
        maxLines = 1,
    )
}
