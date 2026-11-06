package org.ownsee.app

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import java.io.File
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Saves a frame of a live camera to the phone, in Pictures/OwnSee. */
object Snapshots {
    suspend fun save(ctx: Context, url: String, fileName: String) = withContext(Dispatchers.IO) {
        val bytes = fetch(ctx, url)
        if (Build.VERSION.SDK_INT >= 29) {
            val values = ContentValues().apply {
                put(MediaStore.Images.Media.DISPLAY_NAME, fileName)
                put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg")
                put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/OwnSee")
            }
            val cr = ctx.contentResolver
            val uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
                ?: throw IOException(ctx.getString(R.string.err_create_file))
            cr.openOutputStream(uri)?.use { it.write(bytes) } ?: throw IOException(ctx.getString(R.string.err_open_file))
        } else {
            // Android 8/9: app-specific storage needs no permission.
            val dir = File(ctx.getExternalFilesDir(Environment.DIRECTORY_PICTURES), "OwnSee").apply { mkdirs() }
            File(dir, fileName).writeBytes(bytes)
        }
    }

    private fun fetch(ctx: Context, url: String): ByteArray {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 8_000
        c.readTimeout = 20_000
        try {
            if (c.responseCode != 200) throw IOException(ctx.getString(R.string.err_hub_status, c.responseCode))
            return c.inputStream.use { it.readBytes() }
        } finally {
            c.disconnect()
        }
    }
}
