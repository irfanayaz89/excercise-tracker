package com.margelo.nitro.poselandmarker

import android.graphics.Bitmap
import android.graphics.Matrix
import android.os.SystemClock
import android.util.Log
import androidx.annotation.Keep
import com.facebook.proguard.annotations.DoNotStrip
import com.google.mediapipe.framework.image.BitmapImageBuilder
import com.google.mediapipe.tasks.core.BaseOptions
import com.google.mediapipe.tasks.core.Delegate
import com.google.mediapipe.tasks.vision.core.RunningMode
import com.google.mediapipe.tasks.vision.poselandmarker.PoseLandmarker
import com.margelo.nitro.NitroModules
import com.margelo.nitro.camera.HybridFrameSpec
import com.margelo.nitro.camera.public.NativeFrame
import com.margelo.nitro.core.Promise

/**
 * MediaPipe Pose Landmarker as a VisionCamera v5 frame plugin.
 *
 * `detect` runs synchronously on the camera thread: the frame's ImageProxy is
 * only valid until the worklet disposes it, so we must finish before returning.
 */
@DoNotStrip
@Keep
class HybridPoseLandmarker : HybridPoseLandmarkerSpec() {
  /** Guards the landmarker and timestamps; held for a whole inference. */
  private val lock = Any()
  private var landmarker: PoseLandmarker? = null
  private var lastTimestampMs = 0L

  // Status read from JS; volatile so reading it never waits for an inference.
  @Volatile private var _activeDelegate = ""
  @Volatile private var _lastError = ""
  @Volatile private var _loaded = false

  override val isLoaded: Boolean
    get() = _loaded

  override val activeDelegate: String
    get() = _activeDelegate

  override val lastError: String
    get() = _lastError

  override fun load(options: PoseLandmarkerOptions): Promise<Unit> {
    return Promise.async {
      val context = NitroModules.applicationContext
        ?: throw Error("React context is not ready yet")
      val asset = if (options.model == PoseModel.LITE) "pose_landmarker_lite.task" else "pose_landmarker_full.task"

      val exists = try {
        context.assets.openFd(asset).close(); true
      } catch (_: Exception) {
        try { context.assets.open(asset).close(); true } catch (_: Exception) { false }
      }
      if (!exists) {
        val message = "Model file $asset is missing from the app. Run `npm run fetch-models` and rebuild."
        _lastError = message
        throw Error(message)
      }

      val order = if (options.delegate == PoseDelegate.GPU) listOf(Delegate.GPU, Delegate.CPU) else listOf(Delegate.CPU)
      var failure: Throwable? = null
      for (delegate in order) {
        try {
          val base = BaseOptions.builder()
            .setModelAssetPath(asset)
            .setDelegate(delegate)
            .build()
          val opts = PoseLandmarker.PoseLandmarkerOptions.builder()
            .setBaseOptions(base)
            .setRunningMode(RunningMode.VIDEO)
            .setNumPoses(1)
            .setMinPoseDetectionConfidence(options.minPoseDetectionConfidence.toFloat())
            .setMinPosePresenceConfidence(options.minPosePresenceConfidence.toFloat())
            .setMinTrackingConfidence(options.minTrackingConfidence.toFloat())
            .build()
          val created = PoseLandmarker.createFromOptions(context, opts)
          synchronized(lock) {
            landmarker?.close()
            landmarker = created
            lastTimestampMs = 0L
            _loaded = true
          }
          _activeDelegate = if (delegate == Delegate.GPU) "gpu" else "cpu"
          _lastError = ""
          return@async
        } catch (t: Throwable) {
          Log.w(TAG, "Pose model failed on $delegate: ${t.message}")
          failure = t
        }
      }
      val message = "Could not start the pose model: ${failure?.message ?: "unknown error"}"
      _lastError = message
      throw Error(message)
    }
  }

  override fun detect(frame: HybridFrameSpec): PoseResult? {
    synchronized(lock) {
      val lm = landmarker ?: return null
      if (!frame.isValid) return null
      val native = frame as? NativeFrame ?: return null
      val proxy = native.image

      var raw: Bitmap? = null
      var upright: Bitmap? = null
      return try {
        val rotation = proxy.imageInfo.rotationDegrees
        raw = proxy.toBitmap()
        upright = if (rotation % 360 != 0) {
          val m = Matrix().apply { postRotate(rotation.toFloat()) }
          Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true)
        } else raw

        val ts = maxOf(SystemClock.uptimeMillis(), lastTimestampMs + 1)
        lastTimestampMs = ts

        val start = SystemClock.elapsedRealtimeNanos()
        val result = lm.detectForVideo(BitmapImageBuilder(upright).build(), ts)
        val inferenceMs = (SystemClock.elapsedRealtimeNanos() - start) / 1_000_000.0

        val width = upright.width.toDouble()
        val height = upright.height.toDouble()

        val pose = result.landmarks().firstOrNull()
        val flat = if (pose != null && pose.size >= 33) {
          DoubleArray(33 * 5).also { out ->
            for (i in 0 until 33) {
              val p = pose[i]
              out[i * 5] = p.x().toDouble()
              out[i * 5 + 1] = p.y().toDouble()
              out[i * 5 + 2] = p.z().toDouble()
              out[i * 5 + 3] = p.visibility().orElse(0f).toDouble()
              out[i * 5 + 4] = p.presence().orElse(0f).toDouble()
            }
          }
        } else DoubleArray(0)

        PoseResult(
          landmarks = flat,
          width = width,
          height = height,
          mirrored = frame.isMirrored,
          timestampMs = ts.toDouble(),
          inferenceMs = inferenceMs,
        )
      } catch (t: Throwable) {
        _lastError = "Detection failed: ${t.message}"
        null
      } finally {
        // Recycle on every path, including a failed detection.
        if (upright != null && upright !== raw) upright.recycle()
        raw?.recycle()
      }
    }
  }

  override fun close() {
    synchronized(lock) {
      landmarker?.close()
      landmarker = null
      _loaded = false
    }
    _activeDelegate = ""
  }

  companion object {
    private const val TAG = "PoseLandmarker"
  }
}
