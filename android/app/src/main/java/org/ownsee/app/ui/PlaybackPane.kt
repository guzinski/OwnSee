package org.ownsee.app.ui

import android.Manifest
import android.content.pm.PackageManager
import android.graphics.Color as AndroidColor
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.OptIn
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.media3.common.MediaItem
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.ui.AspectRatioFrameLayout
import androidx.media3.ui.PlayerView
import java.time.LocalDate
import org.ownsee.app.CameraInfo
import org.ownsee.app.Downloads
import org.ownsee.app.HubClient
import org.ownsee.app.R
import org.ownsee.app.Segment
import org.ownsee.app.percent
import org.ownsee.app.sizeText

/** The last 60 days, newest at the right; the row scrolls back in time. */
@Composable
fun DayStrip(selected: LocalDate, today: LocalDate, onPick: (LocalDate) -> Unit) {
    val locale = LocalContext.current.uiLocale()
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val cell = (maxWidth - 24.dp) / 7
        LazyRow(
            reverseLayout = true,
            horizontalArrangement = Arrangement.spacedBy(4.dp),
            modifier = Modifier.fillMaxWidth(),
        ) {
            items(List(60) { today.minusDays(it.toLong()) }, key = { it.toString() }) { day ->
                val on = day == selected
                Column(
                    Modifier
                        .width(cell)
                        .height(60.dp)
                        .clip(RoundedCornerShape(14.dp))
                        .background(if (on) Ink else Color.White)
                        .clickable { onPick(day) },
                    verticalArrangement = Arrangement.Center,
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    val color = if (on) Color.White else Ink
                    Text(
                        day.dayOfWeek.shortName(locale),
                        style = MaterialTheme.typography.labelMedium,
                        color = color,
                    )
                    Text(
                        day.dayOfMonth.toString(),
                        style = MaterialTheme.typography.titleMedium,
                        color = color,
                    )
                }
            }
        }
    }
}

/**
 * The day's recordings as 24 hour buttons, and once one is playing, its hour as
 * 12 five-minute blocks. [current] indexes into the loaded segments.
 */
@Composable
fun RecordingPicker(
    segments: Load<List<Segment>>,
    date: LocalDate,
    today: LocalDate,
    nowHour: Int,
    current: Int?,
    onPlay: (List<Segment>, Int) -> Unit,
    onRetry: () -> Unit,
) {
    val list = (segments as? Load.Ok)?.value.orEmpty()
    val recorded = remember(list) { list.map { it.hour.toInt() }.toSet() }
    val currentSeg = current?.let(list::getOrNull)

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(stringResource(R.string.pick_hour), style = MaterialTheme.typography.titleMedium)
        when (segments) {
            Load.Loading -> Text(stringResource(R.string.loading_recordings), style = MaterialTheme.typography.bodySmall, color = Muted)
            is Load.Err -> Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    stringResource(R.string.recordings_failed, segments.message),
                    Modifier.weight(1f),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                )
                TextButton(onClick = onRetry) { Text(stringResource(R.string.retry)) }
            }
            is Load.Ok -> if (list.isEmpty()) {
                Text(stringResource(R.string.no_recordings), style = MaterialTheme.typography.bodySmall, color = Muted)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            for (row in 0 until 4) {
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    for (hour in row * 6 until (row + 1) * 6) {
                        val future = date == today && hour > nowHour
                        HourButton(
                            hour,
                            selected = currentSeg?.hour?.toInt() == hour,
                            enabled = hour in recorded,
                            // Dashed = time that has passed with nothing on the NVR.
                            missing = segments is Load.Ok && !future && hour !in recorded,
                            modifier = Modifier.weight(1f),
                        ) {
                            onPlay(list, list.indexOfFirst { it.hour.toInt() == hour })
                        }
                    }
                }
            }
        }
        if (currentSeg != null) HourBlocks(list, current, onPlay)
    }
}

@Composable
private fun HourButton(
    hour: Int,
    selected: Boolean,
    enabled: Boolean,
    missing: Boolean,
    modifier: Modifier,
    onClick: () -> Unit,
) {
    Box(
        modifier
            .height(44.dp)
            .clip(RoundedCornerShape(10.dp))
            .background(if (selected) Cobalt else if (enabled) Color.White else Color.Transparent)
            .drawBehind {
                if (missing) drawRoundRect(
                    Faint,
                    cornerRadius = CornerRadius(10.dp.toPx()),
                    style = Stroke(1.dp.toPx(), pathEffect = PathEffect.dashPathEffect(floatArrayOf(8f, 8f))),
                )
            }
            .clickable(enabled = enabled, onClick = onClick),
        Alignment.Center,
    ) {
        Text(
            "%02d".format(hour),
            style = MaterialTheme.typography.bodyMedium.copy(fontWeight = FontWeight.Medium),
            color = if (selected) Color.White else if (enabled) Ink else Faint,
        )
    }
}

/** One block per 5 minutes of the playing hour: tap to jump, gaps stay blank. */
@Composable
private fun HourBlocks(list: List<Segment>, current: Int, onPlay: (List<Segment>, Int) -> Unit) {
    val seg = list[current]
    val hour = seg.hour
    val slot = { s: Segment -> s.minute.toInt() / 5 }
    val bySlot = remember(list, hour) {
        list.indices.filter { list[it].hour == hour }.groupBy { slot(list[it]) }.mapValues { it.value.first() }
    }
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Text(
            stringResource(R.string.within_hour, "$hour:00", "%02d:00".format(hour.toInt() + 1)),
            Modifier.fillMaxWidth(),
            style = MaterialTheme.typography.titleMedium,
        )
        Row(
            Modifier.fillMaxWidth().height(44.dp).clip(RoundedCornerShape(12.dp)),
            horizontalArrangement = Arrangement.spacedBy(1.dp),
        ) {
            for (i in 0 until 12) {
                val index = bySlot[i]
                Box(
                    Modifier
                        .weight(1f)
                        .fillMaxHeight()
                        .background(
                            when {
                                index == null -> Color.Transparent
                                i == slot(seg) -> Cobalt
                                i < slot(seg) -> CobaltTint
                                else -> Color.White
                            },
                        )
                        .clickable(enabled = index != null) { onPlay(list, index!!) },
                )
            }
        }
    }
}

