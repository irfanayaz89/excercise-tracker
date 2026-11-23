import ManagedSettings
import UserNotifications

/// The blocked screen's buttons. Same layout as ShieldConfigurationExtension (STShared.buttons).
class ShieldActionExtension: ShieldActionDelegate {
  override func handle(action: ShieldAction, for application: ApplicationToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
    respond(action, key: STShared.key(application), STShared.shieldKind(app: application, site: nil, category: nil, STShared.status()), completionHandler)
  }

  override func handle(action: ShieldAction, for webDomain: WebDomainToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
    respond(action, key: STShared.key(webDomain), STShared.shieldKind(app: nil, site: webDomain, category: nil, STShared.status()), completionHandler)
  }

  override func handle(action: ShieldAction, for category: ActivityCategoryToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
    respond(action, key: nil, STShared.shieldKind(app: nil, site: nil, category: category, STShared.status()), completionHandler)
  }

  private func respond(_ action: ShieldAction, key: String?, _ kind: STShared.ShieldKind, _ done: @escaping (ShieldActionResponse) -> Void) {
    let s = STShared.status()
    let (primary, secondary) = STShared.buttons(kind, s)
    let pressed: STShared.ShieldButton?
    switch action {
    case .primaryButtonPressed: pressed = primary
    case .secondaryButtonPressed: pressed = secondary
    default: pressed = nil
    }
    switch pressed {
    case .earn:
      STShared.requestEarn()
      if #available(iOS 26.5, *) {
        // Opens Trueline (the app that holds the Screen Time permission).
        done(.openParentalControlsApp)
      } else {
        // Extensions can't open apps before iOS 26.5: a notification takes the user there.
        notifyEarn { done(.close) }
      }
    case .workout:
      if STShared.plan?.focusKind == "key" { STShared.requestScan() }
      if #available(iOS 26.5, *) {
        done(.openParentalControlsApp)
      } else {
        done(.close)
      }
    case .emergency:
      STShared.takeUnlock(kind: "emergency", minutes: STShared.plan?.emergencyMin ?? 10)
      done(.defer)
    case .oneMore:
      STShared.takeUnlock(kind: "one-more", minutes: STShared.plan?.oneMoreMin ?? 1)
      done(.defer)
    case .open:
      // The pause: after the wait, open this app for the pass length; before it, stay.
      if let key, STShared.pauseLeft(key) == 0 { STShared.grantPass(key) }
      done(.defer)
    case .close, .none:
      done(.close)
    }
  }

  private func notifyEarn(_ then: @escaping () -> Void) {
    let content = UNMutableNotificationContent()
    content.title = "Earn your time"
    content.body = "Tap to open Trueline and do a set."
    content.userInfo = ["url": "trueline://earn"]
    let req = UNNotificationRequest(identifier: "st.earn", content: content, trigger: nil)
    UNUserNotificationCenter.current().add(req) { _ in then() }
  }
}
