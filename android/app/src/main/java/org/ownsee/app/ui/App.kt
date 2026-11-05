package org.ownsee.app.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.ownsee.app.CameraInfo
import org.ownsee.app.HubAddress
import org.ownsee.app.HubClient
import org.ownsee.app.Route

/** Result of a background load, for screens that fetch from the hub. */
sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Ok<T>(val value: T) : Load<T>
    data class Err(val message: String) : Load<Nothing>
}

/** The hub as currently reached: which client, over which route. */
data class Connection(val hub: HubClient, val route: Route)

private sealed interface Screen {
    data object Setup : Screen
    data object Grid : Screen
    data class Viewer(val camera: CameraInfo) : Screen
}

/**
 * Top-level navigation. Three screens don't need a navigation library: the
 * current one is plain state, and the activity is never recreated on
 * rotation (see configChanges in the manifest), so it survives fullscreen.
 *
 * [pairingLink] is an ownsee://pair link the app was opened with, if any.
 */
@Composable
fun App(pairingLink: String?, onPairingLinkHandled: () -> Unit) {
    val ctx = LocalContext.current
    var configured by remember { mutableStateOf(HubAddress.isConfigured(ctx)) }
    var screen by remember { mutableStateOf<Screen>(if (configured) Screen.Grid else Screen.Setup) }
    var connection by remember { mutableStateOf<Load<Connection>>(Load.Loading) }
    var attempt by remember { mutableIntStateOf(0) }

    LaunchedEffect(configured, attempt) {
        if (!configured) return@LaunchedEffect
        connection = Load.Loading
        connection = runCatching { withContext(Dispatchers.IO) { HubAddress.resolve(ctx) } }
            .fold({ Load.Ok(Connection(it.first, it.second)) }, { Load.Err(it.message ?: it.javaClass.simpleName) })
    }
    LaunchedEffect(pairingLink) {
        if (pairingLink != null) screen = Screen.Setup
    }

    Surface(Modifier.fillMaxSize(), color = MaterialTheme.colorScheme.background) {
        when (val s = screen) {
            Screen.Setup -> SetupScreen(
                pairingLink = pairingLink,
                onPairingLinkHandled = onPairingLinkHandled,
                onDone = {
                    configured = true
                    attempt++
                    screen = Screen.Grid
                },
                onCancel = if (configured) ({ screen = Screen.Grid }) else null,
            )
            Screen.Grid -> GridScreen(
                connection = connection,
                onRetry = { attempt++ },
                onOpen = { screen = Screen.Viewer(it) },
                onSettings = { screen = Screen.Setup },
            )
            is Screen.Viewer -> (connection as? Load.Ok)?.value?.let { c ->
                ViewerScreen(hub = c.hub, camera = s.camera, onBack = { screen = Screen.Grid })
            } ?: LaunchedEffect(Unit) { screen = Screen.Grid }
        }
    }
}
