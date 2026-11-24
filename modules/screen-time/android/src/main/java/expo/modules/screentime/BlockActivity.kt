package expo.modules.screentime

import android.animation.ValueAnimator
import android.app.Activity
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Outline
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.graphics.drawable.RippleDrawable
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.format.DateUtils
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.view.ViewOutlineProvider
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.FrameLayout
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import android.window.OnBackInvokedDispatcher
import java.text.DateFormat
import java.util.Calendar
import java.util.Date

/**
 * The screen shown over a blocked app. It says, in plain words, which app is closed, why (a lock
 * time, the daily limit, an app limit, a workout focus or a key lock), when it opens again, and what
 * the user can do now, each option with a line explaining it. Same actions as the iPhone's blocked
 * screen (STShared.buttons). The "true line" (a spirit-level bubble on a line) shows how far through
 * the block the user is: Trueline's own mark, so the screen is recognisably the app's.
 */
class BlockActivity : Activity() {
  private val ground = Color.parseColor("#0C1A1D")
  private val ground2 = Color.parseColor("#11262B")
  private val surface = Color.parseColor("#132A2F")
  private val raised = Color.parseColor("#1A363C")
  private val line = Color.parseColor("#24464D")
  private val chalk = Color.parseColor("#EEF1EA")
  private val chalk2 = Color.parseColor("#C9D3CE")
  private val muted = Color.parseColor("#86A1A4")
  private val vial = Color.parseColor("#F3D64B")
  private val vialInk = Color.parseColor("#1D1A05")

  private val faceDisplay by lazy { font("display.ttf", Typeface.DEFAULT_BOLD) }
  private val body by lazy { font("body.ttf", Typeface.DEFAULT) }
  private val bodySemi by lazy { font("body_semibold.ttf", Typeface.DEFAULT_BOLD) }

  private val ticker = Handler(Looper.getMainLooper())
  private var tick: Runnable? = null

