import DeviceActivity
import ExpoModulesCore
import FamilyControls
import ManagedSettings
import SwiftUI
import UserNotifications

/// Trueline's Screen Time bridge. The app's TypeScript engine (src/screentime)
/// decides; this module stores the plan where the extensions can read it,
/// applies blocks, and (re)starts the schedules. See STShared.swift.
public class ScreenTimeModule: Module {
  private var expiryObserver: Any?

  public func definition() -> ModuleDefinition {
    Name("ScreenTime")

    // iOS 26.5+: stored app tokens can expire. Remember it, so the app asks the user to pick again.
    OnCreate {
      if #available(iOS 26.5, *) {
        self.expiryObserver = NotificationCenter.default.addObserver(of: ManagedSettingsStore.self, for: .tokensDidExpire) { _ in
          STShared.defaults?.set(true, forKey: "st.tokensExpired")
        }
      }
    }

    /// Only builds made with SCREEN_TIME=1 carry the Family Controls entitlement (see app.config.js).
    Function("isSupported") { () -> Bool in
      guard #available(iOS 17.4, *) else { return false }
      return Bundle.main.object(forInfoDictionaryKey: "TruelineScreenTime") as? Bool == true
    }

    Function("authorizationStatus") { () -> String in
      Self.statusName(AuthorizationCenter.shared.authorizationStatus)
    }

    AsyncFunction("requestAuthorization") { () async -> String in
      do {
        try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
      } catch {
        // Declined or unavailable: report the status as it now is.
      }
      return Self.statusName(AuthorizationCenter.shared.authorizationStatus)
    }

    /// Show Apple's app picker, starting from `current` (token strings as the app stores them).
    /// Resolves with the new picked strings and counts, or null if cancelled. Nothing is applied
    /// here: the app checks the change against its rules first, then sends a new plan.
    AsyncFunction("pickApps") { (title: String, current: [String: [String]], promise: Promise) in
      guard let presenter = Self.topViewController() else {
        promise.reject("NO_VIEW", "Nothing to present the picker from")
        return
      }
      let start = STShared.Sel(apps: current["apps"] ?? [], categories: current["categories"] ?? [], domains: current["domains"] ?? []).family
      var host: UIViewController?
      let sheet = PickerSheet(selection: start, title: title) { picked in
        host?.dismiss(animated: true)
        promise.resolve(picked.map { Self.summary($0) })
      }
      let vc = UIHostingController(rootView: sheet)
      // Swiping the sheet away would leave the promise hanging: Cancel and Done are the ways out.
      vc.isModalInPresentation = true
      host = vc
      presenter.present(vc, animated: true)
    }.runOnQueue(.main)

    /// Store the plan, apply blocks for right now, and (re)start the schedules.
    /// Returns any schedule errors (empty when all is well).
    Function("sync") { (planJson: String) -> [String] in
      guard let data = planJson.data(using: .utf8) else { return ["bad plan"] }
      do {
        let plan = try JSONDecoder().decode(STShared.Plan.self, from: data)
        STShared.save("st.plan", plan)
        // The app has taken in the extensions' counts: they start again from here.
        var st = STShared.state()
        st.earnedSpentMin = 0
        st.earnedBase = 0
        st.earnedArmed = false
        st.limitReached = plan.limitReached
        STShared.saveState(st)
        DeviceActivityCenter().stopMonitoring([DeviceActivityName("st.earned")])
        let errors = STShared.scheduleAll()
        STShared.reapply()
        return errors
      } catch {
        return ["plan: \(error.localizedDescription)"]
      }
    }

    /// What the extensions recorded since the last read (usage, earned minutes spent,
    /// blocked-screen unlocks and "earn time" taps). Clears the one-off parts.
    Function("takeState") { () -> String in
      let st = STShared.state()
      var dict = (try? JSONEncoder().encode(st)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
      if STShared.defaults?.bool(forKey: "st.tokensExpired") == true {
        dict["tokensExpired"] = true
        STShared.defaults?.removeObject(forKey: "st.tokensExpired")
      }
      let out = (try? JSONSerialization.data(withJSONObject: dict)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
      var cleared = st
      cleared.unlocks = []
      cleared.openEarn = false
      STShared.saveState(cleared)
      return out
    }

    Function("takeUnlock") { (kind: String, minutes: Int) in
      STShared.takeUnlock(kind: kind, minutes: minutes)
    }

    Function("stopAll") {
      STShared.stopAll()
      STShared.defaults?.removeObject(forKey: "st.plan")
    }

    AsyncFunction("requestNotifications") { () async -> Bool in
      (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
    }
  }

  private static func statusName(_ s: AuthorizationStatus) -> String {
    switch s {
    case .approved: return "approved"
    case .denied: return "denied"
    default: return "notDetermined"
    }
  }

  private static func summary(_ sel: FamilyActivitySelection) -> [String: Any] {
    let t = STShared.Sel(sel)
    var out: [String: Any] = ["apps": t.apps, "categories": t.categories, "domains": t.domains]
    out["appCount"] = sel.applicationTokens.count
    out["categoryCount"] = sel.categoryTokens.count
    out["domainCount"] = sel.webDomainTokens.count
    return out
  }

  private static func topViewController() -> UIViewController? {
    let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first { $0.activationState == .foregroundActive }
      ?? UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
    var top = scene?.windows.first { $0.isKeyWindow }?.rootViewController ?? scene?.windows.first?.rootViewController
    while let presented = top?.presentedViewController { top = presented }
    return top
  }
}

/// Apple's picker in a sheet with Cancel / Done.
struct PickerSheet: View {
  @State var selection: FamilyActivitySelection
  let title: String
  let done: (FamilyActivitySelection?) -> Void

  var body: some View {
    NavigationView {
      FamilyActivityPicker(selection: $selection)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
          ToolbarItem(placement: .cancellationAction) { Button("Cancel") { done(nil) } }
          ToolbarItem(placement: .confirmationAction) { Button("Done") { done(selection) } }
        }
    }
  }
}
