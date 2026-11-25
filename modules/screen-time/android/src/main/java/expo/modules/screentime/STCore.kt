package expo.modules.screentime

import android.app.ActivityManager
import android.app.AlarmManager
import android.app.ApplicationExitInfo
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.provider.Telephony
import android.telecom.TelecomManager
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.provider.AlarmClock
import android.provider.Settings
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar
import java.util.Locale
import kotlin.math.abs

/**
 * Android side of Trueline's screen time, shared by the module, the blocking
 * service and the blocked screen. The app's TypeScript engine (src/screentime)
 * is the authority: it writes a plan here when it's open. While Trueline is in
 * the background, the service uses this file to act on that plan. Keep
 * `status()` in step with `decide()` in src/screentime/decide.ts and with
 * STShared.swift on iPhone.
 */
object STCore {
  private const val PREFS = "trueline.screentime"

  fun prefs(ctx: Context): SharedPreferences = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

  /**
   * The state is changed from three threads (the service's loop, the JS thread, the blocked
   * screen on the main thread). Every load-change-save holds this lock, so no writer overwrites
   * another's change with an older copy.
   */
  private val lock = Any()

  fun <T> locked(block: () -> T): T = synchronized(lock) { block() }

  /** Loads the state, changes it and saves it, as one step. */
  fun <T> edit(ctx: Context, now: Long = STCore.now(ctx), block: (State) -> T): T =
    synchronized(lock) {
      val st = state(ctx, now)
      val r = block(st)
      saveState(ctx, st)
      r
    }

  // ── Trusted time ───────────────────────────────────────────────────────────

  /**
   * "Now" for every screen time decision. Moving the phone clock forward must not end a lock time,
   * Strict, a focus or an unlock early, or start a new day. Each plan carries the app's own trusted
   * "now" (madeAt); with the time since boot at that moment, the phone carries on from it. When the
   * wall clock is more than 2 minutes away from that, the clock was moved: the carried-on time wins.
   * (The time since boot drifts only a second or two a day, and every plan from the app re-anchors.)
   * After a reboot the time since boot starts again, so the anchor says nothing: the wall clock is
   * used until Trueline sends its next plan. Accepted gap: moving the clock and then rebooting.
   */
  fun now(ctx: Context): Long {
    val wall = System.currentTimeMillis()
    val pr = prefs(ctx)
    val at = pr.getLong("clockAt", 0L)
    if (at == 0L) return wall
    val up = pr.getLong("clockUp", 0L)
    val el = SystemClock.elapsedRealtime()
    if (el < up || pr.getString("clockBoot", null) != bootId(ctx)) return wall
    val expected = at + (el - up)
    return if (abs(wall - expected) > CLOCK_SLACK_MS) expected else wall
  }

  private const val CLOCK_SLACK_MS = 120_000L

  /** Remembers the app's trusted "now" with the time since boot (on every plan). */
  fun anchor(ctx: Context, madeAt: Long?) {
    // An older app sends no madeAt: carry on from the last anchor (or the wall clock) instead.
    val at = madeAt ?: now(ctx)
    prefs(ctx).edit().putLong("clockAt", at).putLong("clockUp", SystemClock.elapsedRealtime()).putString("clockBoot", bootId(ctx)).apply()
  }

  /** The wall clock minus the trusted time: how far the phone clock was moved (0 when it wasn't). */
  fun skew(ctx: Context, now: Long = STCore.now(ctx)) = System.currentTimeMillis() - now

  @Volatile private var boot: String? = null

  /**
   * An id that changes on every reboot (it can't change while this process lives, so it's read
   * once): Android's boot count, else the kernel's boot id, else the boot moment by the wall clock
   * (a moved clock then only makes the anchor look stale, which falls back to the wall clock).
   */
  fun bootId(ctx: Context): String =
    boot ?: (
      runCatching { Settings.Global.getInt(ctx.contentResolver, Settings.Global.BOOT_COUNT).toString() }.getOrNull()
        ?: runCatching { java.io.File("/proc/sys/kernel/random/boot_id").readText().trim().takeIf { it.isNotEmpty() } }.getOrNull()
        ?: "up${(System.currentTimeMillis() - SystemClock.elapsedRealtime()) / 60_000}"
      ).also { boot = it }

  // ── Plan (written by the app) ──────────────────────────────────────────────

  data class Sel(val apps: Set<String>, val categories: Set<String>) {
    val isEmpty get() = apps.isEmpty() && categories.isEmpty()

    fun contains(pkg: String, category: String) = pkg in apps || (category.isNotEmpty() && category in categories)

