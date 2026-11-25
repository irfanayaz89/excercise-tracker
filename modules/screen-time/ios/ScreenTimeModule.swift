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
      // The notice below only reaches a running app: look for tokens dropped while it was closed.
      STShared.locked { STShared.checkDroppedTokens() }
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

    // On the main actor: Apple's prompt is UI (an async closure can't take runOnQueue).
    AsyncFunction("requestAuthorization") { () async -> String in
      await Self.askAuthorization()
    }

    /// A clock the user can't change: milliseconds since boot (counting sleep) and this boot's id.
    Function("clock") { () -> [String: Any] in
      ["uptimeMs": STShared.uptimeMs(), "boot": STShared.bootId]
    }

    /// Show Apple's app picker, starting from `current` (token strings as the app stores them).
    /// Resolves with the new picked strings and counts, or null if cancelled. Nothing is applied
    /// here: the app checks the change against its rules first, then sends a new plan.
    AsyncFunction("pickApps") { (title: String, current: [String: [String]], promise: Promise) in
      guard let presenter = Self.topViewController() else {
        promise.reject("NO_VIEW", "Nothing to present the picker from")
        return
      }
      // Already presenting or dismissing something: presenting now would fail and leave the promise hanging.
      if presenter.isBeingDismissed || presenter.isBeingPresented || presenter.presentedViewController != nil {
        promise.reject("BUSY", "Another screen is showing")
        return
      }
      let start = STShared.Sel(apps: current["apps"] ?? [], categories: current["categories"] ?? [], domains: current["domains"] ?? []).family
      weak var host: UIViewController?
      var settled = false
      let sheet = PickerSheet(selection: start, title: title) { picked in
        // A double tap on Done must not answer twice.
        guard !settled else { return }
        settled = true
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
      let plan: STShared.Plan
      do {
        plan = try JSONDecoder().decode(STShared.Plan.self, from: data)
      } catch {
        return ["plan: \(error.localizedDescription)"]
      }
      Self.noteNotifications()
      // All of it under the cross-process lock, so a monitor callback in between sees either the
      // old plan and schedules or the new ones, never half of each.
      return STShared.locked {
        // The app's trusted time, held against time since boot: the extensions decide by it.
        STShared.anchorClock(madeAt: plan.madeAt)
        STShared.save("st.plan", plan)
        // The limit monitoring keeps running through a sync unless the day or what it watches
        // changed: restarting it would lose the use counted since its last 15-minute step.
        let rearmLimit = !STShared.limitArmCurrent(plan)
        let reached = plan.day == STShared.dayKey(STShared.now()) && plan.limitReached
        STShared.updateState { st in
          // With the same monitoring running, a "limit" event it already sent stays counted
          // (it won't fire again); a new arm measures afresh from the plan.
          st.limitReached = rearmLimit ? reached : (st.limitReached || reached)
        }
        let errors = STShared.scheduleAll(rearmLimit: rearmLimit)
        // Earned-time monitoring likewise keeps running unless the amount it expects changed.
        STShared.keepOrStopEarned()
        STShared.reapply()
        return errors
      }
    }

    /// What the extensions recorded since the last read (usage, earned minutes spent,
    /// blocked-screen unlocks and "earn time" taps). Clears the one-off parts.
    Function("takeState") { () -> String in
      STShared.locked { Self.takeState() }
    }

    Function("takeUnlock") { (kind: String, minutes: Int) in
      STShared.takeUnlock(kind: kind, minutes: minutes)
    }

    Function("reloadWidget") {
      STShared.writeWidget(STShared.plan == nil ? nil : STShared.status())
    }

    Function("stopAll") {
      // Removes the plan before stopping the schedules (see STShared.stopAll).
      STShared.stopAll()
    }

    AsyncFunction("requestNotifications") { () async -> Bool in
      let ok = (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
      Self.noteNotifications()
      return ok
    }
  }

  /// Hands over the state and takes off only what was handed, in one go under the lock, so a write
  /// from an extension in between can't be lost.
  private static func takeState() -> String {
    let st = STShared.state()
    var dict = (try? JSONEncoder().encode(st)).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
    if STShared.defaults?.bool(forKey: "st.tokensExpired") == true {
      dict["tokensExpired"] = true
      STShared.defaults?.removeObject(forKey: "st.tokensExpired")
    }
    let out = (try? JSONSerialization.data(withJSONObject: dict)).flatMap { String(data: $0, encoding: .utf8) } ?? "{}"
    // Take off only what was handed over, on a fresh read: an extension may have written since
    // (a "limit" event, an unlock, more earned minutes), and that must not be lost.
    let handed = Set(st.unlocks.map { "\($0.kind):\($0.from)" })
    STShared.updateState { fresh in
      fresh.unlocks.removeAll { handed.contains("\($0.kind):\($0.from)") }
      if st.openEarn { fresh.openEarn = false }
      if st.openScan == true { fresh.openScan = nil }
      if fresh.day == st.day { fresh.earnedSpentMin = max(0, fresh.earnedSpentMin - st.earnedSpentMin) }
    }
    return out
  }

  @MainActor
  private static func askAuthorization() async -> String {
    do {
      try await AuthorizationCenter.shared.requestAuthorization(for: .individual)
    } catch {
      // Declined or unavailable: report the status as it now is.
    }
    return statusName(AuthorizationCenter.shared.authorizationStatus)
  }

  /// Below iOS 26.5 the blocked screen reaches Trueline only through a notification: note whether
  /// they're allowed, so the blocked screen can say to open Trueline by hand when they aren't.
  private static func noteNotifications() {
    UNUserNotificationCenter.current().getNotificationSettings { s in
      let ok: Bool = [UNAuthorizationStatus.authorized, .provisional, .ephemeral].contains(s.authorizationStatus)
      STShared.defaults?.set(ok, forKey: "st.notify")
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
