package site.chatfamily.app.widget;

import android.app.PendingIntent;
import android.appwidget.*;
import android.content.*;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.widget.RemoteViews;
import androidx.work.WorkManager;
import org.json.*;
import java.text.DateFormat;
import java.util.Date;
import site.chatfamily.app.MainActivity;
import site.chatfamily.app.R;

public class FamilyWidgetProvider extends AppWidgetProvider {
 static final String REFRESH="site.chatfamily.app.WIDGET_REFRESH";
 public static int[] ids(Context c){return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,FamilyWidgetProvider.class));}
 public static void renderAll(Context c){for(int id:ids(c))render(c,id);}
 @Override public void onUpdate(Context c,AppWidgetManager manager,int[] ids){for(int id:ids)render(c,id);FamilyWidgetWorker.refresh(c);}
 @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager manager,int id,Bundle options){render(c,id);}
 @Override public void onDeleted(Context c,int[] ids){for(int id:ids)WidgetStore.remove(c,id);}
 @Override public void onDisabled(Context c){WorkManager.getInstance(c).cancelUniqueWork("family-widget-periodic");WorkManager.getInstance(c).cancelUniqueWork("family-widget-refresh");}
 @Override public void onReceive(Context c,Intent intent){super.onReceive(c,intent);if(REFRESH.equals(intent.getAction()))FamilyWidgetWorker.refresh(c);}
 private static PendingIntent launch(Context c,int id,String action,String item){
  Intent in=new Intent(c,MainActivity.class).setAction("site.chatfamily.app.WIDGET_OPEN")
   .setData(Uri.parse("chatfamily-widget://open/"+id+"/"+action+"/"+item))
   .putExtra("widgetId",id).putExtra("widgetAction",action).putExtra("widgetItem",item)
   .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP|Intent.FLAG_ACTIVITY_CLEAR_TOP);
  return PendingIntent.getActivity(c,id,in,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
 }
 public static void render(Context c,int id){synchronized(WidgetStore.class){renderLocked(c,id);}}
 private static void renderLocked(Context c,int id){
  RemoteViews v=new RemoteViews(c.getPackageName(),R.layout.family_widget);
  JSONObject config=WidgetStore.config(c,id),data=WidgetStore.data(c,id);String user=WidgetStore.user(c);
  boolean configured=!user.isEmpty()&&user.equals(config.optString("owner"));
  long at=data.optLong("fetchedAt");boolean cached=configured&&WidgetPolicy.fresh(at,System.currentTimeMillis());
  String error=WidgetStore.error(c,id);
  v.setTextViewText(R.id.widget_title,cached?data.optString("title"):c.getString(R.string.widget_name));
  v.setOnClickPendingIntent(R.id.widget_title,launch(c,id,"list",""));
  Intent settings=new Intent(c,FamilyWidgetConfigure.class).putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,id)
   .setData(Uri.parse("chatfamily-widget://configure/"+id));
  v.setOnClickPendingIntent(R.id.widget_settings,PendingIntent.getActivity(c,id,settings,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
  Intent refresh=new Intent(c,FamilyWidgetProvider.class).setAction(REFRESH).setData(Uri.parse("chatfamily-widget://refresh/"+id));
  v.setOnClickPendingIntent(R.id.widget_refresh,PendingIntent.getBroadcast(c,id,refresh,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE));
  v.setOnClickPendingIntent(R.id.widget_add_task,launch(c,id,"task",""));
  v.setOnClickPendingIntent(R.id.widget_add_purchase,launch(c,id,"purchase",""));
  v.setViewVisibility(R.id.widget_buttons,configured?View.VISIBLE:View.GONE);
  v.removeAllViews(R.id.widget_tasks);v.removeAllViews(R.id.widget_purchases);
  JSONObject s=data.optJSONObject("summary");if(s==null)s=new JSONObject();
  v.setTextViewText(R.id.widget_task_count,cached?c.getString(R.string.widget_tasks_count,s.optInt("due"),s.optInt("overdue")):c.getString(R.string.widget_tasks));
  v.setTextViewText(R.id.widget_purchase_count,cached?c.getString(R.string.widget_purchases_count,s.optInt("purchaseCount")):c.getString(R.string.widget_purchases));
  v.setOnClickPendingIntent(R.id.widget_task_count,launch(c,id,"list",""));
  v.setOnClickPendingIntent(R.id.widget_purchase_count,launch(c,id,"list",""));
  String status=user.isEmpty()?c.getString(R.string.widget_sign_in):!configured?c.getString(R.string.widget_choose_family):"access".equals(error)?c.getString(R.string.widget_access_lost):"server".equals(error)?c.getString(R.string.widget_server_update):!cached?c.getString(R.string.widget_no_data):c.getString(R.string.widget_updated,DateFormat.getDateTimeInstance(DateFormat.SHORT,DateFormat.SHORT).format(new Date(at)));
  if(cached&&!error.isEmpty())status=c.getString(R.string.widget_saved)+" · "+status;
  v.setTextViewText(R.id.widget_updated,status);
  int height=AppWidgetManager.getInstance(c).getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,250);
  int rows=WidgetPolicy.rows(height,c.getResources().getConfiguration().fontScale);
  if(cached){addRows(c,v,id,R.id.widget_tasks,s.optJSONArray("tasks"),rows,s.optString("today"));addRows(c,v,id,R.id.widget_purchases,s.optJSONArray("shopping"),rows,s.optString("today"));}
  AppWidgetManager.getInstance(c).updateAppWidget(id,v);
 }
 private static void addRows(Context c,RemoteViews root,int widget,int container,JSONArray items,int count,String today){
  if(items==null)return;
  for(int i=0;i<Math.min(count,items.length());i++){
   JSONObject item=items.optJSONObject(i);if(item==null)continue;
   RemoteViews row=new RemoteViews(c.getPackageName(),R.layout.family_widget_row);
   String date=item.optString("date"),assignee=item.optString("assignee");
   String meta=(date.equals(today)?c.getString(R.string.widget_today):date)+(assignee.isEmpty()?"":" · "+assignee);
   row.setTextViewText(R.id.widget_row_title,item.optString("title"));row.setTextViewText(R.id.widget_row_meta,meta);
   row.setViewVisibility(R.id.widget_row_meta,meta.isEmpty()?View.GONE:View.VISIBLE);
   row.setTextColor(R.id.widget_row_meta,c.getColor(!date.isEmpty()&&date.compareTo(today)<0?R.color.widget_overdue:R.color.widget_muted));
   row.setOnClickPendingIntent(R.id.widget_row,launch(c,widget,"item",item.optString("id")));
   root.addView(container,row);
  }
 }
}
