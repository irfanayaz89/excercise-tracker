import DeviceActivity
import FamilyControls
import Foundation
import ManagedSettings
#if canImport(WidgetKit)
import WidgetKit
#endif

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
    /// Blocks every app except the always-allowed ones.
    let allApps: Bool?
  }

  /// A per-app limit, with the minutes the app knew were used today when it wrote the plan.
  struct AppLimPlan: Codable {
    let id: String
    let name: String
    let apps: Sel
    let dailyMin: Int?
    /// Android only (iPhone can't count opens).
    let opensPerDay: Int?
    let usedMin: Int
    let opens: Int
  }

  /// The pause before a blocked app opens outside blocks: the first wait, the step added per
  /// pass, the cap, how long a pass lasts, and the passes the app knew about today.
  struct PausePlan: Codable {
    let enabled: Bool
    let seconds: Int
    let step: Int
    let max: Int
    let passMin: Int
    let passes: Int

    func wait(_ passesToday: Int) -> Int { Swift.min(max, seconds + step * passesToday) }
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
    /// The full daily allowance, used on a new day the app hasn't sent a plan for yet.
    var emergenciesPerDay: Int?
    var oneMoresPerDay: Int?
    /// An unlock already granted in the app (epoch ms).
    var unlockUntil: Double?
    /// A workout focus blocks the main apps until then (epoch ms).
    var focusUntil: Double?
    /// "set", "timed" or "key" (wording only).
    var focusKind: String?
    /// A key lock or Strict focus: unlocks don't open the main apps and none is offered.
    var focusLocked: Bool?
    /// Minutes the app knows were used today; the limit is measured on from here.
    var usedMin: Int?
    var locks: [LockPlan]
    var blocked: Sel
    var allowed: Sel
    /// The running focus blocks every app except the always-allowed ones.
    var focusAll: Bool?
    var appLimits: [AppLimPlan]?
    var pause: PausePlan?
    /// While Strict runs: when its period ends (epoch ms). From then on the mode reads as "standard".
    var strictUntil: Double?
    /// The full daily earning cap, used on a new day the app hasn't sent a plan for yet.
    var earnCapMin: Int?
    /// When the app made the plan, by its trusted clock (epoch ms; older plans have none).
    var madeAt: Double?
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
    /// Earned minutes spent that the app hasn't been handed yet (takeState hands them over and
    /// takes them off here).
    var earnedSpentMin: Int = 0
    /// Earned-time monitoring is running (so it isn't restarted from zero).
    var earnedArmed: Bool = false
    /// When earned-time monitoring started (epoch s), to tell real events from early misfires.
    var earnedArmedAt: Double = 0
    /// Re-arms after early misfires since earned monitoring last started normally (capped at 3).
    var earnedRearms: Int = 0
    /// The minutes the running earned monitoring was started with (its "end" threshold).
    var earnedArmMin: Int = 0
    /// Of those, the minutes it has counted so far (each event adds only what's new).
    var earnedArmSpent: Int = 0
    /// Generation of the running earned monitoring: events from an older one are ignored.
    var earnedGen: Int? = nil
    /// Signature of the main selection it watches.
    var earnedSig: String? = nil
    /// Unlocks taken on the blocked screen since the app last read this state.
    var unlocks: [Unlock] = []
    /// The user tapped "Earn time" on the blocked screen: open the earn screen.
    var openEarn: Bool = false
    /// The user tapped "Scan my key": open the key scanner.
    var openScan: Bool? = nil
    /// Per-app limits: minutes used today, by limit id (optional: older saved state has none).
    var appUsed: [String: Int]? = nil
    /// Passes taken through the pause screen today.
    var pauses: Int? = nil
    /// Apps or sites open on a pass (token key → until, epoch ms).
    var passes: [String: Double]? = nil
  }

  static func load<T: Decodable>(_ key: String, _ type: T.Type) -> T? {
    guard let data = defaults?.data(forKey: key) else { return nil }
    return try? JSONDecoder().decode(T.self, from: data)
  }

  static func save<T: Encodable>(_ key: String, _ value: T) {
    guard let data = try? JSONEncoder().encode(value) else { return }
    defaults?.set(data, forKey: key)
  }

  /// The plan and its decoded app lists, kept per process while the saved bytes stay the same: a
  /// callback reads them many times, and decoding every token again each time costs CPU and memory.
  private final class PlanCache: @unchecked Sendable {
    let m = NSLock()
    var data: Data?
    var plan: Plan?
    var sels: [String: FamilyActivitySelection] = [:]
  }

  private static let cache = PlanCache()

  static var plan: Plan? {
    guard let data = defaults?.data(forKey: "st.plan") else { return nil }
    cache.m.lock()
    defer { cache.m.unlock() }
    if data != cache.data {
      cache.data = data
      cache.plan = try? JSONDecoder().decode(Plan.self, from: data)
      cache.sels = [:]
    }
    return cache.plan
  }

  // MARK: Cross-process lock

  /// The app, the monitor and the blocked-screen extensions all read-modify-write the same keys.
  /// A flock on a file in the app group makes each change whole (the kernel drops it if a process
  /// dies). Reentrant within a process, so locked work can call other locked work.
  private final class FileLock: @unchecked Sendable {
    let m = NSRecursiveLock()
    var depth = 0
    var fd: Int32 = -1
    var held = false
  }

  private static let fileLock = FileLock()

  /// Runs `body` holding the lock, waiting up to 2 s (longer could hang an extension until iOS
  /// kills it). If another process still holds it, `body` is skipped and `busy` returned: run
  /// unlocked, two processes' changes interleave (one arm's generation saved, the other's schedule
  /// started), which is worse than one missed change that the next callback or sync makes again.
  @discardableResult
  static func locked<T>(busy: @autoclosure () -> T, _ body: () throws -> T) rethrows -> T {
    let l = fileLock
    l.m.lock()
    defer { l.m.unlock() }
    if l.depth == 0 {
      if l.fd < 0, let url = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)?.appendingPathComponent("st.lock") {
        l.fd = open(url.path, O_RDWR | O_CREAT, 0o644)
        if l.fd < 0 { l.fd = open(url.path, O_RDONLY) }
      }
      // No lock file means no app group container, so nothing is shared to guard.
      if l.fd >= 0 {
        for _ in 0..<200 {
          if flock(l.fd, LOCK_EX | LOCK_NB) == 0 { l.held = true; break }
          usleep(10_000)
        }
        if !l.held { return busy() }
      }
    }
    l.depth += 1
    defer {
      l.depth -= 1
      if l.depth == 0 && l.held {
        flock(l.fd, LOCK_UN)
        l.held = false
      }
    }
    return try body()
  }

  static let busyError = "Screen Time was busy and didn't update: it tries again at the next sync"

  /// Locked work with nothing to return: skipped when the lock is busy.
  static func locked(_ body: () throws -> Void) rethrows { try locked(busy: (), body) }

  // MARK: Trusted clock

  /// Moving the phone clock forward must not end a lock, a focus or Strict, or start a new day early.
  /// Each sync stores the app's trusted time with the time since boot (which the user can't change and
  /// which keeps counting while the phone sleeps); `now()` follows that. After a reboot the anchor is
  /// gone, so the phone clock is all there is until Trueline is next opened.
  struct ClockAnchor: Codable {
    var madeAt: Double
    var uptimeMs: Double
    var boot: String
  }

  static func uptimeMs() -> Double { Double(clock_gettime_nsec_np(CLOCK_MONOTONIC)) / 1e6 }

  /// Changes on every boot ("" if it can't be read, which turns the trusted clock off).
  static let bootId: String = {
    var size = 0
    guard sysctlbyname("kern.bootsessionuuid", nil, &size, nil, 0) == 0, size > 0 else { return "" }
    var buf = [CChar](repeating: 0, count: size)
    guard sysctlbyname("kern.bootsessionuuid", &buf, &size, nil, 0) == 0 else { return "" }
    return String(cString: buf)
  }()

  static func anchorClock(madeAt: Double?) {
    save("st.clock", ClockAnchor(madeAt: madeAt ?? ms(Date()), uptimeMs: uptimeMs(), boot: bootId))
  }

  /// The time to make decisions with: the phone clock, unless it is more than two minutes away
  /// from where the anchor says it should be (moved by hand), then the anchor's.
  static func now() -> Date {
    let wall = Date()
    guard !bootId.isEmpty, let a = load("st.clock", ClockAnchor.self), a.boot == bootId else { return wall }
    let expected = a.madeAt + (uptimeMs() - a.uptimeMs)
    return abs(ms(wall) - expected) > 120_000 ? Date(timeIntervalSince1970: expected / 1000) : wall
  }

  /// Schedules fire by the phone clock: the phone-clock moment for a trusted one.
  static func toWall(_ at: Date) -> Date { at.addingTimeInterval(Date().timeIntervalSince(now())) }

  static func ms(_ d: Date) -> Double { d.timeIntervalSince1970 * 1000 }

  /// Today's state: any other day starts fresh, an earlier one too (flying west across midnight goes
  /// back a day). A phone clock moved back can't do that: `now` is the trusted clock.
  static func state(now: Date = STShared.now()) -> State {
    var s = load("st.state", State.self) ?? State()
    let today = dayKey(now)
    if today != s.day {
      s = State(day: today, unlocks: s.unlocks, openEarn: s.openEarn, openScan: s.openScan, passes: s.passes)
    }
    return s
  }

  static func saveState(_ s: State) { save("st.state", s) }

  /// Several processes write the state (the app, the monitor, the blocked-screen buttons): each
  /// change is a read-modify-write under the cross-process lock.
  static func updateState(now: Date = STShared.now(), _ change: (inout State) -> Void) {
    locked {
      var s = state(now: now)
      change(&s)
      saveState(s)
    }
  }

  /// A stable short signature (FNV-1a) of something encodable; Swift's Hasher differs per process.
  static func signature<T: Encodable>(_ value: T) -> String {
    let enc = JSONEncoder()
    enc.outputFormatting = .sortedKeys
    var h: UInt64 = 0xcbf2_9ce4_8422_2325
    for b in (try? enc.encode(value)) ?? Data() {
      h ^= UInt64(b)
      h = h &* 0x0000_0100_0000_01b3
    }
    return String(h, radix: 16)
  }

  /// Events carry the generation of the monitoring that armed them ("a<gen>.<name>"), so events
  /// still queued from an earlier arm can be told apart and ignored.
  static func nextGen() -> Int {
    locked(busy: 0) {
      let g = (defaults?.integer(forKey: "st.armGen") ?? 0) &+ 1
      defaults?.set(g, forKey: "st.armGen")
      return g
    }
  }

  static func splitGen(_ event: String) -> (gen: Int?, name: String) {
    guard event.hasPrefix("a"), let dot = event.firstIndex(of: "."),
          let g = Int(event[event.index(after: event.startIndex)..<dot]) else { return (nil, event) }
    return (g, String(event[event.index(after: dot)...]))
  }

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
    cache.m.lock()
    defer { cache.m.unlock() }
    if let f = cache.sels[key] { return f }
    let f = sel.family
    cache.sels[key] = f
    return f
  }

  /// Every token in any of these lists, once.
  static func union(_ sels: [Sel]) -> Sel {
    Sel(
      apps: Array(Set(sels.flatMap { $0.apps })).sorted(),
      categories: Array(Set(sels.flatMap { $0.categories })).sorted(),
      domains: Array(Set(sels.flatMap { $0.domains })).sorted())
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
    /// Earned time is opening the main list.
    var usingEarned = false
    /// Earned time is opening these own-list lock times (ids).
    var earnedOwn: [String] = []
    var earnedLeft = 0
    var canEarn = false
    var emergency = false
    var oneMore = false
    var ownBlocked: [String] = []
    /// The block covers every app except the always-allowed ones.
    var blockAll = false
    /// Per-app limits used up today (ids).
    var limitBlocked: [String] = []
    /// An emergency unlock or "1 more minute" is running: no pause either.
    var unlocked = false
    /// Strictness in force now (for the blocked screen's wording).
    var mode = "standard"
  }

  /// Minutes used today against a per-app limit: the most the app or the extensions have counted.
  static func limitUsed(_ p: Plan, _ st: State, _ l: AppLimPlan, today: String) -> Int {
    Swift.max(st.appUsed?[l.id] ?? 0, p.day == today ? l.usedMin : 0)
  }

  /// Earned time can open this lock time on iPhone. Not an "everything" one: iOS counts use only
  /// for picked apps, never for "all apps", so earned minutes spent there could never run out.
  /// (Android can count it; decide.ts allows it there.)
  static func earnableHere(_ l: LockPlan) -> Bool { l.earnable && l.allApps != true }

  static func status(at now: Date = STShared.now()) -> Status {
    guard let p = plan else { return Status() }
    let st = state(now: now)
    let nowMs = ms(now)
    let today = dayKey(now)
    let planToday = p.day == today
    let earnedLeft = p.earningEnabled && planToday ? max(0, p.earnedLeftMin - st.earnedSpentMin) : 0
    // The use counted in steps reaching the limit counts too, should its "limit" event be lost.
    let limitReached = p.dailyLimitMin.map { $0 == 0 || st.limitReached || (planToday && p.limitReached) || st.usedMin >= $0 } ?? false
    let unlocked = (p.unlockUntil ?? 0) > nowMs || st.unlocks.contains { $0.from <= nowMs && nowMs < $0.until }

    var s = Status()
    s.earnedLeft = earnedLeft
    s.unlocked = unlocked
    let running = p.locks.compactMap { l in active(l, at: now).map { (l, $0) } }
    let main = running.filter { !$0.0.ownApps }
    let hard = main.filter { !earnableHere($0.0) }
    let soft = main.filter { earnableHere($0.0) }
    if !hard.isEmpty {
      s.reason = "lock"
    } else if !soft.isEmpty {
      if earnedLeft > 0 { s.usingEarned = true } else { s.reason = "lock" }
    } else if limitReached {
      if earnedLeft > 0 { s.usingEarned = true } else { s.reason = "limit" }
    }
    let focusing = (p.focusUntil ?? 0) > nowMs
    if focusing {
      // A workout is running: the main apps stay closed and earned time doesn't open them.
      s.reason = "focus"
      s.usingEarned = false
    }
    // A key lock or Strict focus can't be opened by an unlock: only the key (or its end) lifts it.
    let lockedFocus = focusing && (p.focusLocked ?? false)
    if unlocked && !lockedFocus {
      s.reason = nil
      s.usingEarned = false
    }
    let blocking = s.reason == "lock" ? (hard.isEmpty ? soft : hard) : []
    if let last = blocking.max(by: { $0.1.end < $1.1.end }) {
      s.lockName = last.0.name
      s.until = last.1.end
    }
    if s.reason == "focus", let f = p.focusUntil {
      s.lockName = "Workout focus"
      s.until = Date(timeIntervalSince1970: f / 1000)
    }
    s.blocked = s.reason != nil
    s.ownBlocked = running.filter { $0.0.ownApps && !unlocked && !($0.0.earnable && earnedLeft > 0) }.map { $0.0.id }
    // Own-list lock times opened by earned time spend it too (watched by armEarned).
    s.earnedOwn = running.filter { $0.0.ownApps && $0.0.earnable && !unlocked && earnedLeft > 0 && $0.0.apps.map { !$0.isEmpty } == true }.map { $0.0.id }
    s.blockAll = s.reason == "focus" ? (p.focusAll ?? false) : (s.reason == "lock" && blocking.contains { $0.0.allApps == true })
    if !unlocked {
      s.limitBlocked = (p.appLimits ?? []).filter { l in l.dailyMin.map { limitUsed(p, st, l, today: today) >= $0 } ?? false }.map { $0.id }
    }
    // The plan's "left" counts are for the day it was made. On a later day the app hasn't seen yet,
    // the allowance starts again, and only unlocks taken today count against it.
    let newDay = today > p.day
    let capLeft = newDay ? (p.earnCapMin ?? p.earnCapLeftMin) : p.earnCapLeftMin
    s.canEarn = s.blocked && s.reason != "focus" && p.earningEnabled && capLeft > 0 && (s.reason == "limit" || blocking.allSatisfy { earnableHere($0.0) })
    let any = s.blocked || !s.ownBlocked.isEmpty || !s.limitBlocked.isEmpty
    // Strict reads as Standard once its period is over (decide.ts: effectiveStrictness).
    let mode = p.mode == "strict" && (p.strictUntil.map { nowMs >= $0 } ?? false) ? "standard" : p.mode
    s.mode = mode
    let mine = st.unlocks.filter { !newDay || dayKey(Date(timeIntervalSince1970: $0.from / 1000)) == today }
    let usedEmergencies = mine.filter { $0.kind == "emergency" }.count
    let usedOneMores = mine.filter { $0.kind == "one-more" }.count
    let emergenciesLeft = newDay ? (p.emergenciesPerDay ?? 1) : p.emergenciesLeft
    let oneMoresLeft = newDay ? (p.oneMoresPerDay ?? 3) : p.oneMoresLeft
    s.emergency = any && !lockedFocus && mode == "standard" && emergenciesLeft - usedEmergencies > 0
    s.oneMore = any && !lockedFocus && mode == "nudge" && oneMoresLeft - usedOneMores > 0
    return s
  }

  // MARK: Blocked-screen buttons (shared by the shield's text and its actions)

  enum ShieldButton: String, Codable { case earn, workout, emergency, oneMore, close, open }

  /// The blocked screen has a main button and at most one more.
  static func buttons(_ s: Status) -> (primary: ShieldButton, secondary: ShieldButton?) {
    let escape: ShieldButton? = s.emergency ? .emergency : s.oneMore ? .oneMore : nil
    // During a workout the main button takes the user back to it (it opens Trueline on iOS 26.5+).
    if s.reason == "focus" { return (.workout, escape ?? .close) }
    if s.canEarn { return (.earn, escape ?? .close) }
    return (.close, escape)
  }

  /// Why a particular app or site is behind a shield right now (they share one blocked screen).
  enum ShieldKind {
    case main
    case limit(AppLimPlan)
    case own(LockPlan)
    case pause
  }

  static func shieldKind(app: ApplicationToken?, site: WebDomainToken?, category: ActivityCategoryToken?, _ s: Status) -> ShieldKind {
    func has(_ sel: FamilyActivitySelection) -> Bool {
      (app.map { sel.applicationTokens.contains($0) } ?? false)
        || (site.map { sel.webDomainTokens.contains($0) } ?? false)
        || (category.map { sel.categoryTokens.contains($0) } ?? false)
    }
    // The main block only explains the shield of what it covers: everything (block all) or the main list.
    if s.blocked && (s.blockAll || (selection("main").map(has) ?? false)) { return .main }
    if let l = plan?.appLimits?.first(where: { s.limitBlocked.contains($0.id) && has($0.apps.family) }) { return .limit(l) }
    if let id = s.ownBlocked.first(where: { selection("lock.\($0)").map(has) ?? false }), let lock = plan?.locks.first(where: { $0.id == id }) {
      return .own(lock)
    }
    if paused(s) { return .pause }
    return .main
  }

  /// What the blocked screen last showed. The text extension sees an app together with its category,
  /// but the buttons extension is handed only one token (and for a category, no app at all), so it
  /// reads this back to act on the buttons the user actually saw. Kept under a key of its own, so
  /// the text extension never rewrites the shared state.
  struct ShieldShown: Codable {
    /// "main", "limit", "own" or "pause", with the limit or lock id.
    var kind: String
    var id: String?
    /// The key the pause clock and the pass use for this app or site.
    var pauseKey: String?
    var app: String?
    var site: String?
    var category: String?
    var primary: ShieldButton
    var secondary: ShieldButton?
    /// When it was shown (epoch s).
    var at: Double
  }

  static var shieldShown: ShieldShown? { load("st.shieldShown", ShieldShown.self) }

  static func recordShown(_ kind: ShieldKind, _ b: (primary: ShieldButton, secondary: ShieldButton?), app: String?, site: String?, category: String?, pauseKey: String?) {
    var name = "main"
    var id: String? = nil
    switch kind {
    case .main: break
    case .pause: name = "pause"
    case .limit(let l): name = "limit"; id = l.id
    case .own(let l): name = "own"; id = l.id
    }
    save("st.shieldShown", ShieldShown(
      kind: name, id: id, pauseKey: pauseKey, app: app, site: site, category: category,
      primary: b.primary, secondary: b.secondary, at: now().timeIntervalSince1970))
  }

  /// The kind a record stands for, if the plan still has it.
  static func kind(of r: ShieldShown) -> ShieldKind? {
    switch r.kind {
    case "main": return .main
    case "pause": return .pause
    case "limit": return plan?.appLimits?.first { $0.id == r.id }.map { .limit($0) }
    case "own": return plan?.locks.first { $0.id == r.id }.map { .own($0) }
    default: return nil
    }
  }

  /// The buttons for a shield of this kind: the pause offers Open; limits and own lock times offer
  /// the strictness level's unlock; the main block keeps its own set (buttons(_:)).
  static func buttons(_ kind: ShieldKind, _ s: Status) -> (primary: ShieldButton, secondary: ShieldButton?) {
    switch kind {
    case .main: return buttons(s)
    case .pause: return (.open, .close)
    case .limit, .own:
      let escape: ShieldButton? = s.emergency ? .emergency : s.oneMore ? .oneMore : nil
      return escape.map { ($0, .close) } ?? (.close, nil)
    }
  }

  /// The user asked to scan their key: Trueline opens on its scanner next time.
  static func requestScan() { updateState { $0.openScan = true } }

  /// The user asked to earn time: Trueline opens on its earn screen next time.
  static func requestEarn() { updateState { $0.openEarn = true } }

  // MARK: Applying blocks

  static func store(_ name: String) -> ManagedSettingsStore { ManagedSettingsStore(named: .init(name)) }

  /// Block every app and site except the always-allowed ones. Trueline itself stays open, so the
  /// key can be scanned: "Your app is exempt from .all" (ShieldSettings.applicationCategories docs).
  /// Apps in the user's own Always Allowed list (Phone is always one) are skipped by iOS as well.
  static func blockEverything(_ name: String, allowed: FamilyActivitySelection?) {
    let s = store(name)
    noteShielded(name, 0)
    s.shield.applications = nil
    s.shield.applicationCategories = .all(except: allowed?.applicationTokens ?? [])
    s.shield.webDomains = nil
    s.shield.webDomainCategories = .all(except: allowed?.webDomainTokens ?? [])
  }

  static func block(_ name: String, _ sel: FamilyActivitySelection, allowed: FamilyActivitySelection?) {
    let s = store(name)
    let keep = allowed?.applicationTokens ?? []
    let apps = sel.applicationTokens.subtracting(keep)
    // Over 50 apps a store may keep fewer than it was given (Apple's cap): don't count those.
    noteShielded(name, apps.count <= 50 ? apps.count : 0)
    s.shield.applications = apps.isEmpty ? nil : apps
    s.shield.applicationCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens, except: keep)
    s.shield.webDomains = sel.webDomainTokens.isEmpty ? nil : sel.webDomainTokens
    s.shield.webDomainCategories = sel.categoryTokens.isEmpty ? nil : .specific(sel.categoryTokens, except: allowed?.webDomainTokens ?? [])
  }

  static func unblock(_ name: String) {
    noteShielded(name, 0)
    store(name).clearAllSettings()
  }

  /// How many apps each store was last given, so a later check can tell that iOS dropped some.
  static func noteShielded(_ name: String, _ count: Int) {
    var c = (defaults?.dictionary(forKey: "st.shieldCounts") as? [String: Int]) ?? [:]
    guard (c[name] ?? 0) != count else { return }
    c[name] = count == 0 ? nil : count
    defaults?.set(c, forKey: "st.shieldCounts")
  }

  /// iOS 26.5+ can expire stored app tokens while Trueline is closed, and its notice only reaches a
  /// running app. A store now holding fewer apps than it was given means some were dropped: record
  /// it, so the app asks for the lists again. Call before anything re-applies the blocks.
  static func checkDroppedTokens() {
    guard #available(iOS 26.5, *), AuthorizationCenter.shared.authorizationStatus == .approved else { return }
    let c = (defaults?.dictionary(forKey: "st.shieldCounts") as? [String: Int]) ?? [:]
    if c.contains(where: { $0.value > 0 && (store($0.key).shield.applications?.count ?? 0) < $0.value }) {
      defaults?.set(true, forKey: "st.tokensExpired")
    }
  }

  /// Make the blocks match `status(at:)`. Safe to call any number of times.
  /// `lean` evaluates slightly ahead, so a boundary callback that fires a moment
  /// early (07:00 minus a few ms) already sees the new state.
  static func reapply(at nowIn: Date = STShared.now(), lean: TimeInterval = 0) {
    locked {
      let now = nowIn.addingTimeInterval(lean)
      guard let p = plan else {
        unblockAll()
        return
      }
      let s = status(at: now)
      let allowed = selection("allowed")
      if s.blocked && s.blockAll {
        blockEverything("st.main", allowed: allowed)
      } else if s.blocked, let main = selection("main") {
        block("st.main", main, allowed: allowed)
      } else {
        unblock("st.main")
      }
      // Per-app limits used up: their own apps, in a store each.
      // A deleted limit's store is cleared here once, then its id is dropped.
      let lims = (p.appLimits ?? []).map { $0.id }
      for id in Set(limIds + lims) {
        if s.limitBlocked.contains(id), let l = p.appLimits?.first(where: { $0.id == id }), !l.apps.isEmpty {
          block("st.lim.\(id)", l.apps.family, allowed: allowed)
        } else {
          unblock("st.lim.\(id)")
        }
      }
      limIds = lims
      applyPause(p, s, allowed: allowed, now: now)
      let own = p.locks.filter { $0.ownApps }.map { $0.id }
      for id in Set(ownIds + own) {
        if s.ownBlocked.contains(id), let sel = selection("lock.\(id)") {
          block("st.own.\(id)", sel, allowed: allowed)
        } else {
          unblock("st.own.\(id)")
        }
      }
      ownIds = own
      // Earned minutes are being spent: watch them run out. Started once for the same lists
      // (restarting counts from zero); when the lists change (an own-list lock time starts or
      // ends), it starts again with what's left.
      let st = state(now: now)
      let watch = earnedWatch(p, s)
      if !watch.isEmpty && (!st.earnedArmed || st.earnedSig != signature(watch)) {
        armEarned(minutes: s.earnedLeft, watch: watch)
      } else if watch.isEmpty && st.earnedArmed {
        stopEarned()
      }
      armNext(p, state(now: nowIn), now: nowIn)
      writeWidget(s, now: now)
    }
  }

  /// The lists earned time is opening now: their use is what spends it.
  static func earnedWatch(_ p: Plan, _ s: Status) -> Sel {
    let own = p.locks.filter { s.earnedOwn.contains($0.id) }.compactMap { $0.apps }
    return union((s.usingEarned ? [p.blocked] : []) + own)
  }

  // MARK: Pause before opening

  /// A token as the plan stores it (base64 of its JSON), so passes can be keyed by it.
  static func key<T: Encodable>(_ token: T) -> String? { (try? JSONEncoder().encode(token))?.base64EncodedString() }

  static func token<T: Decodable>(_ key: String, _ t: T.Type) -> T? {
    Data(base64Encoded: key).flatMap { try? JSONDecoder().decode(T.self, from: $0) }
  }

  /// Passes taken today, as far as the app or the extensions know.
  static func pausePasses(_ p: Plan, _ st: State, now: Date) -> Int {
    Swift.max(st.pauses ?? 0, p.day == dayKey(now) ? (p.pause?.passes ?? 0) : 0)
  }

  /// The pause is shown for the blocked list when nothing else blocks it: a shield of its own
  /// ("st.pause") with the apps and sites on a pass left out. When a pass runs out, armNext wakes
  /// the monitor to put the pause back.
  static func applyPause(_ p: Plan, _ s: Status, allowed: FamilyActivitySelection?, now: Date) {
    guard let pause = p.pause, pause.enabled, !s.blocked, !s.unlocked, let main = selection("main") else {
      unblock("st.pause")
      return
    }
    let nowMs = ms(now)
    let open = (state(now: now).passes ?? [:]).filter { $0.value > nowMs }.map { $0.key }
    let openApps = Set(open.compactMap { token($0, ApplicationToken.self) })
    let openSites = Set(open.compactMap { token($0, WebDomainToken.self) })
    let keepApps = (allowed?.applicationTokens ?? []).union(openApps)
    let keepSites = (allowed?.webDomainTokens ?? []).union(openSites)
    let st = store("st.pause")
    let apps = main.applicationTokens.subtracting(keepApps)
    st.shield.applications = apps.isEmpty ? nil : apps
    st.shield.applicationCategories = main.categoryTokens.isEmpty ? nil : .specific(main.categoryTokens, except: keepApps)
    let sites = main.webDomainTokens.subtracting(keepSites)
    st.shield.webDomains = sites.isEmpty ? nil : sites
    st.shield.webDomainCategories = main.categoryTokens.isEmpty ? nil : .specific(main.categoryTokens, except: keepSites)
  }

  /// Is this app or site behind the pause (and not blocked for another reason)?
  static func paused(_ s: Status) -> Bool { !s.blocked && (plan?.pause?.enabled ?? false) }

  /// When the pause screen first appeared for an app or site (token key → epoch ms). Under a key of
  /// its own: the blocked-screen text extension writes it, and must never rewrite the shared state.
  static var pauseShown: [String: Double] {
    get { load("st.pauseShown", [String: Double].self) ?? [:] }
    set { save("st.pauseShown", newValue) }
  }

  /// Seconds still to wait on the pause screen for `key` (the first time it shows, the clock starts).
  static func pauseLeft(_ key: String, now: Date = STShared.now()) -> Int {
    guard let p = plan, let pause = p.pause else { return 0 }
    let nowMs = ms(now)
    // Lock busy: count from now without recording it.
    let shownAt: Double = locked(busy: nowMs) {
      // A pause screen left alone for two minutes starts over next time.
      guard let at = pauseShown[key], at >= nowMs - 120_000 else {
        var shown = pauseShown.filter { $0.value >= nowMs - 120_000 }
        shown[key] = nowMs
        pauseShown = shown
        return nowMs
      }
      return at
    }
    let wait = Double(pause.wait(pausePasses(p, state(now: now), now: now)))
    return Swift.max(0, Int(ceil(wait - (nowMs - shownAt) / 1000)))
  }

  /// The wait is over: open this app or site for the pass length; the next wait grows.
  static func grantPass(_ key: String, now: Date = STShared.now()) {
    guard let p = plan, let pause = p.pause else { return }
    let nowMs = ms(now)
    locked {
      updateState(now: now) { st in
        var passes = (st.passes ?? [:]).filter { $0.value > nowMs }
        passes[key] = nowMs + Double(pause.passMin) * 60_000
        st.passes = passes
        st.pauses = pausePasses(p, st, now: now) + 1
      }
      var shown = pauseShown
      shown[key] = nil
      pauseShown = shown
      reapply(at: now)
    }
  }

  // MARK: Home screen widget

  /// What the widget shows: a title and, when there is one, the time it changes (trusted epoch ms),
  /// with the plain title to show once that time has passed and nothing has rewritten it.
  static func writeWidget(_ s: Status?, now: Date = STShared.now()) {
    var title = "Screen time is off"
    var after = title
    var until: Double? = nil
    if let s, let p = plan {
      let nowMs = ms(now)
      let calm = p.dailyLimitMin.map { "Daily limit \($0) min" } ?? "Screen time is on"
      after = calm
      let unlock = (state(now: now).unlocks.filter { $0.from <= nowMs && nowMs < $0.until }.map { $0.until } + [p.unlockUntil ?? 0]).max() ?? 0
      if unlock > nowMs {
        title = "Unlocked"
        until = unlock
      } else if s.blocked {
        title = s.reason == "limit" ? "Today's time is up" : s.reason == "focus" ? (p.focusKind == "key" ? "Key lock" : "Workout focus") : (s.lockName ?? "Locked")
        until = s.until.map { ms($0) }
      } else if s.usingEarned || !s.earnedOwn.isEmpty {
        title = "Using earned time"
      } else {
        title = calm
      }
    }
    // Only what the widget shows, in a stable key order, so an unchanged summary compares equal and
    // doesn't spend WidgetKit's daily reload budget.
    let json: [String: Any] = ["title": title, "until": until ?? NSNull(), "after": after]
    guard let data = try? JSONSerialization.data(withJSONObject: json, options: [.sortedKeys]) else { return }
    if defaults?.data(forKey: "st.widget") == data { return }
    defaults?.set(data, forKey: "st.widget")
    #if canImport(WidgetKit)
    WidgetCenter.shared.reloadAllTimelines()
    #endif
  }

  static func unblockAll() {
    unblock("st.main")
    unblock("st.pause")
    for id in ownIds { unblock("st.own.\(id)") }
    for id in limIds { unblock("st.lim.\(id)") }
    ownIds = []
    limIds = []
    writeWidget(nil)
  }

  /// The per-app limit stores in use: the plan's limits, plus a deleted one until reapply clears it.
  static var limIds: [String] {
    get { defaults?.stringArray(forKey: "st.limIds") ?? [] }
    set { defaults?.set(Array(Set(newValue)).sorted(), forKey: "st.limIds") }
  }

  /// The own-app lock stores in use, likewise.
  static var ownIds: [String] {
    get { defaults?.stringArray(forKey: "st.ownIds") ?? [] }
    set { defaults?.set(Array(Set(newValue)).sorted(), forKey: "st.ownIds") }
  }

  // MARK: Monitoring

  private static func comps(_ minuteOfDay: Int, second: Int = 0) -> DateComponents {
    DateComponents(hour: minuteOfDay / 60, minute: minuteOfDay % 60, second: second)
  }

  /// A trusted moment as the phone-clock date parts a one-off schedule is made of. With the time
  /// zone: bare components follow the phone's zone, so travel would shift the moment by the offset.
  static func wallParts(_ at: Date) -> DateComponents {
    Calendar.current.dateComponents([.year, .month, .day, .hour, .minute, .second, .timeZone], from: toWall(at))
  }

  /// The last second of the trusted day containing `now`.
  static func endOfDay(_ now: Date) -> Date {
    Calendar.current.date(bySettingHour: 23, minute: 59, second: 59, of: now) ?? now
  }

  @available(iOS 17.4, *)
  private static func event(_ sel: FamilyActivitySelection, _ minutes: Int) -> DeviceActivityEvent {
    DeviceActivityEvent(
      applications: sel.applicationTokens, categories: sel.categoryTokens, webDomains: sel.webDomainTokens,
      threshold: DateComponents(minute: minutes), includesPastActivity: false)
  }

  /// Steps "<prefix><m>" every `step` minutes up to `upTo` and, with `final`, a step there and
  /// "<prefix>end": the step ends it too should "end" be lost or taken for a misfire.
  /// Names without the generation (named(_:gen:) adds it).
  @available(iOS 17.4, *)
  private static func events(for sel: FamilyActivitySelection, prefix: String, upTo: Int, step: Int, final: Int?) -> [String: DeviceActivityEvent] {
    var out: [String: DeviceActivityEvent] = [:]
    for m in stride(from: step, through: upTo, by: step) { out["\(prefix)\(m)"] = event(sel, m) }
    if let f = final, f > 0 {
      out["\(prefix)\(f)"] = event(sel, f)
      out["\(prefix)end"] = event(sel, f)
    }
    return out
  }

  @available(iOS 17.4, *)
  private static func named(_ evs: [String: DeviceActivityEvent], gen: Int) -> [DeviceActivityEvent.Name: DeviceActivityEvent] {
    Dictionary(uniqueKeysWithValues: evs.map { (DeviceActivityEvent.Name("a\(gen).\($0.key)"), $0.value) })
  }

  /// Stopping a schedule ends its interval, which calls intervalDidEnd: note when Trueline itself
  /// stopped one, so that callback isn't taken for the schedule really ending (which would start it
  /// again, stop it again, and loop). Time since boot, so a clock change can't confuse it.
  static func markRestart(_ name: String) {
    defaults?.set(uptimeMs(), forKey: "st.restart.\(name)")
  }

  static func restartedRecently(_ name: String) -> Bool {
    let at = defaults?.double(forKey: "st.restart.\(name)") ?? 0
    let d = uptimeMs() - at
    return d >= 0 && d < 10_000
  }

  /// (Re)start every schedule. Apple allows 20 per app:
  /// day + limit + earned + wake + next (5) + 2 per lock time (at most 7) = 19.
  /// Per-app limits add events to the "limit" schedule, not schedules of their own.
  /// `rearmLimit` false keeps the running limit monitoring: restarting it would forget the use
  /// counted since its last 15-minute step (see limitArmCurrent).
  static func scheduleAll(rearmLimit: Bool = true) -> [String] {
    locked(busy: [busyError]) {
      var errors: [String] = []
      let center = DeviceActivityCenter()
      let keep = ["st.earned", "st.wake", "st.next"] + (rearmLimit ? [] : ["st.limit"])
      if rearmLimit { markRestart("st.limit") }
      // (Older builds also ran "st.unlock", "st.focus" and "st.pass": armNext covers them now.)
      center.stopMonitoring(center.activities.filter { $0.rawValue.hasPrefix("st.") && !keep.contains($0.rawValue) })
      guard #available(iOS 17.4, *) else { return ["Screen Time needs iOS 17.4 or later"] }
      guard let p = plan else { return errors }
      // The limit before the day: once "st.day" starts, the monitor's start callback looks for
      // today's limit monitoring, and must find this one rather than arm a second (D9).
      if rearmLimit {
        // The plan's usage counts only for the day it was made.
        let used = p.day == dayKey(now()) ? (p.usedMin ?? 0) : 0
        if let e = armLimit(used: used, rearms: 0) { errors.append(e) }
      }
      // The day schedule has no events: it only wakes the monitor at midnight to start the new day.
      do {
        try center.startMonitoring(
          DeviceActivityName("st.day"),
          during: DeviceActivitySchedule(intervalStart: comps(0), intervalEnd: comps(23 * 60 + 59, second: 59), repeats: true))
      } catch { errors.append("day: \(error)") }
      // Lock times only need to wake the extension at their start and end; reapply() decides
      // what's blocked. Each edge gets a 15-minute schedule (Apple's minimum) that begins
      // at the edge, or ends at it when that would run past midnight, so no schedule ever
      // has to cross midnight (which day-of-week rules and short windows can't express).
      // These follow the phone clock; armNext also wakes at each edge by the trusted clock.
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
      // Focus, unlock and pass ends are woken by armNext, from the reapply that follows.
      return errors
    }
  }

  // MARK: Daily limit, with a guard against early events (research guide, Appendix A F1)

  /// What the current limit monitoring was armed with.
  struct LimitArm: Codable {
    var day: String
    /// When it was armed (epoch s); usage can't grow faster than the clock from here.
    var at: Double
    /// Minutes already used when armed.
    var used: Int
    /// The "limit" threshold: minutes left when armed.
    var left: Int
    /// Times it was re-armed after a misfire today.
    var rearms: Int
    /// Per-app limits: minutes used when armed, and minutes left to their limit.
    var groupUsed: [String: Int]?
    var groupLeft: [String: Int]?
    /// The generation in its event names ("a<gen>."): events from older arms are ignored.
    var gen: Int?
    /// Signature of what it watches (daily limit, main selection, per-app limits).
    var sig: String?
    /// It had events, so its schedule should be running.
    var watching: Bool?
  }

  static var limitArm: LimitArm? {
    get { load("st.limitArm", LimitArm.self) }
    set { if let v = newValue { save("st.limitArm", v) } else { defaults?.removeObject(forKey: "st.limitArm") } }
  }

  private struct AppLimSig: Encodable {
    let id: String
    let dailyMin: Int?
    let apps: Sel
  }

  private struct LimitSig: Encodable {
    let limit: Int?
    let main: Sel
    let apps: [AppLimSig]
  }

  /// What the limit monitoring depends on: when this changes, it has to be armed again.
  static func limitSig(_ p: Plan) -> String {
    signature(LimitSig(limit: p.dailyLimitMin, main: p.blocked, apps: (p.appLimits ?? []).map { AppLimSig(id: $0.id, dailyMin: $0.dailyMin, apps: $0.apps) }))
  }

  /// The running limit monitoring is today's and watches what this plan asks for, so it can keep
  /// running (restarting it loses the use counted since its last 15-minute step).
  static func limitArmCurrent(_ p: Plan, now: Date = STShared.now()) -> Bool {
    guard let a = limitArm, a.day == dayKey(now), a.sig == limitSig(p) else { return false }
    return a.watching == false || DeviceActivityCenter().activities.contains(DeviceActivityName("st.limit"))
  }

  /// Watch the blocked apps' usage for the rest of today, counted from now (iOS 26 thresholds
  /// can fire at once when they include earlier activity, so nothing here does).
  /// Events: "uM" every 15 minutes of use and when the minutes left run out, and "limit" then, each named
  /// "a<gen>.<event>". Use while earned time opens the main list counts here too: iOS reports use of
  /// the same apps once, to every event watching them, so the two can't be told apart (D10).
  @discardableResult
  static func armLimit(used usedIn: Int, rearms: Int) -> String? {
    guard #available(iOS 17.4, *) else { return nil }
    return locked(busy: "limit: \(busyError)") { () -> String? in
      guard let p = plan else { return nil }
      let main = selection("main")
      let center = DeviceActivityCenter()
      markRestart("st.limit")
      center.stopMonitoring([DeviceActivityName("st.limit")])
      let now = STShared.now()
      let today = dayKey(now)
      let st = state(now: now)
      let used = max(usedIn, st.usedMin)
      // The plan's "reached" is for the day it was made: at midnight it's yesterday's.
      let reachedToday = st.limitReached || (p.day == today && p.limitReached)
      let left = p.dailyLimitMin.map { max(0, $0 - used) } ?? 0
      var evs: [String: DeviceActivityEvent] = [:]
      if let main {
        evs = events(for: main, prefix: "u", upTo: 600, step: 15, final: nil)
        if p.dailyLimitMin != nil, !reachedToday, left > 0 {
          evs["limit"] = event(main, left)
          // A step at the limit too: should "limit" be lost or taken for a misfire, the use counted
          // still reaches it (status() reads that as reached).
          evs["u\(left)"] = event(main, left)
        }
      }
      // Per-app limits: "g.<id>.<m>" every 15 minutes of use and "g.<id>.end" when its minutes run out.
      var groupUsed: [String: Int] = [:]
      var groupLeft: [String: Int] = [:]
      for l in p.appLimits ?? [] {
        guard let daily = l.dailyMin, !l.apps.isEmpty else { continue }
        let u = limitUsed(p, st, l, today: today)
        groupUsed[l.id] = u
        groupLeft[l.id] = max(0, daily - u)
        if daily - u > 0 {
          evs.merge(events(for: l.apps.family, prefix: "g.\(l.id).", upTo: daily - u - 1, step: 15, final: daily - u)) { a, _ in a }
        }
      }
      limitArm = LimitArm(
        day: today, at: now.timeIntervalSince1970, used: used, left: left, rearms: rearms,
        groupUsed: groupUsed, groupLeft: groupLeft, gen: nextGen(), sig: limitSig(p), watching: !evs.isEmpty)
      // Named by the generation as saved, so the events started are the ones handleEvent accepts.
      guard !evs.isEmpty, let gen = limitArm?.gen else { return nil }
      // Until the end of today (trusted); a schedule must last 15 minutes, so late at night it
      // starts a little in the past.
      let end = endOfDay(now)
      let start = min(now, end.addingTimeInterval(-16 * 60))
      do {
        try center.startMonitoring(
          DeviceActivityName("st.limit"),
          during: DeviceActivitySchedule(intervalStart: wallParts(start), intervalEnd: wallParts(end), repeats: false),
          events: named(evs, gen: gen))
        return nil
      } catch { return "limit: \(error)" }
    }
  }

  /// A one-off schedule between two trusted moments (at least 15 minutes apart: Apple's minimum).
  @discardableResult
  static func oneOff(_ name: String, from: Date, to: Date, events: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]) -> String? {
    let center = DeviceActivityCenter()
    center.stopMonitoring([DeviceActivityName(name)])
    do {
      try center.startMonitoring(
        DeviceActivityName(name),
        during: DeviceActivitySchedule(intervalStart: wallParts(from), intervalEnd: wallParts(to), repeats: false),
        events: events)
      return nil
    } catch { return "\(error)" }
  }

  /// A one-off 15-minute schedule that ends at `at` (trusted), to wake the monitor then.
  @discardableResult
  static func wakeAt(_ at: Date, name: String) -> String? {
    oneOff(name, from: at.addingTimeInterval(-15 * 60), to: at)
  }

  // MARK: Wake-ups for moments that pass by themselves

  /// The next moment the blocks may change with nothing else happening (trusted time): an unlock,
  /// pass, focus or Strict period ending, a lock-time edge, or midnight.
  static func nextChange(_ p: Plan, _ st: State, after now: Date) -> Date? {
    let nowMs = ms(now)
    let cal = Calendar.current
    var c = st.unlocks.map { $0.until } + Array((st.passes ?? [:]).values)
    c += [p.unlockUntil, p.focusUntil, p.strictUntil].compactMap { $0 }
    if let midnight = cal.date(byAdding: .day, value: 1, to: cal.startOfDay(for: now)) { c.append(ms(midnight)) }
    for l in p.locks {
      for d in -1...1 {
        if let day = cal.date(byAdding: .day, value: d, to: now), let w = window(l, startingOn: day) { c += [ms(w.start), ms(w.end)] }
      }
    }
    return c.filter { $0 > nowMs }.min().map { Date(timeIntervalSince1970: $0 / 1000) }
  }

  /// Two wake-ups for that moment, as one-off schedules are known to be late or missed: "st.wake"
  /// ends at it (intervalDidEnd) and "st.next" starts a minute after (intervalDidStart), with use
  /// thresholds on everything that may be blocked by then, so an app left open past the end of an
  /// unlock, pass or focus re-shields after a minute of use even if both callbacks are missed.
  /// They follow the trusted clock, so they also catch lock edges and midnight that the repeating
  /// schedules (phone clock) get wrong after the clock is moved. Re-armed only when the moment
  /// changes: restarting a running schedule ends its interval, which calls reapply again.
  static func armNext(_ p: Plan, _ st: State, now: Date) {
    guard #available(iOS 17.4, *), let next = nextChange(p, st, after: now) else { return }
    let at = ms(next)
    let running = DeviceActivityCenter().activities.map { $0.rawValue }
    if defaults?.double(forKey: "st.wakeAt") == at, running.contains("st.wake"), running.contains("st.next") { return }
    defaults?.set(at, forKey: "st.wakeAt")
    wakeAt(next, name: "st.wake")
    let watch = union([p.blocked] + p.locks.compactMap { $0.ownApps ? $0.apps : nil } + (p.appLimits ?? []).map { $0.apps })
    var evs: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
    if !watch.isEmpty {
      let f = watch.family
      for m in [1, 3, 6] { evs[DeviceActivityEvent.Name("n\(m)")] = event(f, m) }
    }
    oneOff("st.next", from: next.addingTimeInterval(60), to: next.addingTimeInterval(16 * 60), events: evs)
  }

  // MARK: Earned time

  static func stopEarned() {
    locked {
      markRestart("st.earned")
      DeviceActivityCenter().stopMonitoring([DeviceActivityName("st.earned")])
      updateState { $0.earnedArmed = false }
    }
  }

  /// Watch earned minutes being spent on the lists they open (`watch`: the main list and/or own-list
  /// lock times), in 5-minute steps, a step at the total and the exact end ("a<gen>.e<m>", "a<gen>.eend").
  static func armEarned(minutes: Int, watch: Sel, rearm: Bool = false) {
    guard #available(iOS 17.4, *), minutes > 0, !watch.isEmpty else { return }
    locked {
      let now = STShared.now()
      // Today by the trusted clock (wallParts moves it onto the phone clock the schedule runs by).
      let end = endOfDay(now)
      let start = min(Calendar.current.startOfDay(for: now), end.addingTimeInterval(-16 * 60))
      updateState(now: now) { st in
        st.earnedArmed = true
        st.earnedArmedAt = now.timeIntervalSince1970
        st.earnedRearms = rearm ? st.earnedRearms + 1 : 0
        st.earnedArmMin = minutes
        st.earnedArmSpent = 0
        st.earnedGen = nextGen()
        st.earnedSig = signature(watch)
      }
      // Named by the generation as saved, so the events started are the ones handleEvent accepts.
      guard let gen = state(now: now).earnedGen else { return }
      let center = DeviceActivityCenter()
      markRestart("st.earned")
      center.stopMonitoring([DeviceActivityName("st.earned")])
      try? center.startMonitoring(
        DeviceActivityName("st.earned"),
        during: DeviceActivitySchedule(intervalStart: wallParts(start), intervalEnd: wallParts(end), repeats: false),
        events: named(events(for: watch.family, prefix: "e", upTo: minutes - 1, step: 5, final: minutes), gen: gen))
    }
  }

  /// After a new plan: keep earned monitoring running when it still expects what the plan says is
  /// left (nothing new was earned), so its count isn't restarted from zero. Otherwise stop it, and
  /// reapply() arms it again with the new amount (it also restarts it when the lists change).
  static func keepOrStopEarned(now: Date = STShared.now()) {
    locked {
      guard let p = plan else { return }
      let st = state(now: now)
      guard st.earnedArmed else { return }
      let planLeft = p.earningEnabled && p.day == dayKey(now) ? max(0, p.earnedLeftMin - st.earnedSpentMin) : 0
      let expected = st.earnedArmMin - st.earnedArmSpent
      let running = DeviceActivityCenter().activities.contains(DeviceActivityName("st.earned"))
      if !running || expected != planLeft { stopEarned() }
    }
  }

  /// A temporary unlock: lift the blocks now; reapply arms the wake-ups for its end (armNext).
  static func takeUnlock(kind: String, minutes: Int) {
    locked {
      let now = STShared.now()
      let until = now.addingTimeInterval(Double(minutes) * 60)
      updateState(now: now) { $0.unlocks.append(Unlock(kind: kind, from: ms(now), until: ms(until))) }
      reapply(at: now)
    }
  }

  /// Turn Screen Time off. The plan goes first: stopping the schedules wakes the monitor
  /// (intervalDidEnd), and with no plan its reapply lifts the blocks instead of putting them back.
  static func stopAll() {
    locked {
      defaults?.removeObject(forKey: "st.plan")
      defaults?.removeObject(forKey: "st.wakeAt")
      limitArm = nil
      markRestart("st.earned")
      let center = DeviceActivityCenter()
      center.stopMonitoring(center.activities.filter { $0.rawValue.hasPrefix("st.") })
      updateState { $0.earnedArmed = false }
      unblockAll()
    }
  }

  // MARK: Extension callbacks
  //
  // Each runs whole under the cross-process lock and decides by the trusted clock. The schedules
  // themselves fire by the phone clock, so after it is moved a callback may come early: reapply then
  // keeps the blocks as the trusted time says, and armNext wakes again at the right moment.

  /// A new day by the trusted clock: drop finished unlocks and start the day's limit monitoring.
  /// Checked on every callback, as the midnight schedule follows the phone clock (and also fires
  /// when monitoring starts mid-day, so only a real new day counts).
  static func rollDay(now: Date) {
    guard plan != nil, limitArm?.day != dayKey(now) else { return }
    let nowMs = ms(now)
    updateState(now: now) { st in st.unlocks = st.unlocks.filter { $0.until > nowMs } }
    armLimit(used: 0, rearms: 0)
  }

  static func onIntervalStart(_ activity: String) {
    locked {
      rollDay(now: now())
      reapply(lean: 30)
    }
  }

  static func onIntervalEnd(_ activity: String) {
    locked {
      let now = STShared.now()
      if activity == "st.earned" {
        // Trueline stopped or restarted it a moment ago: not the end of earned time.
        if restartedRecently("st.earned") { return }
        updateState(now: now) { $0.earnedArmed = false }
      } else if activity == "st.limit", !restartedRecently("st.limit"), let arm = limitArm, arm.day == dayKey(now),
                now.addingTimeInterval(120) < endOfDay(now) {
        // It ended before today did (trusted): the phone clock was moved on. Keep measuring from
        // the use counted so far.
        armLimit(used: state(now: now).usedMin, rearms: arm.rearms)
      }
      rollDay(now: now)
      reapply(lean: 30)
    }
  }

  /// Usage can't be more than the time that has passed since monitoring started (plus a minute
  /// of slack). An event claiming more is one of iOS 26's early misfires.
  static func plausible(_ minutes: Int, since armedAt: Double, now: Date = STShared.now()) -> Bool {
    Double(minutes) <= (now.timeIntervalSince1970 - armedAt) / 60 + 1
  }

  /// Use is reported in steps (15 minutes for limits, 5 for earned time) that arrive in order.
  /// A step event that skips ahead (one before it was lost, or an early misfire) is credited at most
  /// one step past what was counted: a lost callback costs one step, not the rest of the day, and a
  /// misfire can't jump the count (D5).
  static func credit(_ total: Int, counted: Int, step: Int) -> Int { min(total, counted + step) }
  /// The final event ("limit", "end", "eend") is believed within two steps of what was counted
  /// (one may lag after a lost callback); further off, it's a misfire and monitoring restarts.
  static func inOrder(_ total: Int, counted: Int, step: Int) -> Bool { total <= counted + 2 * step }

  static func onEvent(_ raw: String, activity: String) {
    locked {
      let now = STShared.now()
      rollDay(now: now)
      handleEvent(raw, activity: activity, now: now)
      // "st.next" use thresholds need nothing else: re-applying is the point.
      reapply()
    }
  }

  private static func handleEvent(_ raw: String, activity: String, now: Date) {
    let (gen, event) = splitGen(raw)
    if activity == "st.limit" {
      // Only events of the monitoring armed now (a misfire re-arm leaves older ones queued).
      guard let arm = limitArm, arm.day == dayKey(now), arm.gen == gen else { return }
      let st = state(now: now)
      // Counted so far: the arm may have started from the app's figure, above the extension's own.
      let usedSoFar = max(arm.used, st.usedMin)
      // Start measuring again from the usage we know about.
      let misfire = { _ = armLimit(used: usedSoFar, rearms: arm.rearms + 1) }
      if event.hasPrefix("g."), let dot = event.lastIndex(of: "."), dot >= event.index(event.startIndex, offsetBy: 2) {
        // A per-app limit: "g.<id>.<minutes>" or "g.<id>.end".
        let id = String(event[event.index(event.startIndex, offsetBy: 2)..<dot])
        let tail = String(event[event.index(after: dot)...])
        let base = arm.groupUsed?[id] ?? 0
        let counted = max(base, st.appUsed?[id] ?? 0)
        let left = arm.groupLeft?[id] ?? 0
        let m = tail == "end" ? left : Int(tail)
        // "end", or the step at it (which closes the apps should "end" be lost or rejected).
        if let m, m >= left, plausible(left, since: arm.at, now: now) && inOrder(base + left, counted: counted, step: 15) {
          updateState(now: now) { st in st.appUsed = (st.appUsed ?? [:]).merging([id: base + left]) { max($0, $1) } }
        } else if tail == "end" {
          if arm.rearms < 3 { misfire() }
        } else if let m, plausible(m, since: arm.at, now: now) {
          let v = credit(base + m, counted: counted, step: 15)
          updateState(now: now) { st in st.appUsed = (st.appUsed ?? [:]).merging([id: v]) { max($0, $1) } }
        }
      } else if event == "limit" {
        if plausible(arm.left, since: arm.at, now: now) && inOrder(arm.used + arm.left, counted: usedSoFar, step: 15) {
          updateState(now: now) { st in
            st.limitReached = true
            st.usedMin = max(st.usedMin, arm.used + arm.left)
          }
        } else if arm.rearms < 3 {
          misfire()
        }
      } else if event.hasPrefix("u"), let m = Int(event.dropFirst()), plausible(m, since: arm.at, now: now) {
        let v = credit(arm.used + m, counted: usedSoFar, step: 15)
        updateState(now: now) { st in st.usedMin = max(st.usedMin, v) }
      }
    } else if activity == "st.earned" {
      let st = state(now: now)
      guard st.earnedGen == gen else { return }
      let total = max(0, plan?.earnedLeftMin ?? 0)
      // Each event hands over only the minutes this monitoring hasn't counted yet (the app may
      // already have been given the earlier ones by takeState).
      func count(_ m: Int, done: Bool) {
        updateState(now: now) { st in
          let counted = min(max(m, st.earnedArmSpent), st.earnedArmMin)
          st.earnedSpentMin = min(st.earnedSpentMin + (counted - st.earnedArmSpent), total)
          st.earnedArmSpent = counted
          if done { st.earnedArmed = false }
        }
      }
      if event == "eend" {
        let rest = st.earnedArmMin - st.earnedArmSpent
        if rest <= 0 || (plausible(st.earnedArmMin, since: st.earnedArmedAt, now: now) && inOrder(st.earnedArmMin, counted: st.earnedArmSpent, step: 5)) {
          count(st.earnedArmMin, done: true)
        } else if st.earnedRearms < 3, let p = plan {
          // Misfire: watch the minutes not yet counted again.
          let watch = earnedWatch(p, status(at: now))
          if !watch.isEmpty { armEarned(minutes: rest, watch: watch, rearm: true) }
        }
      } else if event.hasPrefix("e"), let m = Int(event.dropFirst()), plausible(m, since: st.earnedArmedAt, now: now) {
        // The step at the total ends it too, should "eend" be lost or rejected.
        if m >= st.earnedArmMin && inOrder(st.earnedArmMin, counted: st.earnedArmSpent, step: 5) {
          count(st.earnedArmMin, done: true)
        } else {
          count(credit(m, counted: st.earnedArmSpent, step: 5), done: false)
        }
      }
    }
  }
}

