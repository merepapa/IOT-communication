package com.example.iotnavigation.camera

import android.content.Context
import android.graphics.Bitmap
import android.graphics.ImageFormat
import android.graphics.Matrix
import android.graphics.SurfaceTexture
import android.hardware.camera2.*
import android.media.Image
import android.media.ImageReader
import android.os.Handler
import android.os.HandlerThread
import android.util.Log
import android.util.Size
import android.view.Surface
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.util.concurrent.Semaphore
import java.util.concurrent.TimeUnit
import kotlin.math.min

class CameraManager(private val context: Context) {
    private val TAG = "CameraManager"
    
    private var cameraDevice: CameraDevice? = null
    private var cameraId: String? = null
    private var imageReader: ImageReader? = null
    private val cameraOpenCloseLock = Semaphore(1)
    private var backgroundHandler: Handler? = null
    private var backgroundThread: HandlerThread? = null
    private var captureSession: CameraCaptureSession? = null
    
    // Stream quality settings
    private val targetWidth = 640 // Reduced resolution for streaming
    private val targetHeight = 480
    private val jpegQuality = 50 // Lower for better network performance
    
    // Frame rate control
    private var lastFrameTimestamp = 0L
    private val frameCaptureIntervalMs = 100 // Send 2 frames per second
    
    // Callback interface
    interface OnFrameCapturedListener {
        fun onFrameCaptured(imageBytes: ByteArray)
    }
    
    private var frameCapturedListener: OnFrameCapturedListener? = null
    
    fun setOnFrameCapturedListener(listener: OnFrameCapturedListener) {
        frameCapturedListener = listener
    }
    
    fun startCamera() {
        startBackgroundThread()
        openCamera()
    }
    
    fun stopCamera() {
        try {
            Log.d(TAG, "Stopping camera")
            closeCamera()
            stopBackgroundThread()
            Log.d(TAG, "Camera stopped successfully")
        } catch (e: Exception) {
            Log.e(TAG, "Error stopping camera", e)
            // Try to ensure resources are released even if there was an error
            try {
                cameraDevice?.close()
                cameraDevice = null
                captureSession?.close()
                captureSession = null
                imageReader?.close()
                imageReader = null
            } catch (ignored: Exception) {}
        }
    }
    
    private fun startBackgroundThread() {
        backgroundThread = HandlerThread("CameraBackground").also { it.start() }
        backgroundHandler = Handler(backgroundThread!!.looper)
    }
    
    private fun stopBackgroundThread() {
        backgroundThread?.quitSafely()
        try {
            backgroundThread?.join()
            backgroundThread = null
            backgroundHandler = null
        } catch (e: InterruptedException) {
            Log.e(TAG, "Exception stopping background thread", e)
        }
    }
    
    private fun openCamera() {
        val cameraService = context.getSystemService(Context.CAMERA_SERVICE) as android.hardware.camera2.CameraManager
        
        try {
            // Find the first back-facing camera
            for (cameraId in cameraService.cameraIdList) {
                val characteristics = cameraService.getCameraCharacteristics(cameraId)
                val facing = characteristics.get(CameraCharacteristics.LENS_FACING)
                if (facing != null && facing == CameraCharacteristics.LENS_FACING_BACK) {
                    this.cameraId = cameraId
                    break
                }
            }
            
            if (this.cameraId == null) {
                Log.e(TAG, "No back-facing camera found")
                return
            }
            
            // Set up ImageReader for capturing frames
            imageReader = ImageReader.newInstance(targetWidth, targetHeight, 
                ImageFormat.JPEG, 2).apply {
                setOnImageAvailableListener({ reader ->
                    val image = reader.acquireLatestImage()
                    
                    // Rate limit the frames we process to save bandwidth
                    val currentTime = System.currentTimeMillis()
                    if (image != null && currentTime - lastFrameTimestamp >= frameCaptureIntervalMs) {
                        lastFrameTimestamp = currentTime
                        
                        // Process and deliver the JPEG data
                        val buffer = image.planes[0].buffer
                        val bytes = ByteArray(buffer.capacity())
                        buffer.get(bytes)
                        
                        // Add this log statement
                        Log.d(TAG, "Frame captured: ${bytes.size} bytes")
                        
                        // Notify listener with byte array
                        frameCapturedListener?.onFrameCaptured(bytes)
                        
                        image.close()
                    } else {
                        image?.close()
                    }
                }, backgroundHandler)
            }
            
            // Open the camera
            if (!cameraOpenCloseLock.tryAcquire(2500, TimeUnit.MILLISECONDS)) {
                throw RuntimeException("Time out waiting to lock camera opening.")
            }
            
            cameraService.openCamera(cameraId!!, stateCallback, backgroundHandler)
        } catch (e: Exception) {
            Log.e(TAG, "Failed to open camera", e)
        }
    }
    
    private val stateCallback = object : CameraDevice.StateCallback() {
        override fun onOpened(camera: CameraDevice) {
            cameraOpenCloseLock.release()
            cameraDevice = camera
            createCaptureSession()
        }
        
        override fun onDisconnected(camera: CameraDevice) {
            cameraOpenCloseLock.release()
            camera.close()
            cameraDevice = null
        }
        
        override fun onError(camera: CameraDevice, error: Int) {
            cameraOpenCloseLock.release()
            camera.close()
            cameraDevice = null
            Log.e(TAG, "Camera device error: $error")
        }
    }
    
    private fun createCaptureSession() {
        try {
            val surface = imageReader?.surface ?: return
            
            // Create capture session
            cameraDevice?.createCaptureSession(
                listOf(surface),
                object : CameraCaptureSession.StateCallback() {
                    override fun onConfigured(session: CameraCaptureSession) {
                        if (cameraDevice == null) return
                        
                        captureSession = session
                        try {
                            // Set up repeating capture request
                            val captureBuilder = cameraDevice!!.createCaptureRequest(
                                CameraDevice.TEMPLATE_PREVIEW
                            ).apply {
                                addTarget(surface)
                                set(CaptureRequest.CONTROL_MODE, CaptureRequest.CONTROL_MODE_AUTO)
                            }
                            
                            captureSession?.setRepeatingRequest(
                                captureBuilder.build(),
                                null,
                                backgroundHandler
                            )
                        } catch (e: CameraAccessException) {
                            Log.e(TAG, "Failed to set up capture request", e)
                        }
                    }
                    
                    override fun onConfigureFailed(session: CameraCaptureSession) {
                        Log.e(TAG, "Failed to configure camera capture session")
                    }
                },
                backgroundHandler
            )
        } catch (e: CameraAccessException) {
            Log.e(TAG, "Failed to create camera capture session", e)
        }
    }
    
    private fun closeCamera() {
        try {
            if (!cameraOpenCloseLock.tryAcquire(2500, TimeUnit.MILLISECONDS)) {
                Log.e(TAG, "Time out waiting to lock camera closing.")
                return
            }
            
            captureSession?.close()
            captureSession = null
            
            cameraDevice?.close()
            cameraDevice = null
            
            imageReader?.close()
            imageReader = null
        } catch (e: InterruptedException) {
            Log.e(TAG, "Interrupted while closing camera", e)
        } finally {
            cameraOpenCloseLock.release()
        }
    }
}