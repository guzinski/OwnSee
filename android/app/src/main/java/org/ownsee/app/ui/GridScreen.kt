package org.ownsee.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.ownsee.app.CameraInfo
import org.ownsee.app.HubClient
import org.ownsee.app.Route

/** All cameras, each tile playing its low-res sub stream. */
@OptIn(ExperimentalMaterial3Api::class)
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

    Scaffold(
        topBar = {
            TopAppBar(
                title = {
                    Column {
                        Text("OwnSee")
                        conn?.let {
                            Text(
                                if (it.route == Route.Home) "Home network" else "Remote · encrypted",
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    }
                },
                actions = { TextButton(onClick = onSettings) { Text("Hub") } },
            )
        },
    ) { pad ->
        when (val s = shown) {
            Load.Loading -> Box(Modifier.padding(pad).fillMaxSize(), Alignment.Center) {
                CircularProgressIndicator()
            }
            is Load.Err -> Column(
                Modifier.padding(pad).fillMaxSize().padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterVertically),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Text("Can't reach the hub", style = MaterialTheme.typography.titleMedium)
                Text(
                    s.message,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Text(
                    "Is the hub running? Away from home, the PC also needs its tunnel to the VPS.",
                    textAlign = TextAlign.Center,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Button(onClick = onRetry) { Text("Retry") }
            }
            is Load.Ok -> LazyVerticalGrid(
                columns = GridCells.Adaptive(minSize = 320.dp),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp),
                horizontalArrangement = Arrangement.spacedBy(12.dp),
                modifier = Modifier.padding(pad).fillMaxSize(),
            ) {
                items(s.value, key = { it.id }) { cam ->
                    CameraTile(conn!!.hub, cam, onClick = { onOpen(cam) })
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
            .clip(RoundedCornerShape(12.dp))
            .background(Color.Black),
    ) {
        cam.stream("sub")?.let { LiveVideo(hub.liveUrl(it.id), Modifier.fillMaxSize()) }
        Text(
            cam.name,
            Modifier
                .align(Alignment.BottomStart)
                .padding(8.dp)
                .background(Color(0x8C000000), RoundedCornerShape(6.dp))
                .padding(horizontal = 8.dp, vertical = 2.dp),
            style = MaterialTheme.typography.labelMedium,
            color = Color.White,
        )
        // Transparent layer on top takes the tap, so the video view can't swallow it.
        Box(Modifier.matchParentSize().clickable(onClick = onClick))
    }
}
