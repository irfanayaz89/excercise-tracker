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
    /// "set" or "timed" (wording only).
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

  static var plan: Plan? { load("st.plan", Plan.self) }

  /// Today's state (a new day starts fresh). Only a later day counts: if the clock is moved back,
  /// the day already used up stays used up.
  static func state(now: Date = Date()) -> State {
    var s = load("st.state", State.self) ?? State()
    let today = dayKey(now)
    if today > s.day {
      s = State(day: today, unlocks: s.unlocks, openEarn: s.openEarn, openScan: s.openScan, passes: s.passes)
    }
    return s
  }

  static func saveState(_ s: State) { save("st.state", s) }

  /// Several processes write the state (the app, the monitor, the blocked-screen buttons), with no
  /// lock between them, so each change is a small read-modify-write done at once.
  static func updateState(now: Date = Date(), _ change: (inout State) -> Void) {
    var s = state(now: now)
    change(&s)
    saveState(s)
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
    let g = (defaults?.integer(forKey: "st.armGen") ?? 0) &+ 1
    defaults?.set(g, forKey: "st.armGen")
    return g
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
    s.unlocked = unlocked
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
    s.blockAll = s.reason == "focus" ? (p.focusAll ?? false) : (s.reason == "lock" && blocking.contains { $0.0.allApps == true })
    if !unlocked {
      s.limitBlocked = (p.appLimits ?? []).filter { l in l.dailyMin.map { limitUsed(p, st, l, today: today) >= $0 } ?? false }.map { $0.id }
    }
    // The plan's "left" counts are for the day it was made. On a later day the app hasn't seen yet,
    // the allowance starts again, and only unlocks taken today count against it.
    let newDay = today > p.day
    let capLeft = newDay ? (p.earnCapMin ?? p.earnCapLeftMin) : p.earnCapLeftMin
    s.canEarn = s.blocked && s.reason != "focus" && p.earningEnabled && capLeft > 0 && (s.reason == "limit" || blocking.allSatisfy { $0.0.earnable })
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
      primary: b.primary, secondary: b.secondary, at: Date().timeIntervalSince1970))
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
    s.shield.applications = nil
    s.shield.applicationCategories = .all(except: allowed?.applicationTokens ?? [])
    s.shield.webDomains = nil
    s.shield.webDomainCategories = .all(except: allowed?.webDomainTokens ?? [])
  }

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
    if s.blocked && s.blockAll {
      blockEverything("st.main", allowed: allowed)
    } else if s.blocked, let main = selection("main") {
      block("st.main", main, allowed: allowed)
    } else {
      unblock("st.main")
    }
    // Per-app limits used up: their own apps, in a store each.
    limIds = limIds + (p.appLimits ?? []).map { $0.id }
    for id in limIds {
      if s.limitBlocked.contains(id), let l = p.appLimits?.first(where: { $0.id == id }), !l.apps.isEmpty {
        block("st.lim.\(id)", l.apps.family, allowed: allowed)
      } else {
        unblock("st.lim.\(id)")
      }
    }
    applyPause(p, s, allowed: allowed, now: now)
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
    let st = state(now: now)
    if s.usingEarned && !st.earnedArmed {
      armEarned(minutes: s.earnedLeft)
    } else if !s.usingEarned && st.earnedArmed {
      stopEarned()
    }
    writeWidget(s)
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
  /// ("st.pause") with the apps and sites on a pass left out.
  static func applyPause(_ p: Plan, _ s: Status, allowed: FamilyActivitySelection?, now: Date) {
    guard let pause = p.pause, pause.enabled, !s.blocked, !s.unlocked, let main = selection("main") else {
      unblock("st.pause")
      return
    }
    let nowMs = now.timeIntervalSince1970 * 1000
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
    // Wake when the next pass runs out, so the pause comes back with Trueline closed. Only when
    // that moment changes: restarting a schedule ends its interval, which calls reapply again.
    let next = (state(now: now).passes ?? [:]).values.filter { $0 > nowMs }.min()
    if let next, defaults?.double(forKey: "st.passWake") != next {
      defaults?.set(next, forKey: "st.passWake")
      wakeAt(Date(timeIntervalSince1970: next / 1000), name: "st.pass")
    }
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
  static func pauseLeft(_ key: String, now: Date = Date()) -> Int {
    guard let p = plan, let pause = p.pause else { return 0 }
    let nowMs = now.timeIntervalSince1970 * 1000
    var shownAt = pauseShown[key] ?? 0
    // A pause screen left alone for two minutes starts over next time.
    if shownAt < nowMs - 120_000 {
      shownAt = nowMs
      var shown = pauseShown.filter { $0.value >= nowMs - 120_000 }
      shown[key] = nowMs
      pauseShown = shown
    }
    let wait = Double(pause.wait(pausePasses(p, state(now: now), now: now)))
    return Swift.max(0, Int(ceil(wait - (nowMs - shownAt) / 1000)))
  }

  /// The wait is over: open this app or site for the pass length; the next wait grows.
  static func grantPass(_ key: String, now: Date = Date()) {
    guard let p = plan, let pause = p.pause else { return }
    let nowMs = now.timeIntervalSince1970 * 1000
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

  // MARK: Home screen widget

  /// What the widget shows: a title and, when there is one, the time it changes.
  static func writeWidget(_ s: Status?) {
    var title = "Screen time is off"
    var until: Double? = nil
    if let s, let p = plan {
      let nowMs = Date().timeIntervalSince1970 * 1000
      let unlock = (state().unlocks.filter { $0.from <= nowMs && nowMs < $0.until }.map { $0.until } + [p.unlockUntil ?? 0]).max() ?? 0
      if unlock > nowMs {
        title = "Unlocked"
        until = unlock
      } else if s.blocked {
        title = s.reason == "limit" ? "Today's time is up" : s.reason == "focus" ? (p.focusKind == "key" ? "Key lock" : "Workout focus") : (s.lockName ?? "Locked")
        until = s.until.map { $0.timeIntervalSince1970 * 1000 }
      } else if s.usingEarned {
        title = "Using earned time"
      } else {
        title = p.dailyLimitMin.map { "Daily limit \($0) min" } ?? "Screen time is on"
      }
    }
    // Only what the widget shows, in a stable key order, so an unchanged summary compares equal and
    // doesn't spend WidgetKit's daily reload budget.
    let json: [String: Any] = ["title": title, "until": until ?? NSNull()]
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
    writeWidget(nil)
  }

  /// Every per-app limit store ever used (so a deleted limit's block can still be lifted).
  static var limIds: [String] {
    get { defaults?.stringArray(forKey: "st.limIds") ?? [] }
    set { defaults?.set(Array(Set(newValue)).sorted(), forKey: "st.limIds") }
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
        threshold: DateComponents(minute: m), includesPastActivity: false)
      m += step
    }
    if let f = final, f > 0 {
      out[DeviceActivityEvent.Name("\(prefix)end")] = DeviceActivityEvent(
        applications: sel.applicationTokens, categories: sel.categoryTokens, webDomains: sel.webDomainTokens,
        threshold: DateComponents(minute: f), includesPastActivity: false)
    }
    return out
  }

  /// (Re)start every schedule. Apple allows 20 per app:
  /// day + limit + earned + unlock + focus + pause pass (6) + 2 per lock time (at most 7) = 20.
  /// Per-app limits add events to the "limit" schedule, not schedules of their own.
  /// `rearmLimit` false keeps the running limit monitoring: restarting it would forget the use
  /// counted since its last 15-minute step (see limitArmCurrent).
  static func scheduleAll(rearmLimit: Bool = true) -> [String] {
    var errors: [String] = []
    let center = DeviceActivityCenter()
    let keep = ["st.earned", "st.unlock", "st.pass"] + (rearmLimit ? [] : ["st.limit"])
    center.stopMonitoring(center.activities.filter { $0.rawValue.hasPrefix("st.") && !keep.contains($0.rawValue) })
    guard #available(iOS 17.4, *) else { return ["Screen Time needs iOS 17.4 or later"] }
    guard let p = plan else { return errors }
    // The day schedule has no events: it only wakes the monitor at midnight to start the new day.
    do {
      try center.startMonitoring(
        DeviceActivityName("st.day"),
        during: DeviceActivitySchedule(intervalStart: comps(0), intervalEnd: comps(23 * 60 + 59, second: 59), repeats: true))
    } catch { errors.append("day: \(error)") }
    if rearmLimit {
      // The plan's usage counts only for the day it was made.
      let used = p.day == dayKey(Date()) ? (p.usedMin ?? 0) : 0
      if let e = armLimit(used: used, rearms: 0) { errors.append(e) }
    }
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
    // A workout focus: wake up when it ends so the block lifts even if Trueline is closed.
    if let f = p.focusUntil, f > Date().timeIntervalSince1970 * 1000 {
      if let e = wakeAt(Date(timeIntervalSince1970: f / 1000), name: "st.focus") { errors.append("focus: \(e)") }
    }
    return errors
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
  static func limitArmCurrent(_ p: Plan, now: Date = Date()) -> Bool {
    guard let a = limitArm, a.day == dayKey(now), a.sig == limitSig(p) else { return false }
    return a.watching == false || DeviceActivityCenter().activities.contains(DeviceActivityName("st.limit"))
  }

  /// Watch the blocked apps' usage for the rest of today, counted from now (iOS 26 thresholds
  /// can fire at once when they include earlier activity, so nothing here does).
  /// Events: "uM" every 15 minutes of use, and "limit" when the minutes left run out, each named
  /// "a<gen>.<event>".
  @discardableResult
  static func armLimit(used usedIn: Int, rearms: Int) -> String? {
    guard #available(iOS 17.4, *), let p = plan else { return nil }
    let main = selection("main")
    let center = DeviceActivityCenter()
    center.stopMonitoring([DeviceActivityName("st.limit")])
    let now = Date()
    let today = dayKey(now)
    let st = state(now: now)
    let used = max(usedIn, st.usedMin)
    // The plan's "reached" is for the day it was made: at midnight it's yesterday's.
    let reachedToday = st.limitReached || (p.day == today && p.limitReached)
    let left = p.dailyLimitMin.map { max(0, $0 - used) } ?? 0
    let gen = nextGen()
    let pre = "a\(gen)."
    var evs: [DeviceActivityEvent.Name: DeviceActivityEvent] = [:]
    if let main {
      evs = events(for: main, prefix: "\(pre)u", upTo: 600, step: 15, final: nil)
      if p.dailyLimitMin != nil, !reachedToday, left > 0 {
        evs[DeviceActivityEvent.Name("\(pre)limit")] = DeviceActivityEvent(
          applications: main.applicationTokens, categories: main.categoryTokens, webDomains: main.webDomainTokens,
          threshold: DateComponents(minute: left), includesPastActivity: false)
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
        evs.merge(events(for: l.apps.family, prefix: "\(pre)g.\(l.id).", upTo: daily - u - 1, step: 15, final: daily - u)) { a, _ in a }
      }
    }
    limitArm = LimitArm(
      day: today, at: now.timeIntervalSince1970, used: used, left: left, rearms: rearms,
      groupUsed: groupUsed, groupLeft: groupLeft, gen: gen, sig: limitSig(p), watching: !evs.isEmpty)
    if evs.isEmpty { return nil }
    // Until the end of today; a schedule must last 15 minutes, so late at night it starts a little in the past.
    let cal = Calendar.current
    guard let endOfDay = cal.date(bySettingHour: 23, minute: 59, second: 59, of: now) else { return nil }
    let start = min(now, endOfDay.addingTimeInterval(-16 * 60))
    // With the time zone: a schedule made of bare components follows the phone's zone, so a zone
    // change (travel) would shift it by the offset.
    let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second, .timeZone]
    do {
      try center.startMonitoring(
        DeviceActivityName("st.limit"),
        during: DeviceActivitySchedule(intervalStart: cal.dateComponents(parts, from: start), intervalEnd: cal.dateComponents(parts, from: endOfDay), repeats: false),
        events: evs)
      return nil
    } catch { return "limit: \(error)" }
  }

  /// A one-off 15-minute schedule that ends at `at` (Apple's minimum length), to wake the monitor then.
  @discardableResult
  static func wakeAt(_ at: Date, name: String) -> String? {
    let cal = Calendar.current
    // With the time zone, so a wake-up keeps its moment if the phone's zone changes.
    let parts: Set<Calendar.Component> = [.year, .month, .day, .hour, .minute, .second, .timeZone]
    let center = DeviceActivityCenter()
    center.stopMonitoring([DeviceActivityName(name)])
    do {
      try center.startMonitoring(
        DeviceActivityName(name),
        during: DeviceActivitySchedule(
          intervalStart: cal.dateComponents(parts, from: at.addingTimeInterval(-15 * 60)),
          intervalEnd: cal.dateComponents(parts, from: at),
          repeats: false))
      return nil
    } catch { return "\(error)" }
  }

  // MARK: Earned time

  /// Stopping a schedule ends its interval, which calls intervalDidEnd: note when Trueline itself
  /// stopped "st.earned", so that callback isn't taken for earned time running out (which would
  /// re-arm it, stop it again, and loop).
  static func markEarnedRestart() {
    defaults?.set(Date().timeIntervalSince1970, forKey: "st.earnedRestart")
  }

  static func earnedRestartedRecently(now: Date = Date()) -> Bool {
    let at = defaults?.double(forKey: "st.earnedRestart") ?? 0
    return now.timeIntervalSince1970 - at < 10
  }

  static func stopEarned() {
    markEarnedRestart()
    DeviceActivityCenter().stopMonitoring([DeviceActivityName("st.earned")])
    updateState { $0.earnedArmed = false }
  }

  /// Watch earned minutes being spent on the blocked apps, in 5-minute steps and the exact end
  /// ("a<gen>.e<m>", "a<gen>.eend").
  static func armEarned(minutes: Int, rearm: Bool = false) {
    guard #available(iOS 17.4, *), minutes > 0, let p = plan, let main = selection("main") else { return }
    let cal = Calendar.current
    let now = Date()
    let start = cal.dateComponents([.year, .month, .day, .hour, .minute, .timeZone], from: cal.startOfDay(for: now))
    var end = cal.dateComponents([.year, .month, .day, .timeZone], from: now)
    end.hour = 23
    end.minute = 59
    end.second = 59
    let gen = nextGen()
    updateState(now: now) { st in
      st.earnedArmed = true
      st.earnedArmedAt = now.timeIntervalSince1970
      st.earnedRearms = rearm ? st.earnedRearms + 1 : 0
      st.earnedArmMin = minutes
      st.earnedArmSpent = 0
      st.earnedGen = gen
      st.earnedSig = signature(p.blocked)
    }
    let center = DeviceActivityCenter()
    markEarnedRestart()
    center.stopMonitoring([DeviceActivityName("st.earned")])
    try? center.startMonitoring(
      DeviceActivityName("st.earned"),
      during: DeviceActivitySchedule(intervalStart: start, intervalEnd: end, repeats: false),
      events: events(for: main, prefix: "a\(gen).e", upTo: minutes - 1, step: 5, final: minutes))
  }

  /// After a new plan: keep earned monitoring running when it still expects what the plan says is
  /// left (nothing new was earned, the main list is the same), so its count isn't restarted from
  /// zero. Otherwise stop it, and reapply() arms it again with the new amount.
  static func keepOrStopEarned(now: Date = Date()) {
    guard let p = plan else { return }
    let st = state(now: now)
    guard st.earnedArmed else { return }
    let planLeft = p.earningEnabled && p.day == dayKey(now) ? max(0, p.earnedLeftMin - st.earnedSpentMin) : 0
    let expected = st.earnedArmMin - st.earnedArmSpent
    let running = DeviceActivityCenter().activities.contains(DeviceActivityName("st.earned"))
    if !running || expected != planLeft || st.earnedSig != signature(p.blocked) { stopEarned() }
  }

  /// A temporary unlock: lift the blocks now and wake up when it ends (schedules are at least 15 minutes).
  static func takeUnlock(kind: String, minutes: Int) {
    let now = Date()
    let until = now.addingTimeInterval(Double(minutes) * 60)
    updateState(now: now) { $0.unlocks.append(Unlock(kind: kind, from: now.timeIntervalSince1970 * 1000, until: until.timeIntervalSince1970 * 1000)) }
    wakeAt(until, name: "st.unlock")
    reapply(at: now)
  }

  /// Turn Screen Time off. The plan goes first: stopping the schedules wakes the monitor
  /// (intervalDidEnd), and with no plan its reapply lifts the blocks instead of putting them back.
  static func stopAll() {
    defaults?.removeObject(forKey: "st.plan")
    limitArm = nil
    markEarnedRestart()
    let center = DeviceActivityCenter()
    center.stopMonitoring(center.activities.filter { $0.rawValue.hasPrefix("st.") })
    updateState { $0.earnedArmed = false }
    unblockAll()
  }

  // MARK: Extension callbacks

  static func onIntervalStart(_ activity: String) {
    if activity == "st.day" {
      // A new day (this also fires when monitoring starts mid-day, so only act on a real new day).
      let nowMs = Date().timeIntervalSince1970 * 1000
      updateState { st in st.unlocks = st.unlocks.filter { $0.until > nowMs } }
      if limitArm?.day != dayKey(Date()) { armLimit(used: 0, rearms: 0) }
    }
    reapply(lean: 30)
  }

  static func onIntervalEnd(_ activity: String) {
    if activity == "st.earned" {
      // Trueline stopped or restarted it a moment ago: not the end of earned time.
      if earnedRestartedRecently() { return }
      updateState { $0.earnedArmed = false }
    }
    reapply(lean: 30)
  }

  /// Usage can't be more than the time that has passed since monitoring started (plus a minute
  /// of slack). An event claiming more is one of iOS 26's early misfires.
  static func plausible(_ minutes: Int, since armedAt: Double, now: Date = Date()) -> Bool {
    Double(minutes) <= (now.timeIntervalSince1970 - armedAt) / 60 + 1
  }

  static func onEvent(_ raw: String, activity: String) {
    let now = Date()
    let (gen, event) = splitGen(raw)
    if activity == "st.limit" {
      // Only events of the monitoring armed now (a misfire re-arm leaves older ones queued).
      guard let arm = limitArm, arm.day == dayKey(now), arm.gen == gen else { return }
      let misfire = {
        // Start measuring again from the usage we know about.
        armLimit(used: max(arm.used, state(now: now).usedMin), rearms: arm.rearms + 1)
        reapply()
      }
      if event.hasPrefix("g."), let dot = event.lastIndex(of: "."), dot >= event.index(event.startIndex, offsetBy: 2) {
        // A per-app limit: "g.<id>.<minutes>" or "g.<id>.end".
        let id = String(event[event.index(event.startIndex, offsetBy: 2)..<dot])
        let tail = String(event[event.index(after: dot)...])
        let base = arm.groupUsed?[id] ?? 0
        if tail == "end" {
          let left = arm.groupLeft?[id] ?? 0
          if plausible(left, since: arm.at, now: now) {
            updateState(now: now) { st in st.appUsed = (st.appUsed ?? [:]).merging([id: base + left]) { max($0, $1) } }
          } else if arm.rearms < 3 {
            misfire()
            return
          }
        } else if let m = Int(tail), plausible(m, since: arm.at, now: now) {
          updateState(now: now) { st in st.appUsed = (st.appUsed ?? [:]).merging([id: base + m]) { max($0, $1) } }
        }
      } else if event == "limit" {
        if plausible(arm.left, since: arm.at, now: now) {
          updateState(now: now) { st in
            st.limitReached = true
            st.usedMin = max(st.usedMin, arm.used + arm.left)
          }
        } else if arm.rearms < 3 {
          misfire()
          return
        }
      } else if event.hasPrefix("u"), let m = Int(event.dropFirst()), plausible(m, since: arm.at, now: now) {
        updateState(now: now) { st in st.usedMin = max(st.usedMin, arm.used + m) }
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
        if rest <= 0 || plausible(st.earnedArmMin, since: st.earnedArmedAt, now: now) {
          count(st.earnedArmMin, done: true)
        } else if st.earnedRearms < 3 {
          // Misfire: watch the minutes not yet counted again.
          armEarned(minutes: rest, rearm: true)
          return
        }
      } else if event.hasPrefix("e"), let m = Int(event.dropFirst()), plausible(m, since: st.earnedArmedAt, now: now) {
        count(m, done: false)
      }
    }
    reapply()
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
