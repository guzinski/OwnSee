package org.ownsee.app

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.ContentValues
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.IBinder
import android.provider.MediaStore
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.io.OutputStream
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.launch

/** The current (or last finished) recording download, for the UI. */
data class DownloadState(
    val title: String,
    val bytes: Long = 0,
    /** Approximate final size from the NVR, for a percentage; 0 if unknown. */
    val expected: Long = 0,
    val done: Boolean = false,
    val error: String? = null,
)

/**
 * Saves NVR recordings to the phone, in Movies/OwnSee. One at a time.
 *
 * The NVR sends recordings at about real-time speed, so a 5-minute segment
 * takes about 5 minutes. That is longer than Android lets a backgrounded app
 * keep running, so the transfer runs in a foreground service with a progress
 * notification.
 */
object Downloads {
    private val _state = MutableStateFlow<DownloadState?>(null)
    val state: StateFlow<DownloadState?> = _state

    val busy: Boolean get() = _state.value?.done == false

    /** Starts a download; false if one is already running. */
    fun start(ctx: Context, url: String, fileName: String, title: String, expected: Long = 0): Boolean {
        if (busy) return false
        _state.value = DownloadState(title, expected = expected)
        ctx.startForegroundService(
            Intent(ctx, DownloadService::class.java)
                .putExtra(EXTRA_URL, url)
                .putExtra(EXTRA_FILE, fileName)
                .putExtra(EXTRA_TITLE, title)
                .putExtra(EXTRA_SIZE, expected),
        )
        return true
    }

    fun cancel(ctx: Context) {
        if (busy) ctx.startService(Intent(ctx, DownloadService::class.java).setAction(ACTION_CANCEL))
    }

    /** Hides a finished download's result in the UI. */
    fun dismiss() {
        if (!busy) _state.value = null
    }

    /** "Camera_1_2026-11-05_22-25-00.mp4"; same shape as the hub's filenames. */
    fun fileName(camera: String, begin: String): String {
        fun safe(s: String) = s.replace(Regex("[^A-Za-z0-9_-]+"), "_").trim('_')
        return "${safe(camera).ifEmpty { "camera" }}_${safe(begin.replace(':', '-').replace(' ', '_'))}.mp4"
    }

    internal fun update(s: DownloadState) {
        _state.value = s
    }

    internal const val EXTRA_URL = "url"
    internal const val EXTRA_FILE = "file"
    internal const val EXTRA_TITLE = "title"
    internal const val EXTRA_SIZE = "size"
    internal const val ACTION_CANCEL = "org.ownsee.app.CANCEL_DOWNLOAD"
}

