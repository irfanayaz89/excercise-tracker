package expo.modules.screentime

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** After a restart or an app update, blocking resumes without opening Trueline. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(ctx: Context, intent: Intent) {
    if (intent.action != Intent.ACTION_BOOT_COMPLETED && intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
    if (STCore.plan(ctx) != null && ScreenTimeModule.hasAccess(ctx)) runCatching { BlockService.start(ctx) }
  }
}
