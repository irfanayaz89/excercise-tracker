import SwiftUI
import WidgetKit

/// Home screen widget: what screen time is doing now ("Work until 17:00", "Key lock", "Daily
/// limit 60 min"). It reads the summary STShared.writeWidget keeps in the app group.
struct STEntry: TimelineEntry {
  let date: Date
  let title: String
  let until: Date?
}

struct STProvider: TimelineProvider {
  static let group = "group.com.exercisetracker.trueline"

  /// How far the phone clock is ahead of the trusted one (STShared.now(): the anchor the app stores
  /// at each sync, moved on by the time since boot), so a moved clock doesn't end a block early here.
  static func skew(_ wall: Date) -> TimeInterval {
    var size = 0
    guard
      let data = UserDefaults(suiteName: group)?.data(forKey: "st.clock"),
      let a = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let madeAt = a["madeAt"] as? Double, let up = a["uptimeMs"] as? Double, let boot = a["boot"] as? String,
      sysctlbyname("kern.bootsessionuuid", nil, &size, nil, 0) == 0, size > 0
    else { return 0 }
    var buf = [CChar](repeating: 0, count: size)
    guard sysctlbyname("kern.bootsessionuuid", &buf, &size, nil, 0) == 0, !boot.isEmpty, String(cString: buf) == boot else { return 0 }
    let expected = madeAt + (Double(clock_gettime_nsec_np(CLOCK_MONOTONIC)) / 1e6 - up)
    let d = wall.timeIntervalSince1970 * 1000 - expected
    return abs(d) > 120_000 ? d / 1000 : 0
  }

  /// The entry for now and, when the shown state has an end, one from then with the plain title
  /// (until the app or an extension writes the next state).
  func read(_ wall: Date = Date()) -> [STEntry] {
    guard
      let data = UserDefaults(suiteName: Self.group)?.data(forKey: "st.widget"),
      let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return [STEntry(date: wall, title: "Screen time is off", until: nil)] }
    let title = o["title"] as? String ?? "Screen time"
    let after = o["after"] as? String ?? "Screen time is on"
    guard let ms = o["until"] as? Double else { return [STEntry(date: wall, title: title, until: nil)] }
    let until = Date(timeIntervalSince1970: ms / 1000)
    let now = wall.addingTimeInterval(-Self.skew(wall))
    guard until > now else { return [STEntry(date: wall, title: after, until: nil)] }
    // Entries are dated by the phone clock; the shown time stays the trusted one.
    return [STEntry(date: wall, title: title, until: until), STEntry(date: wall.addingTimeInterval(until.timeIntervalSince(now)), title: after, until: nil)]
  }

  func placeholder(in context: Context) -> STEntry { STEntry(date: Date(), title: "Work", until: Date().addingTimeInterval(3600)) }

  func getSnapshot(in context: Context, completion: @escaping (STEntry) -> Void) { completion(read()[0]) }

  func getTimeline(in context: Context, completion: @escaping (Timeline<STEntry>) -> Void) {
    let es = read()
    // Look again once the last entry is shown, or in 15 minutes; the app also reloads it on changes.
    let next = es.count > 1 ? es[es.count - 1].date : Date().addingTimeInterval(15 * 60)
    completion(Timeline(entries: es, policy: .after(next)))
  }
}

struct STWidgetView: View {
  let entry: STEntry
  private let vial = Color(red: 0xF3 / 255, green: 0xD6 / 255, blue: 0x4B / 255)
  private let chalk = Color(red: 0xEE / 255, green: 0xF1 / 255, blue: 0xEA / 255)

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text("SCREEN TIME").font(.caption2.weight(.bold)).foregroundStyle(vial)
      Text(entry.title).font(.headline).foregroundStyle(chalk).lineLimit(2)
      if let until = entry.until {
        Text("until \(until, style: .time)").font(.subheadline).foregroundStyle(chalk.opacity(0.7))
      }
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .containerBackground(Color(red: 0x0C / 255, green: 0x1A / 255, blue: 0x1D / 255), for: .widget)
    .widgetURL(URL(string: "trueline://screen-time"))
  }
}

@main
struct ScreenTimeWidget: Widget {
  var body: some WidgetConfiguration {
    StaticConfiguration(kind: "st-widget", provider: STProvider()) { STWidgetView(entry: $0) }
      .configurationDisplayName("Screen time")
      .description("What's blocked now, and until when.")
      .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular])
  }
}
