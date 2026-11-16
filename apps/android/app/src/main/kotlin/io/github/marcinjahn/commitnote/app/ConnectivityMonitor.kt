package io.github.marcinjahn.commitnote.app

import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities

/** Reports whether the default network reaches the internet, as the system validated it. */
class ConnectivityMonitor(
    private val connectivity: ConnectivityManager,
    private val onChange: (online: Boolean) -> Unit,
) {
    private val callback =
        object : ConnectivityManager.NetworkCallback() {
            override fun onCapabilitiesChanged(
                network: Network,
                capabilities: NetworkCapabilities,
            ) {
                onChange(capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED))
            }

            override fun onLost(network: Network) {
                onChange(false)
            }
        }

    fun start() {
        connectivity.registerDefaultNetworkCallback(callback)
    }
}
