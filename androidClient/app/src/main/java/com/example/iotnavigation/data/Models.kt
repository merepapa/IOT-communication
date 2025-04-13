package com.example.iotnavigation.data

data class LocationData(
    val latitude: Double,
    val longitude: Double
)

data class AccelerometerData(
    val x: Float,
    val y: Float,
    val z: Float
)

data class SensorMessage(
    val type: String,
    val deviceId: String? = null,
    val payload: Map<String, Any>? = null
)
