package expo.modules.screentime

import android.Manifest
import android.app.AppOpsManager
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.PowerManager
import android.os.Process
import android.os.SystemClock
import android.provider.Settings
import expo.modules.interfaces.permissions.PermissionsStatus
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.app.usage.UsageStatsManager
import java.util.Calendar
import java.util.concurrent.Executors

/**
 * Trueline's screen time bridge on Android. The app's TypeScript engine
 * (src/screentime) decides; this stores its plan, runs BlockService, and
 * reports back what happened while Trueline was in the background.
 */
class ScreenTimeModule : Module() {
  private val ctx: Context
    get() = appContext.reactContext ?: throw IllegalStateException("No context")

  override fun definition() = ModuleDefinition {
    Name("ScreenTime")

    Function("isSupported") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q }

    /** A clock the user can't move (time since boot, sleep included) and an id that changes on every reboot. */
    Function("clock") {
      mapOf("uptimeMs" to SystemClock.elapsedRealtime().toDouble(), "boot" to STCore.bootId(ctx))
    }

    Function("authorizationStatus") { if (hasAccess(ctx)) "approved" else "notDetermined" }

    /** Opens the settings screen for the first missing permission; the app checks again when it returns. */
    AsyncFunction("requestAuthorization") {
      when {
        !usageAccess(ctx) -> open(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        !Settings.canDrawOverlays(ctx) -> open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}")))
      }
      if (hasAccess(ctx)) "approved" else "notDetermined"
    }

    /** Battery optimisation is already off for Trueline (so phone battery savers leave the service alone). */
    Function("batteryUnrestricted") {
      ctx.getSystemService(PowerManager::class.java).isIgnoringBatteryOptimizations(ctx.packageName)
    }

