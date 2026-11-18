import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings

/// Shared by Trueline's ScreenTime module and its three Screen Time extensions
/// (monitor, blocked-screen text, blocked-screen buttons). The same file is
/// linked into each target (targets/*/STShared.swift are links to this file).
///
/// The app's TypeScript rules engine (src/screentime) is the authority: when the
/// app is open it works out the plan and writes it here. While Trueline is closed,
/// the extensions use this file to act on that plan at lock-time boundaries,
/// usage thresholds and blocked-screen taps. Keep `status(at:)` in step with
/// `decide()` in src/screentime/decide.ts.
enum STShared {
  static let appGroup = "group.com.exercisetracker.trueline"
  static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

  // MARK: Plan (written by the app) and state (written by the extensions)

  /// Picked apps, categories and sites as opaque strings (each a base64 JSON-encoded token).
  struct Sel: Codable {
    var apps: [String] = []
    var categories: [String] = []
    var domains: [String] = []

    init(apps: [String] = [], categories: [String] = [], domains: [String] = []) {
      self.apps = apps
      self.categories = categories
      self.domains = domains
    }

    init(_ f: FamilyActivitySelection) {
      func enc<T: Encodable>(_ xs: Set<T>) -> [String] {
        xs.compactMap { try? JSONEncoder().encode($0).base64EncodedString() }.sorted()
      }
      self.init(apps: enc(f.applicationTokens), categories: enc(f.categoryTokens), domains: enc(f.webDomainTokens))
    }

    var family: FamilyActivitySelection {
      func dec<T: Decodable & Hashable>(_ xs: [String], _ t: T.Type) -> Set<T> {
        Set(xs.compactMap { Data(base64Encoded: $0).flatMap { try? JSONDecoder().decode(T.self, from: $0) } })
      }
      var f = FamilyActivitySelection()
      f.applicationTokens = dec(apps, ApplicationToken.self)
      f.categoryTokens = dec(categories, ActivityCategoryToken.self)
      f.webDomainTokens = dec(domains, WebDomainToken.self)
      return f
    }

    var isEmpty: Bool { apps.isEmpty && categories.isEmpty && domains.isEmpty }
  }

  struct LockPlan: Codable {
    let id: String
    let name: String
    /// 0 = Sunday … 6 = Saturday: the days a window starts on.
    let days: [Int]
    let startMin: Int
    let endMin: Int
    let earnable: Bool
    let enabled: Bool
    let skipDate: String?
    /// Blocks its own selection instead of the main list.
    let ownApps: Bool
    let apps: Sel?
  }

  struct Plan: Codable {
    /// Local day the plan's counts refer to ("YYYY-MM-DD").
    var day: String
    var dailyLimitMin: Int?
    var limitReached: Bool
    var earningEnabled: Bool
    var earnedLeftMin: Int
    var earnCapLeftMin: Int
    var mode: String
    var emergencyMin: Int
    var oneMoreMin: Int
    var emergenciesLeft: Int
    var oneMoresLeft: Int
    /// An unlock already granted in the app (epoch ms).
    var unlockUntil: Double?
    var locks: [LockPlan]
    var blocked: Sel
    var allowed: Sel
  }

  struct Unlock: Codable {
    var kind: String
    var from: Double
    var until: Double
  }

  struct State: Codable {
    var day: String = ""
    /// Usage of the blocked apps today, in 5-minute steps (from thresholds).
    var usedMin: Int = 0
    var limitReached: Bool = false
    /// Earned minutes spent since the app last read this state.
    var earnedSpentMin: Int = 0
    /// Earned-time monitoring is running (so it isn't restarted from zero).
    var earnedArmed: Bool = false
    /// Earned minutes already spent when the current monitoring started.
    var earnedBase: Int = 0
    /// Unlocks taken on the blocked screen since the app last read this state.
    var unlocks: [Unlock] = []
    /// The user tapped "Earn time" on the blocked screen: open the earn screen.
    var openEarn: Bool = false
  }