class DownloadService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null

    // Closing the connection is what unblocks a read waiting on the NVR.
    @Volatile private var conn: HttpURLConnection? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == Downloads.ACTION_CANCEL) {
            job?.cancel()
            conn?.disconnect()
            return START_NOT_STICKY
        }
        val url = intent?.getStringExtra(Downloads.EXTRA_URL)
        val file = intent?.getStringExtra(Downloads.EXTRA_FILE)
        val title = intent?.getStringExtra(Downloads.EXTRA_TITLE) ?: getString(R.string.recording)
        val expected = intent?.getLongExtra(Downloads.EXTRA_SIZE, 0) ?: 0

        createChannel()
        // startForeground must be called promptly after startForegroundService,
        // even when there is nothing to do.
        startInForeground(progress(title, 0, expected))
        if (url == null || file == null || job?.isActive == true) {
            if (job?.isActive != true) stopSelf()
            return START_NOT_STICKY
        }

        Tls.install(this) // client certificate for the remote route
        job = scope.launch {
            var bytes = 0L
            val result = runCatching {
                save(url, file) { n ->
                    bytes = n
                    Downloads.update(DownloadState(title, n, expected))
                    notify(progress(title, n, expected))
                }
            }
            val saved = result.getOrNull()
            val error = when {
                saved != null -> null
                job?.isCancelled == true -> getString(R.string.download_cancelled)
                else -> result.exceptionOrNull()?.message ?: getString(R.string.err_failed)
            }
            Downloads.update(DownloadState(title, bytes, expected, done = true, error = error))
            stopForeground(STOP_FOREGROUND_REMOVE)
            notify(finished(title, saved, error), id = DONE_ID)
            stopSelf()
        }
        return START_NOT_STICKY
    }

    override fun onDestroy() {
        conn?.disconnect()
        scope.cancel()
    }

    /** Copies the hub's response into a new video file; returns its URI
     *  (null on Android 9 and older, where it goes to app storage). */
    private suspend fun save(url: String, name: String, onProgress: (Long) -> Unit): Uri? {
        val c = URL(url).openConnection() as HttpURLConnection
        conn = c
        c.connectTimeout = 10_000
        c.readTimeout = 60_000 // the NVR can take a while to start sending
        try {
            if (c.responseCode != 200) throw IOException(getString(R.string.err_hub_status, c.responseCode))
            val target = openTarget(name)
            try {
                c.inputStream.use { input ->
                    target.stream.use { out ->
                        val buf = ByteArray(64 * 1024)
                        var total = 0L
                        var lastReport = 0L
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val n = input.read(buf)
                            if (n < 0) break
                            out.write(buf, 0, n)
                            total += n
                            val now = System.currentTimeMillis()
                            if (now - lastReport > 1_000) {
                                lastReport = now
                                onProgress(total)
                            }
                        }
                        onProgress(total)
                        if (total == 0L) throw IOException(getString(R.string.err_no_video))
                    }
                }
            } catch (e: Throwable) {
                target.discard()
                throw e
            }
            target.commit()
            return target.uri
        } finally {
            c.disconnect()
            conn = null
        }
    }

    private class Target(val stream: OutputStream, val uri: Uri?, val commit: () -> Unit, val discard: () -> Unit)

    private fun openTarget(name: String): Target {
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.Video.Media.DISPLAY_NAME, name)
                put(MediaStore.Video.Media.MIME_TYPE, "video/mp4")
                put(MediaStore.Video.Media.RELATIVE_PATH, "${Environment.DIRECTORY_MOVIES}/OwnSee")
                put(MediaStore.Video.Media.IS_PENDING, 1)
            }
            val cr = contentResolver
            val uri = cr.insert(MediaStore.Video.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw IOException(getString(R.string.err_create_file))
            val stream = cr.openOutputStream(uri)
                ?: run { cr.delete(uri, null, null); throw IOException(getString(R.string.err_open_file)) }
            return Target(
                stream, uri,
                commit = {
                    cr.update(uri, ContentValues().apply { put(MediaStore.Video.Media.IS_PENDING, 0) }, null, null)
                },
                discard = { cr.delete(uri, null, null) },
            )
        }
        // Android 8/9: app-specific storage needs no permission.
        val dir = File(getExternalFilesDir(Environment.DIRECTORY_MOVIES), "OwnSee").apply { mkdirs() }
        val f = File(dir, name)
        return Target(FileOutputStream(f), null, commit = {}, discard = { f.delete() })
    }

    // --- notifications ---

    private fun createChannel() {
        getSystemService(NotificationManager::class.java).createNotificationChannel(
            NotificationChannel(CHANNEL, getString(R.string.channel_downloads), NotificationManager.IMPORTANCE_LOW),
        )
    }

    private fun startInForeground(n: Notification) {
        if (Build.VERSION.SDK_INT >= 29) startForeground(PROGRESS_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(PROGRESS_ID, n)
    }

    private fun notify(n: Notification, id: Int = PROGRESS_ID) {
        // Without the notification permission this is silently dropped; the
        // download itself still works and the app shows its progress.
        getSystemService(NotificationManager::class.java).notify(id, n)
    }

    private fun progress(title: String, bytes: Long, expected: Long): Notification {
        val cancel = PendingIntent.getService(
            this, 0,
            Intent(this, DownloadService::class.java).setAction(Downloads.ACTION_CANCEL),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle(getString(R.string.notif_downloading, title))
            .setContentText(
                if (bytes > 0) getString(R.string.notif_progress, sizeText(bytes, expected))
                else getString(R.string.notif_waiting),
            )
            .apply {
                if (expected > 0 && bytes > 0) setProgress(100, percent(bytes, expected), false)
                else setProgress(0, 0, true)
            }
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .addAction(Notification.Action.Builder(null, getString(R.string.cancel), cancel).build())
            .build()
    }

    private fun finished(title: String, uri: Uri?, error: String?): Notification {
        val b = Notification.Builder(this, CHANNEL)
            .setAutoCancel(true)
            .setSmallIcon(if (error == null) android.R.drawable.stat_sys_download_done else android.R.drawable.stat_notify_error)
            .setContentTitle(getString(if (error == null) R.string.notif_saved else R.string.notif_failed, title))
            .setContentText(error ?: "Movies/OwnSee")
        if (uri != null) {
            val view = Intent(Intent.ACTION_VIEW)
                .setDataAndType(uri, "video/mp4")
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            b.setContentIntent(PendingIntent.getActivity(this, 1, view, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT))
        }
        return b.build()
    }

    private companion object {
        const val CHANNEL = "downloads"
        const val PROGRESS_ID = 1
        const val DONE_ID = 2
    }
}

/** Download progress in percent, capped at 99 until it's actually done
 *  (the estimate is the NVR's size, and the MP4 comes out a bit smaller). */
fun percent(bytes: Long, expected: Long): Int = if (expected <= 0) 0 else minOf(99, (bytes * 100 / expected).toInt())

/** "40% · 45 / 112 MB", or "45 MB" when the size isn't known. */
fun sizeText(bytes: Long, expected: Long): String =
    if (expected > 0) "${percent(bytes, expected)}% · ${bytes / (1024 * 1024)} / ${mb(expected)}" else mb(bytes)

/** "45 MB" */
fun mb(bytes: Long): String = "${bytes / (1024 * 1024)} MB"
