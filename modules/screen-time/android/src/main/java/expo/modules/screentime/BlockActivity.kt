package expo.modules.screentime

import android.app.Activity
import android.content.Intent
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.os.Build
import android.os.Bundle
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

  private fun render() {
    val now = System.currentTimeMillis()
    val p = STCore.plan(this)
    val s = STCore.status(p, STCore.state(this, now), now)
    val app = intent.getStringExtra("pkg")?.let { pkg ->
      runCatching { packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString() }.getOrNull()
    } ?: "This app"
    if (!s.blocked && s.ownBlocked.isEmpty()) {
      finish()
      return
    }
    val title: String
    val lines = mutableListOf<String>()
    if (s.reason == "limit") {
      title = "Today's time is up"
      lines.add("$app is past your daily limit.")
    } else if (s.reason == "focus") {
      title = "Workout in progress"
      s.until?.let {
        val mins = maxOf(1L, (it - now + 59_999) / 60_000)
        lines.add(if (p?.focusKind == "set") "$app opens again when the set is done (at most $mins min)." else "$app opens again in $mins min.")
      }
    } else {
      val lock = s.lockName ?: s.ownBlocked.firstOrNull()?.name
      title = lock?.let { "$it is on" } ?: "$app is locked"
      s.until?.let { lines.add("Locked until ${DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(it))}.") }
    }
    if (s.canEarn) lines.add("Do a set in Trueline to earn more time.")

    val root = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      gravity = Gravity.CENTER
      setBackgroundColor(ground)
      setPadding(dp(32), dp(48), dp(32), dp(48))
    }
    root.addView(text(title, 30f, chalk, bold = true))
    root.addView(text(lines.joinToString("\n"), 16f, muted).apply { setPadding(0, dp(12), 0, dp(32)) })

    val escape = when {
      s.emergency -> "Emergency: ${p?.emergencyMin ?: 10} min" to { unlock("emergency", p?.emergencyMin ?: 10) }
      s.oneMore -> (if ((p?.oneMoreMin ?: 1) == 1) "1 more minute" else "${p?.oneMoreMin} more minutes") to { unlock("one-more", p?.oneMoreMin ?: 1) }
      else -> null
    }
    if (s.reason == "focus") root.addView(button("Back to workout", primary = true) { openTrueline() })
    if (s.canEarn) root.addView(button("Earn time", primary = true) { earn() })
    val mainShown = s.canEarn || s.reason == "focus"
    escape?.let { (label, act) -> root.addView(button(label, primary = !mainShown) { act() }) }
    root.addView(button("Close", primary = !mainShown && escape == null) { goHome() })
    setContentView(root)
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
