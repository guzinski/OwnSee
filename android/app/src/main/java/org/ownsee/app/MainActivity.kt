package org.ownsee.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.graphics.Color
import org.ownsee.app.ui.App

private val Colors = darkColorScheme(
    primary = Color(0xFF4DA3FF),
    onPrimary = Color(0xFF04121F),
    background = Color(0xFF0B0E13),
    surface = Color(0xFF151A22),
    surfaceVariant = Color(0xFF1D242E),
    onSurface = Color(0xFFE6EDF3),
    onSurfaceVariant = Color(0xFF8B98A9),
    outline = Color(0xFF273041),
)

class MainActivity : ComponentActivity() {
    /** An ownsee://pair link the app was opened with (QR scanned by another app, or adb). */
    private var pairingLink by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tls.install(this) // no-op until paired
        pairingLink = pairingLinkOf(intent)
        enableEdgeToEdge()
        setContent {
            MaterialTheme(colorScheme = Colors) {
                App(pairingLink = pairingLink, onPairingLinkHandled = { pairingLink = null })
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        pairingLinkOf(intent)?.let { pairingLink = it }
    }

    private fun pairingLinkOf(intent: Intent?): String? =
        intent?.dataString?.takeIf { it.startsWith("ownsee://pair") }
}
