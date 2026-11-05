package org.ownsee.app.ui

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.ownsee.app.CameraInfo
import org.ownsee.app.HubClient

/**
 * One camera: Live (HD main stream) or Playback (NVR recordings).
 * In landscape the video fills the screen and the system bars hide.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ViewerScreen(hub: HubClient, camera: CameraInfo, onBack: () -> Unit) {
    val activity = LocalActivity.current
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    var tab by remember { mutableIntStateOf(0) }

    BackHandler {
        // Back from forced fullscreen returns to portrait first.
        if (activity?.requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE)
            activity.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        else onBack()
    }
    DisposableEffect(Unit) {
        onDispose { activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
    }
    ImmersiveWhen(landscape)

    Column(
        Modifier
            .fillMaxSize()
            .background(Color.Black)
            .then(if (landscape) Modifier else Modifier.navigationBarsPadding()),
    ) {
        if (!landscape) {
            TopAppBar(
                title = { Text(camera.name) },
                navigationIcon = { TextButton(onClick = onBack) { Text("Back") } },
                actions = {
                    TextButton(onClick = {
                        activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
                    }) { Text("Fullscreen") }
                },
            )
            PrimaryTabRow(selectedTabIndex = tab) {
                Tab(selected = tab == 0, onClick = { tab = 0 }, text = { Text("Live") })
                Tab(selected = tab == 1, onClick = { tab = 1 }, text = { Text("Playback") })
            }
        }
        val videoModifier =
            if (landscape) Modifier.fillMaxSize() else Modifier.fillMaxWidth().aspectRatio(16f / 9f)
        when (tab) {
            0 -> camera.stream("main")?.let {
                LiveVideo(hub.liveUrl(it.id), videoModifier, keepScreenOn = true)
            }
            else -> PlaybackPane(hub, camera, videoModifier, showControls = !landscape)
        }
    }
}

/** Hide status and navigation bars while [hidden]; swipe from an edge shows them briefly. */
@Composable
private fun ImmersiveWhen(hidden: Boolean) {
    val activity = LocalActivity.current
    val view = LocalView.current
    DisposableEffect(hidden) {
        val window = activity?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        if (controller != null) {
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            if (hidden) controller.hide(WindowInsetsCompat.Type.systemBars())
            else controller.show(WindowInsetsCompat.Type.systemBars())
        }
        onDispose { controller?.show(WindowInsetsCompat.Type.systemBars()) }
    }
}
