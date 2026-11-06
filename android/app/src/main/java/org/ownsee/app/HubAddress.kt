package org.ownsee.app

import android.content.Context
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI
import java.net.URL

/** How the app reached the hub this time. */
enum class Route { Home, Remote }

/**
 * Where the hub lives, persisted across launches.
 *
 * After pairing there are two addresses, both HTTPS and authenticated by this
 * phone's certificate: the hub's LAN address (used at home) and the remote
 * address through the VPS (used everywhere else). The plain-HTTP listener
 * needs the hub password, so the app never uses it after pairing. Before
 * pairing, a manually entered address can be tried, but the hub will refuse
 * it until the phone is paired.
 */
object HubAddress {
    private const val PREFS = "ownsee"
    private const val KEY_URL = "hub_url" // manual address (unpaired)
    private const val KEY_LAN = "lan_url"
    private const val KEY_REMOTE = "remote_url"
    private const val KEY_CA = "ca_pem"
    private const val TLS_PORT = 8443 // HUB_TLS_PORT default; pairing sends the real one

    private fun prefs(ctx: Context) = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun isConfigured(ctx: Context) = lan(ctx) != null || remote(ctx) != null
    fun isPaired(ctx: Context) = caPem(ctx) != null

    fun lan(ctx: Context): String? {
        val saved = prefs(ctx).getString(KEY_LAN, null) ?: return prefs(ctx).getString(KEY_URL, null)
        // Paired before the hub had a password: switch to its HTTPS port.
        return if (saved.startsWith("http://")) secureLan(saved) else saved
    }

    /** http://host:3000 -> https://host:8443, the hub's paired-device port. */
    fun secureLan(url: String): String {
        val host = URI(url).host ?: return url
        return "https://$host:$TLS_PORT"
    }
    fun remote(ctx: Context): String? = prefs(ctx).getString(KEY_REMOTE, null)
    fun caPem(ctx: Context): String? = prefs(ctx).getString(KEY_CA, null)

    fun saveManual(ctx: Context, url: String) {
        prefs(ctx).edit().putString(KEY_URL, url).apply()
    }

    fun savePairing(ctx: Context, lan: String, remote: String?, caPem: String) {
        prefs(ctx).edit()
            .putString(KEY_LAN, lan)
            .putString(KEY_REMOTE, remote)
            .putString(KEY_CA, caPem)
            .remove(KEY_URL)
            .apply()
    }

    /**
     * Pick the address to use right now. Blocking: run off the main thread.
     * The LAN address gets a short timeout, so away from home the remote one
     * is tried quickly.
     */
    fun resolve(ctx: Context): Pair<HubClient, Route> {
        val lan = lan(ctx)
        val remote = remote(ctx)
        var lastError: Exception? = null
        if (lan != null) {
            try {
                ping(lan, 1_500)
                return HubClient(lan, ctx.getString(R.string.not_paired)) to Route.Home
            } catch (e: Exception) {
                lastError = e
            }
        }
        if (remote != null) {
            try {
                ping(remote, 10_000)
                return HubClient(remote, ctx.getString(R.string.not_paired)) to Route.Remote
            } catch (e: Exception) {
                lastError = e
            }
        }
        throw IOException(
            when {
                remote == null -> ctx.getString(R.string.hub_unreachable_home, lastError?.message.orEmpty())
                else -> ctx.getString(R.string.hub_unreachable_both, lastError?.message.orEmpty())
            },
        )
    }

    private fun ping(base: String, timeoutMs: Int) {
        val conn = URL("$base/api/health").openConnection() as HttpURLConnection
        conn.connectTimeout = timeoutMs
        conn.readTimeout = timeoutMs
        try {
            if (conn.responseCode != 200) throw IOException("HTTP ${conn.responseCode}")
        } finally {
            conn.disconnect()
        }
    }

    /**
     * Turn user input like "192.168.1.10:3000" into "http://192.168.1.10:3000".
     * Plain HTTP is only accepted for private addresses (LAN, VPN tunnel),
     * because it is unencrypted; anything else must be https.
     */
    fun normalize(ctx: Context, input: String): Result<String> = runCatching {
        var s = input.trim().trimEnd('/')
        require(s.isNotEmpty()) { ctx.getString(R.string.addr_empty) }
        if (!s.contains("://")) s = "http://$s"
        val uri = URI(s)
        val host = uri.host ?: throw IllegalArgumentException(ctx.getString(R.string.addr_invalid))
        when (uri.scheme) {
            "https" -> Unit
            "http" -> require(isPrivate(host)) { ctx.getString(R.string.addr_http_private) }
            else -> throw IllegalArgumentException(ctx.getString(R.string.addr_scheme))
        }
        val port = if (uri.port != -1) ":${uri.port}" else ""
        "${uri.scheme}://$host$port"
    }

    private fun isPrivate(host: String): Boolean {
        if (host == "localhost" || host.endsWith(".local") || host.endsWith(".lan")) return true
        val p = host.split('.').mapNotNull { it.toIntOrNull() }
        if (p.size != 4 || p.any { it !in 0..255 }) return false
        return when {
            p[0] == 10 -> true                                // 10/8 (incl. the WireGuard tunnel)
            p[0] == 192 && p[1] == 168 -> true                // 192.168/16
            p[0] == 172 && p[1] in 16..31 -> true             // 172.16/12
            p[0] == 100 && p[1] in 64..127 -> true            // 100.64/10 (CGNAT, Tailscale)
            p[0] == 127 -> true
            else -> false
        }
    }
}