  static func load<T: Decodable>(_ key: String, _ type: T.Type) -> T? {
    guard let data = defaults?.data(forKey: key) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  static func save<T: Encodable>(_ key: String, _ value: T) {
    guard let data = try? JSONEncoder().encode(value) else { return }
    defaults?.set(data, forKey: key)
  }

  static var plan: Plan? { load("st.plan", Plan.self) }

  /// Today's state (a new day starts fresh).
  static func state(now: Date = Date()) -> State {
    var s = load("st.state", State.self) ?? State()
    let today = dayKey(now)
    if s.day != today {
      s = State(day: today, unlocks: s.unlocks, openEarn: s.openEarn)
    }
    return s
  }

  static func saveState(_ s: State) { save("st.state", s) }

  // MARK: Selections (they travel in the plan: the app's rules decide what's picked)

  /// "main" (the blocked apps), "allowed", or "lock.<id>" (a lock time with its own apps).
  static func selection(_ key: String) -> FamilyActivitySelection? {
    guard let p = plan else { return nil }
    let sel: Sel?
    switch key {
    case "main": sel = p.blocked
    case "allowed": sel = p.allowed
    default: sel = p.locks.first { "lock.\($0.id)" == key }?.apps
    }
    guard let sel, !sel.isEmpty else { return nil }
    return sel.family
  }

  // MARK: Local time

  static func dayKey(_ d: Date) -> String {
    let c = Calendar.current.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
  }

  /// The window of a lock time that starts on the local day containing `day`.
  static func window(_ lock: LockPlan, startingOn day: Date) -> (start: Date, end: Date)? {
    let cal = Calendar.current
    let weekday = cal.component(.weekday, from: day) - 1
    guard lock.enabled, lock.days.contains(weekday), lock.skipDate != dayKey(day) else { return nil }
    let midnight = cal.startOfDay(for: day)
    guard
      let start = cal.date(bySettingHour: lock.startMin / 60, minute: lock.startMin % 60, second: 0, of: midnight),
      let endDay = lock.endMin > lock.startMin ? midnight : cal.date(byAdding: .day, value: 1, to: midnight),
      let end = cal.date(bySettingHour: lock.endMin / 60, minute: lock.endMin % 60, second: 0, of: endDay),
      end > start
    else { return nil }
    return (start, end)
  }

  /// The running window of a lock time, if any (it may have started yesterday).
  static func active(_ lock: LockPlan, at now: Date) -> (start: Date, end: Date)? {
    guard let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now) else { return nil }
    for d in [yesterday, now] {
      if let w = window(lock, startingOn: d), w.start <= now, now < w.end { return w }
    }
    return nil
  }

  // MARK: What should happen now (mirror of decide())

  struct Status {
    var blocked = false
    var reason: String? = nil
    var lockName: String? = nil
    var until: Date? = nil
    var usingEarned = false
    var earnedLeft = 0
    var canEarn = false
    var emergency = false
    var oneMore = false
    var ownBlocked: [String] = []
  }

