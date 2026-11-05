package org.ownsee.app.ui

import android.graphics.Color as AndroidColor
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import java.time.LocalDate
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.ownsee.app.CameraInfo
import org.ownsee.app.HubClient
import org.ownsee.app.Segment

/** Pick a day and a time, then play NVR recordings from there onward. */
@Composable
fun PlaybackPane(hub: HubClient, camera: CameraInfo, videoModifier: Modifier, showControls: Boolean) {
    val today = remember { LocalDate.now() }
    var date by remember { mutableStateOf(today) }
    var segments by remember { mutableStateOf<Load<List<Segment>>>(Load.Loading) }
    var hour by remember(date) { mutableStateOf<String?>(null) }
    var selected by remember(date) { mutableStateOf<Int?>(null) }
    // What is playing: the day's segments and the index to start from.
    var playing by remember(date) { mutableStateOf<Pair<List<Segment>, Int>?>(null) }

    LaunchedEffect(date) {
        segments = Load.Loading
        segments = runCatching { withContext(Dispatchers.IO) { hub.recordings(camera.id, date.toString()) } }
            .fold({ Load.Ok(it) }, { Load.Err(it.message ?: it.javaClass.simpleName) })
    }

    Column {
        Box(videoModifier.background(Color.Black)) {
            val p = playing
            if (p != null) RecordingPlayer(hub, camera, p.first, p.second)
            else Text(
                "Pick a time below to play",
                Modifier.align(Alignment.Center),
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        if (!showControls) return@Column

        Column(
            Modifier.padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(onClick = { date = date.minusDays(1) }) { Text("◀") }
                Text(date.toString(), style = MaterialTheme.typography.titleMedium)
                TextButton(onClick = { date = date.plusDays(1) }, enabled = date < today) { Text("▶") }
            }
            when (val s = segments) {
                Load.Loading -> Text("Loading recordings…", color = MaterialTheme.colorScheme.onSurfaceVariant)
                is Load.Err -> Text("Couldn't load recordings: ${s.message}", color = MaterialTheme.colorScheme.error)
                is Load.Ok -> {
                    val list = s.value
                    if (list.isEmpty()) {
                        Text("No recordings on this day", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        return@Column
                    }
                    val hours = list.map { it.hour }.distinct()
                    val h = hour?.takeIf { it in hours } ?: hours.last()
                    val inHour = list.indices.filter { list[it].hour == h }
                    val sel = selected?.takeIf { it in inHour } ?: inHour.first()

                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        Picker(h, hours) { hour = hours[it]; selected = null }
                        Text(":")
                        Picker(list[sel].minute, inHour.map { list[it].minute }) { selected = inHour[it] }
                        Button(onClick = { playing = list to sel }) { Text("Play") }
                    }
                }
            }
        }
    }
}

@Composable
private fun Picker(value: String, options: List<String>, onPick: (Int) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        OutlinedButton(onClick = { open = true }) { Text(value) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            options.forEachIndexed { i, o ->
                DropdownMenuItem(text = { Text(o) }, onClick = { open = false; onPick(i) })
            }
        }
    }
}

/**
 * Plays segments[start], then the following segments back to back: they are
 * one ExoPlayer playlist, so moving to the next 5-minute file is seamless.
 */
@OptIn(UnstableApi::class)
@Composable
private fun RecordingPlayer(hub: HubClient, camera: CameraInfo, segments: List<Segment>, start: Int) {
    val ctx = LocalContext.current
    var label by remember(segments, start) { mutableStateOf(segments[start].begin) }

    val player = remember(segments, start) {
        ExoPlayer.Builder(ctx).build().apply {
            setMediaItems(
                segments.drop(start).map {
                    MediaItem.Builder().setUri(hub.playbackUrl(camera.id, it)).setMediaId(it.begin).build()
                },
            )
            prepare()
            playWhenReady = true
        }
    }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
                item?.mediaId?.let { label = it }
            }
        }
        player.addListener(listener)
        onDispose {
            player.removeListener(listener)
            player.release()
        }
    }

    Box(Modifier.fillMaxSize()) {
        AndroidView(
            factory = { c ->
                PlayerView(c).apply {
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    setShutterBackgroundColor(AndroidColor.BLACK)
                    keepScreenOn = true
                }
            },
            update = { it.player = player },
            onRelease = { it.player = null },
            modifier = Modifier.fillMaxSize(),
        )
        Text(
            label,
            Modifier
                .align(Alignment.TopStart)
                .padding(8.dp)
                .background(Color(0x8C000000))
                .padding(horizontal = 6.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelMedium,
            color = Color.White,
        )
    }
}