    companion object {
      val EMPTY = Sel(emptySet(), emptySet())

      fun from(o: JSONObject?): Sel {
        if (o == null) return EMPTY
        return Sel(strings(o.optJSONArray("apps")), strings(o.optJSONArray("categories")))
      }
    }
  }

  data class Lock(
    val id: String,
    val name: String,
    val days: Set<Int>,
    val startMin: Int,
    val endMin: Int,
    val earnable: Boolean,
    val enabled: Boolean,
    val skipDate: String?,
    val apps: Sel?,
    /** Blocks every app except the always-allowed ones. */
    val allApps: Boolean = false,
  )

  /** A per-app limit, with what the app knew about today when it wrote the plan. */
  data class AppLim(
    val id: String,
    val name: String,
    val apps: Sel,
    val dailyMin: Int?,
    val opensPerDay: Int?,
    val usedMin: Int,
    val opens: Int,
  )

  data class Pause(val enabled: Boolean, val seconds: Int, val step: Int, val max: Int, val passMin: Int, val passes: Int) {
    /** The wait for the next pass, given the passes taken today. */
    fun wait(passesToday: Int) = minOf(max, seconds + step * passesToday)

    companion object {
      val OFF = Pause(false, 10, 5, 60, 5, 0)
    }
  }

  data class Plan(
    val day: String,
    val dailyLimitMin: Int?,
    val limitReached: Boolean,
    val earningEnabled: Boolean,
    val earnedLeftMin: Int,
    val earnCapLeftMin: Int,
    /** The full daily earning cap, used on a new day the app hasn't sent a plan for yet. */
    val earnCapMin: Int,
    val mode: String,
    /** While Strict runs: when its period ends (epoch ms). From then on the mode reads as "standard". */
    val strictUntil: Double?,
    val emergencyMin: Int,
    val oneMoreMin: Int,
    val emergenciesLeft: Int,
    val oneMoresLeft: Int,
    /** The full daily allowance, used on a new day the app hasn't sent a plan for yet. */
    val emergenciesPerDay: Int,
    val oneMoresPerDay: Int,
    val unlockUntil: Double?,
    /** A workout focus blocks the main apps until then (epoch ms). */
    val focusUntil: Double?,
    /** "set" or "timed" (wording only). */
    val focusKind: String?,
    /** A key lock or Strict focus: unlocks don't open the main apps and none is offered. */
    val focusLocked: Boolean = false,
    val locks: List<Lock>,
    val blocked: Sel,
    val allowed: Sel,
    /** The running focus blocks every app except the always-allowed ones. */
    val focusAll: Boolean = false,
    val appLimits: List<AppLim> = emptyList(),
    val pause: Pause = Pause.OFF,
    /** Hide notifications from apps while they're blocked. */
    val silence: Boolean = false,
    /** The app's trusted "now" when it made the plan (epoch ms); absent from older apps. */
    val madeAt: Long? = null,
  ) {
    /** Is there anything to block (or count)? If not, the service isn't needed. */
    val wantsBlocking get() = !blocked.isEmpty || appLimits.isNotEmpty() || focusAll ||
      locks.any { it.enabled && (it.allApps || it.apps == null || !it.apps.isEmpty) }
  }

