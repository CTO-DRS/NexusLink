package com.nexuslink.mobile

import org.json.JSONObject
import java.net.DatagramPacket
import java.net.DatagramSocket
import java.net.Inet4Address
import java.net.InetAddress
import java.net.NetworkInterface
import java.net.SocketTimeoutException

/**
 * P1: lets the background agent find its PC again after the PC's IP changes
 * (DHCP, a new router, a hotspot) without opening the app (docs/protocol-contract.md §44).
 *
 * Mirrors lib/domain/beacon_listener.dart: sends a probe {proto, v:1, probe:true} to
 * 255.255.255.255 and to the /24 broadcast of every IPv4 interface on UDP 41234, and
 * waits for the gateway's unicast reply to our ephemeral port. Unicast is used so it
 * needs no MulticastLock and doesn't compete with the Flutter listener for port 41234.
 * The payload is parsed strictly; it never carries a token, and the token is never
 * taken from it. Blocking: call it from a background thread.
 */
object BeaconLocator {
    const val UDP_PORT = 41234
    const val PROTO = "nexuslink-beacon"
    private val PC_ID_RE = Regex("^[a-f0-9]{32}$")

    data class Hit(val host: String, val port: Int)

    /** Strict parse; null for anything other than a valid announcement for [pcId]. */
    fun parse(data: ByteArray, len: Int, pcId: String): Int? {
        if (len <= 0 || len > 512) return null
        return try {
            val j = JSONObject(String(data, 0, len, Charsets.UTF_8))
            if (j.optString("proto") != PROTO || j.optInt("v", -1) != 1 || j.optBoolean("probe", false)) return null
            val id = j.optString("pcId")
            if (!PC_ID_RE.matches(id) || id != pcId) return null
            val port = j.opt("port")
            if (port !is Int || port < 1 || port > 65535) return null
            port
        } catch (_: Exception) {
            null
        }
    }

    private fun targets(): Set<InetAddress> {
        val out = linkedSetOf<InetAddress>()
        try { out.add(InetAddress.getByName("255.255.255.255")) } catch (_: Exception) {}
        try {
            for (ni in NetworkInterface.getNetworkInterfaces()) {
                if (!ni.isUp || ni.isLoopback) continue
                for (ia in ni.interfaceAddresses) {
                    val a = ia.address as? Inet4Address ?: continue
                    ia.broadcast?.let { out.add(it) } ?: run {
                        val b = a.address
                        out.add(InetAddress.getByAddress(byteArrayOf(b[0], b[1], b[2], 255.toByte())))
                    }
                }
            }
        } catch (_: Exception) {}
        return out
    }

    fun find(pcId: String, timeoutMs: Long = 5_000L): Hit? {
        if (!PC_ID_RE.matches(pcId)) return null
        val probe = JSONObject().put("proto", PROTO).put("v", 1).put("probe", true)
            .toString().toByteArray(Charsets.UTF_8)
        var sock: DatagramSocket? = null
        try {
            sock = DatagramSocket()
            sock.broadcast = true
            sock.soTimeout = 400
            val buf = ByteArray(1024)
            val end = System.currentTimeMillis() + timeoutMs
            var nextProbe = 0L
            val dests = targets()
            while (System.currentTimeMillis() < end) {
                val now = System.currentTimeMillis()
                if (now >= nextProbe) {
                    for (t in dests) {
                        try { sock.send(DatagramPacket(probe, probe.size, t, UDP_PORT)) } catch (_: Exception) {}
                    }
                    nextProbe = now + 1_200L
                }
                val pkt = DatagramPacket(buf, buf.size)
                try {
                    sock.receive(pkt)
                } catch (_: SocketTimeoutException) {
                    continue
                }
                val addr = pkt.address as? Inet4Address ?: continue
                val port = parse(pkt.data, pkt.length, pcId) ?: continue
                return Hit(addr.hostAddress ?: continue, port)
            }
        } catch (_: Exception) {
        } finally {
            try { sock?.close() } catch (_: Exception) {}
        }
        return null
    }
}
