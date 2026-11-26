package expo.modules.screentime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.KeyguardManager
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
import android.os.SystemClock
import android.provider.Settings
import android.media.AudioManager
import android.telecom.TelecomManager
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
  @Volatile private var running = false
  /** Throttles and the time counted use the time since boot: moving the phone clock can't stretch or stall them. */
  private var lastTick = 0L
  /** Milliseconds counted but not yet a whole second (carried to the next tick, so none are lost). */
  private var carryMs = 0L
  private var lastShown = 0L
  private var unsaved = 0
  /** Seconds counted since the last save. The saved state is re-read every second (the app may
   *  have changed it), so what hasn't been saved yet is carried here and added back each time. */
  private var pendingUsed = 0L
  private var pendingEarned = 0L
  private var pendingDay = ""
  /** Per-app limit seconds counted since the last save, by limit id (re-added like pendingUsed). */
  private val pendingApp = mutableMapOf<String, Long>()
  /** The app of the current visit. The blocked and pause screens don't end a visit; Trueline's own
   *  screens do once the user has been in them for a few seconds (then this is Trueline). */
  private var lastApp: String? = null
  /** This visit to the app came when its opens were used up, so it's blocked. */
  private var deniedVisit = false
  /** This visit has taken its open (only an allowed visit does: not one blocked anyway, or ended at the pause). */
  private var visitCounted = false
  /** The visit before this one, and when it ended: coming back to it within 10 s (a custom tab, the
   *  share sheet, the photo picker, a permission dialog) carries on that visit instead of a new open. */
  private var leftApp: String? = null
  private var leftAt = 0L
  private var leftDenied = false
  private var leftCounted = false
  /** A call is on since then (time since boot), and the apps left uncovered until it ends. */
  private var callOn = false
  private var callAt = 0L
  private val callApps = mutableSetOf<String>()
  /** When the user came into Trueline itself (not its blocked or pause screen), or 0. */
  private var inTruelineSince = 0L
  /** Activities that resumed and haven't paused since ("package/class" to when), and the newest event read. */
  private val resumed = mutableMapOf<String, Long>()
  /** Activities that paused but haven't stopped: still on screen (picture-in-picture, or under a see-through screen). */
  private val pausedVisible = mutableMapOf<String, Long>()
  private var lastEventAt = 0L
  /** Wall clock minus time since boot at the last look: a change means the phone clock was moved. */
  private var lastSkew: Long? = null
  private var lastNote: String? = null
  private var lastBeat = 0L
  private var usageOk = true
  /** What access is missing ("usage", "overlay"), as last alerted; null when all is there. */
  private var missing: String? = null
  /** Android refused the foreground start: this instance does nothing and goes away. */
  private var refused = false
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
    // Restarted by the system from the background, Android 12+ may refuse a foreground start
    // (ForegroundServiceStartNotAllowedException). Stop cleanly instead of crashing in a loop: the
    // gap is recorded next time Trueline opens, the user is told (tapping opens Trueline, which
    // starts it from the foreground), and the watchdog, the boot receiver or the app start it again.
    val started = runCatching {
      if (Build.VERSION.SDK_INT >= 34) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE) else startForeground(ID, n)
    }.isSuccess
    if (!started) {
      refused = true
      runCatching { BootReceiver.alertStopped(this) }
      runCatching { STWidget.update(this, null) }
      stopSelf()
      return
    }
    alive = true
    BootReceiver.clearAlert(this)
    // Brings blocking back if this service is stopped without Trueline knowing (see BootReceiver).
    runCatching { BootReceiver.arm(this) }
    // Restarted (after a reboot, or Trueline opened after a force stop): note any gap, then beat again.
    handler.post {
      runCatching { STCore.checkGap(this) }
      STCore.heartbeat(this)
    }
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (refused) return START_NOT_STICKY
    if (!running) {
      running = true
      handler.post(tick)
    }
    return START_STICKY
  }

  override fun onDestroy() {
    // Only a deliberate stop gets here; a force stop or Task Manager stop kills the process instead.
    // A refused foreground start is not a clean stop: leave the gap for checkGap to record.
    if (!refused) STCore.stoppedCleanly(this)
    alive = false
    running = false
    handler.removeCallbacks(tick)
    // After any step in progress: write down the last seconds counted, and clear the widget's line.
    handler.post {
      runCatching { flush() }
      if (!refused) runCatching { STWidget.update(this, "Screen time is off") }
    }
    thread.quitSafely()
    super.onDestroy()
  }

  /** Writes the seconds counted since the last save into the saved state. */
  private fun flush() {
    if (pendingUsed + pendingEarned + pendingApp.values.sum() == 0L) return
    STCore.edit(this) { st ->
      if (st.day == pendingDay) {
        st.usedSec += pendingUsed
        st.earnedSpentSec += pendingEarned
        pendingApp.forEach { (id, v) -> st.appUsedSec[id] = (st.appUsedSec[id] ?: 0L) + v }
      }
    }
    pendingUsed = 0
    pendingEarned = 0
    pendingApp.clear()
  }

  private fun step() {
    val now = STCore.now(this)
    val wall = System.currentTimeMillis()
    val up = SystemClock.elapsedRealtime()
    val p = STCore.plan(this) ?: run {
      stopSelf()
      return
    }
    val interactive = getSystemService(PowerManager::class.java).isInteractive
    val elapsed = if (lastTick == 0L) 0L else (up - lastTick).coerceIn(0L, 5_000L)
    lastTick = up
    val call = inCall()
    if (call != CALL) {
      callOn = false
      callApps.clear()
    } else if (!callOn) {
      callOn = true
      callAt = up
    }
    // Screen off: a heartbeat every 30 s is enough (the widget calls it paused after 60 s), and the
    // checks below wait for the screen to come on.
    if (lastBeat == 0L || up - lastBeat >= (if (interactive) 5_000 else 30_000)) {
      lastBeat = up
      STCore.heartbeat(this, now)
      // Usage access or "display over other apps" switched off: nothing can be blocked, so say so
      // where the user will see it (a heads-up once, then the ongoing notification), not only inside Trueline.
      if (interactive) {
        usageOk = ScreenTimeModule.usageAccess(this)
        val overlay = Settings.canDrawOverlays(this)
        val miss = BootReceiver.missing(usageOk, overlay)
        if (miss != missing) {
          missing = miss
          runCatching { if (miss != null) BootReceiver.alertAccess(this, miss) else BootReceiver.clearAlert(this) }
        }
      }
    }
    if (!interactive) {
      carryMs = 0
      runCatching { flush() }
      return
    }
    // Nothing counts, and nothing is blocked, on the lock screen (including an alarm shown over it),
    // or when no activity is in front.
    // Without usage access no new events arrive: the last app would look like it's in front forever
    // (counting its time, or blocking it over and over). Forget it until access is back.
    val top = if (usageOk) foreground(wall, up) else {
      resumed.clear()
      pausedVisible.clear()
      null
    }
    val keyguard = getSystemService(KeyguardManager::class.java)?.isKeyguardLocked == true
    val front = if (keyguard) null else top
    val pkg = front?.substringBefore('/')
    val onOwnScreen = pkg == packageName && front?.substringAfter('/') == BlockActivity::class.java.name
    // Whole seconds to count this tick; the rest of a second is kept for the next one.
    carryMs = if (pkg == null) 0L else carryMs + elapsed
    val dt = carryMs / 1000
    carryMs -= dt * 1000
    // A few seconds in Trueline itself ends the visit to the app before (going back is a new open).
    if (pkg == packageName && !onOwnScreen) {
      if (inTruelineSince == 0L) inTruelineSince = up
      if (up - inTruelineSince >= 3_000) {
        lastApp = packageName
        leftApp = null
      }
    } else {
      inTruelineSince = 0L
    }
    // A call (phone, WhatsApp, Meet…) leaves the app it was made or taken in uncovered until it ends,
    // and nothing else: other blocked apps opened meanwhile are blocked. That's the app in front when
    // it starts, or in its first 5 s (a call taken from a notification shows its screen a moment
    // later), or the first app seen if it started on the lock screen. While a call rings, nothing
    // new is covered, so an incoming call screen never is.
    if (callOn && pkg != null && (callApps.isEmpty() || up - callAt <= 5_000)) callApps.add(pkg)
    val ringing = call == RINGING
    val (s, st, show) = STCore.locked { tally(p, pkg, now, up, dt) }
    // Never cover the apps the phone needs: the dialer, Settings (Trueline's own permission screens
    // open there) and emergency.
    val spared = { app: String -> app in essential || app in callApps }
    if (pkg != null && show != null && !spared(pkg) && !ringing) {
      openBlocked(pkg, show)
    } else if (front != null && show == null && !ringing && up - lastShown > 1500) {
      // Split screen and free-form windows keep more than one app resumed: a blocked app there
      // is blocked too, even when the other pane was touched last.
      val other = resumed.entries.sortedByDescending { it.value }.map { it.key.substringBefore('/') }
        .firstOrNull { it != pkg && it != packageName && !spared(it) && STCore.blocks(p, s, it, category(it), packageName, ::everyday) }
      if (other != null) {
        lastShown = up
        openBlocked(other, "block")
      }
    }
    // A video call often goes to picture-in-picture: its app is spared there too.
    if (front != null && !ringing) pausePip(p, s, pkg, wall)
    val clock = { at: Long -> DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(at)) }
    val text = when {
      missing != null -> BootReceiver.accessText(missing!!)
      s.unlockedUntil != null -> "Unlocked until ${clock(s.unlockedUntil)}"
      // A lock time or a workout focus: both have a name and an end.
      s.blocked && s.until != null && p.focusKind == "key" && s.reason == "focus" -> "Key lock until you scan your key (at most ${clock(s.until)})"
      s.blocked && s.until != null && (s.reason == "lock" || s.reason == "focus") -> "${s.lockName ?: "Lock time"} until ${clock(s.until)}"
      s.blocked -> "Today's time is used up"
      s.usingEarned -> "Earned time: ${s.earnedLeftSec / 60} min left"
      else -> p.dailyLimitMin?.let { "${maxOf(0L, it - st.usedSec / 60)} min left today" } ?: "Screen time is on"
    }
    // Once stopping, leave the notification and widget to onDestroy.
    if (text != lastNote && running) {
      lastNote = text
      getSystemService(NotificationManager::class.java).notify(ID, note(text, missing))
      STWidget.update(this, text)
    }
  }

  /**
   * Under the state lock: re-read the saved state (the app or the blocked screen may have changed
   * it), add what this tick counted, save when needed, and say which screen to show over `pkg`.
   */
  private fun tally(p: STCore.Plan, pkg: String?, now: Long, up: Long, dt: Long): Triple<STCore.Status, STCore.State, String?> {
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
    if (pkg == null) {
      // Nothing in front (lock screen): write the last few seconds down now.
      if (pendingUsed + pendingEarned + pendingApp.values.sum() > 0) save()
      return Triple(s, st, null)
    }
    val today = STCore.dayKey(now)
    val cat = category(pkg)
    val limits = STCore.limitsOf(p, pkg, cat)
    // A new visit to an app (coming from another app or from Trueline itself, not from the blocked
    // or pause screen).
    if (pkg != packageName && pkg != lastApp) {
      val back = pkg == leftApp && up - leftAt <= 10_000
      val (denied, counted) = deniedVisit to visitCounted
      deniedVisit = back && leftDenied
      visitCounted = back && leftCounted
      leftApp = lastApp?.takeIf { it != packageName }
      leftAt = up
      leftDenied = denied
      leftCounted = counted
      lastApp = pkg
    }
    // Opens: a visit takes one only once it's actually let in (not while a lock time, a focus or a
    // time limit blocks it, or the pause screen is up). If the opens are used up by then, the visit
    // is refused. During an unlock a used-up app opens without taking one; this is looked at again
    // every tick, so the visit is refused as soon as the unlock ends.
    val opensLimits = limits.filter { it.opensPerDay != null }
    if (pkg != packageName && opensLimits.isNotEmpty() && !visitCounted && !deniedVisit) {
      val usedUp = opensLimits.any { l -> STCore.limitOpens(p, st, l, today) >= l.opensPerDay!! }
      if (usedUp) {
        if (s.unlockedUntil == null) deniedVisit = true
      } else {
        val others = s.copy(limitBlocked = s.limitBlocked.filter { it.second != "opens" })
        val letIn = !STCore.blocks(p, others, pkg, cat, packageName, ::everyday) &&
          !STCore.pauses(p, others, st, pkg, cat, packageName, now)
        if (letIn) {
          for (l in opensLimits) st.appOpens[l.id] = STCore.limitOpens(p, st, l, today) + 1
          visitCounted = true
          save()
        }
      }
    }
    // A limit used up by opens only blocks a refused visit; the visit that used the last open goes on.
    val visitOnly = { n: STCore.Status -> n.copy(limitBlocked = n.limitBlocked.filter { it.second != "opens" || (deniedVisit && pkg == lastApp) }) }
    s = visitOnly(s)
    val blockedNow = STCore.blocks(p, s, pkg, cat, packageName, ::everyday)
    if (dt > 0 && !blockedNow && limits.isNotEmpty()) {
      for (l in limits) {
        st.appUsedSec[l.id] = (st.appUsedSec[l.id] ?: 0L) + dt
        pendingApp[l.id] = (pendingApp[l.id] ?: 0L) + dt
      }
      if (limits.any { l -> l.dailyMin != null && STCore.limitUsedSec(p, st, l, today).let { it >= l.dailyMin * 60L && it - dt < l.dailyMin * 60L } }) save()
    }
    // Earned time opening a lock time is spent by the apps that lock would block (its own list, or
    // everything for an "Everything" one), not only by the main list.
    val earned = STCore.spendsEarned(p, s, pkg, cat, packageName) { it !in essential && everyday(it) }
    if (dt > 0 && (earned || STCore.counts(p, pkg, cat, packageName))) {
      if (earned) {
        st.earnedSpentSec += dt
        pendingEarned += dt
      } else {
        st.usedSec += dt
        pendingUsed += dt
      }
      // Reaching the limit is worked out from the time used and the limit now (not remembered), so
      // a raised limit opens the apps again.
      val limit = p.dailyLimitMin
      val crossed = limit != null && !earned && st.usedSec >= limit * 60L && st.usedSec - dt < limit * 60L
      // Saved every 10 s (and at once when something changes what's blocked).
      if (++unsaved >= 10 || crossed || (earned && st.earnedSpentSec >= p.earnedLeftMin * 60L)) save()
    } else if (pendingUsed + pendingEarned + pendingApp.values.sum() > 0 && limits.isEmpty()) {
      // Left the app: write the last few seconds down now.
      save()
    } else if (pendingApp.isNotEmpty() && ++unsaved >= 10) {
      save()
    }
    s = visitOnly(STCore.status(p, st, now))
    var show: String? = null
    if (up - lastShown > 1500) {
      show = when {
        STCore.blocks(p, s, pkg, cat, packageName, ::everyday) -> "block"
        STCore.pauses(p, s, st, pkg, cat, packageName, now) -> "pause"
        else -> null
      }
      if (show != null) {
        lastShown = up
        save()
      }
    }
    return Triple(s, st, show)
  }

  /**
   * The app in front, worked out from the system's activity events. Taking "the last app that
   * resumed" isn't enough: an app in the background can resume and pause again in the same instant
   * (the launcher does) without ever coming to the front. So this keeps the set of activities that
   * resumed and haven't paused since, and answers with the most recent of those ("package/class"),
   * or null when there's none (the lock screen, or the screen just turned on). Entries also go when
   * the activity is destroyed (one that crashed never pauses) and when the screen turns off or the
   * lock screen shows (a paused one stays, see pausePip).
   */
  private fun foreground(now: Long, up: Long): String? {
    val usm = getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
    // Event times are wall clock times, and Android moves its stored events when the clock is
    // changed. Move ours by the same amount, or a clock set back would hide every new event (they'd
    // all look older than the last one read) until the clock caught up.
    val skew = now - up
    lastSkew?.let { last ->
      val moved = skew - last
      if (lastEventAt != 0L && kotlin.math.abs(moved) > 2_000) {
        lastEventAt += moved
        resumed.replaceAll { _, at -> at + moved }
        pausedVisible.replaceAll { _, at -> at + moved }
      }
    }
    lastSkew = skew
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
        UsageEvents.Event.ACTIVITY_RESUMED -> {
          resumed[key] = e.timeStamp
          pausedVisible.remove(key)
        }
        UsageEvents.Event.ACTIVITY_PAUSED -> {
          resumed.remove(key)
          pausedVisible[key] = e.timeStamp
        }
        UsageEvents.Event.ACTIVITY_STOPPED, ACTIVITY_DESTROYED -> {
          resumed.remove(key)
          pausedVisible.remove(key)
        }
        // Paused-and-visible entries stay: a picture-in-picture window outlives the lock screen, and
        // its activity's own stop or resume clears it.
        UsageEvents.Event.SCREEN_NON_INTERACTIVE, UsageEvents.Event.KEYGUARD_SHOWN -> resumed.clear()
      }
      if (e.timeStamp > lastEventAt) lastEventAt = e.timeStamp
    }
    if (lastEventAt == 0L) lastEventAt = now
    return resumed.maxByOrNull { it.value }?.key
  }

  /** Blocked apps whose picture-in-picture window has had the blocked screen shown for it once. */
  private val pipShown = mutableSetOf<String>()

  /**
   * Picture-in-picture: the app's activity is paused but stays on screen (nothing in the usage
   * events says "PiP", but paused-and-not-stopped for a few seconds is what it looks like). The
   * blocked screen can't cover a PiP window, and only an accessibility service could close it, so:
   * the blocked screen is shown once (so the user knows why), and the app's playback is paused
   * through its media session every second while it stays blocked. Pausing needs Notification
   * access (Android only lists media sessions to a notification listener); without it, the PiP
   * window keeps playing. Its time isn't counted (the user isn't using that app).
   */
  private fun pausePip(p: STCore.Plan, s: STCore.Status, pkg: String?, wall: Long) {
    val apps = pausedVisible.filter { wall - it.value > 2_000 }.keys.map { it.substringBefore('/') }.toSet()
      .filter { it != pkg && it != packageName && it !in essential && it !in callApps && STCore.blocks(p, s, it, category(it), packageName, ::everyday) }
    pipShown.retainAll(apps.toSet())
    for (app in apps) {
      STNotifyListener.pauseMedia(this, app)
      if (pipShown.add(app)) openBlocked(app, "block")
    }
  }

  private fun openBlocked(pkg: String, mode: String) {
    startActivity(
      Intent(this, BlockActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_NO_ANIMATION)
        .putExtra("pkg", pkg)
        .putExtra("mode", mode)
        .putExtra("deniedVisit", deniedVisit),
    )
  }

  /** CALL on a call (phone, or a VoIP app in communication mode), RINGING while one rings, else 0. */
  private fun inCall(): Int =
    when (getSystemService(AudioManager::class.java)?.mode) {
      AudioManager.MODE_IN_CALL, AudioManager.MODE_IN_COMMUNICATION -> CALL
      AudioManager.MODE_RINGTONE -> RINGING
      else -> 0
    }

  /** Apps never covered by the blocked screen, whatever the user picked. */
  private val essential: Set<String> by lazy {
    val dialer = runCatching { getSystemService(TelecomManager::class.java)?.defaultDialerPackage }.getOrNull()
    setOfNotNull(
      dialer,
      "com.android.dialer",
      "com.google.android.dialer",
      "com.android.phone",
      "com.android.server.telecom",
      "com.android.emergency",
      "com.android.settings",
      "com.android.permissioncontroller",
      "com.google.android.permissioncontroller",
    )
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
    val now = SystemClock.elapsedRealtime()
    if (everydayAt == 0L || now - everydayAt > 10 * 60_000L) {
      everydayAt = now
      everydayApps = STCore.everydayApps(this)
    }
    return pkg in everydayApps
  }

  /** The ongoing notification; with access missing, tapping it opens the settings screen that fixes it. */
  private fun note(text: String, miss: String? = null): Notification {
    val pi = if (miss != null) {
      PendingIntent.getActivity(this, 2, BootReceiver.fixIntent(this, miss), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    } else {
      packageManager.getLaunchIntentForPackage(packageName)?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE) }
    }
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
    /** UsageEvents.Event.ACTIVITY_DESTROYED (hidden in the SDK, but delivered with usage access). */
    private const val ACTIVITY_DESTROYED = 24
    private const val CALL = 1
    private const val RINGING = 2

    /** The service is running in this process (the watchdog then has nothing to do). */
    @Volatile var alive = false

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
