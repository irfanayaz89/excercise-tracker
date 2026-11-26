package expo.modules.screentime

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.SystemClock
import android.provider.Settings

/**
 * Brings blocking back without opening Trueline: after a restart or an app update, and from a
 * watchdog alarm about every 15 minutes, in case Android or a phone's task killer stopped the
 * service. When it can't (access switched off, or Android refuses a start from the background),
 * it says so with a notification the user will see, instead of staying silent.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED, WATCHDOG -> runCatching { check(ctx) }
    }
  }

  companion object {
    const val WATCHDOG = "expo.modules.screentime.WATCHDOG"
    private const val ALERTS = "trueline.screentime.alerts"
    private const val ALERT_ID = 4272

    /** Blocking should run: start the service if it isn't running, or tell the user why it can't. */
    fun check(ctx: Context) {
      val p = STCore.plan(ctx)
      if (p == null || !p.wantsBlocking) {
        disarm(ctx)
        return
      }
      arm(ctx)
      val miss = missing(ctx)
      if (miss != null) {
        // Only once blocking has run before (not while the user is still setting it up).
        if (STCore.prefs(ctx).getLong("hb", 0L) != 0L) runCatching { alertAccess(ctx, miss) }
        STWidget.update(ctx, null)
        return
      }
      if (BlockService.alive) return
      // Android 12+ refuses most foreground starts from the background (an inexact alarm isn't an
      // exemption; battery optimisation off, or display over other apps on 12-14, is).
      if (runCatching { BlockService.start(ctx) }.isFailure) {
        runCatching { alertStopped(ctx) }
        STWidget.update(ctx, null)
      }
    }

    /**
     * The watchdog: inexact and not waking the phone, so it costs nothing while the phone sleeps and
     * runs when the phone is next used (which is when blocking matters). Alarms go on a reboot (the
     * boot broadcast sets it again) and on a force stop (nothing can come back from that by itself).
     */
    fun arm(ctx: Context) {
      if (pending(ctx, PendingIntent.FLAG_NO_CREATE) != null) return
      val am = ctx.getSystemService(AlarmManager::class.java) ?: return
      val every = AlarmManager.INTERVAL_FIFTEEN_MINUTES
      runCatching { am.setInexactRepeating(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime() + every, every, pending(ctx, 0)!!) }
    }

    fun disarm(ctx: Context) {
      val pi = pending(ctx, PendingIntent.FLAG_NO_CREATE) ?: return
      runCatching { ctx.getSystemService(AlarmManager::class.java)?.cancel(pi) }
      pi.cancel()
    }

    private fun pending(ctx: Context, flags: Int): PendingIntent? =
      PendingIntent.getBroadcast(ctx, 7, Intent(ctx, BootReceiver::class.java).setAction(WATCHDOG), PendingIntent.FLAG_IMMUTABLE or flags)

    /** What blocking is missing: "usage" (usage access) or "overlay" (display over other apps), or null. */
    fun missing(usage: Boolean, overlay: Boolean): String? = if (!usage) "usage" else if (!overlay) "overlay" else null

    fun missing(ctx: Context) = missing(ScreenTimeModule.usageAccess(ctx), Settings.canDrawOverlays(ctx))

    /** The settings screen that fixes a missing access. */
    fun fixIntent(ctx: Context, miss: String): Intent =
      (if (miss == "usage") Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS)
      else Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:${ctx.packageName}")))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    fun accessText(miss: String) =
      if (miss == "usage") "Blocking is paused: Trueline lost usage access. Tap to fix."
      else "Blocking is paused: Trueline can't show over other apps. Tap to fix."

    /** A heads-up the user can't miss (the ongoing notification is silent and easy to overlook). */
    fun alertAccess(ctx: Context, miss: String) {
      // One heads-up per loss of access, not one per watchdog run: cleared when access is back.
      val prefs = STCore.prefs(ctx)
      if (prefs.getString("alerted", null) == miss) return
      prefs.edit().putString("alerted", miss).apply()
      val pi = PendingIntent.getActivity(ctx, 8, fixIntent(ctx, miss), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
      // The title already says it is paused: the body says why.
      alert(ctx, "Blocking is paused", accessText(miss).removePrefix("Blocking is paused: ").replaceFirstChar { it.uppercase() }, pi)
    }

    /** Android didn't let blocking start from the background: opening Trueline starts it again. */
    fun alertStopped(ctx: Context) {
      // Once per stop, not once per watchdog run: cleared when the service starts again.
      val prefs = STCore.prefs(ctx)
      if (prefs.getBoolean("alertedStop", false)) return
      val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName) ?: return
      prefs.edit().putBoolean("alertedStop", true).apply()
      val pi = PendingIntent.getActivity(ctx, 9, open, PendingIntent.FLAG_IMMUTABLE)
      alert(ctx, "Blocking stopped", "Android stopped Trueline's blocking. Tap to resume it.", pi)
    }

    fun clearAlert(ctx: Context) {
      STCore.prefs(ctx).edit().remove("alerted").remove("alertedStop").apply()
      runCatching { ctx.getSystemService(NotificationManager::class.java).cancel(ALERT_ID) }
    }

    private fun alert(ctx: Context, title: String, text: String, pi: PendingIntent) {
      val nm = ctx.getSystemService(NotificationManager::class.java)
      nm.createNotificationChannel(NotificationChannel(ALERTS, "Blocking problems", NotificationManager.IMPORTANCE_HIGH))
      nm.notify(
        ALERT_ID,
        Notification.Builder(ctx, ALERTS)
          .setSmallIcon(android.R.drawable.stat_sys_warning)
          .setContentTitle(title)
          .setContentText(text)
          .setStyle(Notification.BigTextStyle().bigText(text))
          .setCategory(Notification.CATEGORY_ERROR)
          .setContentIntent(pi)
          .setAutoCancel(true)
          .build(),
      )
    }
  }
}
