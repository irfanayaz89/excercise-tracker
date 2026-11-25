import ManagedSettings
import ManagedSettingsUI
import UIKit

/// The screen shown over a blocked app or site: why it's blocked, until when,
/// and what the user can do about it (earn time, an emergency unlock, or close).
class ShieldConfigurationExtension: ShieldConfigurationDataSource {
  override func configuration(shielding application: Application) -> ShieldConfiguration {
    make(application.localizedDisplayName, app: application.token, site: nil, category: nil)
  }

  override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
    make(application.localizedDisplayName, app: application.token, site: nil, category: category.token)
  }

  override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
    make(webDomain.domain, app: nil, site: webDomain.token, category: nil)
  }

  override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
    make(webDomain.domain, app: nil, site: webDomain.token, category: category.token)
  }

  // Trueline's colours (src/ui/theme.ts): pool-tile ground, chalk type, spirit-level vial yellow.
  private let ink = UIColor(red: 0xEE / 255, green: 0xF1 / 255, blue: 0xEA / 255, alpha: 1)
  private let accent = UIColor(red: 0xF3 / 255, green: 0xD6 / 255, blue: 0x4B / 255, alpha: 1)
  private let accentInk = UIColor(red: 0x1D / 255, green: 0x1A / 255, blue: 0x05 / 255, alpha: 1)
  private let bg = UIColor(red: 0x0C / 255, green: 0x1A / 255, blue: 0x1D / 255, alpha: 1)

  private func make(_ name: String?, app appToken: ApplicationToken?, site: WebDomainToken?, category: ActivityCategoryToken?) -> ShieldConfiguration {
    let s = STShared.status()
    let app = name ?? "This app"
    let kind = STShared.shieldKind(app: appToken, site: site, category: category, s)
    // The buttons extension is handed fewer tokens than this one: it reads back what was shown.
    var shown = Shown(
      app: appToken.flatMap { STShared.key($0) }, site: site.flatMap { STShared.key($0) },
      category: category.flatMap { STShared.key($0) })
    shown.pauseKey = shown.app ?? shown.site ?? app
    var lines: [String] = []
    // The plain-words order on every screen: why it's closed, when it opens, what to do now.
    switch kind {
    case .limit(let l):
      lines.append("\(app) has used its \(l.dailyMin ?? 0) minutes today, the limit you set for \(l.name).")
      lines.append("Opens again tomorrow.")
      return config(shown, "\(app) is done for today", lines, kind, s, pauseLeft: 0, app: app, symbol: "hourglass.bottomhalf.filled")
    case .own(let lock):
      lines.append("Your \(lock.name) lock time is on, and \(app) is on its list.")
      if let w = STShared.active(lock, at: Date()) { lines.append(opens(w.1)) }
      return config(shown, "\(app) is locked", lines, kind, s, pauseLeft: 0, app: app, symbol: "lock.fill")
    case .pause:
      let pauseLeft = STShared.pauseLeft(shown.pauseKey ?? app)
      let passMin = STShared.plan?.pause?.passMin ?? 5
      lines.append("You asked for a short pause before opening \(app).")
      lines.append(pauseLeft > 0 ? "Breathe for \(pauseLeft) s, then decide. It opens for \(passMin) minutes." : "Ready. It opens for \(passMin) minutes.")
      return config(shown, "Take a breath", lines, kind, s, pauseLeft: pauseLeft, app: app, symbol: "wind")
    case .main:
      break
    }
    let title: String
    let symbol: String
    if s.reason == "focus" && STShared.plan?.focusKind == "key" {
      title = "\(app) is locked with your key"
      symbol = "key.fill"
      lines.append("You started a key lock. Scan your key in Trueline to open your apps.")
      if let until = s.until { lines.append("If you can't, it ends by itself at \(clock(until)).") }
    } else if s.reason == "limit" {
      title = "Today's time is up"
      symbol = "hourglass.bottomhalf.filled"
      lines.append("You've used your \(STShared.plan?.dailyLimitMin ?? 0) minutes for your blocked apps today.")
      lines.append("Opens again at midnight.")
    } else if s.reason == "focus" {
      title = "Workout in progress"
      symbol = "figure.strengthtraining.functional"
      lines.append(STShared.plan?.focusKind == "set" ? "Your apps wait until your set is done." : "You started a workout focus, so your apps wait until it ends.")
      if let until = s.until { lines.append(opens(until)) }
    } else {
      let name = s.lockName ?? "Lock time"
      title = "\(app) is locked"
      symbol = "lock.fill"
      lines.append(s.blockAll ? "Your \(name) lock time is on. Everything except your always-allowed apps stays closed." : "Your \(name) lock time is on, so your blocked apps stay closed.")
      if let until = s.until { lines.append(opens(until)) }
    }
    if s.canEarn { lines.append("Do a set in Trueline to earn minutes.") }
    if s.mode == "strict" { lines.append("Strict mode: no unlocks. You chose this to stay on track.") }
    return config(shown, title, lines, kind, s, pauseLeft: 0, app: app, symbol: symbol)
  }

  /// "Opens at 7:00 AM (6 h 12 min left)", with the day when it isn't today.
  private func opens(_ at: Date) -> String {
    let min = max(1, Int(ceil(at.timeIntervalSinceNow / 60)))
    let left = min < 60 ? "\(min) min" : (min % 60 == 0 ? "\(min / 60) h" : "\(min / 60) h \(min % 60) min")
    return "Opens at \(clock(at)) (\(left) left)."
  }

  private func clock(_ at: Date) -> String {
    let f = DateFormatter()
    f.timeStyle = .short
    f.dateStyle = .none
    if Calendar.current.isDate(at, inSameDayAs: Date()) { return f.string(from: at) }
    if Calendar.current.isDateInTomorrow(at) { return "tomorrow \(f.string(from: at))" }
    f.dateStyle = .short
    return f.string(from: at)
  }

  /// The tokens of the shield being drawn, as keys (see STShared.ShieldShown).
  private struct Shown {
    var app: String?
    var site: String?
    var category: String?
    var pauseKey: String?
  }

  private func config(_ shown: Shown, _ title: String, _ lines: [String], _ kind: STShared.ShieldKind, _ s: STShared.Status, pauseLeft: Int, app: String, symbol: String) -> ShieldConfiguration {
    let (primary, secondary) = STShared.buttons(kind, s)
    STShared.recordShown(kind, (primary, secondary), app: shown.app, site: shown.site, category: shown.category, pauseKey: shown.pauseKey)
    return ShieldConfiguration(
      backgroundBlurStyle: .systemUltraThinMaterialDark,
      backgroundColor: bg,
      icon: UIImage(systemName: symbol, withConfiguration: UIImage.SymbolConfiguration(pointSize: 44, weight: .semibold))?
        .withTintColor(accent, renderingMode: .alwaysOriginal),
      title: .init(text: title, color: ink),
      subtitle: .init(text: lines.joined(separator: "\n\n"), color: ink.withAlphaComponent(0.78)),
      primaryButtonLabel: .init(text: label(primary, s, pauseLeft: pauseLeft, app: app), color: accentInk),
      primaryButtonBackgroundColor: accent,
      secondaryButtonLabel: secondary.map { .init(text: label($0, s, pauseLeft: pauseLeft, app: app), color: ink) })
  }

  private func label(_ b: STShared.ShieldButton, _ s: STShared.Status, pauseLeft: Int, app: String) -> String {
    switch b {
    case .open: return pauseLeft > 0 ? "Open in \(pauseLeft) s" : "Open \(app)"
    case .earn: return "Earn time"
    case .workout: return STShared.plan?.focusKind == "key" ? "Scan my key" : "Back to workout"
    case .emergency: return "Emergency · \(STShared.plan?.emergencyMin ?? 10) min"
    case .oneMore: return (STShared.plan?.oneMoreMin ?? 1) == 1 ? "1 more minute" : "\(STShared.plan?.oneMoreMin ?? 1) more minutes"
    case .close: return "Close"
    }
  }
}