  fun parsePlan(json: String): Plan {
    val o = JSONObject(json)
    val locks = mutableListOf<Lock>()
    val arr = o.optJSONArray("locks") ?: JSONArray()
    for (i in 0 until arr.length()) {
      val l = arr.getJSONObject(i)
      val days = mutableSetOf<Int>()
      val d = l.optJSONArray("days") ?: JSONArray()
      for (k in 0 until d.length()) days.add(d.getInt(k))
      locks.add(
        Lock(
          id = l.getString("id"),
          name = l.optString("name", "Lock time"),
          days = days,
          startMin = l.optInt("startMin"),
          endMin = l.optInt("endMin"),
          earnable = l.optBoolean("earnable"),
          enabled = l.optBoolean("enabled", true),
          skipDate = if (l.isNull("skipDate")) null else l.optString("skipDate"),
          apps = if (l.optBoolean("ownApps")) Sel.from(l.optJSONObject("apps")) else null,
          allApps = l.optBoolean("allApps"),
        ),
      )
    }
    val limits = mutableListOf<AppLim>()
    val la = o.optJSONArray("appLimits") ?: JSONArray()
    for (i in 0 until la.length()) {
      val l = la.getJSONObject(i)
      limits.add(
        AppLim(
          id = l.getString("id"),
          name = l.optString("name", "App limit"),
          apps = Sel.from(l.optJSONObject("apps")),
          dailyMin = if (l.isNull("dailyMin")) null else l.optInt("dailyMin"),
          opensPerDay = if (l.isNull("opensPerDay")) null else l.optInt("opensPerDay"),
          usedMin = l.optInt("usedMin"),
          opens = l.optInt("opens"),
        ),
      )
    }
    val pz = o.optJSONObject("pause")
    return Plan(
      day = o.optString("day"),
      dailyLimitMin = if (o.isNull("dailyLimitMin")) null else o.optInt("dailyLimitMin"),
      limitReached = o.optBoolean("limitReached"),
      earningEnabled = o.optBoolean("earningEnabled"),
      earnedLeftMin = o.optInt("earnedLeftMin"),
      earnCapLeftMin = o.optInt("earnCapLeftMin"),
      earnCapMin = o.optInt("earnCapMin", o.optInt("earnCapLeftMin")),
      mode = o.optString("mode", "standard"),
      strictUntil = if (!o.has("strictUntil") || o.isNull("strictUntil")) null else o.optDouble("strictUntil"),
      emergencyMin = o.optInt("emergencyMin", 10),
      oneMoreMin = o.optInt("oneMoreMin", 1),
      emergenciesLeft = o.optInt("emergenciesLeft"),
      oneMoresLeft = o.optInt("oneMoresLeft"),
      emergenciesPerDay = o.optInt("emergenciesPerDay", 1),
      oneMoresPerDay = o.optInt("oneMoresPerDay", 3),
      unlockUntil = if (o.isNull("unlockUntil")) null else o.optDouble("unlockUntil"),
      focusUntil = if (!o.has("focusUntil") || o.isNull("focusUntil")) null else o.optDouble("focusUntil"),
      focusKind = if (!o.has("focusKind") || o.isNull("focusKind")) null else o.optString("focusKind"),
      focusLocked = o.optBoolean("focusLocked", false),
      locks = locks,
      blocked = Sel.from(o.optJSONObject("blocked")),
      allowed = Sel.from(o.optJSONObject("allowed")),
      focusAll = o.optBoolean("focusAll"),
      appLimits = limits,
      pause = if (pz == null) Pause.OFF else Pause(
        enabled = pz.optBoolean("enabled"),
        seconds = pz.optInt("seconds", 10),
        step = pz.optInt("step", 5),
        max = pz.optInt("max", 60),
        passMin = pz.optInt("passMin", 5),
        passes = pz.optInt("passes"),
      ),
      silence = o.optBoolean("silence"),
      madeAt = if (!o.has("madeAt") || o.isNull("madeAt")) null else o.optLong("madeAt").takeIf { it > 0 },
    )
  }

  /** The last plan parsed, by its text: the service reads the plan every second, the text rarely changes. */
  @Volatile private var parsed: Pair<String, Plan>? = null

  fun plan(ctx: Context): Plan? {
    val raw = prefs(ctx).getString("plan", null) ?: return null
    parsed?.let { if (it.first == raw) return it.second }
    return runCatching { parsePlan(raw) }.getOrNull()?.also { parsed = raw to it }
  }

  // ── State (written here while Trueline is in the background) ───────────────

  data class Unlock(val kind: String, val from: Double, val until: Double)

  /**
   * A stretch when blocking wasn't running: "stopped" (force stop, Task Manager) or "killed" (e.g. a
   * battery saver). `via` says which stop it was when Android tells ("force-stop", "task-manager").
   */
  data class Gap(val from: Long, val to: Long, val kind: String, val via: String? = null)

  data class State(
    var day: String = "",
    /** Seconds the blocked apps were in front today. Whether the daily limit is reached is worked
     *  out from this and the limit in force now, so raising the limit gives the time back. */
    var usedSec: Long = 0,
    /** Earned seconds spent since the app last read this state. */
    var earnedSpentSec: Long = 0,
    val unlocks: MutableList<Unlock> = mutableListOf(),
    var openEarn: Boolean = false,
    val gaps: MutableList<Gap> = mutableListOf(),
    /** Per-app limits: seconds used and opens today, by limit id. */
    val appUsedSec: MutableMap<String, Long> = mutableMapOf(),
    val appOpens: MutableMap<String, Int> = mutableMapOf(),
    /** Passes taken through the pause screen today, and which apps are open on a pass until when. */
    var pauses: Int = 0,
    val passes: MutableMap<String, Long> = mutableMapOf(),
  ) {
    fun toJson(): JSONObject {
      val u = JSONArray()
      for (x in unlocks) u.put(JSONObject().put("kind", x.kind).put("from", x.from).put("until", x.until))
      val g = JSONArray()
      for (x in gaps) g.put(JSONObject().put("from", x.from).put("to", x.to).put("kind", x.kind).apply { x.via?.let { put("via", it) } })
      return JSONObject()
        .put("gaps", g)
        .put("day", day)
        .put("usedMin", usedSec / 60)
        .put("usedSec", usedSec)
        .put("earnedSpentMin", earnedSpentSec / 60)
        .put("earnedSpentSec", earnedSpentSec)
        .put("unlocks", u)
        .put("openEarn", openEarn)
        .put("appUsed", JSONObject().apply { appUsedSec.forEach { (k, v) -> put(k, v / 60) } })
        .put("appUsedSec", JSONObject().apply { appUsedSec.forEach { (k, v) -> put(k, v) } })
        .put("appOpens", JSONObject().apply { appOpens.forEach { (k, v) -> put(k, v) } })
        .put("pauses", pauses)
        .put("passes", JSONObject().apply { passes.forEach { (k, v) -> put(k, v) } })
    }
  }

