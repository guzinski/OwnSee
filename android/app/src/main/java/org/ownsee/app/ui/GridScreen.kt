package org.ownsee.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.itemsIndexed
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.res.pluralStringResource
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.ownsee.app.CameraInfo
import org.ownsee.app.HubClient
import org.ownsee.app.R
import org.ownsee.app.Route

/**
 * Home: every camera live on its low-res sub stream, edge to edge. On a phone
 * in portrait the first camera spans the full width above a 2-column grid.
 */
@Composable
fun GridScreen(
    connection: Load<Connection>,
    onRetry: () -> Unit,
    onOpen: (CameraInfo) -> Unit,
    onSettings: () -> Unit,
) {
    val conn = (connection as? Load.Ok)?.value
    var state by remember(conn) { mutableStateOf<Load<List<CameraInfo>>>(Load.Loading) }

    LaunchedEffect(conn) {
        if (conn == null) return@LaunchedEffect
        state = Load.Loading
        state = runCatching { withContext(Dispatchers.IO) { conn.hub.cameras() } }
            .fold({ Load.Ok(it) }, { Load.Err(it.message ?: it.javaClass.simpleName) })
    }
    // A connection error shows instead of the camera list.
    val shown: Load<List<CameraInfo>> = when (connection) {
        is Load.Err -> connection
        Load.Loading -> Load.Loading
        is Load.Ok -> state
    }

    Column(Modifier.fillMaxSize().statusBarsPadding()) {
        Row(
            Modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 12.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Column(Modifier.weight(1f)) {
                Text(stringResource(R.string.home_title), style = MaterialTheme.typography.headlineLarge)
                Text(
                    stringResource(
                        when (conn?.route) {
                            Route.Home -> R.string.on_home_network
                            Route.Remote -> R.string.away_encrypted
                            null -> R.string.connecting_hub
                        },
                    ),
                    Modifier.padding(top = 4.dp),
                    style = MaterialTheme.typography.bodyMedium,
                    color = Muted,
                )
            }
            RoundIconButton(Icons.Settings, stringResource(R.string.hub_connection), onSettings)
        }

        when (val s = shown) {
            Load.Loading -> Box(Modifier.fillMaxSize(), Alignment.Center) {
                CircularProgressIndicator()
            }
            is Load.Err -> Column(
                Modifier.fillMaxSize().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text(stringResource(R.string.cant_reach_title), style = MaterialTheme.typography.titleMedium)
                Text(s.message, textAlign = TextAlign.Center, color = Muted)
                Text(
                    stringResource(R.string.cant_reach_hint),
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.bodySmall,
                    color = Muted,
                )
                Button(onClick = onRetry) { Text(stringResource(R.string.retry)) }
            }
            is Load.Ok -> Mosaic(conn!!, s.value, onOpen)
        }
    }
}

@Composable
private fun Mosaic(conn: Connection, cams: List<CameraInfo>, onOpen: (CameraInfo) -> Unit) {
    BoxWithConstraints(Modifier.fillMaxSize()) {
        // Wide screens fit three across, so no camera needs to span.
        val wide = maxWidth >= 600.dp
        LazyVerticalGrid(
            columns = GridCells.Fixed(if (wide) 3 else 2),
            contentPadding = PaddingValues(bottom = WindowInsets.navigationBars.asPaddingValues().calculateBottomPadding()),
            verticalArrangement = Arrangement.spacedBy(3.dp),
            horizontalArrangement = Arrangement.spacedBy(3.dp),
            modifier = Modifier.fillMaxSize(),
        ) {
            itemsIndexed(
                cams,
                key = { _, cam -> cam.id },
                span = { i, _ ->
                    // An even camera count would leave a hole beside the last tile.
                    val full = !wide && (i == 0 || (i == cams.lastIndex && cams.size % 2 == 0))
                    GridItemSpan(if (full) maxLineSpan else 1)
                },
            ) { _, cam ->
                CameraTile(conn.hub, cam, onClick = { onOpen(cam) })
            }
            if (conn.route == Route.Remote) {
                item(span = { GridItemSpan(maxLineSpan) }) {
                    Text(
                        pluralStringResource(R.plurals.cameras_live, cams.size, cams.size),
                        Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = Muted,
                    )
                }
            }
        }
    }
}

@Composable
private fun CameraTile(hub: HubClient, cam: CameraInfo, onClick: () -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .aspectRatio(16f / 9f)
            .background(Color.Black),
    ) {
        cam.stream("sub")?.let { LiveVideo(hub.liveUrl(it.id), Modifier.fillMaxSize(), stretch = true) }
        NamePill(cam.name, Modifier.align(Alignment.BottomStart).padding(8.dp))
        // Transparent layer on top takes the tap, so the video view can't swallow it.
        Box(Modifier.matchParentSize().clickable(onClick = onClick))
    }
}
