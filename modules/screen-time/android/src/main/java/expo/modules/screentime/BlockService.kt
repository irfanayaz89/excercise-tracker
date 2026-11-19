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
    var s = STCore.status(p, st, now)
    if (pkg != null) {
      val cat = category(pkg)
      if (dt > 0 && STCore.counts(p, pkg, cat, packageName)) {
        if (s.usingEarned) st.earnedSpentSec += dt else st.usedSec += dt
        val limit = p.dailyLimitMin
        val crossed = limit != null && !st.limitReached && st.usedSec >= limit * 60L
        if (crossed) st.limitReached = true
        // Saved every 10 s (and at once when something changes what's blocked).
        if (++unsaved >= 10 || crossed || (s.usingEarned && st.earnedSpentSec >= p.earnedLeftMin * 60L)) {
          STCore.saveState(this, st)
          unsaved = 0
        }
        s = STCore.status(p, st, now)
      }
      if (STCore.blocks(p, s, pkg, cat, packageName) && now - lastShown > 1500) {
        lastShown = now
        STCore.saveState(this, st)
        unsaved = 0
        startActivity(
          Intent(this, BlockActivity::class.java)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NO_ANIMATION)
            .putExtra("pkg", pkg),
        )
      }
    }
    val text = when {
      s.blocked && s.reason == "lock" && s.until != null ->
        "${s.lockName ?: "Lock time"} until ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(s.until))}"
      s.blocked -> "Today's time is used up"
      s.usingEarned -> "Earned time: ${s.earnedLeftSec / 60} min left"
      else -> p.dailyLimitMin?.let { "${maxOf(0L, it - st.usedSec / 60)} min left today" } ?: "Screen time is on"
    }
    if (text != lastNote) {
      lastNote = text
      getSystemService(NotificationManager::class.java).notify(ID, note(text))
    }
  }

  /** The app most recently brought to the front, from the last few seconds of usage events. */
  private fun foreground(now: Long): String? {
    val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    val events = usm.queryEvents(now - 10_000, now)
    val e = UsageEvents.Event()
    var pkg: String? = null
    while (events.hasNextEvent()) {
      events.getNextEvent(e)
      if (e.eventType == UsageEvents.Event.ACTIVITY_RESUMED) pkg = e.packageName
    }
    return pkg
  }

  private fun category(pkg: String): String =
    categories.getOrPut(pkg) {
      val c = runCatching { packageManager.getApplicationInfo(pkg, 0).category }.getOrDefault(ApplicationInfo.CATEGORY_UNDEFINED)
      categoryName(c)
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