  fun state(ctx: Context, now: Long = STCore.now(ctx)): State {
    val raw = prefs(ctx).getString("state", null)
    val s = State()
    if (raw != null) {
      runCatching {
        val o = JSONObject(raw)
        s.day = o.optString("day")
        s.usedSec = o.optLong("usedSec")
        s.earnedSpentSec = o.optLong("earnedSpentSec")
        s.openEarn = o.optBoolean("openEarn")
        val u = o.optJSONArray("unlocks") ?: JSONArray()
        for (i in 0 until u.length()) {
          val x = u.getJSONObject(i)
          s.unlocks.add(Unlock(x.optString("kind"), x.optDouble("from"), x.optDouble("until")))
        }
        val g = o.optJSONArray("gaps") ?: JSONArray()
        for (i in 0 until g.length()) {
          val x = g.getJSONObject(i)
          s.gaps.add(Gap(x.optLong("from"), x.optLong("to"), x.optString("kind"), if (x.isNull("via")) null else x.optString("via")))
        }
        o.optJSONObject("appUsedSec")?.let { m -> m.keys().forEach { s.appUsedSec[it] = m.optLong(it) } }
        o.optJSONObject("appOpens")?.let { m -> m.keys().forEach { s.appOpens[it] = m.optInt(it) } }
        s.pauses = o.optInt("pauses")
        o.optJSONObject("passes")?.let { m -> m.keys().forEach { s.passes[it] = m.optLong(it) } }
      }
    }
    val today = dayKey(now)
    if (today > s.day) {
      // A new day: usage and earned time start over (unlocks and an "earn" tap wait for the app).
      // Only a later day counts: if the clock is moved back, the day already used up stays used up.
      return State(day = today, unlocks = s.unlocks, openEarn = s.openEarn, gaps = s.gaps, passes = s.passes)
    }
    return s
  }

  /** Call while holding the lock (inside `edit` or `locked`). */
  fun saveState(ctx: Context, s: State) {
    prefs(ctx).edit().putString("state", s.toJson().toString()).apply()
  }

  /** The daily limit is reached by the usage counted here, against the limit in force now. */
  fun limitReached(p: Plan?, st: State): Boolean {
    val limit = p?.dailyLimitMin ?: return false
    return limit == 0 || st.usedSec >= limit * 60L
  }

  /** What happened since the app last read it; whole earned minutes are handed over, the remainder stays. */
  fun takeState(ctx: Context): String =
    edit(ctx) { st ->
      val out = st.toJson().put("limitReached", limitReached(plan(ctx), st))
      // What blocking needs right now, so the app can say what to fix (older apps ignore these).
      val usage = ScreenTimeModule.usageAccess(ctx)
      val overlay = Settings.canDrawOverlays(ctx)
      out.put(
        "access",
        JSONObject()
          .put("usage", usage)
          .put("overlay", overlay)
          .put("notifications", runCatching { ctx.getSystemService(android.app.NotificationManager::class.java).areNotificationsEnabled() }.getOrDefault(true))
          .put("listener", ScreenTimeModule.listenerOn(ctx)),
      )
      // Blocking should run but can't: "usage" or "overlay" (what's missing), else absent.
      if (plan(ctx)?.wantsBlocking == true) BootReceiver.missing(usage, overlay)?.let { out.put("pausedFor", it) }
      out.put("now", now(ctx)).put("clockMoved", abs(skew(ctx)) > CLOCK_SLACK_MS)
      st.earnedSpentSec -= (st.earnedSpentSec / 60) * 60
      st.unlocks.clear()
      st.gaps.clear()
      st.openEarn = false
      out.toString()
    }

