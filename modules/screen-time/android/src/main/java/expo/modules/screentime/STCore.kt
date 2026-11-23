package expo.modules.screentime

import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.SharedPreferences
import android.os.Build
import android.os.PowerManager
import org.json.JSONArray
import org.json.JSONObject
import java.util.Calendar

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
  )

  data class Plan(
    val day: String,
    val dailyLimitMin: Int?,
    val limitReached: Boolean,
    val earningEnabled: Boolean,
    val earnedLeftMin: Int,
    val earnCapLeftMin: Int,
    val mode: String,
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
    val locks: List<Lock>,
    val blocked: Sel,
    val allowed: Sel,
  )

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
        ),
      )
    }
    return Plan(
      day = o.optString("day"),
      dailyLimitMin = if (o.isNull("dailyLimitMin")) null else o.optInt("dailyLimitMin"),
      limitReached = o.optBoolean("limitReached"),
      earningEnabled = o.optBoolean("earningEnabled"),
      earnedLeftMin = o.optInt("earnedLeftMin"),
      earnCapLeftMin = o.optInt("earnCapLeftMin"),
      mode = o.optString("mode", "standard"),
      emergencyMin = o.optInt("emergencyMin", 10),
      oneMoreMin = o.optInt("oneMoreMin", 1),
      emergenciesLeft = o.optInt("emergenciesLeft"),
      oneMoresLeft = o.optInt("oneMoresLeft"),
      emergenciesPerDay = o.optInt("emergenciesPerDay", 1),
      oneMoresPerDay = o.optInt("oneMoresPerDay", 3),
      unlockUntil = if (o.isNull("unlockUntil")) null else o.optDouble("unlockUntil"),
      focusUntil = if (!o.has("focusUntil") || o.isNull("focusUntil")) null else o.optDouble("focusUntil"),
      focusKind = if (!o.has("focusKind") || o.isNull("focusKind")) null else o.optString("focusKind"),
      locks = locks,
      blocked = Sel.from(o.optJSONObject("blocked")),
      allowed = Sel.from(o.optJSONObject("allowed")),
    )
  }

  fun plan(ctx: Context): Plan? = prefs(ctx).getString("plan", null)?.let { runCatching { parsePlan(it) }.getOrNull() }

  // ── State (written here while Trueline is in the background) ───────────────

  data class Unlock(val kind: String, val from: Double, val until: Double)

  /** A stretch when blocking wasn't running: "stopped" (force stop, Task Manager) or "killed" (e.g. a battery saver). */
  data class Gap(val from: Long, val to: Long, val kind: String)

  data class State(
    var day: String = "",
    /** Seconds the blocked apps were in front today. */
    var usedSec: Long = 0,
    var limitReached: Boolean = false,
    /** Earned seconds spent since the app last read this state. */
    var earnedSpentSec: Long = 0,
    val unlocks: MutableList<Unlock> = mutableListOf(),
    var openEarn: Boolean = false,
    val gaps: MutableList<Gap> = mutableListOf(),
  ) {
    fun toJson(): JSONObject {
      val u = JSONArray()
      for (x in unlocks) u.put(JSONObject().put("kind", x.kind).put("from", x.from).put("until", x.until))
      val g = JSONArray()
      for (x in gaps) g.put(JSONObject().put("from", x.from).put("to", x.to).put("kind", x.kind))
      return JSONObject()
        .put("gaps", g)
        .put("day", day)
        .put("usedMin", usedSec / 60)
        .put("usedSec", usedSec)
        .put("limitReached", limitReached)
        .put("earnedSpentMin", earnedSpentSec / 60)
        .put("earnedSpentSec", earnedSpentSec)
        .put("unlocks", u)
        .put("openEarn", openEarn)
    }
  }

  fun state(ctx: Context, now: Long = System.currentTimeMillis()): State {
    val raw = prefs(ctx).getString("state", null)
    val s = State()
    if (raw != null) {
      runCatching {
        val o = JSONObject(raw)
        s.day = o.optString("day")
        s.usedSec = o.optLong("usedSec")
        s.limitReached = o.optBoolean("limitReached")
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
          s.gaps.add(Gap(x.optLong("from"), x.optLong("to"), x.optString("kind")))
        }
      }
    }
    val today = dayKey(now)
    if (today > s.day) {
      // A new day: usage and earned time start over (unlocks and an "earn" tap wait for the app).
      // Only a later day counts: if the clock is moved back, the day already used up stays used up.
      return State(day = today, unlocks = s.unlocks, openEarn = s.openEarn, gaps = s.gaps)
    }
    return s
  }

  fun saveState(ctx: Context, s: State) {
    prefs(ctx).edit().putString("state", s.toJson().toString()).apply()
  }

  // ── Local time ──────────────────────────────────────────────────────────────

  fun dayKey(ms: Long): String {
    val c = Calendar.getInstance().apply { timeInMillis = ms }
    return "%04d-%02d-%02d".format(c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH))
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
  )

  fun status(p: Plan?, st: State, now: Long): Status {
    if (p == null) return Status()
    val today = dayKey(now)
    val planToday = p.day == today
    val earnedLeftSec = if (p.earningEnabled && planToday) maxOf(0L, p.earnedLeftMin * 60L - st.earnedSpentSec) else 0L
    val limit = p.dailyLimitMin
    val limitReached = limit != null && (limit == 0 || st.limitReached || st.usedSec >= limit * 60L || (planToday && p.limitReached))
    val unlockedUntil = (st.unlocks.filter { it.from <= now && now < it.until }.map { it.until } + listOfNotNull(p.unlockUntil?.takeIf { it > now }))
      .maxOrNull()?.toLong()
    val unlocked = unlockedUntil != null

    val running = p.locks.mapNotNull { l -> active(l, now)?.let { l to it } }
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
    if (unlocked) {
      reason = null
      usingEarned = false
    }
    val blocking = if (reason == "lock") (if (hard.isNotEmpty()) hard else soft) else emptyList()
    val last = blocking.maxByOrNull { it.second.second }
    val ownBlocked = running.filter { it.first.apps != null && !unlocked && !(it.first.earnable && earnedLeftSec > 0) }.map { it.first }
    val blocked = reason != null
    val canEarn = blocked && reason != "focus" && p.earningEnabled && p.earnCapLeftMin > 0 && (reason == "limit" || blocking.all { it.first.earnable })
    val any = blocked || ownBlocked.isNotEmpty()
    // The plan's "left" counts are for the day it was made. On a later day the app hasn't seen yet,
    // the allowance starts again, and only unlocks taken today count against it.
    val newDay = today > p.day
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
      emergency = any && p.mode == "standard" && emergenciesLeft - usedEmergencies > 0,
      oneMore = any && p.mode == "nudge" && oneMoresLeft - usedOneMores > 0,
      ownBlocked = ownBlocked,
      unlockedUntil = unlockedUntil,
    )
  }

  /** Is this app (in front right now) blocked? Allowed apps never are; Trueline itself never is. */
  fun blocks(p: Plan, s: Status, pkg: String, category: String, self: String): Boolean {
    if (pkg == self || pkg in p.allowed.apps) return false
    if (s.blocked && p.blocked.contains(pkg, category)) return true
    return s.ownBlocked.any { it.apps?.contains(pkg, category) == true }
  }

  /** Counts against the daily limit (the main blocked list, minus allowed apps). */
  fun counts(p: Plan, pkg: String, category: String, self: String) =
    pkg != self && pkg !in p.allowed.apps && p.blocked.contains(pkg, category)

  // ── Was blocking stopped? (research guide, Appendix A F5) ─────────────────

  /** The service writes this every few seconds while it runs. */
  fun heartbeat(ctx: Context, now: Long = System.currentTimeMillis()) {
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
   * The screen-on check avoids counting the phone sleeping as a gap.
   */
  fun checkGap(ctx: Context, now: Long = System.currentTimeMillis()) {
    val pr = prefs(ctx)
    val hb = pr.getLong("hb", 0L)
    if (hb == 0L || !pr.getBoolean("svc", false) || now - hb < 60_000) return
    if (interactiveMs(ctx, hb, now) < 60_000) {
      heartbeat(ctx, now)
      return
    }
    val kind = if (userStoppedSince(ctx, hb)) "stopped" else "killed"
    val st = state(ctx, now)
    if (st.gaps.none { it.from == hb }) st.gaps.add(Gap(hb, now, kind))
    saveState(ctx, st)
    heartbeat(ctx, now)
  }

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

  /** Android recorded that the user stopped Trueline (Force stop or Task Manager) after `since`. */
  private fun userStoppedSince(ctx: Context, since: Long): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
    val am = ctx.getSystemService(ActivityManager::class.java)
    return runCatching {
      am.getHistoricalProcessExitReasons(ctx.packageName, 0, 5).any {
        it.timestamp >= since && it.reason == ApplicationExitInfo.REASON_USER_REQUESTED
      }
    }.getOrDefault(false)
  }

  fun takeUnlock(ctx: Context, kind: String, minutes: Int, now: Long = System.currentTimeMillis()) {
    val st = state(ctx, now)
    st.unlocks.add(Unlock(kind, now.toDouble(), (now + minutes * 60_000L).toDouble()))
    saveState(ctx, st)
  }

  private fun strings(a: JSONArray?): Set<String> {
    if (a == null) return emptySet()
    val out = mutableSetOf<String>()
    for (i in 0 until a.length()) out.add(a.getString(i))
    return out
  }
}
