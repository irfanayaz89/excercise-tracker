package expo.modules.screentime

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.window.OnBackInvokedDispatcher
import java.text.DateFormat
import java.util.Date

/**
 * The screen shown over a blocked app: why it's blocked, until when, and what
 * the user can do (earn time in Trueline, the strictness level's unlock, or
 * leave). Same buttons as the iPhone's blocked screen (STShared.buttons).
 */
class BlockActivity : Activity() {
  private val ground = Color.parseColor("#0C1A1D")
  private val chalk = Color.parseColor("#EEF1EA")
  private val muted = Color.parseColor("#86A1A4")
  private val vial = Color.parseColor("#F3D64B")
  private val vialInk = Color.parseColor("#1D1A05")
  private val raised = Color.parseColor("#1A363C")

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= 33) {
      onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { goHome() }
    }
    render()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    render()
  }

  @Deprecated("Back leaves the blocked app instead of revealing it")
  override fun onBackPressed() {
    goHome()
  }

  private val ticker = Handler(Looper.getMainLooper())
  private var tick: Runnable? = null

  override fun onDestroy() {
    tick?.let { ticker.removeCallbacks(it) }
    super.onDestroy()
  }

  private fun render() {
    tick?.let { ticker.removeCallbacks(it) }
    val now = System.currentTimeMillis()
    val p = STCore.plan(this)
    val st = STCore.state(this, now)
    val pkg = intent.getStringExtra("pkg")
    val cat = pkg?.let { pk ->
      runCatching { BlockService.categoryName(packageManager.getApplicationInfo(pk, 0).category) }.getOrDefault("")
    } ?: ""
    val denied = intent.getBooleanExtra("deniedVisit", false)
    val s = STCore.status(p, st, now).let { n -> n.copy(limitBlocked = n.limitBlocked.filter { it.second != "opens" || denied }) }
    val app = pkg?.let { pk ->
      runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pk, 0)).toString() }.getOrNull()
    } ?: "This app"
    val limit = if (pkg != null) STCore.limitFor(s, pkg, cat) else null
    val blockedHere = p != null && pkg != null && STCore.blocks(p, s, pkg, cat, packageName) { true }
    if (intent.getStringExtra("mode") == "pause" && !blockedHere) {
      if (p == null || pkg == null || !STCore.pauses(p, s, st, pkg, cat, packageName, now)) finish() else renderPause(p, st, pkg, app, now)
      return
    }
    if (!s.blocked && s.ownBlocked.isEmpty() && limit == null) {
      finish()
      return
    }
    val title: String
    val lines = mutableListOf<String>()
    val clock = { at: Long -> DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(at)) }
    if (!s.blocked && limit != null) {
      title = "${limit.first.name}: done for today"
      lines.add(
        if (limit.second == "opens") "You've opened $app ${limit.first.opensPerDay} times today, your limit."
        else "$app has used its ${limit.first.dailyMin} minutes today.",
      )
      lines.add("It opens again tomorrow.")
    } else if (s.reason == "limit") {
      title = "Today's time is up"
      lines.add("$app is past your daily limit.")
    } else if (s.reason == "focus" && p?.focusKind == "key") {
      title = "Key lock is on"
      s.until?.let { lines.add("$app opens when you scan your key in Trueline, or at ${clock(it)}.") }
    } else if (s.reason == "focus") {
      title = "Workout in progress"
      s.until?.let {
        val mins = maxOf(1L, (it - now + 59_999) / 60_000)
        lines.add(if (p?.focusKind == "set") "$app opens again when the set is done (at most $mins min)." else "$app opens again in $mins min.")
      }
    } else {
      val lock = s.lockName ?: s.ownBlocked.firstOrNull()?.name
      title = lock?.let { "$it is on" } ?: "$app is locked"
      s.until?.let { lines.add("Locked until ${clock(it)}.") }
    }
    if (s.canEarn && s.blocked) lines.add("Do a set in Trueline to earn more time.")

    val root = page()
    root.addView(text(title, 30f, chalk, bold = true))
    root.addView(text(lines.joinToString("\n"), 16f, muted).apply { setPadding(0, dp(12), 0, dp(32)) })

    val escape = when {
      s.emergency -> "Emergency: ${p?.emergencyMin ?: 10} min" to { unlock("emergency", p?.emergencyMin ?: 10) }
      s.oneMore -> (if ((p?.oneMoreMin ?: 1) == 1) "1 more minute" else "${p?.oneMoreMin} more minutes") to { unlock("one-more", p?.oneMoreMin ?: 1) }
      else -> null
    }
    val key = s.blocked && s.reason == "focus" && p?.focusKind == "key"
    val workout = s.blocked && s.reason == "focus" && !key
    if (key) root.addView(button("Scan my key", primary = true) { openScanner() })
    if (workout) root.addView(button("Back to workout", primary = true) { openTrueline() })
    val earnable = s.canEarn && s.blocked
    if (earnable) root.addView(button("Earn time", primary = true) { earn() })
    val mainShown = earnable || workout || key
    escape?.let { (label, act) -> root.addView(button(label, primary = !mainShown) { act() }) }
    root.addView(button("Close", primary = !mainShown && escape == null) { goHome() })
    setContentView(root)
  }

  /** The pause: a short wait (longer with every pass today), then the app opens for a few minutes. */
  private fun renderPause(p: STCore.Plan, st: STCore.State, pkg: String, app: String, now: Long) {
    val wait = p.pause.wait(STCore.pausePasses(p, st, now))
    val openAt = now + wait * 1000L
    val root = page()
    root.addView(text("Take a breath", 30f, chalk, bold = true))
    root.addView(
      text("Do you still want to open $app? It opens for ${p.pause.passMin} minutes after the wait. Each pass today makes the next wait 5 s longer.", 16f, muted)
        .apply { setPadding(0, dp(12), 0, dp(32)) },
    )
    val count = text("", 56f, vial, bold = true).apply { setPadding(0, 0, 0, dp(24)) }
    root.addView(count)
    val open = button("Open $app", primary = false) {
      STCore.grantPass(this, pkg)
      finish()
    }.apply { isEnabled = false }
    root.addView(open)
    root.addView(button("Not now", primary = true) { goHome() })
    setContentView(root)
    val r = object : Runnable {
      override fun run() {
        val left = ((openAt - System.currentTimeMillis() + 999) / 1000).coerceAtLeast(0)
        count.text = if (left > 0) "$left" else "✓"
        open.isEnabled = left == 0L
        open.alpha = if (left == 0L) 1f else 0.5f
        if (left > 0) ticker.postDelayed(this, 250)
      }
    }
    tick = r
    r.run()
  }

  private fun page() =
    LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(ground)
      setPadding(dp(32), dp(48), dp(32), dp(48))
    }

  /** Trueline's key scanner, straight away. */
  private fun openScanner() {
    runCatching {
      startActivity(
        Intent(Intent.ACTION_VIEW, android.net.Uri.parse("trueline://screen-time/scan"))
          .setPackage(packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
      )
    }.onFailure { openTrueline() }
    finish()
  }

  private fun openTrueline() {
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
    }
    finish()
  }

  private fun earn() {
    val st = STCore.state(this)
    st.openEarn = true
    STCore.saveState(this, st)
    packageManager.getLaunchIntentForPackage(packageName)?.let {
      startActivity(it.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP))
    }
    finish()
  }

  private fun unlock(kind: String, minutes: Int) {
    STCore.takeUnlock(this, kind, minutes)
    finish()
  }

  private fun goHome() {
    startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    finish()
  }

  private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

  private fun text(t: String, size: Float, color: Int, bold: Boolean = false) =
    TextView(this).apply {
      text = t
      textSize = size
      setTextColor(color)
      gravity = Gravity.CENTER
      if (bold) typeface = Typeface.DEFAULT_BOLD
    }

  private fun button(label: String, primary: Boolean, onClick: () -> Unit) =
    Button(this).apply {
      text = label
      isAllCaps = false
      textSize = 16f
      setTextColor(if (primary) vialInk else chalk)
      background = GradientDrawable().apply {
        cornerRadius = dp(10).toFloat()
        setColor(if (primary) vial else raised)
      }
      layoutParams = LinearLayout.LayoutParams(LinearLayout.LayoutParams.MATCH_PARENT, dp(52)).apply { topMargin = dp(12) }
      setOnClickListener { onClick() }
    }
}