  /** The user tapped "Earn time" on the blocked screen: Trueline opens its earn screen next. */
  fun requestEarn(ctx: Context) {
    edit(ctx) { it.openEarn = true }
  }

  // ── Local time ──────────────────────────────────────────────────────────────

  fun dayKey(ms: Long): String {
    val c = Calendar.getInstance().apply { timeInMillis = ms }
    // Locale.ROOT: always ASCII digits, so the key matches the app's own ("2026-11-25"), even on a
    // phone set to Arabic, Persian or Bengali (which would otherwise write their own digits).
    return String.format(Locale.ROOT, "%04d-%02d-%02d", c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
  }

  /** The window of a lock time starting on the local day containing `dayMs`. */
  fun window(l: Lock, dayMs: Long): Pair<Long, Long>? {
    val c = Calendar.getInstance().apply { timeInMillis = dayMs }
    val weekday = c.get(Calendar.DAY_OF_WEEK) - 1
    if (!l.enabled || weekday !in l.days || l.skipDate == dayKey(dayMs) || l.startMin == l.endMin) return null
    c.set(Calendar.HOUR_OF_DAY, 0)
    c.set(Calendar.MINUTE, 0)
    c.set(Calendar.SECOND, 0)
    c.set(Calendar.MILLISECOND, 0)
    val start = (c.clone() as Calendar).apply {
      set(Calendar.HOUR_OF_DAY, l.startMin / 60)
      set(Calendar.MINUTE, l.startMin % 60)
    }.timeInMillis
    val end = (c.clone() as Calendar).apply {
      if (l.endMin <= l.startMin) add(Calendar.DAY_OF_MONTH, 1)
      set(Calendar.HOUR_OF_DAY, l.endMin / 60)
      set(Calendar.MINUTE, l.endMin % 60)
    }.timeInMillis
    return if (end > start) start to end else null
  }

  fun active(l: Lock, now: Long): Pair<Long, Long>? {
    val yesterday = Calendar.getInstance().apply { timeInMillis = now; add(Calendar.DAY_OF_MONTH, -1) }.timeInMillis
    for (d in listOf(yesterday, now)) {
      val w = window(l, d) ?: continue
      if (w.first <= now && now < w.second) return w
    }
    return null
  }

  // ── What should happen now (mirror of decide()) ────────────────────────────

  data class Status(
    val blocked: Boolean = false,
    val reason: String? = null,
    val lockName: String? = null,
    val until: Long? = null,
    val usingEarned: Boolean = false,
    val earnedLeftSec: Long = 0,
    val canEarn: Boolean = false,
    val emergency: Boolean = false,
    val oneMore: Boolean = false,
    /** Own-app lock times blocking now (their own lists). */
    val ownBlocked: List<Lock> = emptyList(),
    /** An emergency unlock or "1 more minute" is running until then. */
    val unlockedUntil: Long? = null,
    /** The block covers every app except the always-allowed ones. */
    val blockAll: Boolean = false,
    /** Per-app limits used up today, and why ("time" or "opens"). */
    val limitBlocked: List<Pair<AppLim, String>> = emptyList(),
    /** Strictness in force now, and the unlocks left today (for the blocked screen's wording). */
    val mode: String = "standard",
    val emergenciesLeft: Int = 0,
    val oneMoresLeft: Int = 0,
  )

  /** Seconds used today against a per-app limit: the most the app or the service has counted. */
  fun limitUsedSec(p: Plan, st: State, l: AppLim, today: String): Long =
    maxOf(st.appUsedSec[l.id] ?: 0L, if (p.day == today) l.usedMin * 60L else 0L)

  fun limitOpens(p: Plan, st: State, l: AppLim, today: String): Int =
    maxOf(st.appOpens[l.id] ?: 0, if (p.day == today) l.opens else 0)

  fun status(p: Plan?, st: State, now: Long): Status {
    if (p == null) return Status()
    val today = dayKey(now)
    val planToday = p.day == today
    val earnedLeftSec = if (p.earningEnabled && planToday) maxOf(0L, p.earnedLeftMin * 60L - st.earnedSpentSec) else 0L
    val limit = p.dailyLimitMin
    val limitReached = limit != null && (limit == 0 || st.usedSec >= limit * 60L || (planToday && p.limitReached))
    val unlockedUntil = (st.unlocks.filter { it.from <= now && now < it.until }.map { it.until } + listOfNotNull(p.unlockUntil?.takeIf { it > now }))
      .maxOrNull()?.toLong()
    val unlocked = unlockedUntil != null

    val running = p.locks.mapNotNull { l -> active(l, now)?.let { l to it } }
    // "Everything" lock times decide like main ones (they block the main apps, and more).
    val main = running.filter { it.first.apps == null }
    val hard = main.filter { !it.first.earnable }
    val soft = main.filter { it.first.earnable }
    var reason: String? = null
    var usingEarned = false
    if (hard.isNotEmpty()) {
      reason = "lock"
    } else if (soft.isNotEmpty()) {
      if (earnedLeftSec > 0) usingEarned = true else reason = "lock"
    } else if (limitReached) {
      if (earnedLeftSec > 0) usingEarned = true else reason = "limit"
    }
    val focusing = (p.focusUntil ?: 0.0) > now
    if (focusing) {
      // A workout is running: the main apps stay closed and earned time doesn't open them.
      reason = "focus"
      usingEarned = false
    }
    // A key lock or Strict focus can't be opened by an unlock: only the key (or its end) lifts it.
    val lockedFocus = focusing && p.focusLocked
    if (unlocked && !lockedFocus) {
      reason = null
      usingEarned = false
    }
    val blocking = if (reason == "lock") (if (hard.isNotEmpty()) hard else soft) else emptyList()
    val last = blocking.maxByOrNull { it.second.second }
    val ownBlocked = running.filter { it.first.apps != null && !unlocked && !(it.first.earnable && earnedLeftSec > 0) }.map { it.first }
    val blocked = reason != null
    // The plan's "left" counts are for the day it was made. On a later day the app hasn't seen yet,
    // the allowance starts again, and only unlocks taken today count against it.
    val newDay = today > p.day
    val earnCapLeft = if (newDay) p.earnCapMin else p.earnCapLeftMin
    val canEarn = blocked && reason != "focus" && p.earningEnabled && earnCapLeft > 0 && (reason == "limit" || blocking.all { it.first.earnable })
    val blockAll = if (reason == "focus") p.focusAll else reason == "lock" && blocking.any { it.first.allApps }
    val limitBlocked = if (unlocked) emptyList() else p.appLimits.mapNotNull { l ->
      when {
        l.dailyMin != null && limitUsedSec(p, st, l, today) >= l.dailyMin * 60L -> l to "time"
        l.opensPerDay != null && limitOpens(p, st, l, today) >= l.opensPerDay -> l to "opens"
        else -> null
      }
    }
    val any = blocked || ownBlocked.isNotEmpty() || limitBlocked.isNotEmpty()
    // Strict reads as Standard once its period is over, even before Trueline sends a new plan.
    val mode = if (p.mode == "strict" && p.strictUntil != null && now >= p.strictUntil) "standard" else p.mode
    val mine = st.unlocks.filter { !newDay || dayKey(it.from.toLong()) == today }
    val usedEmergencies = mine.count { it.kind == "emergency" }
    val usedOneMores = mine.count { it.kind == "one-more" }
    val emergenciesLeft = if (newDay) p.emergenciesPerDay else p.emergenciesLeft
    val oneMoresLeft = if (newDay) p.oneMoresPerDay else p.oneMoresLeft
    return Status(
      blocked = blocked,
      reason = reason,
      lockName = if (reason == "focus") "Workout focus" else last?.first?.name,
      until = if (reason == "focus") p.focusUntil?.toLong() else last?.second?.second,
      usingEarned = usingEarned,
      earnedLeftSec = earnedLeftSec,
      canEarn = canEarn,
      emergency = any && !lockedFocus && mode == "standard" && emergenciesLeft - usedEmergencies > 0,
      oneMore = any && !lockedFocus && mode == "nudge" && oneMoresLeft - usedOneMores > 0,
      ownBlocked = ownBlocked,
      unlockedUntil = unlockedUntil,
      blockAll = blockAll,
      limitBlocked = limitBlocked,
      mode = mode,
      emergenciesLeft = maxOf(0, emergenciesLeft - usedEmergencies),
      oneMoresLeft = maxOf(0, oneMoresLeft - usedOneMores),
    )
  }

  /**
   * Is this app (in front right now) blocked? Allowed apps never are; Trueline itself never is.
   * `everyday` says whether an app counts for "block everything": an app the user opens from the
   * launcher, and not one the phone needs (home screen, phone, messages, settings, keyboard).
   */
  fun blocks(p: Plan, s: Status, pkg: String, category: String, self: String, everyday: (String) -> Boolean): Boolean {
    if (pkg == self || pkg in p.allowed.apps) return false
    if (s.blocked && (p.blocked.contains(pkg, category) || (s.blockAll && everyday(pkg)))) return true
    if (s.limitBlocked.any { it.first.apps.contains(pkg, category) }) return true
    return s.ownBlocked.any { it.apps?.contains(pkg, category) == true }
  }

  /** Why this app is blocked, for the blocked screen: a per-app limit's name, or null for the main reasons. */
  fun limitFor(s: Status, pkg: String, category: String): Pair<AppLim, String>? =
    s.limitBlocked.firstOrNull { it.first.apps.contains(pkg, category) }

  /** Should this app show the pause screen first? (Outside blocks, for the main list, without a pass.) */
  fun pauses(p: Plan, s: Status, st: State, pkg: String, category: String, self: String, now: Long): Boolean {
    // An emergency unlock or "1 more minute" opens the apps straight away: no pause either.
    if (!p.pause.enabled || s.blocked || s.unlockedUntil != null || pkg == self || pkg in p.allowed.apps) return false
    if (!p.blocked.contains(pkg, category)) return false
    return (st.passes[pkg] ?: 0L) <= now
  }

  /** The per-app limits an app belongs to (its time and opens count towards each). */
  fun limitsOf(p: Plan, pkg: String, category: String) = p.appLimits.filter { it.apps.contains(pkg, category) }

  /** Counts against the daily limit (the main blocked list, minus allowed apps). */
  fun counts(p: Plan, pkg: String, category: String, self: String) =
    pkg != self && pkg !in p.allowed.apps && p.blocked.contains(pkg, category)

  // ── Was blocking stopped? (research guide, Appendix A F5) ─────────────────

  /** The service writes this every few seconds while it runs. */
  fun heartbeat(ctx: Context, now: Long = STCore.now(ctx)) {
    prefs(ctx).edit().putLong("hb", now).putBoolean("svc", true).apply()
  }

  /** The service stopped on purpose (no more plan, or turned off): not a gap. */
  fun stoppedCleanly(ctx: Context) {
    prefs(ctx).edit().putBoolean("svc", false).apply()
  }

  /**
   * Called when Trueline or the service starts. If the service should have been running but its
   * heartbeat is old, and the phone was in use meanwhile, record the gap: "stopped" when Android
   * says the user stopped the app (Force stop, Task Manager), otherwise "killed".
   * The screen-on check avoids counting the phone sleeping as a gap. A heartbeat from before the
   * last boot doesn't start a gap (the phone was off, and a shutdown doesn't always stop the service
   * cleanly): only time after the boot can count, and only if the service still hadn't started
   * well after it (it normally starts on BOOT_COMPLETED).
   */
  fun checkGap(ctx: Context, now: Long = STCore.now(ctx)) =
    locked {
      val pr = prefs(ctx)
      val hb = pr.getLong("hb", 0L)
      if (hb == 0L || !pr.getBoolean("svc", false) || now - hb < 60_000) return@locked
      val bootAt = now - SystemClock.elapsedRealtime()
      // Android's records (usage events, exit reasons) are stamped with the wall clock.
      val shift = skew(ctx, now)
      val from = maxOf(hb, bootAt)
      if (hb < bootAt && now - bootAt < BOOT_GRACE_MS) {
        heartbeat(ctx, now)
        return@locked
      }
      if (interactiveMs(ctx, from + shift, now + shift) < 60_000) {
        heartbeat(ctx, now)
        return@locked
      }
      val via = userStopSince(ctx, from + shift, now + shift)
      val st = state(ctx, now)
      if (st.gaps.none { it.from == from }) st.gaps.add(Gap(from, now, if (via != null) "stopped" else "killed", via?.takeIf { it != "user" }))
      saveState(ctx, st)
      heartbeat(ctx, now)
    }

  /** After a boot, how long the service may take to start before the time counts as a gap. */
  private const val BOOT_GRACE_MS = 5 * 60_000L

  /** Milliseconds the screen was on between two moments (from usage events). */
  private fun interactiveMs(ctx: Context, from: Long, to: Long): Long {
    val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val events = runCatching { usm.queryEvents(from, to) }.getOrNull() ?: return 0L
    val e = UsageEvents.Event()
    var on: Long? = null
    var total = 0L
    var first = true
    while (events.hasNextEvent()) {
      events.getNextEvent(e)
      when (e.eventType) {
        UsageEvents.Event.SCREEN_INTERACTIVE -> { if (on == null) on = e.timeStamp; first = false }
        UsageEvents.Event.SCREEN_NON_INTERACTIVE -> {
          // The screen was already on when the gap began.
          if (first && on == null) on = from
          on?.let { total += e.timeStamp - it }
          on = null
          first = false
        }
      }
    }
    if (first) {
      // No screen changes at all: on (or off) the whole time.
      return if (ctx.getSystemService(PowerManager::class.java).isInteractive) to - from else 0L
    }
    on?.let { total += to - it }
    return total
  }

  /**
   * Did the user stop Trueline (Force stop or Task Manager) after `since`? Returns "force-stop" or
   * "task-manager" when Android can tell them apart (Android 15+: this start's wasForceStopped(); a
   * Task Manager stop leaves the app runnable, a force stop doesn't), "user" when it can't, or null.
   */
  private fun userStopSince(ctx: Context, since: Long, now: Long): String? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return null
    val am = ctx.getSystemService(ActivityManager::class.java) ?: return null
    val requested = runCatching {
      am.getHistoricalProcessExitReasons(ctx.packageName, 0, 5).any {
        it.timestamp >= since && it.reason == ApplicationExitInfo.REASON_USER_REQUESTED
      }
    }.getOrDefault(false)
    // This process's own start record, if it began after `since` (so the stop it follows is in the gap).
    val startedAt = now - (SystemClock.elapsedRealtime() - Process.getStartElapsedRealtime())
    val forced: Boolean? =
      if (Build.VERSION.SDK_INT >= 35 && startedAt >= since) {
        runCatching { am.getHistoricalProcessStartReasons(5).firstOrNull { it.pid == Process.myPid() }?.wasForceStopped() }.getOrNull()
      } else {
        null
      }
    return when {
      forced == true -> "force-stop"
      requested && forced == false -> "task-manager"
      requested -> "user"
      else -> null
    }
  }