  /** What's on screen now, so a refresh only updates the clock instead of redrawing (and re-animating). */
  private var shownSig: String? = null
  private var remainingView: TextView? = null
  private var trueLine: TrueLine? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    window.setBackgroundDrawable(android.graphics.drawable.ColorDrawable(ground))
    if (Build.VERSION.SDK_INT >= 33) {
      onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT) { goHome() }
    }
    render()
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    setIntent(intent)
    shownSig = null
    render()
  }

  @Deprecated("Back leaves the blocked app instead of revealing it")
  override fun onBackPressed() {
    goHome()
  }

  override fun onDestroy() {
    tick?.let { ticker.removeCallbacks(it) }
    super.onDestroy()
  }

  private data class Option(val label: String, val hint: String, val act: () -> Unit)

  private data class Screen(
    val chip: String,
    val title: String,
    val explain: String,
    /** When the block started and ends (epoch ms), if known: drawn as the true line. */
    val start: Long?,
    val end: Long?,
    /** "Opens at 7:00 am", "Opens again tomorrow"… */
    val opens: String,
    val options: List<Option>,
    val footer: String,
  )

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
    val screen = describe(p, s, pkg, cat, app, limit, now)
    val sig = listOf(screen.chip, screen.title, screen.explain, screen.opens, screen.footer, screen.options.joinToString { it.label + it.hint }).joinToString("|")
    if (sig == shownSig) {
      updateClock(screen, now)
    } else {
      shownSig = sig
      draw(screen, pkg, now)
    }
    // Look again every few seconds: when the lock, focus or unlock ends while this screen is up,
    // it closes by itself, and the time left stays current.
    val again = Runnable { render() }
    tick = again
    ticker.postDelayed(again, 5_000)
  }

  /** Why this app is closed, in plain words, and what the user can do about it. */
  private fun describe(p: STCore.Plan?, s: STCore.Status, pkg: String?, cat: String, app: String, limit: Pair<STCore.AppLim, String>?, now: Long): Screen {
    // A lock time on the main list doesn't explain an app that only its own app limit (or its own
    // lock time's list) closes: say why *this* app is closed.
    val mainHere = s.blocked && (pkg == null || p == null || p.blocked.contains(pkg, cat) || s.blockAll)
    val ownHere = if (pkg == null) null else s.ownBlocked.firstOrNull { it.apps?.contains(pkg, cat) == true }
    val key = mainHere && s.reason == "focus" && p?.focusKind == "key"
    val workout = mainHere && s.reason == "focus" && !key

    val options = mutableListOf<Option>()
    if (key) options += Option("Scan my key", "Point the camera at the key you printed or saved.") { openScanner() }
    if (workout) options += Option("Back to workout", "Finish your set. Your apps open when it ends.") { openTrueline() }
    if (s.canEarn && mainHere) options += Option("Earn time", "Do a set in Trueline. Clean reps earn you minutes.") { earn() }
    if (s.emergency) {
      val m = p?.emergencyMin ?: 10
      options += Option("Emergency · $m min", "For something urgent. ${plural(s.emergenciesLeft, "emergency unlock", "emergency unlocks")} left today.") { unlock("emergency", m) }
    }
    if (s.oneMore) {
      val m = p?.oneMoreMin ?: 1
      options += Option(if (m == 1) "1 more minute" else "$m more minutes", "${plural(s.oneMoresLeft, "use", "uses")} left today.") { unlock("one-more", m) }
    }
    options += Option("Close", "Back to your home screen.") { goHome() }

    val strictUntil = p?.strictUntil?.toLong()
    val footer = when (s.mode) {
      "strict" -> "Strict mode${strictUntil?.let { " until ${whenText(it, now)}" } ?: ""}: no unlocks. You chose this to stay on track."
      "nudge" -> "Nudge mode: a gentle reminder. Change your rules in Trueline."
      else -> "Standard mode. Change your rules in Trueline."
    }

    return when {
      !mainHere && ownHere != null -> {
        val w = STCore.active(ownHere, now)
        Screen(
          tag("Lock time", ownHere.name), "$app is locked",
          "Your ${ownHere.name} lock time is on, and $app is on its list.",
          w?.first, w?.second, w?.second?.let { "Opens at ${whenText(it, now)}" } ?: "Opens when the lock time ends", options, footer,
        )
      }
      !mainHere && limit != null -> {
        val (l, why) = limit
        Screen(
          tag("App limit", l.name), "$app is done for today",
          if (why == "opens") "You've opened $app ${l.opensPerDay} times today. That's the limit you set."
          else "$app has used its ${l.dailyMin} minutes today. That's the limit you set.",
          null, null, "Opens again tomorrow", options, footer,
        )
      }
      s.reason == "limit" -> Screen(
        "Daily limit", "Today's time is up",
        "You've used your ${p?.dailyLimitMin ?: 0} minutes for your blocked apps today.",
        null, null, "Opens again at midnight", options, footer,
      )
      key -> Screen(
        "Key lock", "$app is locked with your key",
        "You started a key lock. Scan your key to open your apps again. If you can't, it ends by itself.",
        null, s.until, s.until?.let { "Ends by ${whenText(it, now)} at the latest" } ?: "Ends when you scan your key", options, footer,
      )
      workout -> Screen(
        "Workout focus", "Workout in progress",
        if (p?.focusKind == "set") "Your apps wait until your set is done." else "You started a workout focus, so your apps wait until it ends.",
        null, s.until, s.until?.let { "Opens at ${whenText(it, now)}" } ?: "Opens when the workout ends", options, footer,
      )
      else -> {
        val name = s.lockName ?: "Lock time"
        val w = p?.locks?.firstOrNull { it.enabled && it.apps == null && it.name == s.lockName }?.let { STCore.active(it, now) }
        Screen(
          tag("Lock time", s.lockName), "$app is locked",
          if (s.blockAll) "Your $name lock time is on. Everything except your always-allowed apps stays closed."
          else "Your $name lock time is on, so your blocked apps stay closed.",
          w?.first, s.until, s.until?.let { "Opens at ${whenText(it, now)}" } ?: "Opens when the lock time ends", options, footer,
        )
      }
    }
  }

  private fun draw(sc: Screen, pkg: String?, now: Long) {
    val col = column()
    col.addView(brandRow())
    col.addView(space(26))
    col.addView(appBadge(pkg))
    col.addView(space(22))
    col.addView(chip(sc.chip))
    col.addView(space(12))
    col.addView(text(sc.title, 38f, chalk, faceDisplay).apply { setLineSpacing(0f, 0.92f) })
    col.addView(space(10))
    col.addView(text(sc.explain, 16f, chalk2, body).apply { setLineSpacing(0f, 1.2f) })
    col.addView(space(24))
    col.addView(whenBlock(sc, now))
    col.addView(space(30))
    col.addView(label("What you can do"))
    sc.options.forEachIndexed { i, o -> col.addView(card(o, primary = i == 0)) }
    col.addView(space(22))
    col.addView(text(sc.footer, 12.5f, muted, body).apply { gravity = Gravity.CENTER })
    setContentView(scroll(col))
    enter(col)
    trueLine?.settle()
  }

  /** "Opens at 7:00 am" with the true line and the time left, or just the line of text. */
  private fun whenBlock(sc: Screen, now: Long): View {
    val box = LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(18), dp(16), dp(18), dp(16))
      background = rounded(surface, 18f, stroke = line)
    }
    trueLine = null
    remainingView = null
    if (sc.end != null) {
      val tl = TrueLine(this).apply { layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(30)) }
      tl.fraction = fraction(sc.start, sc.end, now)
      trueLine = tl
      box.addView(tl)
      box.addView(space(10))
    }
    val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
    row.addView(text(sc.opens, 15f, chalk, bodySemi).apply { layoutParams = LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f) })
    if (sc.end != null) {
      val left = text(remaining(sc.end, now), 15f, vial, bodySemi)
      remainingView = left
      row.addView(left)
    }
    box.addView(row)
    return box
  }

  private fun updateClock(sc: Screen, now: Long) {
    sc.end?.let { end -> remainingView?.text = remaining(end, now) }
    trueLine?.let { it.fraction = fraction(sc.start, sc.end, now); it.invalidate() }
  }

  /** The pause: breathe while the wait runs down (longer with every pass today), then decide. */
  private fun renderPause(p: STCore.Plan, st: STCore.State, pkg: String, app: String, now: Long) {
    shownSig = "pause|$pkg"
    val passes = STCore.pausePasses(p, st, now)
    val wait = p.pause.wait(passes)
    val openAt = now + wait * 1000L
    val col = column()
    col.addView(brandRow())
    col.addView(space(26))
    col.addView(appBadge(pkg, locked = false))
    col.addView(space(22))
    col.addView(chip("Pause"))
    col.addView(space(12))
    col.addView(text("Take a breath", 38f, chalk, faceDisplay))
    col.addView(space(10))
    col.addView(text("You asked for a short pause before opening $app. Breathe with the circle, then decide.", 16f, chalk2, body).apply { setLineSpacing(0f, 1.2f) })
    col.addView(space(16))
    val ring = BreathRing(this).apply { layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(160)) }
    col.addView(ring)
    col.addView(space(10))
    col.addView(
      text("If you open it, $app stays open for ${p.pause.passMin} minutes. Each pass today makes the next wait ${p.pause.step} s longer.", 13.5f, muted, body)
        .apply { gravity = Gravity.CENTER },
    )
    col.addView(space(26))
    col.addView(label("What you can do"))
    col.addView(card(Option("Not now", "Back to your home screen.") { goHome() }, primary = true))
    val open = card(Option("Open $app", "Opens for ${p.pause.passMin} minutes.") {
      STCore.grantPass(this, pkg)
      finish()
    }, primary = false)
    col.addView(open)
    setContentView(scroll(col))
    enter(col)
    val r = object : Runnable {
      override fun run() {
        val left = ((openAt - System.currentTimeMillis() + 999) / 1000).coerceAtLeast(0)
        ring.count = if (left > 0) "$left" else "✓"
        ring.invalidate()
        open.isEnabled = left == 0L
        open.alpha = if (left == 0L) 1f else 0.4f
        if (left > 0) ticker.postDelayed(this, 250)
      }
    }
    tick = r
    r.run()
  }

  // ── Building blocks ────────────────────────────────────────────────────────

  private fun column() =
    LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(26), dp(28), dp(26), dp(28))
    }

  private fun scroll(content: View) =
    ScrollView(this).apply {
      isFillViewport = true
      // Android 15 draws apps edge to edge: keep the content clear of the status and navigation bars.
      fitsSystemWindows = true
      background = GradientDrawable(GradientDrawable.Orientation.TOP_BOTTOM, intArrayOf(ground2, ground, ground))
      addView(content)
    }

  /** Trueline's mark (a level vial) and name, so the user knows whose screen this is. */
  private fun brandRow() =
    LinearLayout(this).apply {
      orientation = LinearLayout.HORIZONTAL
      gravity = Gravity.CENTER_VERTICAL
      addView(VialMark(this@BlockActivity).apply { layoutParams = LinearLayout.LayoutParams(dp(30), dp(16)) })
      addView(text("TRUELINE", 12f, muted, bodySemi).apply {
        letterSpacing = 0.28f
        setPadding(dp(10), 0, 0, 0)
      })
    }

  /** The blocked app's own icon, dimmed, with a lock (or a pause) badge. */
  private fun appBadge(pkg: String?, locked: Boolean = true): View {
    val size = dp(76)
    val frame = FrameLayout(this).apply { layoutParams = LinearLayout.LayoutParams(dp(92), dp(88)) }
    val icon = ImageView(this).apply {
      layoutParams = FrameLayout.LayoutParams(size, size)
      runCatching { setImageDrawable(packageManager.getApplicationIcon(pkg ?: packageName)) }
      colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(if (locked) 0.15f else 0.6f) })
      alpha = if (locked) 0.55f else 0.85f
      outlineProvider = object : ViewOutlineProvider() {
        override fun getOutline(view: View, outline: Outline) = outline.setRoundRect(0, 0, view.width, view.height, dp(20).toFloat())
      }
      clipToOutline = true
    }
    frame.addView(icon)
    frame.addView(Badge(this, locked).apply {
      layoutParams = FrameLayout.LayoutParams(dp(34), dp(34)).apply { gravity = Gravity.BOTTOM or Gravity.END }
    })
    return frame
  }

  private fun chip(t: String) =
    text(t.uppercase(), 11.5f, vial, bodySemi).apply {
      letterSpacing = 0.14f
      setPadding(dp(12), dp(6), dp(12), dp(6))
      background = rounded(Color.TRANSPARENT, 99f, stroke = vial)
      layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    }

  private fun label(t: String) =
    text(t.uppercase(), 11.5f, muted, bodySemi).apply {
      letterSpacing = 0.2f
      setPadding(0, 0, 0, dp(4))
    }

  /** An option: what it is, and one line saying what it does. The first one is the suggested one. */
  private fun card(o: Option, primary: Boolean): View {
    val bg = if (primary) vial else raised
    return LinearLayout(this).apply {
      orientation = LinearLayout.VERTICAL
      setPadding(dp(18), dp(14), dp(18), dp(14))
      background = RippleDrawable(ColorStateList.valueOf(if (primary) Color.parseColor("#33000000") else Color.parseColor("#22FFFFFF")), rounded(bg, 16f), null)
      layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT).apply { topMargin = dp(10) }
      isClickable = true
      isFocusable = true
      contentDescription = "${o.label}. ${o.hint}"
      addView(text(o.label, 17f, if (primary) vialInk else chalk, bodySemi))
      addView(text(o.hint, 13.5f, if (primary) Color.parseColor("#5C531A") else muted, body).apply { setPadding(0, dp(3), 0, 0) })
      setOnClickListener { o.act() }
    }
  }

  private fun text(t: String, size: Float, color: Int, face: Typeface) =
    TextView(this).apply {
      text = t
      textSize = size
      setTextColor(color)
      typeface = face
    }

  private fun space(h: Int) = View(this).apply { layoutParams = LinearLayout.LayoutParams(1, dp(h)) }

  private fun rounded(fill: Int, radius: Float, stroke: Int? = null) =
    GradientDrawable().apply {
      cornerRadius = dp(radius.toInt()).toFloat()
      setColor(fill)
      stroke?.let { setStroke(dp(1).coerceAtLeast(1), it) }
    }

  /** Children slide up into place one after another. */
  private fun enter(col: LinearLayout) {
    for (i in 0 until col.childCount) {
      val v = col.getChildAt(i)
      v.alpha = 0f
      v.translationY = dp(18).toFloat()
      v.animate().alpha(v.tag as? Float ?: 1f).translationY(0f).setStartDelay(40L * i).setDuration(380).setInterpolator(DecelerateInterpolator(1.6f)).start()
    }
  }

  private fun font(name: String, fallback: Typeface) = runCatching { Typeface.createFromAsset(assets, "fonts/$name") }.getOrDefault(fallback)

  private fun fraction(start: Long?, end: Long?, now: Long): Float =
    if (start == null || end == null || end <= start) 0f else ((now - start).toFloat() / (end - start)).coerceIn(0f, 1f)

  private fun remaining(end: Long, now: Long): String {
    val min = maxOf(1L, (end - now + 59_999) / 60_000)
    return if (min < 60) "$min min left" else if (min % 60 == 0L) "${min / 60} h left" else "${min / 60} h ${min % 60} min left"
  }

  /** "4:00 pm", "tomorrow 7:00 am", or a date further out. */
  private fun whenText(at: Long, now: Long): String {
    val clock = DateFormat.getTimeInstance(DateFormat.SHORT).format(Date(at))
    if (DateUtils.isToday(at)) return clock
    val tomorrow = Calendar.getInstance().apply { timeInMillis = now; add(Calendar.DAY_OF_YEAR, 1) }
    val day = Calendar.getInstance().apply { timeInMillis = at }
    return if (day.get(Calendar.YEAR) == tomorrow.get(Calendar.YEAR) && day.get(Calendar.DAY_OF_YEAR) == tomorrow.get(Calendar.DAY_OF_YEAR)) "tomorrow $clock"
    else "${DateFormat.getDateInstance(DateFormat.MEDIUM).format(Date(at))} $clock"
  }

  /** "App limit · Instagram", or just "App limit" when the user kept the default name. */
  private fun tag(kind: String, name: String?) =
    if (name.isNullOrBlank() || name.trim().equals(kind, ignoreCase = true)) kind else "$kind · ${name.trim()}"

  private fun plural(n: Int, one: String, many: String) = if (n == 1) "1 $one" else "$n $many"

  private fun dp(v: Int) = (v * resources.displayMetrics.density).toInt()

  // ── Actions ────────────────────────────────────────────────────────────────

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
    STCore.requestEarn(this)
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

  // ── Drawn pieces ───────────────────────────────────────────────────────────

  /**
   * The true line: a level line from when the block started to when it ends, with the vial's
   * bubble at "now". The bubble floats in from the left and settles, like a spirit level.
   */
  private inner class TrueLine(ctx: Context) : View(ctx) {
    var fraction = 0f
    private var shown = 0f
    private var settled = false
    private val track = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = line; strokeWidth = dp(3).toFloat(); strokeCap = Paint.Cap.ROUND }
    private val done = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = vial; strokeWidth = dp(3).toFloat(); strokeCap = Paint.Cap.ROUND }
    private val tickPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = muted; strokeWidth = dp(2).toFloat(); strokeCap = Paint.Cap.ROUND }
    private val bubble = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = vial }
    private val glint = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#FFF6C2") }
    private val halo = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#33F3D64B") }

    fun settle() {
      ValueAnimator.ofFloat(0f, 1f).apply {
        startDelay = 350
        duration = 1100
        interpolator = OvershootInterpolator(1.4f)
        addUpdateListener { shown = fraction * (it.animatedValue as Float); invalidate() }
        addListener(object : android.animation.AnimatorListenerAdapter() {
          override fun onAnimationEnd(animation: android.animation.Animator) { settled = true; invalidate() }
        })
        start()
      }
    }

    override fun onDraw(c: Canvas) {
      val pad = dp(14).toFloat()
      val y = height / 2f
      val x0 = pad
      val x1 = width - pad
      // While it settles it floats in; after that it follows the clock.
      val f = if (settled) fraction else shown
      c.drawLine(x0, y, x1, y, track)
      for (q in 1..3) {
        val x = x0 + (x1 - x0) * q / 4f
        c.drawLine(x, y - dp(4), x, y + dp(4), tickPaint.apply { alpha = 90 })
      }
      tickPaint.alpha = 255
      c.drawLine(x0, y - dp(8), x0, y + dp(8), tickPaint)
      c.drawLine(x1, y - dp(8), x1, y + dp(8), tickPaint)
      val bx = x0 + (x1 - x0) * f.coerceIn(0f, 1.04f)
      c.drawLine(x0, y, bx, y, done)
      val w = dp(26).toFloat()
      val h = dp(15).toFloat()
      c.drawRoundRect(RectF(bx - w / 2 - dp(4), y - h / 2 - dp(4), bx + w / 2 + dp(4), y + h / 2 + dp(4)), h, h, halo)
      c.drawRoundRect(RectF(bx - w / 2, y - h / 2, bx + w / 2, y + h / 2), h / 2, h / 2, bubble)
      c.drawRoundRect(RectF(bx - w / 2 + dp(5), y - h / 2 + dp(3), bx - dp(1), y - dp(1)), h / 4, h / 4, glint)
    }
  }

  /** Trueline's mark: a level vial with its bubble centred. */
  private inner class VialMark(ctx: Context) : View(ctx) {
    private val outline = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = chalk2; strokeWidth = dp(1.6f) }
    private val dot = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = vial }
    override fun onDraw(c: Canvas) {
      val s = dp(1.6f) / 2
      val r = height / 2f - s
      c.drawRoundRect(RectF(s, s, width - s, height - s), r, r, outline)
      c.drawRoundRect(RectF(width * 0.33f, height * 0.28f, width * 0.67f, height * 0.72f), height * 0.22f, height * 0.22f, dot)
    }
  }

  /** The badge on the app icon: a padlock, or a pause sign. */
  private inner class Badge(ctx: Context, private val locked: Boolean) : View(ctx) {
    private val fill = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = vial }
    private val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = ground; style = Paint.Style.STROKE; strokeWidth = dp(3f) }
    private val ink = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = vialInk }
    private val inkLine = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = vialInk; style = Paint.Style.STROKE; strokeWidth = dp(2.2f); strokeCap = Paint.Cap.ROUND }
    override fun onDraw(c: Canvas) {
      val cx = width / 2f
      val cy = height / 2f
      val r = width / 2f - dp(1.5f)
      c.drawCircle(cx, cy, r, fill)
      c.drawCircle(cx, cy, r, ring)
      if (locked) {
        val bw = r * 0.95f
        val bh = r * 0.72f
        val top = cy - bh * 0.15f
        c.drawArc(RectF(cx - bw * 0.32f, top - bh * 0.78f, cx + bw * 0.32f, top + bh * 0.3f), 180f, 180f, false, inkLine)
        c.drawRoundRect(RectF(cx - bw / 2, top, cx + bw / 2, top + bh), dp(2.5f), dp(2.5f), ink)
      } else {
        val gap = r * 0.22f
        val h = r * 0.9f
        c.drawRoundRect(RectF(cx - gap - dp(3.4f), cy - h / 2, cx - gap, cy + h / 2), dp(1.5f), dp(1.5f), ink)
        c.drawRoundRect(RectF(cx + gap, cy - h / 2, cx + gap + dp(3.4f), cy + h / 2), dp(1.5f), dp(1.5f), ink)
      }
    }
  }

  /** The pause's breathing circle: it swells and settles every 8 seconds, with the wait inside. */
  private inner class BreathRing(ctx: Context) : View(ctx) {
    var count = ""
    private var phase = 0f
    private val outer = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; color = line; strokeWidth = dp(2f) }
    private val glow = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = Color.parseColor("#22F3D64B") }
    private val core = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = vial }
    private val num = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = vialInk; textAlign = Paint.Align.CENTER; typeface = faceDisplay; textSize = dp(52f) }
    private val anim = ValueAnimator.ofFloat(0f, 1f).apply {
      duration = 8000
      repeatCount = ValueAnimator.INFINITE
      addUpdateListener { phase = it.animatedValue as Float; invalidate() }
    }

    override fun onAttachedToWindow() {
      super.onAttachedToWindow()
      anim.start()
    }

    override fun onDetachedFromWindow() {
      anim.cancel()
      super.onDetachedFromWindow()
    }

    override fun onDraw(c: Canvas) {
      val cx = width / 2f
      val cy = height / 2f
      val max = minOf(width, height) / 2f - dp(4)
      // In for 4 s, out for 4 s.
      val breath = (1 - Math.cos(phase * 2 * Math.PI).toFloat()) / 2
      c.drawCircle(cx, cy, max, outer)
      c.drawCircle(cx, cy, max * (0.62f + 0.36f * breath), glow)
      val r = max * (0.46f + 0.12f * breath)
      c.drawCircle(cx, cy, r, core)
      c.drawText(count, cx, cy - (num.descent() + num.ascent()) / 2, num)
    }
  }

  private fun dp(v: Float) = v * resources.displayMetrics.density
}
