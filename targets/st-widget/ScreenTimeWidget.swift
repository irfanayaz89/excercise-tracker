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

  func read(_ now: Date = Date()) -> STEntry {
    guard
      let data = UserDefaults(suiteName: Self.group)?.data(forKey: "st.widget"),
      let o = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
    else { return STEntry(date: now, title: "Screen time is off", until: nil) }
    let until = (o["until"] as? Double).map { Date(timeIntervalSince1970: $0 / 1000) }
    return STEntry(date: now, title: o["title"] as? String ?? "Screen time", until: until.flatMap { $0 > now ? $0 : nil })
  }

  func placeholder(in context: Context) -> STEntry { STEntry(date: Date(), title: "Work", until: Date().addingTimeInterval(3600)) }

  func getSnapshot(in context: Context, completion: @escaping (STEntry) -> Void) { completion(read()) }

  func getTimeline(in context: Context, completion: @escaping (Timeline<STEntry>) -> Void) {
    let e = read()
    // Look again when the shown block ends, or in 15 minutes; the app also reloads it on changes.
    let next = e.until ?? Date().addingTimeInterval(15 * 60)
    completion(Timeline(entries: [e], policy: .after(next)))
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
