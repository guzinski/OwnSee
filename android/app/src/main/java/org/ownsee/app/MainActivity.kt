package org.ownsee.app

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import org.ownsee.app.ui.App
import org.ownsee.app.ui.OwnSeeTheme

class MainActivity : ComponentActivity() {
    /** An ownsee://pair link the app was opened with (QR scanned by another app, or adb). */
    private var pairingLink by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        Tls.install(this) // no-op until paired
        pairingLink = pairingLinkOf(intent)
        // The UI is always light, so bar icons stay dark even in system dark mode.
        val bars = SystemBarStyle.light(Color.TRANSPARENT, Color.TRANSPARENT)
        enableEdgeToEdge(statusBarStyle = bars, navigationBarStyle = bars)
        setContent {
            OwnSeeTheme {
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