  static func status(at now: Date = Date()) -> Status {
    guard let p = plan else { return Status() }
    let st = state(now: now)
    let nowMs = now.timeIntervalSince1970 * 1000
    let today = dayKey(now)
    let planToday = p.day == today
    let earnedLeft = p.earningEnabled && planToday ? max(0, p.earnedLeftMin - st.earnedSpentMin) : 0
    let limitReached = p.dailyLimitMin != nil && (p.dailyLimitMin == 0 || st.limitReached || (planToday && p.limitReached))
    let unlocked = (p.unlockUntil ?? 0) > nowMs || st.unlocks.contains { $0.from <= nowMs && nowMs < $0.until }

    var s = Status()
    s.earnedLeft = earnedLeft
    let running = p.locks.compactMap { l in active(l, at: now).map { (l, $0) } }
    let main = running.filter { !$0.0.ownApps }
    let hard = main.filter { !$0.0.earnable }
    let soft = main.filter { $0.0.earnable }
    if !hard.isEmpty {
      s.reason = "lock"
    } else if !soft.isEmpty {
      if earnedLeft > 0 { s.usingEarned = true } else { s.reason = "lock" }
    } else if limitReached {
      if earnedLeft > 0 { s.usingEarned = true } else { s.reason = "limit" }
    }
    if unlocked {
      s.reason = nil
      s.usingEarned = false
    }
    let blocking = s.reason == "lock" ? (hard.isEmpty ? soft : hard) : []
    if let last = blocking.max(by: { $0.1.end < $1.1.end }) {
      s.lockName = last.0.name
      s.until = last.1.end
    }
    s.blocked = s.reason != nil
    s.ownBlocked = running.filter { $0.0.ownApps && !unlocked && !($0.0.earnable && earnedLeft > 0) }.map { $0.0.id }
    s.canEarn = s.blocked && p.earningEnabled && p.earnCapLeftMin > 0 && (s.reason == "limit" || blocking.allSatisfy { $0.0.earnable })
    let any = s.blocked || !s.ownBlocked.isEmpty
    let usedEmergencies = st.unlocks.filter { $0.kind == "emergency" }.count
    let usedOneMores = st.unlocks.filter { $0.kind == "one-more" }.count
    s.emergency = any && p.mode == "standard" && p.emergenciesLeft - usedEmergencies > 0
    s.oneMore = any && p.mode == "nudge" && p.oneMoresLeft - usedOneMores > 0
    return s
  }

  // MARK: Blocked-screen buttons (shared by the shield's text and its actions)

  enum ShieldButton { case earn, emergency, oneMore, close }

  /// The blocked screen has a main button and at most one more.
  static func buttons(_ s: Status) -> (primary: ShieldButton, secondary: ShieldButton?) {
    let escape: ShieldButton? = s.emergency ? .emergency : s.oneMore ? .oneMore : nil
    if s.canEarn { return (.earn, escape ?? .close) }
    return (.close, escape)
  }

  /// The user asked to earn time: Trueline opens on its earn screen next time.
  static func requestEarn() {
    var st = state()
    st.openEarn = true
    saveState(st)
  }

  // MARK: Applying blocks

  static func store(_ name: String) -> ManagedSettingsStore { ManagedSettingsStore(named: .init(name)) }

