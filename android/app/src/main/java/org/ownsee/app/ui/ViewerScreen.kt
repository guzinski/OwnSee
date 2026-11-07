package org.ownsee.app.ui

import android.content.pm.ActivityInfo
import android.content.res.Configuration
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.activity.compose.LocalActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.media3.exoplayer.ExoPlayer
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import java.time.LocalDate
import java.time.LocalDateTime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.ownsee.app.CameraInfo
import org.ownsee.app.Downloads
import org.ownsee.app.HubClient
import org.ownsee.app.R
import org.ownsee.app.Segment
import org.ownsee.app.Snapshots

/** A recording in progress: the day's segments and where playback started. */
private data class Playback(val segments: List<Segment>, val start: Int)

/**
 * One camera. It opens live in HD; picking a day and hour below plays that
 * recording in the same place, and "Back to live" returns. In landscape the
 * video fills the screen and a tap shows its controls.
 */
@Composable
fun ViewerScreen(hub: HubClient, camera: CameraInfo, onBack: () -> Unit) {
    val activity = LocalActivity.current
    val landscape = LocalConfiguration.current.orientation == Configuration.ORIENTATION_LANDSCAPE
    val today = remember { LocalDate.now() }
    val nowHour = remember { LocalDateTime.now().hour }

    var date by remember { mutableStateOf(today) }
    var attempt by remember { mutableIntStateOf(0) }
    var segments by remember { mutableStateOf<Load<List<Segment>>>(Load.Loading) }
    var playback by remember { mutableStateOf<Playback?>(null) }
    var current by remember { mutableStateOf<Int?>(null) } // playing segment
    var paused by remember { mutableStateOf(false) }

    LaunchedEffect(date, attempt) {
        segments = Load.Loading
        segments = runCatching { withContext(Dispatchers.IO) { hub.recordings(camera.id, date.toString()) } }
            .fold({ Load.Ok(it) }, { Load.Err(it.message ?: it.javaClass.simpleName) })
    }

    val goLive = {
        playback = null
        current = null
        paused = false
    }
    val forcedLandscape = {
        activity?.requestedOrientation == ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
    }
    val toggleFullScreen = {
        activity?.requestedOrientation = when {
            forcedLandscape() -> ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
            // Landscape only because the phone was turned: hold portrait until leaving.
            landscape -> ActivityInfo.SCREEN_ORIENTATION_PORTRAIT
            else -> ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE
        }
    }
    // Back from forced fullscreen returns to portrait first.
    val goBack = {
        if (forcedLandscape()) activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED
        else onBack()
    }

    BackHandler(onBack = goBack)
    DisposableEffect(Unit) {
        onDispose { activity?.requestedOrientation = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED }
    }
    ViewerSystemBars(hidden = landscape)

    // Landscape keeps only the picture until tapped.
    var chrome by remember { mutableStateOf(true) }
    LaunchedEffect(landscape, chrome) {
        if (landscape && chrome) {
            delay(4_000)
            chrome = false
        }
    }

    val seg = current?.let { i -> playback?.segments?.getOrNull(i) }
    // The recording player publishes itself here so the control bar can show a
    // seek slider; null while live or between recordings.
    var recPlayer by remember { mutableStateOf<ExoPlayer?>(null) }

    Column(Modifier.fillMaxSize().background(Ground)) {
        Box(
            (if (landscape) Modifier.fillMaxSize() else Modifier.fillMaxWidth())
                .clip(if (landscape) RectangleShape else RoundedCornerShape(bottomStart = 28.dp, bottomEnd = 28.dp))
                .background(Color.Black),
        ) {
            val videoModifier =
                if (landscape) Modifier.fillMaxSize()
                else Modifier.fillMaxWidth().statusBarsPadding().aspectRatio(16f / 9f)
            val p = playback
            if (p == null) {
                camera.stream("main")?.let {
                    LiveVideo(hub.liveUrl(it.id), videoModifier, keepScreenOn = true)
                }
            } else {
                RecordingPlayer(hub, camera, p.segments, p.start, paused, onSegment = { current = it }, onPlayer = { recPlayer = it }, modifier = videoModifier)
            }

            if (landscape) {
                Box(
                    Modifier
                        .matchParentSize()
                        .clickable(remember { MutableInteractionSource() }, indication = null) { chrome = !chrome },
                )
            }
            if (!landscape || chrome) {
                VideoControls(
                    hub, camera,
                    seg = seg,
                    date = date,
                    today = today,
                    paused = paused,
                    player = if (seg != null) recPlayer else null,
                    onBack = goBack,
                    onPause = { paused = !paused },
                    onLive = goLive,
                    onFullScreen = toggleFullScreen,
                    modifier = Modifier.matchParentSize(),
                )
            }
        }

        if (!landscape) {
            Column(
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .verticalScroll(rememberScrollState())
                    .navigationBarsPadding()
                    .padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
            ) {
                DayStrip(date, today) {
                    date = it
                    goLive()
                }
                RecordingPicker(
                    segments, date, today, nowHour, current,
                    onPlay = { list, index ->
                        playback = Playback(list, index)
                        current = index
                        paused = false
                    },
                    onRetry = { attempt++ },
                )
                DownloadStatus()
            }
        }
    }
}

