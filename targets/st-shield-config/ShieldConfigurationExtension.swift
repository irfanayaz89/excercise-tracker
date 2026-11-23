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
    let title: String
    var lines: [String] = []
    var pauseLeft = 0
    switch kind {
    case .limit(let l):
      title = "\(l.name): done for today"
      lines.append("\(app) has used its \(l.dailyMin ?? 0) minutes today. It opens again tomorrow.")
      return config(title, lines, kind, s, pauseLeft: 0, app: app)
    case .own(let lock):
      title = "\(lock) is on"
      lines.append("\(app) is locked for now.")
      return config(title, lines, kind, s, pauseLeft: 0, app: app)
    case .pause:
      let key = appToken.flatMap { STShared.key($0) } ?? site.flatMap { STShared.key($0) } ?? app
      pauseLeft = STShared.pauseLeft(key)
      let passMin = STShared.plan?.pause?.passMin ?? 5
      lines.append(pauseLeft > 0 ? "Wait \(pauseLeft) s, then tap Open. \(app) opens for \(passMin) minutes." : "\(app) opens for \(passMin) minutes.")
      lines.append("Each pass today makes the next wait a little longer.")
      return config("Take a breath", lines, kind, s, pauseLeft: pauseLeft, app: app)
    case .main:
      break
    }
    if s.reason == "focus" && STShared.plan?.focusKind == "key" {
      title = "Key lock is on"
      if let until = s.until {
        let f = DateFormatter()
        f.timeStyle = .short
        lines.append("\(app) opens when you scan your key in Trueline, or at \(f.string(from: until)).")
      }
    } else if s.reason == "limit" {
      title = "Today's time is up"
      lines.append("\(app) is past your daily limit.")
    } else if s.reason == "focus" {
      title = "Workout in progress"
      if let until = s.until {
        let mins = max(1, Int(ceil(until.timeIntervalSinceNow / 60)))
        let setOnly = STShared.plan?.focusKind == "set"
        lines.append(setOnly ? "\(app) opens again when the set is done (at most \(mins) min)." : "\(app) opens again in \(mins) min.")
      }
    } else {
      title = s.lockName.map { "\($0) is on" } ?? "\(app) is locked"
      if let until = s.until {
        let f = DateFormatter()
        f.timeStyle = .short
        f.dateStyle = Calendar.current.isDate(until, inSameDayAs: Date()) ? .none : .short
        lines.append("Locked until \(f.string(from: until)).")
      }
    }
    if s.canEarn { lines.append("Do a set in Trueline to earn more time.") }
    return config(title, lines, kind, s, pauseLeft: 0, app: app)
  }

  private func config(_ title: String, _ lines: [String], _ kind: STShared.ShieldKind, _ s: STShared.Status, pauseLeft: Int, app: String) -> ShieldConfiguration {
    let (primary, secondary) = STShared.buttons(kind, s)
    return ShieldConfiguration(
      backgroundBlurStyle: .systemUltraThinMaterialDark,
      backgroundColor: bg,
      icon: UIImage(systemName: "figure.strengthtraining.functional")?.withTintColor(accent, renderingMode: .alwaysOriginal),
      title: .init(text: title, color: ink),
      subtitle: .init(text: lines.joined(separator: "\n"), color: ink.withAlphaComponent(0.7)),
      primaryButtonLabel: .init(text: label(primary, s, pauseLeft: pauseLeft, app: app), color: accentInk),
      primaryButtonBackgroundColor: accent,
      secondaryButtonLabel: secondary.map { .init(text: label($0, s, pauseLeft: pauseLeft, app: app), color: ink) })
  }

  private func label(_ b: STShared.ShieldButton, _ s: STShared.Status, pauseLeft: Int, app: String) -> String {
    switch b {
    case .open: return pauseLeft > 0 ? "Open in \(pauseLeft) s" : "Open \(app)"
    case .earn: return "Earn time"
    case .workout: return STShared.plan?.focusKind == "key" ? "Scan my key" : "Back to workout"
    case .emergency: return "Emergency: \(STShared.plan?.emergencyMin ?? 10) min"
    case .oneMore: return (STShared.plan?.oneMoreMin ?? 1) == 1 ? "1 more minute" : "\(STShared.plan?.oneMoreMin ?? 1) more minutes"
    case .close: return "Close"
    }
  }
}
