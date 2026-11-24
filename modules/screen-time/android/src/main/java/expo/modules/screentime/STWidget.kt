package expo.modules.screentime

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.widget.RemoteViews

/**
 * Home screen widget: the same one-line status as the ongoing notification ("Work until 5:00 PM",
 * "45 min left today"). The blocking service updates it whenever that line changes.
 */
class STWidget : AppWidgetProvider() {
  override fun onUpdate(ctx: Context, mgr: AppWidgetManager, ids: IntArray) {
    update(ctx, null)
  }

  companion object {
    private const val KEY = "widgetText"

    fun update(ctx: Context, textIn: String?) {
      val prefs = STCore.prefs(ctx)
      if (textIn != null) prefs.edit().putString(KEY, textIn).apply()
      val mgr = AppWidgetManager.getInstance(ctx)
      val ids = runCatching { mgr.getAppWidgetIds(ComponentName(ctx, STWidget::class.java)) }.getOrNull() ?: return
      if (ids.isEmpty()) return
      val text = textIn ?: prefs.getString(KEY, null) ?: "Screen time is off"
      val views = RemoteViews(ctx.packageName, R.layout.st_widget)
      views.setTextViewText(R.id.st_widget_text, text)
      ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
        views.setOnClickPendingIntent(R.id.st_widget_root, PendingIntent.getActivity(ctx, 1, it, PendingIntent.FLAG_IMMUTABLE))
      }
      mgr.updateAppWidget(ids, views)
    }
  }
}
