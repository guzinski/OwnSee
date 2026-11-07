package org.ownsee.app.ui

import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.stringResource
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.journeyapps.barcodescanner.ScanContract
import com.journeyapps.barcodescanner.ScanOptions
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.ownsee.app.BuildConfig
import org.ownsee.app.HubAddress
import org.ownsee.app.HubClient
import org.ownsee.app.Pairing
import org.ownsee.app.PairingCode
import org.ownsee.app.R

/**
 * Connect the app to a hub: scan the pairing QR code from the hub's web UI
 * (home + remote access), or type a LAN address (home only, no pairing).
 */
@Composable
fun SetupScreen(
    pairingLink: String?,
    onPairingLinkHandled: () -> Unit,
    onDone: () -> Unit,
    onCancel: (() -> Unit)?,
) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var manual by remember { mutableStateOf(HubAddress.lan(ctx) ?: "") }
    var manualError by remember { mutableStateOf<String?>(null) }
    val paired = remember { HubAddress.isPaired(ctx) }

    if (onCancel != null) BackHandler(onBack = onCancel)

    fun pair(text: String) {
        val code = PairingCode.parse(text)
        if (code == null) {
            error = ctx.getString(R.string.not_pairing_code)
            return
        }
        busy = ctx.getString(R.string.pairing)
        error = null
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { Pairing.pair(ctx, code) } }
            busy = null
            result.fold(
                onSuccess = { onDone() },
                onFailure = { error = ctx.getString(R.string.pairing_failed, it.message ?: it.javaClass.simpleName) },
            )
        }
    }

    LaunchedEffect(pairingLink) {
        if (pairingLink != null) {
            onPairingLinkHandled()
            pair(pairingLink)
        }
    }

    val scanner = rememberLauncherForActivityResult(ScanContract()) { result ->
        result.contents?.let(::pair)
    }

    fun connectManual() {
        val url = HubAddress.normalize(ctx, manual).getOrElse {
            manualError = it.message
            return
        }
        busy = ctx.getString(R.string.connecting)
        manualError = null
        scope.launch {
            val result = runCatching { withContext(Dispatchers.IO) { HubClient(url, ctx.getString(R.string.not_paired)).cameras() } }
            busy = null
            result.fold(
                onSuccess = { cams ->
                    if (cams.isEmpty()) manualError = ctx.getString(R.string.hub_no_cameras)
                    else {
                        HubAddress.saveManual(ctx, url)
                        onDone()
                    }
                },
                onFailure = { manualError = ctx.getString(R.string.cant_reach_hub, it.message ?: it.javaClass.simpleName) },
            )
        }
    }

    Column(
        Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Text(stringResource(if (paired) R.string.hub_connection else R.string.setup_title), style = MaterialTheme.typography.headlineSmall)
        if (paired) {
            Text(
                stringResource(
                    R.string.setup_paired_info,
                    HubAddress.lan(ctx).orEmpty(),
                    HubAddress.remote(ctx) ?: stringResource(R.string.not_set),
                ),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Text(
            stringResource(R.string.setup_help),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Button(
            onClick = {
                scanner.launch(
                    ScanOptions()
                        .setDesiredBarcodeFormats(ScanOptions.QR_CODE)
                        .setPrompt(ctx.getString(R.string.scan_prompt))
                        .setBeepEnabled(false)
                        .setOrientationLocked(false),
                )
            },
            enabled = busy == null,
            modifier = Modifier.fillMaxWidth(),
        ) { Text(stringResource(if (paired) R.string.pair_again else R.string.scan_code)) }
        busy?.let { Text(it) }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }

        HorizontalDivider()

        Text(stringResource(R.string.manual_title), style = MaterialTheme.typography.titleSmall)
        OutlinedTextField(
            value = manual,
            onValueChange = { manual = it; manualError = null },
            label = { Text(stringResource(R.string.hub_address)) },
            placeholder = { Text(stringResource(R.string.hub_address_hint)) },
            singleLine = true,
            isError = manualError != null,
            supportingText = manualError?.let { { Text(it) } },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri, imeAction = ImeAction.Done),
            modifier = Modifier.fillMaxWidth(),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedButton(onClick = ::connectManual, enabled = busy == null) { Text(stringResource(R.string.connect)) }
            if (onCancel != null) TextButton(onClick = onCancel) { Text(stringResource(R.string.cancel)) }
        }

        HorizontalDivider()
        Text(
            stringResource(R.string.app_version, BuildConfig.VERSION_NAME, BuildConfig.VERSION_CODE),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}
