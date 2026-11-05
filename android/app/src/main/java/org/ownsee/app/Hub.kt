package org.ownsee.app

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder
import org.json.JSONArray

/** One viewable stream of a camera ("main" = HD, "sub" = low-res). */
data class StreamRef(val id: String, val quality: String)

data class CameraInfo(
    val id: String,
    val name: String,
    val channel: Int,
    val streams: List<StreamRef>,
) {
    /** The stream of the given quality, or any stream if that one is missing. */
    fun stream(quality: String): StreamRef? =
        streams.firstOrNull { it.quality == quality } ?: streams.firstOrNull()
}

/** One NVR recording segment (the NVR records 5-minute files, local time). */
data class Segment(val fileName: String, val begin: String, val end: String) {
    /** "HH" of the start time; begin is "YYYY-MM-DD HH:MM:SS". */
    val hour: String get() = begin.substring(11, 13)
    val minute: String get() = begin.substring(14, 16)
}

/**
 * Client for the Camera Hub HTTP API. Blocking calls: run them off the main
 * thread. The same endpoints serve the web UI, so this is the app's contract
 * with the hub.
 */
class HubClient(val baseUrl: String) {

    fun cameras(): List<CameraInfo> {
        val sources = JSONArray(get("/api/sources"))
        val out = mutableListOf<CameraInfo>()
        for (i in 0 until sources.length()) {
            val cams = sources.getJSONObject(i).getJSONArray("cameras")
            for (j in 0 until cams.length()) {
                val c = cams.getJSONObject(j)
                val st = c.getJSONArray("streams")
                out += CameraInfo(
                    id = c.getString("id"),
                    name = c.getString("name"),
                    channel = c.optInt("channel"),
                    streams = (0 until st.length()).map {
                        val s = st.getJSONObject(it)
                        StreamRef(s.getString("id"), s.getString("quality"))
                    },
                )
            }
        }
        return out
    }

    /** Segments for one local calendar day, date = "YYYY-MM-DD". */
    fun recordings(cameraId: String, date: String): List<Segment> {
        val arr = JSONArray(get("/api/recordings?camera=${enc(cameraId)}&date=${enc(date)}"))
        return (0 until arr.length()).map {
            val r = arr.getJSONObject(it)
            Segment(r.getString("fileName"), r.getString("begin"), r.getString("end"))
        }
    }

    /**
     * Live stream as fragmented MP4 through the hub's go2rtc proxy. The bare
     * "mp4" flag lets go2rtc send H.265 as well; without it only H.264 is
     * offered and H.265 cameras never start.
     */
    fun liveUrl(streamId: String): String =
        "$baseUrl/go2rtc/api/stream.mp4?src=${enc(streamId)}&mp4"

    fun playbackUrl(cameraId: String, seg: Segment): String =
        "$baseUrl/api/playback?camera=${enc(cameraId)}&file=${enc(seg.fileName)}" +
            "&begin=${enc(seg.begin)}&end=${enc(seg.end)}"

    private fun get(path: String): String {
        val conn = URL(baseUrl + path).openConnection() as HttpURLConnection
        conn.connectTimeout = 8_000
        // A day's recording list needs several NVR queries, so allow a while.
        conn.readTimeout = 30_000
        try {
            val code = conn.responseCode
            val body = (if (code in 200..299) conn.inputStream else conn.errorStream)
                ?.bufferedReader()?.use { it.readText() }.orEmpty()
            if (code !in 200..299) throw IOException("HTTP $code ${body.take(200)}".trim())
            return body
        } finally {
            conn.disconnect()
        }
    }

    private fun enc(s: String): String = URLEncoder.encode(s, "UTF-8")
}
