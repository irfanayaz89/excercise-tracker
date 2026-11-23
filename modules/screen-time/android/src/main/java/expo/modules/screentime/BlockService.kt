package expo.modules.screentime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.app.usage.UsageEvents
import android.app.usage.UsageStatsManager
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.os.IBinder
import android.os.PowerManager
import java.text.DateFormat
import java.util.Date

/**
 * Runs while screen time is on: once a second it checks which app is in front
 * (usage access), counts time in the blocked apps against the daily limit or
 * earned minutes, and puts the blocked screen over an app that's blocked now.
 * A foreground service (with its ongoing notification) so Android keeps it alive.
 */
class BlockService : Service() {
  /** The once-a-second check runs off the main thread, so it never competes with Trueline's UI. */
  private val thread = HandlerThread("trueline-block").apply { start() }
  private val handler = Handler(thread.looper)
  private var running = false
  private var lastTick = 0L
  private var lastPkg: String? = null
  private var lastShown = 0L
  private var unsaved = 0
  /** Seconds counted since the last save. The saved state is re-read every second (the app may
   *  have changed it), so what hasn't been saved yet is carried here and added back each time. */
  private var pendingUsed = 0L
  private var pendingEarned = 0L
  private var pendingDay = ""
  /** Per-app limit seconds counted since the last save, by limit id (re-added like pendingUsed). */
  private val pendingApp = mutableMapOf<String, Long>()
  /** The last app in front other than Trueline (its blocked and pause screens don't count as leaving). */
  private var lastApp: String? = null
  /** This visit to the app began after its opens were used up, so it's blocked. */
  private var deniedVisit = false
  /** Activities that resumed and haven't paused since ("package/class" to when), and the newest event read. */
  private val resumed = mutableMapOf<String, Long>()
  private var lastEventAt = 0L
  private var lastNote: String? = null
  private var lastBeat = 0L
  private val categories = mutableMapOf<String, String>()