/// Saved state from an older build may lack fields added since: decode what's there and use the
/// defaults for the rest, instead of failing and resetting the day. (In an extension, so the
/// memberwise initializer stays.)
extension STShared.State {
  init(from decoder: Decoder) throws {
    self.init()
    let c = try decoder.container(keyedBy: CodingKeys.self)
    func v<T: Decodable>(_ k: CodingKeys, _ fallback: T) -> T { ((try? c.decodeIfPresent(T.self, forKey: k)) ?? nil) ?? fallback }
    func o<T: Decodable>(_ k: CodingKeys, _ t: T.Type) -> T? { (try? c.decodeIfPresent(T.self, forKey: k)) ?? nil }
    day = v(.day, day)
    usedMin = v(.usedMin, usedMin)
    limitReached = v(.limitReached, limitReached)
    earnedSpentMin = v(.earnedSpentMin, earnedSpentMin)
    earnedArmed = v(.earnedArmed, earnedArmed)
    earnedArmedAt = v(.earnedArmedAt, earnedArmedAt)
    earnedRearms = v(.earnedRearms, earnedRearms)
    earnedArmMin = v(.earnedArmMin, earnedArmMin)
    earnedArmSpent = v(.earnedArmSpent, earnedArmSpent)
    earnedGen = o(.earnedGen, Int.self)
    earnedSig = o(.earnedSig, String.self)
    unlocks = v(.unlocks, unlocks)
    openEarn = v(.openEarn, openEarn)
    openScan = o(.openScan, Bool.self)
    appUsed = o(.appUsed, [String: Int].self)
    pauses = o(.pauses, Int.self)
    passes = o(.passes, [String: Double].self)
  }
}
