package expo.modules.screentime

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a restart or an app update, blocking resumes without opening Trueline. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (STCore.plan(ctx) == null) return
    if (ScreenTimeModule.hasAccess(ctx)) {
      runCatching { BlockService.start(ctx) }
    } else {
      // Access was switched off: blocking can't run, so tell the user instead of staying silent.
      runCatching { warnNoAccess(ctx) }
    }
  }

  private fun warnNoAccess(ctx: Context) {
    val nm = ctx.getSystemService(NotificationManager::class.java)
    nm.createNotificationChannel(NotificationChannel(BlockService.CHANNEL, "Screen time", NotificationManager.IMPORTANCE_LOW))
    val open = ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)
    val pi = open?.let { PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_IMMUTABLE) }
    nm.notify(
      BlockService.ID,
      Notification.Builder(ctx, BlockService.CHANNEL)
        .setSmallIcon(android.R.drawable.ic_lock_idle_lock)
        .setContentTitle("Trueline")
        .setContentText("Blocking is off: Trueline lost its access. Tap to turn it back on.")
        .setContentIntent(pi)
        .setAutoCancel(true)
        .build(),
    )
  }
}
