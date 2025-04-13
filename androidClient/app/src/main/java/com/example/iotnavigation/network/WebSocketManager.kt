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
import android.util.Base64
import com.example.iotnavigation.camera.CameraManager

class WebSocketManager(
    private val serverUrl: String = "ws://192.168.1.42:3000",
    private val deviceId: String = UUID.randomUUID().toString(),
    private val onLog: ((String) -> Unit)? = null
) {
    private var webSocket: WebSocket? = null
    private val client = OkHttpClient()
    private val _connectionState = MutableStateFlow(false)
    val connectionState: StateFlow<Boolean> = _connectionState

    fun connect() {
        val request = Request.Builder()
            .url(serverUrl)
            .build()

        webSocket = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                _connectionState.value = true
                // Register device with server
                sendMessage(SensorMessage("register", deviceId))
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                val errorMessage = "Error: ${t.message}"
                Log.e("WebSocket", errorMessage)
                onLog?.invoke(errorMessage)
                _connectionState.value = false
                // Attempt to reconnect after delay
                Thread.sleep(5000)
                connect()
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                _connectionState.value = false
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
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
            Log.e("WebSocket", errorMessage)
            onLog?.invoke(errorMessage)
        }
    }

    fun sendCameraFrame(imageBytes: ByteArray) {
        try {
            if (imageBytes.isEmpty()) {
                Log.e("WebSocketManager", "Empty image data, not sending")
                return
            }
            
            Log.d("WebSocketManager", "Sending camera frame: ${imageBytes.size} bytes")
            
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
            Log.d("WebSocketManager", "Camera frame sent successfully")
        } catch (e: Exception) {
            Log.e("WebSocketManager", "Failed to send camera frame", e)
        }
    }
}