/** What sits on the video: back and live state on top, the rest along the bottom. */
@Composable
private fun VideoControls(
    hub: HubClient,
    camera: CameraInfo,
    seg: Segment?,
    date: LocalDate,
    today: LocalDate,
    paused: Boolean,
    player: ExoPlayer?,
    onBack: () -> Unit,
    onPause: () -> Unit,
    onLive: () -> Unit,
    onFullScreen: () -> Unit,
    modifier: Modifier,
) {
    Box(modifier) {
        Row(
            Modifier.fillMaxWidth().statusBarsPadding().padding(12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            RoundIconButton(Icons.Back, stringResource(R.string.back), onBack, size = 44.dp)
            if (seg == null) LivePill()
            else Text(
                stringResource(R.string.back_to_live),
                Modifier
                    .clip(RoundedCornerShape(999.dp))
                    .background(Color.White)
                    .clickable(onClick = onLive)
                    .padding(horizontal = 14.dp, vertical = 9.dp),
                style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
                color = LiveGreen,
            )
        }
        Column(
            Modifier
                .align(Alignment.BottomCenter)
                .fillMaxWidth()
                .background(Brush.verticalGradient(listOf(Color.Transparent, Color(0xB80A1414))))
                .padding(start = 12.dp, end = 12.dp, top = 24.dp, bottom = 12.dp),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (seg != null) {
                    RoundIconButton(
                        if (paused) Icons.Play else Icons.Pause,
                        stringResource(if (paused) R.string.play else R.string.pause),
                        onPause,
                    )
                }
                // Live shows the camera name; on a recording the chosen time is
                // already in the panel below, so nothing covers the video.
                if (seg == null) {
                    Text(
                        camera.name,
                        Modifier.weight(1f),
                        style = MaterialTheme.typography.headlineSmall.copy(shadow = Shadow(Color.Black, blurRadius = 12f)),
                        color = Color.White,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis,
                    )
                } else {
                    Spacer(Modifier.weight(1f))
                }
                if (seg == null) SaveFrameButton(hub, camera) else DownloadButton(hub, camera, seg)
                RoundIconButton(Icons.FullScreen, stringResource(R.string.full_screen), onFullScreen)
            }
            if (player != null) RecordingSeekBar(player)
        }
    }
}

/** A scrubber for the playing recording segment: drag to seek within it. */
@Composable
private fun RecordingSeekBar(player: ExoPlayer) {
    var position by remember { mutableStateOf(0L) }
    var duration by remember { mutableStateOf(0L) }
    var scrub by remember { mutableStateOf<Float?>(null) }
    LaunchedEffect(player) {
        while (true) {
            if (scrub == null) {
                position = player.currentPosition.coerceAtLeast(0L)
                duration = player.duration.let { if (it > 0) it else 0L }
            }
            delay(400)
        }
    }
    val value = scrub ?: if (duration > 0) position.toFloat() / duration else 0f
    Slider(
        value = value.coerceIn(0f, 1f),
        onValueChange = { scrub = it },
        onValueChangeFinished = {
            scrub?.let { if (duration > 0) player.seekTo((it * duration).toLong()) }
            scrub = null
        },
        colors = SliderDefaults.colors(
            thumbColor = Color.White,
            activeTrackColor = Color.White,
            inactiveTrackColor = Color.White.copy(alpha = 0.3f),
        ),
        modifier = Modifier.fillMaxWidth().height(28.dp),
    )
}

@Composable
private fun LivePill() {
    Row(
        Modifier
            .background(Color.White, RoundedCornerShape(999.dp))
            .padding(horizontal = 10.dp, vertical = 4.dp),
        horizontalArrangement = Arrangement.spacedBy(6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(8.dp).background(LiveGreen, CircleShape))
        Text(
            stringResource(R.string.live),
            style = MaterialTheme.typography.bodySmall.copy(fontWeight = FontWeight.SemiBold),
            color = LiveGreen,
        )
    }
}

/** Saves the current live frame to the phone (Pictures/OwnSee). */
@Composable
private fun SaveFrameButton(hub: HubClient, camera: CameraInfo) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    RoundIconButton(
        Icons.Camera,
        stringResource(R.string.save_photo),
        enabled = !saving,
        onClick = {
            val stream = camera.stream("main") ?: return@RoundIconButton
            saving = true
            scope.launch {
                val name = Downloads.fileName(camera.name, LocalDateTime.now().toString().take(19).replace('T', ' '))
                    .removeSuffix(".mp4") + ".jpg"
                val result = runCatching { Snapshots.save(ctx, hub.snapshotUrl(stream.id), name) }
                saving = false
                val message = result.fold(
                    { ctx.getString(R.string.photo_saved) },
                    { ctx.getString(R.string.photo_failed, it.message ?: it.javaClass.simpleName) },
                )
                Toast.makeText(ctx, message, Toast.LENGTH_SHORT).show()
            }
        },
    )
}

/**
 * The video runs under the status bar, so its icons go light while this screen
 * shows. When [hidden], status and navigation bars hide; a swipe from an edge
 * shows them briefly.
 */
@Composable
private fun ViewerSystemBars(hidden: Boolean) {
    val activity = LocalActivity.current
    val view = LocalView.current
    DisposableEffect(hidden) {
        val window = activity?.window
        val controller = window?.let { WindowCompat.getInsetsController(it, view) }
        if (controller != null) {
            controller.isAppearanceLightStatusBars = false
            controller.systemBarsBehavior =
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            if (hidden) controller.hide(WindowInsetsCompat.Type.systemBars())
            else controller.show(WindowInsetsCompat.Type.systemBars())
        }
        onDispose {
            controller?.show(WindowInsetsCompat.Type.systemBars())
            controller?.isAppearanceLightStatusBars = true
        }
    }
}