  /** Passes taken today, as far as the app or the phone knows (each makes the next wait longer). */
  fun pausePasses(p: Plan, st: State, now: Long) = maxOf(st.pauses, if (p.day == dayKey(now)) p.pause.passes else 0)

  /** The user waited out the pause: this app is open for the pass length, and the next wait grows. */
  fun grantPass(ctx: Context, pkg: String, now: Long = STCore.now(ctx)) {
    val p = plan(ctx) ?: return
    edit(ctx, now) { st ->
      st.passes.entries.removeAll { it.value <= now }
      st.passes[pkg] = now + p.pause.passMin * 60_000L
      st.pauses = pausePasses(p, st, now) + 1
    }
  }

  /**
   * For "block everything": apps the user opens from the launcher, minus the ones the phone needs
   * (home screen, phone, messages, Settings, the clock app so an alarm is never covered) and
   * Trueline itself. (An alarm shown over the lock screen is also never blocked: the service does
   * nothing while the keyguard is up.)
   */
  fun everydayApps(ctx: Context): Set<String> {
    val pm = ctx.packageManager
    val launchable = runCatching {
      pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0).map { it.activityInfo.packageName }.toSet()
    }.getOrDefault(emptySet())
    val needed = mutableSetOf(ctx.packageName, "com.android.settings")
    runCatching { pm.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), PackageManager.MATCH_DEFAULT_ONLY) }
      .getOrNull()?.activityInfo?.packageName?.let { needed.add(it) }
    runCatching { ctx.getSystemService(TelecomManager::class.java)?.defaultDialerPackage }.getOrNull()?.let { needed.add(it) }
    runCatching { Telephony.Sms.getDefaultSmsPackage(ctx) }.getOrNull()?.let { needed.add(it) }
    // Clock apps: whatever shows or sets alarms, and the app that set the next alarm.
    for (action in listOf(AlarmClock.ACTION_SHOW_ALARMS, AlarmClock.ACTION_SET_ALARM)) {
      runCatching { pm.queryIntentActivities(Intent(action), PackageManager.MATCH_DEFAULT_ONLY) }.getOrNull()
        ?.forEach { needed.add(it.activityInfo.packageName) }
    }
    runCatching { ctx.getSystemService(AlarmManager::class.java)?.nextAlarmClock?.showIntent?.creatorPackage }.getOrNull()?.let { needed.add(it) }
    return launchable - needed
  }

  fun takeUnlock(ctx: Context, kind: String, minutes: Int, now: Long = STCore.now(ctx)) {
    edit(ctx, now) { st -> st.unlocks.add(Unlock(kind, now.toDouble(), (now + minutes * 60_000L).toDouble())) }
  }

  private fun strings(a: JSONArray?): Set<String> {
    if (a == null) return emptySet()
    val out = mutableSetOf<String>()
    for (i in 0 until a.length()) out.add(a.getString(i))
    return out
  }
}
