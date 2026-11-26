package expo.modules.screentime

import android.content.ComponentName
import android.content.Context
import android.media.session.MediaSessionManager
import android.media.session.PlaybackState
import android.os.Build
import android.os.SystemClock
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import java.util.Calendar

/**
 * Hides notifications from apps while they're blocked (when the user turned "Hide their
 * notifications" on and gave Trueline notification access). Nothing is read or kept: a blocked
 * app's notification is snoozed until the block ends, then Android shows it again, so messages and
 * sign-in codes aren't lost. Everything else is left alone.
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
    val now = STCore.now(this)
    val p = STCore.plan(this) ?: return
    if (!p.silence) return
    // Limits used up by opens only block a new visit, so they don't hide notifications.
    val s = STCore.status(p, STCore.state(this, now), now).let { n -> n.copy(limitBlocked = n.limitBlocked.filter { it.second != "opens" }) }
    val cat = runCatching { BlockService.categoryName(packageManager.getApplicationInfo(pkg, 0).category) }.getOrDefault("")
    val up = SystemClock.elapsedRealtime()
    if (everydayAt == 0L || up - everydayAt > 10 * 60_000L) {
      everydayAt = up
      everyday = STCore.everydayApps(this)
    }
    if (!STCore.blocks(p, s, pkg, cat, packageName) { it in everyday }) return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      snoozeNotification(sbn.key, (blockedUntil(p, s, pkg, cat, now) - now).coerceIn(60_000L, 24 * 3_600_000L))
    } else {
      cancelNotification(sbn.key)
    }
  }

  /**
   * When the block on this app ends, as far as is known now: the latest end among the reasons it's
   * blocked (a lock time or focus end, midnight for a used-up limit). A block that ends sooner
   * (earned time, an unlock) leaves the notification snoozed until then; one that runs longer
   * (unknown end) hides it again when Android re-posts it.
   */
  private fun blockedUntil(p: STCore.Plan, s: STCore.Status, pkg: String, cat: String, now: Long): Long {
    val midnight = Calendar.getInstance().apply {
      timeInMillis = now
      add(Calendar.DAY_OF_MONTH, 1)
      set(Calendar.HOUR_OF_DAY, 0); set(Calendar.MINUTE, 0); set(Calendar.SECOND, 0); set(Calendar.MILLISECOND, 0)
    }.timeInMillis
    val ends = mutableListOf<Long>()
    if (s.blocked && (p.blocked.contains(pkg, cat) || s.blockAll)) ends.add(if (s.reason == "limit") midnight else s.until ?: now + 3_600_000L)
    if (s.limitBlocked.any { it.first.apps.contains(pkg, cat) }) ends.add(midnight)
    s.ownBlocked.filter { it.apps?.contains(pkg, cat) == true }.forEach { l -> STCore.active(l, now)?.let { ends.add(it.second) } }
    return ends.maxOrNull() ?: (now + 3_600_000L)
  }

  companion object {
    /**
     * Pauses whatever a blocked app is playing (its picture-in-picture video, see BlockService).
     * Only a notification listener may see other apps' media sessions; without access this does nothing.
     */
    fun pauseMedia(ctx: Context, pkg: String) {
      runCatching {
        val msm = ctx.getSystemService(MediaSessionManager::class.java) ?: return
        msm.getActiveSessions(ComponentName(ctx, STNotifyListener::class.java))
          .filter { it.packageName == pkg && it.playbackState?.state == PlaybackState.STATE_PLAYING }
          .forEach { it.transportControls.pause() }
      }
    }
  }
}