  static func block(_ name: String, _ sel: FamilyActivitySelection, allowed: FamilyActivitySelection?) {
    let s = store(name)
    let keep = allowed?.applicationTokens ?? []
    let apps = sel.applicationTokens.subtracting(keep)
    s.shield.applications = apps.isEmpty ? nil : apps
    s.shield.applicationCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens, except: keep)
    s.shield.webDomains = sel.webDomainTokens.isEmpty ? nil : sel.webDomainTokens
    s.shield.webDomainCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens, except: allowed?.webDomainTokens ?? [])
  }

  static func unblock(_ name: String) { store(name).clearAllSettings() }

  /// Make the blocks match `status(at:)`. Safe to call any number of times.
  /// `lean` evaluates slightly ahead, so a boundary callback that fires a moment
  /// early (07:00 minus a few ms) already sees the new state.
  static func reapply(at nowIn: Date = Date(), lean: TimeInterval = 0) {
    let now = nowIn.addingTimeInterval(lean)
    guard let p = plan else {
      unblockAll()
      return
    }
    let s = status(at: now)
    let allowed = selection("allowed")
    if s.blocked, let main = selection("main") { block("st.main", main, allowed: allowed) } else { unblock("st.main") }
    let own = p.locks.filter { $0.ownApps }.map { $0.id }
    ownIds = ownIds + own
    for id in ownIds {
      if s.ownBlocked.contains(id), let sel = selection("lock.\(id)") {
        block("st.own.\(id)", sel, allowed: allowed)
      } else {
        unblock("st.own.\(id)")
      }
    }
    // Earned minutes are being spent: watch them run out (only once; restarting would count from zero).
    var st = state(now: now)
    if s.usingEarned && !st.earnedArmed {
      st.earnedArmed = true
      st.earnedBase = st.earnedSpentMin
      saveState(st)
      armEarned(minutes: s.earnedLeft)
    } else if !s.usingEarned && st.earnedArmed {
      DeviceActivityCenter().stopMonitoring([DeviceActivityName("st.earned")])
      st.earnedArmed = false
      saveState(st)
    }
  }

  static func unblockAll() {
    unblock("st.main")
    for id in ownIds { unblock("st.own.\(id)") }
  }

  /// Every own-app lock store ever used (so a deleted lock time's block can still be lifted).
  static var ownIds: [String] {
    get { defaults?.stringArray(forKey: "st.ownIds") ?? [] }
    set { defaults?.set(Array(Set(newValue)).sorted(), forKey: "st.ownIds") }
  }

  // MARK: Monitoring

  private static func comps(_ minuteOfDay: Int, second: Int = 0) -> DateComponents {
    DateComponents(hour: minuteOfDay / 60, minute: minuteOfDay % 60, second: second)
  }

  @available(iOS 17.4, *)
  private static func events(for sel: FamilyActivitySelection, prefix: String, upTo: Int, step: Int, final: Int?) -> [DeviceActivityEvent.Name: DeviceActivityEvent] {
    var out: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
    var m = step
    while m <= upTo {
      out[DeviceActivityEvent.Name("\(prefix)\(m)")] = DeviceActivityEvent(
        applications: sel.applicationTokens, categories: sel.categoryTokens, webDomains: sel.webDomainTokens,
        threshold: DateComponents(minute: m), includesPastActivity: prefix == "u")
      m += step
    }
    if let f = final, f > 0 {
      out[DeviceActivityEvent.Name("\(prefix)end")] = DeviceActivityEvent(
        applications: sel.applicationTokens, categories: sel.categoryTokens, webDomains: sel.webDomainTokens,
        threshold: DateComponents(minute: f), includesPastActivity: prefix == "u")
    }
    return out
  }

  /// (Re)start every schedule: the day (usage and the daily limit) and each lock time's boundaries.
  /// About 20 schedules are allowed per app: 1 day + up to 8 lock times × 2 + earned + unlock.
  static func scheduleAll() -> [String] {
    var errors: [String] = []
    let center = DeviceActivityCenter()
    center.stopMonitoring(center.activities.filter { $0.rawValue.hasPrefix("st.") && $0.rawValue != "st.earned" && $0.rawValue != "st.unlock" })
    guard #available(iOS 17.4, *) else { return ["Screen Time needs iOS 17.4 or later"] }
    guard let p = plan, let main = selection("main") else { return errors }
    let limit = p.dailyLimitMin ?? 0
    var dayEvents = events(for: main, prefix: "u", upTo: min(600, max(limit, 240)), step: 15, final: nil)
    if let l = p.dailyLimitMin, l > 0 {
      dayEvents[DeviceActivityEvent.Name("limit")] = DeviceActivityEvent(
        applications: main.applicationTokens, categories: main.categoryTokens, webDomains: main.webDomainTokens,
        threshold: DateComponents(minute: l), includesPastActivity: true)
    }
    do {
      try center.startMonitoring(
        DeviceActivityName("st.day"),
        during: DeviceActivitySchedule(intervalStart: comps(0), intervalEnd: comps(23 * 60 + 59, second: 59), repeats: true),
        events: dayEvents)
    } catch { errors.append("day: \(error)") }
    // Lock times only need to wake the extension at their start and end; reapply() decides
    // what's blocked. Each edge gets a 15-minute schedule (Apple's minimum) that begins
    // at the edge, or ends at it when that would run past midnight, so no schedule ever
    // has to cross midnight (which day-of-week rules and short windows can't express).
    for l in p.locks where l.enabled {
      for (i, edge) in [l.startMin, l.endMin].enumerated() {
        let window = edge + 15 <= 24 * 60 - 1 ? (edge, edge + 15) : (edge - 15, edge)
        do {
          try center.startMonitoring(
            DeviceActivityName("st.edge.\(l.id).\(i)"),
            during: DeviceActivitySchedule(intervalStart: comps(window.0), intervalEnd: comps(window.1), repeats: true))
        } catch { errors.append("lock \(l.name) \(i): \(error)") }
      }
    }
    return errors
  }

  /// Watch earned minutes being spent on the blocked apps, in 5-minute steps and the exact end.
  static func armEarned(minutes: Int) {
    guard #available(iOS 17.4, *), minutes > 0, let main = selection("main") else { return }
    let cal = Calendar.current
    let now = Date()
    let start = cal.dateComponents([.year, .month, .day, .hour, .minute], from: cal.startOfDay(for: now))
    var end = cal.dateComponents([.year, .month, .day], from: now)
    end.hour = 23
    end.minute = 59
    end.second = 59
    let center = DeviceActivityCenter()
    center.stopMonitoring([DeviceActivityName("st.earned")])
    try? center.startMonitoring(
      DeviceActivityName("st.earned"),
      during: DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: false),
      events: events(for: main, prefix: "e", upTo: minutes - 1, step: 5, final: minutes))
  }

  /// A temporary unlock: lift the blocks now and wake up when it ends (schedules are at least 15 minutes).
  static func takeUnlock(kind: String, minutes: Int) {
    let now = Date()
    let until = now.addingTimeInterval(Double(minutes) * 60)
    var st = state(now: now)
    st.unlocks.append(Unlock(kind: kind, from: now.timeIntervalSince1970 * 1000, until: until.timeIntervalSince1970 * 1000))
    saveState(st)
    let cal = Calendar.current
    let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second]
    let center = DeviceActivityCenter()
    center.stopMonitoring([DeviceActivityName("st.unlock")])
    try? center.startMonitoring(
      DeviceActivityName("st.unlock"),
      during: DeviceActivitySchedule(
        intervalStart: cal.dateComponents(parts, from: until.addingTimeInterval(-15 * 60)),
        intervalEnd: cal.dateComponents(parts, from: until),
        repeats: false))
    reapply(at: now)
  }

  static func stopAll() {
    let center = DeviceActivityCenter()
    center.stopMonitoring(center.activities.filter { $0.rawValue.hasPrefix("st.") })
    unblockAll()
  }

  // MARK: Extension callbacks

  static func onIntervalStart(_ activity: String) {
    if activity == "st.day" {
      // A new day: usage and earned time start over.
      var st = state()
      st.unlocks = st.unlocks.filter { $0.until > Date().timeIntervalSince1970 * 1000 }
      saveState(st)
    }
    reapply(lean: 30)
  }

  static func onIntervalEnd(_ activity: String) {
    if activity == "st.earned" {
      var st = state()
      st.earnedArmed = false
      saveState(st)
    }
    reapply(lean: 30)
  }

  static func onEvent(_ event: String, activity: String) {
    var st = state()
    if activity == "st.day" {
      if event == "limit" {
        st.limitReached = true
        st.usedMin = max(st.usedMin, plan?.dailyLimitMin ?? 0)
      } else if event.hasPrefix("u"), let m = Int(event.dropFirst()) {
        st.usedMin = max(st.usedMin, m)
      }
    } else if activity == "st.earned" {
      let total = max(0, plan?.earnedLeftMin ?? 0)
      if event == "eend" {
        st.earnedSpentMin = total
        st.earnedArmed = false
      } else if event.hasPrefix("e"), let m = Int(event.dropFirst()) {
        st.earnedSpentMin = max(st.earnedSpentMin, min(st.earnedBase + m, total))
      }
    }
    saveState(st)
    reapply()
  }
}
