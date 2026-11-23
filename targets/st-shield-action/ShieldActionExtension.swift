import Foundation
import ManagedSettings
import UserNotifications

/// The blocked screen's buttons. Same layout as ShieldConfigurationExtension (STShared.buttons).
///
/// iOS hands this extension a single token, while the text extension saw the app together with its
/// category. So the buttons are taken from what the text extension recorded it showed
/// (STShared.ShieldShown), and only worked out again when there is no matching record.
class ShieldActionExtension: ShieldActionDelegate {
  /// A record this old no longer describes the screen on show.
  private let recent: TimeInterval = 60 * 60

  override func handle(action: ShieldAction, for application: ApplicationToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
    let key = STShared.key(application)
    respond(action, key: key, shown: matching { key != nil && $0.app == key }, completionHandler) {
      STShared.shieldKind(app: application, site: nil, category: nil, $0)
    }
  }

  override func handle(action: ShieldAction, for webDomain: WebDomainToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
    let key = STShared.key(webDomain)
    respond(action, key: key, shown: matching { key != nil && $0.site == key }, completionHandler) {
      STShared.shieldKind(app: nil, site: webDomain, category: nil, $0)
    }
  }

  override func handle(action: ShieldAction, for category: ActivityCategoryToken, completionHandler: @escaping (ShieldActionResponse) -> Void) {
    // No app or site token here at all: what the blocked screen last showed is the best guide.
    respond(action, key: nil, shown: STShared.shieldShown, completionHandler) {
      STShared.shieldKind(app: nil, site: nil, category: category, $0)
    }
  }

  private func matching(_ match: (STShared.ShieldShown) -> Bool) -> STShared.ShieldShown? {
    guard let r = STShared.shieldShown, match(r), Date().timeIntervalSince1970 - r.at < recent else { return nil }
    return r
  }

  private func respond(
    _ action: ShieldAction, key tokenKey: String?, shown: STShared.ShieldShown?,
    _ done: @escaping (ShieldActionResponse) -> Void, fallback: (STShared.Status) -> STShared.ShieldKind
  ) {
    let s = STShared.status()
    let key: String?
    let primary: STShared.ShieldButton
    let secondary: STShared.ShieldButton?
    if let shown, STShared.kind(of: shown) != nil {
      // The buttons the user saw, and the key the pause clock was started with.
      key = shown.pauseKey ?? tokenKey
      (primary, secondary) = (shown.primary, shown.secondary)
    } else {
      key = tokenKey
      (primary, secondary) = STShared.buttons(fallback(s), s)
    }
    var pressed: STShared.ShieldButton?
    switch action {
    case .primaryButtonPressed: pressed = primary
    case .secondaryButtonPressed: pressed = secondary
    default: pressed = nil
    }
    // An unlock shown earlier may have been used up since (on another blocked screen).
    if pressed == .emergency && !s.emergency { pressed = .close }
    if pressed == .oneMore && !s.oneMore { pressed = .close }
    switch pressed {
    case .earn:
      STShared.requestEarn()
      if #available(iOS 26.5, *) {
        // Opens Trueline (the app that holds the Screen Time permission).
        done(.openParentalControlsApp)
      } else {
        // Extensions can't open apps before iOS 26.5: a notification takes the user there.
        notify(id: "st.earn", title: "Earn your time", body: "Tap to open Trueline and do a set.", url: "trueline://earn") { done(.close) }
      }
    case .workout:
      let scan = STShared.plan?.focusKind == "key"
      if scan { STShared.requestScan() }
      if #available(iOS 26.5, *) {
        done(.openParentalControlsApp)
      } else if scan {
        notify(id: "st.scan", title: "Scan your key", body: "Tap to open Trueline and scan your key.", url: "trueline://screen-time/scan") { done(.close) }
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

  private func notify(id: String, title: String, body: String, url: String, _ then: @escaping () -> Void) {
    let content = UNMutableNotificationContent()
    content.title = title
    content.body = body
    content.userInfo = ["url": url]
    let req = UNNotificationRequest(identifier: id, content: content, trigger: nil)
    UNUserNotificationCenter.current().add(req) { _ in then() }
  }
}