  private val tick = object : Runnable {
    override fun run() {
      runCatching { step() }
      if (running) handler.postDelayed(this, 1000)
    }
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onCreate() {
    super.onCreate()
    val nm = getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(CHANNEL, "Screen time", NotificationManager.IMPORTANCE_LOW))
    val n = note("Screen time is on")
    if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(ID, n)
    // Restarted (after a reboot, or Trueline opened after a force stop): note any gap, then beat again.
    handler.post {
      runCatching { STCore.checkGap(this) }
      STCore.heartbeat(this)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (!running) {
      running = true
      handler.post(tick)
    }
    return START_STICKY
  }

  override fun onDestroy() {
    // Only a deliberate stop gets here; a force stop or Task Manager stop kills the process instead.
    STCore.stoppedCleanly(this)
    running = false
    handler.removeCallbacks(tick)
    thread.quitSafely()
    super.onDestroy()
  }

  private fun step() {
    val now = System.currentTimeMillis()
    val p = STCore.plan(this) ?: run {
      stopSelf()
      return
    }
    val interactive = getSystemService(PowerManager::class.java).isInteractive
    val dt = if (lastTick == 0L) 0L else ((now - lastTick) / 1000).coerceIn(0L, 5L)
    lastTick = now
    if (now - lastBeat >= 5_000) {
      lastBeat = now
      STCore.heartbeat(this, now)
    }
    if (!interactive) return
    val pkg = foreground(now) ?: lastPkg
    lastPkg = pkg
    val st = STCore.state(this, now)
    // A new day starts from zero: yesterday's unsaved seconds don't carry over.
    if (st.day != pendingDay) {
      pendingDay = st.day
      pendingUsed = 0
      pendingEarned = 0
      pendingApp.clear()
    }
    st.usedSec += pendingUsed
    st.earnedSpentSec += pendingEarned
    pendingApp.forEach { (id, v) -> st.appUsedSec[id] = (st.appUsedSec[id] ?: 0L) + v }
    val save = {
      STCore.saveState(this, st)
      unsaved = 0
      pendingUsed = 0
      pendingEarned = 0
      pendingApp.clear()
    }
    var s = STCore.status(p, st, now)
    if (pkg != null) {
      val cat = category(pkg)
      val limits = STCore.limitsOf(p, pkg, cat)
      // A new visit to an app (coming from another app, not from Trueline's own screens): count an
      // open for its per-app limits, unless they're used up, in which case this visit is refused.
      if (pkg != packageName && pkg != lastApp) {
        lastApp = pkg
        val today = STCore.dayKey(now)
        deniedVisit = limits.any { l -> l.opensPerDay != null && STCore.limitOpens(p, st, l, today) >= l.opensPerDay } && s.unlockedUntil == null
        if (!deniedVisit && limits.any { it.opensPerDay != null }) {
          for (l in limits) if (l.opensPerDay != null) st.appOpens[l.id] = STCore.limitOpens(p, st, l, today) + 1
          save()
        }
      }
      // A limit used up by opens only blocks a refused visit; the visit that used the last open goes on.
      s = s.copy(limitBlocked = s.limitBlocked.filter { it.second != "opens" || (deniedVisit && pkg == lastApp) })
      val blockedNow = STCore.blocks(p, s, pkg, cat, packageName, ::everyday)
      if (dt > 0 && !blockedNow && limits.isNotEmpty()) {
        for (l in limits) {
          st.appUsedSec[l.id] = (st.appUsedSec[l.id] ?: 0L) + dt
          pendingApp[l.id] = (pendingApp[l.id] ?: 0L) + dt
        }
        if (limits.any { l -> l.dailyMin != null && STCore.limitUsedSec(p, st, l, STCore.dayKey(now)) == l.dailyMin * 60L }) save()
      }
      if (dt > 0 && STCore.counts(p, pkg, cat, packageName)) {
        if (s.usingEarned) {
          st.earnedSpentSec += dt
          pendingEarned += dt
        } else {
          st.usedSec += dt
          pendingUsed += dt
        }
        val limit = p.dailyLimitMin
        val crossed = limit != null && !st.limitReached && st.usedSec >= limit * 60L
        if (crossed) st.limitReached = true
        // Saved every 10 s (and at once when something changes what's blocked).
        if (++unsaved >= 10 || crossed || (s.usingEarned && st.earnedSpentSec >= p.earnedLeftMin * 60L)) save()
      } else if (pendingUsed + pendingEarned + pendingApp.values.sum() > 0 && limits.isEmpty()) {
        // Left the app: write the last few seconds down now.
        save()
      } else if (pendingApp.isNotEmpty() && ++unsaved >= 10) {
        save()
      }
      s = STCore.status(p, st, now).let { n -> n.copy(limitBlocked = n.limitBlocked.filter { it.second != "opens" || (deniedVisit && pkg == lastApp) }) }
      if (now - lastShown > 1500) {
        val show = when {
          STCore.blocks(p, s, pkg, cat, packageName, ::everyday) -> "block"
          STCore.pauses(p, s, st, pkg, cat, packageName, now) -> "pause"
          else -> null
        }
        if (show != null) {
          lastShown = now
          save()
          startActivity(
            Intent(this, BlockActivity::class.java)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NO_ANIMATION)
              .putExtra("pkg", pkg)
              .putExtra("mode", show)
              .putExtra("deniedVisit", deniedVisit),
          )
        }
      }
    }
    val clock = { at: Long -> DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(at)) }
    val text = when {
      s.unlockedUntil != null -> "Unlocked until ${clock(s.unlockedUntil)}"
      // A lock time or a workout focus: both have a name and an end.
      s.blocked && s.until != null && p.focusKind == "key" && s.reason == "focus" -> "Key lock until you scan your key (at most ${clock(s.until)})"
      s.blocked && s.until != null && (s.reason == "lock" || s.reason == "focus") -> "${s.lockName ?: "Lock time"} until ${clock(s.until)}"
      s.blocked -> "Today's time is used up"
      s.usingEarned -> "Earned time: ${s.earnedLeftSec / 60} min left"
      else -> p.dailyLimitMin?.let { "${maxOf(0L, it - st.usedSec / 60)} min left today" } ?: "Screen time is on"
    }
    if (text != lastNote) {
      lastNote = text
      getSystemService(NotificationManager::class.java).notify(ID, note(text))
      STWidget.update(this, text)
    }
  }

  /**
   * The app in front, worked out from the system's activity events. Taking "the last app that
   * resumed" isn't enough: an app in the background can resume and pause again in the same instant
   * (the launcher does) without ever coming to the front. So this keeps the set of activities that
   * resumed and haven't paused since, and answers with the most recent of those.
   */
  private fun foreground(now: Long): String? {
    val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    // The first look after the service starts (reboot, app update) goes back far enough to find an
    // app that was already open. After that, only what is new, with a small overlap: an event can
    // be recorded a moment late, and replaying one is harmless (each activity keeps its last event).
    val since = if (lastEventAt == 0L) now - 12 * 3_600_000L else lastEventAt - 2_000
    val events = usm.queryEvents(since, now)
    val e = UsageEvents.Event()
    while (events.hasNextEvent()) {
      events.getNextEvent(e)
      val key = "${e.packageName}/${e.className}"
      when (e.eventType) {
        UsageEvents.Event.ACTIVITY_RESUMED -> resumed[key] = e.timeStamp
        UsageEvents.Event.ACTIVITY_PAUSED, UsageEvents.Event.ACTIVITY_STOPPED -> resumed.remove(key)
      }
      if (e.timeStamp > lastEventAt) lastEventAt = e.timeStamp
    }
    if (lastEventAt == 0L) lastEventAt = now
    return resumed.maxByOrNull { it.value }?.key?.substringBefore('/')
  }

  private fun category(pkg: String): String =
    categories.getOrPut(pkg) {
      val c = runCatching { packageManager.getApplicationInfo(pkg, 0).category }.getOrDefault(ApplicationInfo.CATEGORY_UNDEFINED)
      categoryName(c)
    }

  private var everydayApps: Set<String> = emptySet()
  private var everydayAt = 0L

  /** For "block everything": apps the user opens from the launcher, minus the ones the phone needs. */
  private fun everyday(pkg: String): Boolean {
    val now = System.currentTimeMillis()
    if (now - everydayAt > 10 * 60_000L) {
      everydayAt = now
      everydayApps = STCore.everydayApps(this)
    }
    return pkg in everydayApps
  }

  private fun note(text: String): Notification {
    val open = packageManager.getLaunchIntentForPackage(packageName)
    val pi = open?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE) }
    return Notification.Builder(this, CHANNEL)
      .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
      .setContentTitle("Trueline")
      .setContentText(text)
      .setOngoing(true)
      .setContentIntent(pi)
      .build()
  }

  companion object {
    const val CHANNEL = "trueline.screentime"
    const val ID = 4271

    fun categoryName(c: Int): String =
      when (c) {
        ApplicationInfo.CATEGORY_GAME -> "games"
        ApplicationInfo.CATEGORY_AUDIO -> "audio"
        ApplicationInfo.CATEGORY_VIDEO -> "video"
        ApplicationInfo.CATEGORY_IMAGE -> "photos"
        ApplicationInfo.CATEGORY_SOCIAL -> "social"
        ApplicationInfo.CATEGORY_NEWS -> "news"
        ApplicationInfo.CATEGORY_MAPS -> "maps"
        ApplicationInfo.CATEGORY_PRODUCTIVITY -> "productivity"
        else -> ""
      }

    fun start(ctx: Context) {
      ctx.startForegroundService(Intent(ctx, BlockService::class.java))
    }

    fun stop(ctx: Context) {
      ctx.stopService(Intent(ctx, BlockService::class.java))
    }
  }
}
