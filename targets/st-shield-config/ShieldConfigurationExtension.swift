import ManagedSettings
import ManagedSettingsUI
import UIKit

/// The screen shown over a blocked app or site: why it's blocked, until when,
/// and what the user can do about it (earn time, an emergency unlock, or close).
class ShieldConfigurationExtension: ShieldConfigurationDataSource {
  override func configuration(shielding application: Application) -> ShieldConfiguration {
    make(application.localizedDisplayName)
  }

  override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
    make(application.localizedDisplayName)
  }

  override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
    make(webDomain.domain)
  }

  override func configuration(shielding webDomain: WebDomain, in category: ActivityCategory) -> ShieldConfiguration {
    make(webDomain.domain)
  }

  // Trueline's colours (src/ui/theme.ts): pool-tile ground, chalk type, spirit-level vial yellow.
  private let ink = UIColor(red: 0xEE / 255, green: 0xF1 / 255, blue: 0xEA / 255, alpha: 1)
  private let accent = UIColor(red: 0xF3 / 255, green: 0xD6 / 255, blue: 0x4B / 255, alpha: 1)
  private let accentInk = UIColor(red: 0x1D / 255, green: 0x1A / 255, blue: 0x05 / 255, alpha: 1)
  private let bg = UIColor(red: 0x0C / 255, green: 0x1A / 255, blue: 0x1D / 255, alpha: 1)

  private func make(_ name: String?) -> ShieldConfiguration {
    let s = STShared.status()
    let app = name ?? "This app"
    let title: String
    var lines: [String] = []
    if s.reason == "limit" {
      title = "Today's time is up"
      lines.append("\(app) is past your daily limit.")
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
    let (primary, secondary) = STShared.buttons(s)
    return ShieldConfiguration(
      backgroundBlurStyle: .systemUltraThinMaterialDark,
      backgroundColor: bg,
      icon: UIImage(systemName: "figure.strengthtraining.functional")?.withTintColor(accent, renderingMode: .alwaysOriginal),
      title: .init(text: title, color: ink),
      subtitle: .init(text: lines.joined(separator: "\n"), color: ink.withAlphaComponent(0.7)),
      primaryButtonLabel: .init(text: label(primary, s), color: accentInk),
      primaryButtonBackgroundColor: accent,
      secondaryButtonLabel: secondary.map { .init(text: label($0, s), color: ink) })
  }

  private func label(_ b: STShared.ShieldButton, _ s: STShared.Status) -> String {
    switch b {
    case .earn: return "Earn time"
    case .emergency: return "Emergency: \(STShared.plan?.emergencyMin ?? 10) min"
    case .oneMore: return (STShared.plan?.oneMoreMin ?? 1) == 1 ? "1 more minute" : "\(STShared.plan?.oneMoreMin ?? 1) more minutes"
    case .close: return "Close"
    }
  }
}
