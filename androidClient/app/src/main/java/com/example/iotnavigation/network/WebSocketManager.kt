package com.example.iotnavigation.network

import android.util.Log
import com.example.iotnavigation.data.AccelerometerData
import com.example.iotnavigation.data.LocationData
import com.example.iotnavigation.data.SensorMessage
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import okhttp3.*
import org.json.JSONObject
import java.util.*
import java.util.concurrent.TimeUnit
import android.util.Base64

class WebSocketManager(
    val serverAddress: String = "192.168.1.42:3000", // Default, but can be overridden
    private val onLog: ((String) -> Unit)? = null
) {
    private val TAG = "WebSocketManager"
    private var webSocket: WebSocket? = null
    private val client = OkHttpClient.Builder()
        .readTimeout(0, TimeUnit.MILLISECONDS) // No timeout for WebSockets
        .build()
    private val _connectionState = MutableStateFlow(false)
    val connectionState: StateFlow<Boolean> = _connectionState
    private val deviceId = UUID.randomUUID().toString()

    fun connect() {
        val request = Request.Builder()
            .url("ws://$serverAddress")
            .build()

        onLog?.invoke("Connecting to server at ws://$serverAddress...")

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                onLog?.invoke("WebSocket connection established")
                _connectionState.value = true

                // Register the device with the server
                val registrationMessage = JSONObject().apply {
                    put("type", "register")
                    put("deviceId", deviceId)
                }.toString()

                webSocket.send(registrationMessage)
                onLog?.invoke("Registered with device ID: $deviceId")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                onLog?.invoke("Received message: $text")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onLog?.invoke("WebSocket closed: $reason")
                _connectionState.value = false
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                onLog?.invoke("WebSocket failure: ${t.message}")
                Log.e(TAG, "WebSocket failure", t)
                _connectionState.value = false
            }
        })
    }

    fun disconnect() {
        webSocket?.close(1000, null)
        webSocket = null
        _connectionState.value = false
    }

    fun sendSensorData(location: LocationData?, accelerometer: AccelerometerData?) {
        if (location == null && accelerometer == null) return

        val payload = mutableMapOf<String, Any>()
        location?.let {
            payload["location"] = mapOf(
                "latitude" to it.latitude,
                "longitude" to it.longitude
            )
        }
        accelerometer?.let {
            payload["accelerometer"] = mapOf(
                "x" to it.x,
                "y" to it.y,
                "z" to it.z
            )
        }

        sendMessage(SensorMessage("update", deviceId, payload))
    }

    private fun sendMessage(message: SensorMessage) {
        try {
            val jsonMessage = JSONObject().apply {
                put("type", message.type)
                message.deviceId?.let { put("deviceId", it) }
                message.payload?.let { put("payload", JSONObject(it)) }
            }
            webSocket?.send(jsonMessage.toString())
        } catch (e: Exception) {
            val errorMessage = "Error sending message: ${e.message}"
            Log.e(TAG, errorMessage)
            onLog?.invoke(errorMessage)
        }
    }

    fun sendCameraFrame(imageBytes: ByteArray) {
        try {
            if (imageBytes.isEmpty()) {
                Log.e(TAG, "Empty image data, not sending")
                return
            }

            Log.d(TAG, "Sending camera frame: ${imageBytes.size} bytes")

            // Convert to Base64
            val base64Image = Base64.encodeToString(imageBytes, Base64.DEFAULT)

            // Create message
            val message = JSONObject().apply {
                put("type", "camera")
                put("image", base64Image)
                put("timestamp", System.currentTimeMillis())
            }

            // Send over WebSocket
            webSocket?.send(message.toString())
            Log.d(TAG, "Camera frame sent successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to send camera frame", e)
        }
    }
}
