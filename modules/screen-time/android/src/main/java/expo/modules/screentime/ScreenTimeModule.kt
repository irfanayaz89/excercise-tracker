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
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

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

    /** Store the plan and start (or stop) blocking. */
    Function("sync") { planJson: String ->
      val problems = mutableListOf<String>()
      val plan = runCatching { STCore.parsePlan(planJson) }.getOrElse {
        problems.add("plan: ${it.message}")
        return@Function problems
      }
      // Before (re)starting the service: did it stop while it should have been running?
      runCatching { STCore.checkGap(ctx) }
      STCore.prefs(ctx).edit().putString("plan", planJson).apply()
      val anything = !plan.blocked.isEmpty || plan.locks.any { it.enabled && (it.apps == null || !it.apps.isEmpty) }
      if (!anything) {
        BlockService.stop(ctx)
      } else if (!hasAccess(ctx)) {
        problems.add("Usage access or Display over other apps is off")
      } else {
        runCatching { BlockService.start(ctx) }.onFailure { problems.add("service: ${it.message}") }
      }
      problems
    }

    /** What happened since the last read; whole minutes are handed over, the remainder stays. */
    Function("takeState") {
      val st = STCore.state(ctx)
      val out: JSONObject = st.toJson()
      val handed = (st.earnedSpentSec / 60) * 60
      st.earnedSpentSec -= handed
      st.unlocks.clear()
      st.gaps.clear()
      st.openEarn = false
      STCore.saveState(ctx, st)
      out.toString()
    }

    Function("takeUnlock") { kind: String, minutes: Int -> STCore.takeUnlock(ctx, kind, minutes) }

    Function("stopAll") {
      BlockService.stop(ctx)
      STCore.prefs(ctx).edit().remove("plan").apply()
    }

    /** Android 13+: the ongoing "Screen time is on" notification. */
    AsyncFunction("requestNotifications") {
      if (Build.VERSION.SDK_INT < 33) return@AsyncFunction true
      if (ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) return@AsyncFunction true
      appContext.currentActivity?.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), 4271)
      false
    }
  }

  private fun open(i: Intent) {
    val activity = appContext.currentActivity
    if (activity != null) activity.startActivity(i) else ctx.startActivity(i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
  }

  companion object {
    fun usageAccess(ctx: Context): Boolean {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return false
      val ops = ctx.getSystemService(Context.APP_OPS_SERVICE) as AppOpsManager
      return ops.unsafeCheckOpNoThrow(AppOpsManager.OPSTR_GET_USAGE_STATS, Process.myUid(), ctx.packageName) == AppOpsManager.MODE_ALLOWED
    }

    fun hasAccess(ctx: Context) = usageAccess(ctx) && Settings.canDrawOverlays(ctx)
  }
}
