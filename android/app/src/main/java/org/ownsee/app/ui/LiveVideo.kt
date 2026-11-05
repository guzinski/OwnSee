package org.ownsee.app.ui

import android.graphics.Color as AndroidColor
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import kotlinx.coroutines.delay

/**
 * A live camera stream (fragmented MP4 from go2rtc) in a native ExoPlayer,
 * decoded by the phone's hardware decoder (H.264 and H.265).
 *
 * The player only exists while the app is in the foreground, so a
 * backgrounded app stops pulling video over mobile data.
 */
@OptIn(UnstableApi::class)
@Composable
fun LiveVideo(url: String, modifier: Modifier = Modifier, keepScreenOn: Boolean = false) {
    val ctx = LocalContext.current
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val started = lifecycleState.isAtLeast(Lifecycle.State.STARTED)
    var status by remember(url) { mutableStateOf("Connecting…") }

    val player = remember(url, started) {
        if (!started) null
        else ExoPlayer.Builder(ctx)
            // Small buffers: start fast and stay close to real time.
            .setLoadControl(
                DefaultLoadControl.Builder()
                    .setBufferDurationsMs(1_000, 4_000, 250, 500)
                    .build(),
            )
            .build()
            .apply {
                volume = 0f
                setMediaItem(MediaItem.fromUri(url))
                prepare()
                playWhenReady = true
            }
    }

    DisposableEffect(player) {
        val p = player ?: return@DisposableEffect onDispose {}
        val listener = object : Player.Listener {
            override fun onPlaybackStateChanged(state: Int) {
                status = when (state) {
                    Player.STATE_READY -> ""
                    Player.STATE_BUFFERING -> if (p.currentPosition == 0L) "Connecting…" else ""
                    else -> status
                }
            }

            override fun onPlayerError(error: PlaybackException) {
                status = "Reconnecting…"
            }
        }
        p.addListener(listener)
        onDispose {
            p.removeListener(listener)
            p.release()
        }
    }

    // Keep the stream live: reconnect after errors, and play slightly faster
    // when video piles up in the buffer (network bursts), so delay doesn't grow.
    LaunchedEffect(player) {
        val p = player ?: return@LaunchedEffect
        while (true) {
            delay(1_000)
            if (p.playerError != null || p.playbackState == Player.STATE_ENDED) {
                delay(1_500)
                p.setMediaItem(MediaItem.fromUri(url))
                p.prepare()
                p.play()
                continue
            }
            val ahead = p.totalBufferedDuration
            val speed = p.playbackParameters.speed
            if (ahead > 2_000 && speed == 1f) p.setPlaybackSpeed(1.15f)
            else if (ahead < 700 && speed != 1f) p.setPlaybackSpeed(1f)
        }
    }

    Box(modifier.background(Color.Black)) {
        if (player != null) {
            AndroidView(
                factory = { c ->
                    PlayerView(c).apply {
                        useController = false
                        resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                        setShutterBackgroundColor(AndroidColor.BLACK)
                        isClickable = false
                        isFocusable = false
                    }
                },
                update = {
                    it.player = player
                    it.keepScreenOn = keepScreenOn
                },
                onRelease = { it.player = null },
                modifier = Modifier.fillMaxSize(),
            )
        }
        if (status.isNotEmpty()) {
            Text(
                status,
                Modifier.align(Alignment.Center),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
    }
}
