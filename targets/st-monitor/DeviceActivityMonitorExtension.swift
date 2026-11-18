import DeviceActivity
import Foundation

/// Wakes at lock-time edges, at midnight and at usage thresholds, while Trueline
/// is closed, and makes the blocks match the plan the app last saved.
class DeviceActivityMonitorExtension: DeviceActivityMonitor {
  override func intervalDidStart(for activity: DeviceActivityName) {
    super.intervalDidStart(for: activity)
    STShared.onIntervalStart(activity.rawValue)
  }

  override func intervalDidEnd(for activity: DeviceActivityName) {
    super.intervalDidEnd(for: activity)
    STShared.onIntervalEnd(activity.rawValue)
  }

  override func eventDidReachThreshold(_ event: DeviceActivityEvent.Name, activity: DeviceActivityName) {
    super.eventDidReachThreshold(event, activity: activity)
    STShared.onEvent(event.rawValue, activity: activity.rawValue)
  }
}
