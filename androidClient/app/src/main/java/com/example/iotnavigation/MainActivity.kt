package com.example.iotnavigation

import android.Manifest
import android.content.pm.PackageManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Bundle
import android.os.Looper
import android.util.Log
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import com.example.iotnavigation.camera.CameraManager
import com.example.iotnavigation.data.AccelerometerData
import com.example.iotnavigation.data.LocationData
import com.example.iotnavigation.network.WebSocketManager
import com.example.iotnavigation.ui.theme.IOTNavigationTheme
import com.google.android.gms.location.*
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

class MainActivity : ComponentActivity(), SensorEventListener {
    private lateinit var webSocketManager: WebSocketManager
    private lateinit var fusedLocationClient: FusedLocationProviderClient
    private lateinit var sensorManager: SensorManager
    private var accelerometer: Sensor? = null
    private lateinit var cameraManager: CameraManager
    private var isCameraStreaming = false

    private val _locationData = MutableStateFlow<LocationData?>(null)
    val locationData: StateFlow<LocationData?> = _locationData

    private val _accelerometerData = MutableStateFlow<AccelerometerData?>(null)
    val accelerometerData: StateFlow<AccelerometerData?> = _accelerometerData

    private val _logMessages = MutableStateFlow<List<String>>(emptyList())
    val logMessages: StateFlow<List<String>> = _logMessages

    private fun addLog(message: String) {
        _logMessages.value = (_logMessages.value + message).takeLast(100)
        Log.d("IOTNavigation", message)
    }

    private val locationPermissionRequest = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { permissions ->
        if (permissions.getOrDefault(Manifest.permission.ACCESS_FINE_LOCATION, false) ||
            permissions.getOrDefault(Manifest.permission.ACCESS_COARSE_LOCATION, false)
        ) {
            startLocationUpdates()
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        webSocketManager = WebSocketManager(
            onLog = { message -> addLog(message) }
        )
        fusedLocationClient = LocationServices.getFusedLocationProviderClient(this)
        sensorManager = getSystemService(SENSOR_SERVICE) as SensorManager
        accelerometer = sensorManager.getDefaultSensor(Sensor.TYPE_ACCELEROMETER)

        requestPermissions()
        setupSensorUpdates()
        webSocketManager.connect()

        // Start periodic data transmission
        CoroutineScope(Dispatchers.Default).launch {
            while (true) {
                webSocketManager.sendSensorData(
                    locationData.value,
                    accelerometerData.value
                )
                delay(1000) // Send updates every second
            }
        }

        // Initialize camera
        requestCameraPermission()

        setContent {
            IOTNavigationTheme {
                MainScreen(
                    locationData = locationData.collectAsState().value,
                    accelerometerData = accelerometerData.collectAsState().value,
                    isConnected = webSocketManager.connectionState.collectAsState().value,
                    logMessages = logMessages.collectAsState().value,
                    isCameraStreaming = isCameraStreaming,  // Pass the variable
                    onToggleCamera = { toggleCameraStreaming() }  // Pass the function reference
                )
            }
        }
    }

    private fun requestPermissions() {
        locationPermissionRequest.launch(arrayOf(
            Manifest.permission.ACCESS_FINE_LOCATION,
            Manifest.permission.ACCESS_COARSE_LOCATION
        ))
    }

    private fun setupSensorUpdates() {
        accelerometer?.let {
            sensorManager.registerListener(
                this,
                it,
                SensorManager.SENSOR_DELAY_NORMAL
            )
        }
    }

    private fun startLocationUpdates() {
        try {
            val locationRequest = LocationRequest.Builder(
                Priority.PRIORITY_HIGH_ACCURACY,
                1000
            ).build()

            val locationCallback = object : LocationCallback() {
                override fun onLocationResult(result: LocationResult) {
                    result.lastLocation?.let { location ->
                        _locationData.value = LocationData(
                            latitude = location.latitude,
                            longitude = location.longitude
                        )
                    }
                }
            }

            if (checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION) == 
                PackageManager.PERMISSION_GRANTED) {
                fusedLocationClient.requestLocationUpdates(
                    locationRequest,
                    locationCallback,
                    Looper.getMainLooper()
                )
            }
        } catch (e: Exception) {
            e.printStackTrace()
            addLog("Location error: ${e.message}")
        }
    }