/**
 * Plays segments[start], then the following segments back to back: they are
 * one ExoPlayer playlist, so moving to the next 5-minute file is seamless.
 * [onSegment] reports the index of the segment now playing.
 */
@OptIn(UnstableApi::class)
@Composable
fun RecordingPlayer(
    hub: HubClient,
    camera: CameraInfo,
    segments: List<Segment>,
    start: Int,
    paused: Boolean,
    onSegment: (Int) -> Unit,
    onPlayer: (ExoPlayer?) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val ctx = LocalContext.current
    val report by rememberUpdatedState(onSegment)
    val reportPlayer by rememberUpdatedState(onPlayer)
    var status by remember(segments, start) { mutableStateOf<Int?>(R.string.loading_recording) }

    val player = remember(segments, start) {
        ExoPlayer.Builder(ctx).build().apply {
            volume = 0f // open silent by default (recordings' G.711 audio off)
            setMediaItems(
                segments.drop(start).mapIndexed { i, seg ->
                    MediaItem.Builder()
                        .setUri(hub.playbackUrl(camera.id, seg))
                        .setMediaId((start + i).toString())
                        .build()
                },
            )
            prepare()
            playWhenReady = true
        }
    }
    LaunchedEffect(player, paused) { player.playWhenReady = !paused }
    DisposableEffect(player) {
        val listener = object : Player.Listener {
            override fun onMediaItemTransition(item: MediaItem?, reason: Int) {
                item?.mediaId?.toIntOrNull()?.let { report(it) }
            }

            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_READY) status = null
            }

            override fun onPlayerError(error: PlaybackException) {
                status = R.string.cant_play
            }
        }
        player.addListener(listener)
        reportPlayer(player) // let the control bar drive a seek slider
        onDispose {
            reportPlayer(null)
            player.removeListener(listener)
            player.release()
        }
    }

    Box(modifier) {
        AndroidView(
            factory = { c ->
                PlayerView(c).apply {
                    useController = false
                    resizeMode = AspectRatioFrameLayout.RESIZE_MODE_FIT
                    setShutterBackgroundColor(AndroidColor.BLACK)
                    keepScreenOn = true
                    isClickable = false
                    isFocusable = false
                }
            },
            update = { it.player = player },
            onRelease = { it.player = null },
            modifier = Modifier.fillMaxSize(),
        )
        status?.let {
            Text(
                stringResource(it),
                Modifier.align(Alignment.Center),
                style = MaterialTheme.typography.bodySmall,
                color = Color.White,
            )
        }
    }
}

/** Saves the playing 5-minute segment to the phone (Movies/OwnSee). */
@Composable
fun DownloadButton(hub: HubClient, camera: CameraInfo, seg: Segment) {
    val ctx = LocalContext.current
    val state by Downloads.state.collectAsState()
    val start = {
        Downloads.start(
            ctx,
            hub.downloadUrl(camera.id, seg),
            Downloads.fileName(camera.name, seg.begin),
            "${camera.name} ${ctx.numericDate(LocalDate.parse(seg.begin.take(10)))} ${seg.hour}:${seg.minute}",
            seg.size,
        )
    }
    // Ask once for notifications (Android 13+), so progress shows outside the
    // app; the download starts either way.
    val askNotify = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { start() }
    RoundIconButton(
        Icons.Download,
        stringResource(R.string.download_clip),
        enabled = state?.done != false,
        onClick = {
            val needAsk = Build.VERSION.SDK_INT >= 33 &&
                ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            if (needAsk) askNotify.launch(Manifest.permission.POST_NOTIFICATIONS) else start()
        },
    )
}

@Composable
fun DownloadStatus() {
    val ctx = LocalContext.current
    val s by Downloads.state.collectAsState()
    val d = s ?: return
    Column {
    Row(verticalAlignment = Alignment.CenterVertically) {
        val text = when {
            !d.done -> stringResource(
                R.string.download_progress,
                d.title,
                if (d.bytes > 0) sizeText(d.bytes, d.expected) else stringResource(R.string.waiting_nvr),
            ) + "\n" + stringResource(R.string.download_hint)
            d.error != null -> stringResource(R.string.download_failed, d.error, d.title)
            else -> stringResource(R.string.download_saved, d.title)
        }
        Text(
            text,
            Modifier.weight(1f),
            style = MaterialTheme.typography.bodySmall,
            color = if (d.error != null) MaterialTheme.colorScheme.error else Muted,
        )
        if (!d.done) TextButton(onClick = { Downloads.cancel(ctx) }) { Text(stringResource(R.string.cancel)) }
        else TextButton(onClick = { Downloads.dismiss() }) { Text(stringResource(R.string.ok)) }
    }
    if (!d.done) {
        val barModifier = Modifier.fillMaxWidth().padding(top = 4.dp)
        if (d.expected > 0 && d.bytes > 0) {
            LinearProgressIndicator(progress = { percent(d.bytes, d.expected) / 100f }, modifier = barModifier)
        } else {
            LinearProgressIndicator(modifier = barModifier)
        }
    }
    }
}
