//
//  HybridPoseLandmarker.swift
//  MediaPipe Pose Landmarker as a VisionCamera v5 frame plugin.
//

import AVFoundation
import Foundation
import MediaPipeTasksVision
import NitroModules
import UIKit
import VisionCamera

final class HybridPoseLandmarker: HybridPoseLandmarkerSpec {
  /// Guards the landmarker and timestamps; held for a whole inference.
  private let lock = NSLock()
  /// Guards status fields read from JS, so reading them never waits for an inference.
  private let metaLock = NSLock()
  private var landmarker: MediaPipeTasksVision.PoseLandmarker?
  private var lastTimestampMs: Int = 0
  private var _activeDelegate = ""
  private var _lastError = ""

  var isLoaded: Bool {
    lock.lock(); defer { lock.unlock() }
    return landmarker != nil
  }

  var activeDelegate: String {
    metaLock.lock(); defer { metaLock.unlock() }
    return _activeDelegate
  }

  var lastError: String {
    metaLock.lock(); defer { metaLock.unlock() }
    return _lastError
  }

  func load(options: PoseLandmarkerOptions) throws -> Promise<Void> {
    return Promise.async { [weak self] in
      guard let self else { return }
      let name = options.model == .lite ? "pose_landmarker_lite" : "pose_landmarker_full"
      guard let path = Self.modelPath(name) else {
        let message = "Model file \(name).task is missing from the app bundle. Run `npm run fetch-models` and rebuild."
        self.setError(message)
        throw RuntimeError.error(withMessage: message)
      }

      // Try the preferred delegate first, then fall back to CPU.
      let order: [Delegate] = options.delegate == .gpu ? [.GPU, .CPU] : [.CPU]
      var lastFailure: Error?
      for delegate in order {
        do {
          let mpOptions = MediaPipeTasksVision.PoseLandmarkerOptions()
          mpOptions.baseOptions.modelAssetPath = path
          mpOptions.baseOptions.delegate = delegate
          mpOptions.runningMode = .video
          mpOptions.numPoses = 1
          mpOptions.minPoseDetectionConfidence = Float(options.minPoseDetectionConfidence)
          mpOptions.minPosePresenceConfidence = Float(options.minPosePresenceConfidence)
          mpOptions.minTrackingConfidence = Float(options.minTrackingConfidence)
          let created = try MediaPipeTasksVision.PoseLandmarker(options: mpOptions)
          self.install(created, delegate: delegate == .GPU ? "gpu" : "cpu")
          return
        } catch {
          lastFailure = error
        }
      }
      let message = "Could not start the pose model: \(lastFailure?.localizedDescription ?? "unknown error")"
      self.setError(message)
      throw RuntimeError.error(withMessage: message)
    }
  }

  func detect(frame: (any HybridFrameSpec)) throws -> PoseResult? {
    lock.lock(); defer { lock.unlock() }
    guard let landmarker else { return nil }
    guard frame.isValid,
          let nativeFrame = frame as? any NativeFrame,
          let sampleBuffer = nativeFrame.sampleBuffer,
          let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return nil }

    // MediaPipe needs strictly increasing timestamps in video mode.
    let now = Int(CACurrentMediaTime() * 1000)
    let ts = max(now, lastTimestampMs + 1)
    lastTimestampMs = ts

    let orientation = Self.uiOrientation(frame.orientation)
    let rawW = Double(CVPixelBufferGetWidth(pixelBuffer))
    let rawH = Double(CVPixelBufferGetHeight(pixelBuffer))
    let rotated = orientation == .left || orientation == .right
    let width = rotated ? rawH : rawW
    let height = rotated ? rawW : rawH

    do {
      let image = try MPImage(sampleBuffer: sampleBuffer, orientation: orientation)
      let start = CACurrentMediaTime()
      let result = try landmarker.detect(videoFrame: image, timestampInMilliseconds: ts)
      let inferenceMs = (CACurrentMediaTime() - start) * 1000

      var flat: [Double] = []
      if let pose = result.landmarks.first, pose.count >= 33 {
        flat.reserveCapacity(33 * 5)
        for lm in pose.prefix(33) {
          // MediaPipe runs on the rotated (upright) image but returns landmarks
          // normalized to the original, un-rotated buffer. Rotate them so they
          // match the upright `width` x `height` reported below (the same
          // mapping as Google's iOS pose landmarker sample overlay).
          let (x, y) = Self.upright(Double(lm.x), Double(lm.y), orientation)
          flat.append(x)
          flat.append(y)
          flat.append(Double(lm.z))
          flat.append(lm.visibility?.doubleValue ?? 0)
          flat.append(lm.presence?.doubleValue ?? 0)
        }
      }
      return PoseResult(
        landmarks: flat,
        width: width,
        height: height,
        mirrored: frame.isMirrored,
        timestampMs: Double(ts),
        inferenceMs: inferenceMs
      )
    } catch {
      setError("Detection failed: \(error.localizedDescription)")
      return nil
    }
  }

  func close() throws {
    lock.lock()
    landmarker = nil
    lock.unlock()
    metaLock.lock()
    _activeDelegate = ""
    metaLock.unlock()
  }

  private func install(_ created: MediaPipeTasksVision.PoseLandmarker, delegate: String) {
    lock.lock()
    landmarker = created
    lastTimestampMs = 0
    lock.unlock()
    metaLock.lock()
    _activeDelegate = delegate
    _lastError = ""
    metaLock.unlock()
  }

  private func setError(_ message: String) {
    metaLock.lock(); defer { metaLock.unlock() }
    _lastError = message
  }

  /// Finds a bundled model whether the pod is linked statically or dynamically.
  private static func modelPath(_ name: String) -> String? {
    let candidates = [Bundle.main, Bundle(for: HybridPoseLandmarker.self)]
    for bundle in candidates {
      if let url = bundle.url(forResource: "PoseLandmarkerModels", withExtension: "bundle"),
         let models = Bundle(url: url),
         let path = models.path(forResource: name, ofType: "task") {
        return path
      }
      if let path = bundle.path(forResource: name, ofType: "task") { return path }
    }
    return nil
  }

  /// Normalized buffer coordinates → normalized upright-image coordinates.
  private static func upright(_ x: Double, _ y: Double, _ o: UIImage.Orientation) -> (Double, Double) {
    switch o {
    case .right: return (1 - y, x)
    case .left: return (y, 1 - x)
    case .down: return (1 - x, 1 - y)
    default: return (x, y)
    }
  }

  /// VisionCamera reports how the pixel data is rotated relative to the
  /// output orientation; MediaPipe takes the matching UIImage orientation and
  /// returns landmarks in upright coordinates.
  private static func uiOrientation(_ o: CameraOrientation) -> UIImage.Orientation {
    switch o {
    case .up: return .up
    case .down: return .down
    case .left: return .left
    case .right: return .right
    @unknown default: return .up
    }
  }
}