    // Update this method to show a toast if permission is denied
    private fun requestCameraPermission() {
        if (ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.CAMERA
            ) != PackageManager.PERMISSION_GRANTED) {
            
            val requestPermissionLauncher = registerForActivityResult(
                ActivityResultContracts.RequestPermission()
            ) { isGranted ->
                if (isGranted) {
                    initializeCamera()
                    Toast.makeText(this, "Camera permission granted", Toast.LENGTH_SHORT).show()
                } else {
                    Toast.makeText(this, "Camera permission denied", Toast.LENGTH_LONG).show()
                }
            }
            
            requestPermissionLauncher.launch(Manifest.permission.CAMERA)
        } else {
            initializeCamera()
        }
    }

    private fun initializeCamera() {
        cameraManager = CameraManager(this)
        cameraManager.setOnFrameCapturedListener(object : CameraManager.OnFrameCapturedListener {
            override fun onFrameCaptured(imageBytes: ByteArray) {
                webSocketManager.sendCameraFrame(imageBytes)
            }
        })
    }

    private fun toggleCameraStreaming() {
        if (isCameraStreaming) {
            cameraManager.stopCamera()
            isCameraStreaming = false
        } else {
            cameraManager.startCamera()
            isCameraStreaming = true
        }
    }

    override fun onSensorChanged(event: SensorEvent?) {
        if (event?.sensor?.type == Sensor.TYPE_ACCELEROMETER) {
            _accelerometerData.value = AccelerometerData(
                x = event.values[0],
                y = event.values[1],
                z = event.values[2]
            )
        }
    }

    override fun onAccuracyChanged(sensor: Sensor?, accuracy: Int) {
        // Not needed for this implementation
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isCameraStreaming) {
            cameraManager.stopCamera()
        }
        webSocketManager.disconnect()
        sensorManager.unregisterListener(this)
    }
}

// Update the MainScreen function parameters to include what it needs
@Composable
fun MainScreen(
    locationData: LocationData?,
    accelerometerData: AccelerometerData?,
    isConnected: Boolean,
    logMessages: List<String>,
    isCameraStreaming: Boolean,
    onToggleCamera: () -> Unit  // Add function reference parameter
) {
    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            ConnectionStatus(isConnected)
            
            Divider()
            
            Text(
                text = "Location Data",
                style = MaterialTheme.typography.titleMedium
            )
            locationData?.let {
                Text("Latitude: ${it.latitude}")
                Text("Longitude: ${it.longitude}")
            } ?: Text("Waiting for location...")

            Divider()

            Text(
                text = "Accelerometer Data",
                style = MaterialTheme.typography.titleMedium
            )
            accelerometerData?.let {
                Text("X: ${String.format("%.2f", it.x)} m/s²")
                Text("Y: ${String.format("%.2f", it.y)} m/s²")
                Text("Z: ${String.format("%.2f", it.z)} m/s²")
            } ?: Text("Waiting for sensor data...")

            Divider()

            Text(
                text = "Logs",
                style = MaterialTheme.typography.titleMedium
            )
            
            Surface(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f),
                color = MaterialTheme.colorScheme.surfaceVariant,
                shape = MaterialTheme.shapes.small
            ) {
                SelectionContainer {
                    Text(
                        text = logMessages.joinToString("\n"),
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(8.dp)
                            .verticalScroll(rememberScrollState()),
                        style = MaterialTheme.typography.bodySmall,
                        textAlign = TextAlign.Start
                    )
                }
            }

            // Update the button to use the passed function
            Button(
                onClick = onToggleCamera,  // Use the passed function reference
                modifier = Modifier.padding(vertical = 8.dp)
            ) {
                Text(text = if (isCameraStreaming) "Stop Camera" else "Start Camera")
            }
        }
    }
}

@Composable
fun ConnectionStatus(isConnected: Boolean) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Box(
            modifier = Modifier
                .size(12.dp)
                .background(
                    color = if (isConnected) Color.Green else Color.Red,
                    shape = CircleShape
                )
        )
        Text(
            text = if (isConnected) "Connected" else "Disconnected",
            style = MaterialTheme.typography.bodyMedium
        )
    }
}
