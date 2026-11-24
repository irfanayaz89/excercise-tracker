package expo.modules.screentime

import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

/**
 * Hides notifications from apps while they're blocked (when the user turned "Hide their
 * notifications" on and gave Trueline notification access). Nothing is read or kept: a blocked
 * app's notification is cancelled, everything else is left alone.
 */
class STNotifyListener : NotificationListenerService() {
  private var everyday: Set<String> = emptySet()
  private var everydayAt = 0L

  override fun onListenerConnected() {
    runCatching { activeNotifications?.forEach { hideIfBlocked(it) } }
  }

  override fun onNotificationPosted(sbn: StatusBarNotification) {
    runCatching { hideIfBlocked(sbn) }
  }

  private fun hideIfBlocked(sbn: StatusBarNotification) {
    val pkg = sbn.packageName
    if (pkg == packageName || sbn.isOngoing) return
    val now = System.currentTimeMillis()
    val p = STCore.plan(this) ?: return
    if (!p.silence) return
    // Limits used up by opens only block a new visit, so they don't hide notifications.
    val s = STCore.status(p, STCore.state(this, now), now).let { n -> n.copy(limitBlocked = n.limitBlocked.filter { it.second != "opens" }) }
    val cat = runCatching { BlockService.categoryName(packageManager.getApplicationInfo(pkg, 0).category) }.getOrDefault("")
    if (now - everydayAt > 10 * 60_000L) {
      everydayAt = now
      everyday = STCore.everydayApps(this)
    }
    if (STCore.blocks(p, s, pkg, cat, packageName) { it in everyday }) cancelNotification(sbn.key)
  }
}