    Function("openSettings") { which: String ->
      when (which) {
        "usage" -> open(Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS))
        "overlay" -> open(Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}")))
        // The general battery page: Play limits the direct "allow" prompt to certain app types.
        "battery" -> open(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        "notifications" -> open(Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS))
      }
    }

    /** Launchable apps, for Trueline's own picker (iPhone uses Apple's). */
    AsyncFunction("installedApps") {
      val pm = ctx.packageManager
      val launcher = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
      pm.queryIntentActivities(launcher, 0)
        .map { it.activityInfo.applicationInfo }
        .distinctBy { it.packageName }
        .filter { it.packageName != ctx.packageName }
        .map {
          mapOf(
            "packageName" to it.packageName,
            "label" to pm.getApplicationLabel(it).toString(),
            "category" to BlockService.categoryName(it.category),
          )
        }
        .sortedBy { (it["label"] as String).lowercase() }
    }

    /** Trueline may hide notifications (Settings → Notification access is on for it). */
    Function("notificationAccess") { listenerOn(ctx) }

    /**
     * Phone use from Android's own records: minutes per day for the last 7 days (all apps the user
     * opens, not Trueline or the home screen), and today's top apps. Stays on the phone.
     */
    AsyncFunction("usageSummary") {
      val pm = ctx.packageManager
      // Only apps the user opens from the launcher (not the home screen, system screens or Trueline).
      val launchable = runCatching {
        pm.queryIntentActivities(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER), 0).map { it.activityInfo.packageName }.toSet()
      }.getOrDefault(emptySet())
      val home = runCatching { pm.resolveActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME), 0)?.activityInfo?.packageName }.getOrNull()
      val counted = launchable - setOfNotNull(ctx.packageName, home)
      // Days by the trusted time (a moved phone clock doesn't relabel them); Android's events are
      // stamped with the wall clock, so they're shifted back by how far the clock was moved.
      val now = STCore.now(ctx)
      val shift = STCore.skew(ctx, now)
      val cal = Calendar.getInstance().apply {
        timeInMillis = now
        set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
      }
      val starts = (0 until 7).map { i -> (cal.clone() as Calendar).apply { add(Calendar.DAY_OF_MONTH, -i) }.timeInMillis }.reversed()
      val perDay = LongArray(7)
      val today = mutableMapOf<String, Long>()
      // From the system's activity events: each time an app comes to the front until it leaves,
      // split at midnight. (Android's daily totals overlap between days, so they can't be used.)
      fun add(pkg: String, from: Long, to: Long) {
        if (pkg !in counted || to <= from) return
        for (d in 0 until 7) {
          val dStart = starts[d]
          val dEnd = if (d == 6) now else starts[d + 1]
          val ms = minOf(to, dEnd) - maxOf(from, dStart)
          if (ms > 0) {
            perDay[d] += ms
            if (d == 6) today[pkg] = (today[pkg] ?: 0L) + ms
          }
        }
      }
      val usm = ctx.getSystemService(Context.USAGE_STATS_SERVICE) as UsageStatsManager
      val events = runCatching { usm.queryEvents(starts[0] + shift, now + shift) }.getOrNull()
      val front = mutableMapOf<String, Long>()
      val e = android.app.usage.UsageEvents.Event()
      while (events != null && events.hasNextEvent()) {
        events.getNextEvent(e)
        val k = "${e.packageName}/${e.className}"
        when (e.eventType) {
          android.app.usage.UsageEvents.Event.ACTIVITY_RESUMED -> front[k] = e.timeStamp - shift
          android.app.usage.UsageEvents.Event.ACTIVITY_PAUSED, android.app.usage.UsageEvents.Event.ACTIVITY_STOPPED ->
            front.remove(k)?.let { add(e.packageName, it, e.timeStamp - shift) }
          android.app.usage.UsageEvents.Event.SCREEN_NON_INTERACTIVE -> {
            front.forEach { (key, at) -> add(key.substringBefore('/'), at, e.timeStamp - shift) }
            front.clear()
          }
        }
      }
      front.forEach { (key, at) -> add(key.substringBefore('/'), at, now) }
      val days = (0 until 7).map { mapOf("day" to STCore.dayKey(starts[it]), "minutes" to (perDay[it] / 60_000L).toInt()) }
      val top = today.entries
        .filter { it.value >= 60_000L }
        .sortedByDescending { it.value }
        .take(6)
        .map {
          mapOf(
            "packageName" to it.key,
            "label" to (runCatching { pm.getApplicationLabel(pm.getApplicationInfo(it.key, 0)).toString() }.getOrNull() ?: it.key),
            "minutes" to (it.value / 60_000L).toInt(),
          )
        }
      mapOf("days" to days, "top" to top)
    }

    /**
     * Store the plan and start (or stop) blocking. Stays synchronous (the app reads the problems
     * straight away) but light: the slow part, looking for a gap in Android's records, runs on a
     * background thread, or in the service's own thread when it starts.
     */
    Function("sync") { planJson: String ->
      val problems = mutableListOf<String>()
      val plan = runCatching { STCore.parsePlan(planJson) }.getOrElse {
        problems.add("plan: ${it.message}")
        return@Function problems
      }
      val c = ctx
      // The app's trusted "now" for this plan: the phone carries on from it if its clock is moved.
      STCore.anchor(c, plan.madeAt)
      STCore.prefs(c).edit().putString("plan", planJson).apply()
      val miss = BootReceiver.missing(c)
      if (!plan.wantsBlocking) {
        // Did it stop while it should have been running? Then it's stopped on purpose: not a gap later.
        background.execute {
          runCatching { STCore.checkGap(c) }
          STCore.stoppedCleanly(c)
        }
        BlockService.stop(c)
        BootReceiver.disarm(c)
        BootReceiver.clearAlert(c)
        STWidget.update(c, "Screen time is off")
      } else if (miss != null) {
        background.execute { runCatching { STCore.checkGap(c) } }
        BootReceiver.arm(c)
        problems.add(if (miss == "usage") "Blocking is paused: Usage access is off for Trueline." else "Blocking is paused: Display over other apps is off for Trueline.")
      } else {
        // A running service beats every 5 s, so there's only a gap to look for when it isn't running
        // (a service starting now looks too, in onCreate: whichever is first records it, once).
        if (!BlockService.alive) background.execute { runCatching { STCore.checkGap(c) } }
        runCatching { BlockService.start(c) }.onFailure { problems.add("service: ${it.message}") }
        BootReceiver.arm(c)
      }
      if (plan.wantsBlocking && plan.silence && !listenerOn(c)) {
        problems.add("Hiding notifications needs Notification access for Trueline.")
      }
      problems
    }

    /** What happened since the last read; whole minutes are handed over, the remainder stays. */
    Function("takeState") { STCore.takeState(ctx) }

    Function("takeUnlock") { kind: String, minutes: Int -> STCore.takeUnlock(ctx, kind, minutes) }

    Function("stopAll") {
      BlockService.stop(ctx)
      BootReceiver.disarm(ctx)
      BootReceiver.clearAlert(ctx)
      STCore.prefs(ctx).edit().remove("plan").apply()
      STWidget.update(ctx, "Screen time is off")
    }

    /** Android 13+: the ongoing "Screen time is on" notification. Resolves with the user's answer. */
    AsyncFunction("requestNotifications") { promise: Promise ->
      if (Build.VERSION.SDK_INT < 33 || ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
        promise.resolve(true)
        return@AsyncFunction
      }
      val perms = appContext.permissions
      if (perms == null) {
        appContext.currentActivity?.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4271)
        promise.resolve(false)
        return@AsyncFunction
      }
      perms.askForPermissions(
        { res -> promise.resolve(res[Manifest.permission.POST_NOTIFICATIONS]?.status == PermissionsStatus.GRANTED) },
        Manifest.permission.POST_NOTIFICATIONS,
      )
    }
  }

  private fun open(i: Intent) {
    val activity = appContext.currentActivity
    if (activity != null) activity.startActivity(i) else ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  companion object {
    /** sync's slow part (checkGap) runs here, one at a time, off the JS thread. */
    private val background = Executors.newSingleThreadExecutor()

    /** Trueline is among the notification listeners the user enabled (Settings → Notification access). */
    fun listenerOn(ctx: Context): Boolean =
      (Settings.Secure.getString(ctx.contentResolver, "enabled_notification_listeners") ?: "")
        .split(':').any { android.content.ComponentName.unflattenFromString(it)?.packageName == ctx.packageName }

    fun usageAccess(ctx: Context): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
      val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      return ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName) == AppOpsManager.MODE_ALLOWED
    }

    fun hasAccess(ctx: Context) = usageAccess(ctx) && Settings.canDrawOverlays(ctx)
  }
}
