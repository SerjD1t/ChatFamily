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
 static final String CHECK="site.chatfamily.app.WIDGET_CHECK";
 public static int[] ids(Context c){return AppWidgetManager.getInstance(c).getAppWidgetIds(new ComponentName(c,FamilyWidgetProvider.class));}
 public static void renderAll(Context c){for(int id:ids(c))render(c,id);}
 @Override public void onUpdate(Context c,AppWidgetManager manager,int[] ids){for(int id:ids)render(c,id);FamilyWidgetWorker.refresh(c);}
 @Override public void onAppWidgetOptionsChanged(Context c,AppWidgetManager manager,int id,Bundle options){render(c,id);}
 @Override public void onDeleted(Context c,int[] ids){for(int id:ids)WidgetStore.remove(c,id);}
 @Override public void onDisabled(Context c){WorkManager.getInstance(c).cancelUniqueWork("family-widget-periodic");WorkManager.getInstance(c).cancelUniqueWork("family-widget-refresh");}
 @Override public void onReceive(Context c,Intent intent){super.onReceive(c,intent);if(REFRESH.equals(intent.getAction()))FamilyWidgetWorker.refresh(c);
  if(CHECK.equals(intent.getAction())){
   String item=intent.getStringExtra("item"),entry=intent.getStringExtra("entry"),user=intent.getStringExtra("user");
   if(!WidgetStore.validID(item)||entry==null||!WidgetStore.validID(user))return;
   androidx.work.Data data=new androidx.work.Data.Builder().putInt("widget",intent.getIntExtra("widget",-1)).putString("item",item).putString("entry",entry).putString("user",user).putLong("epoch",intent.getLongExtra("epoch",-1)).putLong("version",intent.getLongExtra("version",-1)).build();
   WorkManager.getInstance(c).enqueueUniqueWork("family-widget-check",androidx.work.ExistingWorkPolicy.KEEP,new androidx.work.OneTimeWorkRequest.Builder(WidgetCheckWorker.class).setInputData(data).build());
  }
 }
 private static PendingIntent check(Context c,int widget,JSONObject item,String entry){
  long epoch=WidgetStore.epoch(c),version=item.optLong("version");String id=item.optString("id");
  Intent in=new Intent(c,FamilyWidgetProvider.class).setAction(CHECK).setData(Uri.parse("chatfamily-widget://check/"+widget+"/"+epoch+"/"+id+"/"+version+"/"+entry))
   .putExtra("widget",widget).putExtra("item",id).putExtra("entry",entry).putExtra("version",version).putExtra("epoch",epoch).putExtra("user",WidgetStore.user(c));
  return PendingIntent.getBroadcast(c,widget,in,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
 }
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
  if("write".equals(error)||"conflict".equals(error))status=c.getString(R.string.widget_check_error);
  if("pending".equals(error))status=c.getString(R.string.widget_saving);
  v.setTextViewText(R.id.widget_updated,status);
  int height=AppWidgetManager.getInstance(c).getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT,250);
  boolean showChats=cached&&config.optBoolean("chats")&&data.has("chats");
  v.setViewVisibility(R.id.widget_chats,showChats?View.VISIBLE:View.GONE);
  v.setViewVisibility(R.id.widget_chat_count,showChats?View.VISIBLE:View.GONE);
  v.removeAllViews(R.id.widget_chats);
  JSONArray chats=data.optJSONArray("chats");
  int width=AppWidgetManager.getInstance(c).getAppWidgetOptions(id).getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH,250);
  int chatRows=showChats&&chats!=null?WidgetPolicy.chatCount(width,chats.length()):0;
  v.setViewVisibility(R.id.widget_chats,chatRows>0?View.VISIBLE:View.GONE);
  if(showChats){
   v.setTextViewText(R.id.widget_chat_count,c.getString(R.string.widget_chat_count,data.optLong("unreadCount")));
   if(chats!=null)for(int i=0;i<Math.min(chatRows,chats.length());i++){
    JSONObject chat=chats.optJSONObject(i);if(chat==null)continue;
    RemoteViews row=new RemoteViews(c.getPackageName(),R.layout.family_widget_chat);
    String name=chat.optString("title"),icon=chat.optString("icon");
    row.setTextViewText(R.id.widget_chat_initials,icon.isEmpty()?WidgetPolicy.initials(name):icon);
    row.setTextViewText(R.id.widget_chat_name,name);
    row.setTextViewText(R.id.widget_chat_badge,WidgetPolicy.badge(chat.optLong("unread")));
    row.setContentDescription(R.id.widget_chat,name+" · "+c.getString(R.string.widget_chat_unread,chat.optLong("unread")));
    android.graphics.Bitmap avatar=WidgetAvatars.bitmap(chat);
    if(avatar!=null){row.setImageViewBitmap(R.id.widget_chat_avatar,avatar);row.setViewVisibility(R.id.widget_chat_avatar,View.VISIBLE);row.setViewVisibility(R.id.widget_chat_initials,View.INVISIBLE);}
    row.setOnClickPendingIntent(R.id.widget_chat,launch(c,id,"chat",chat.optString("id")));
    v.addView(R.id.widget_chats,row);
   }
  }
  int chatHeight=showChats?24+(chatRows>0?70:0):0;
  v.setViewVisibility(R.id.widget_body,height-chatHeight<130?View.GONE:View.VISIBLE);
  if(height-chatHeight<260)v.setViewVisibility(R.id.widget_buttons,View.GONE);
  int rows=WidgetPolicy.rows(height-chatHeight,c.getResources().getConfiguration().fontScale);
  boolean pinned=data.optBoolean("savedPins")?data.optJSONArray("pinned")!=null&&data.optJSONArray("pinned").length()>0:config.optJSONArray("pins")!=null&&config.optJSONArray("pins").length()>0;
  if(pinned){
   v.setViewVisibility(R.id.widget_task_count,View.GONE);v.setViewVisibility(R.id.widget_tasks,View.GONE);v.setViewVisibility(R.id.widget_buttons,View.GONE);
   v.setTextViewText(R.id.widget_purchase_count,c.getString(R.string.widget_pin_mode));
   if(cached)addPins(c,v,id,data.optJSONArray("pinned"),Math.max(1,Math.min(10,(int)((height-110-chatHeight)/(48*c.getResources().getConfiguration().fontScale)))),"pending".equals(error));
  }else if(cached){addRows(c,v,id,R.id.widget_tasks,s.optJSONArray("tasks"),rows,s.optString("today"));addRows(c,v,id,R.id.widget_purchases,s.optJSONArray("shopping"),rows,s.optString("today"));}
  AppWidgetManager.getInstance(c).updateAppWidget(id,v);
 }
 private static void addPins(Context c,RemoteViews root,int widget,JSONArray items,int budget,boolean pending){
  if(items==null||items.length()==0){root.setTextViewText(R.id.widget_purchase_count,c.getString(R.string.widget_no_pins));return;}
  int per=Math.max(1,budget/items.length());
  for(int i=0;i<Math.min(items.length(),budget);i++){
   JSONObject item=items.optJSONObject(i);if(item==null)continue;
   JSONArray entries=item.optJSONArray("checklist");int total=entries==null?0:entries.length(),done=0;
   for(int j=0;j<total;j++)if(entries.optJSONObject(j).optBoolean("completed"))done++;
   RemoteViews title=new RemoteViews(c.getPackageName(),R.layout.family_widget_row);
   title.setTextViewText(R.id.widget_row_title,item.optString("title"));title.setTextViewText(R.id.widget_row_meta,total==0?c.getString(R.string.widget_open_purchase):c.getString(R.string.widget_bought,done,total));
   title.setOnClickPendingIntent(R.id.widget_row,launch(c,widget,"item",item.optString("id")));root.addView(R.id.widget_purchases,title);
   int shown=0,room=per-1;
   for(int j=0;j<total&&shown<room;j++){
    JSONObject entry=entries.optJSONObject(j);if(entry.optBoolean("completed"))continue;
    RemoteViews row=new RemoteViews(c.getPackageName(),R.layout.family_widget_row);row.setTextViewText(R.id.widget_row_title,"☐ "+entry.optString("text"));row.setViewVisibility(R.id.widget_row_meta,View.GONE);
    if(!pending)row.setOnClickPendingIntent(R.id.widget_row,check(c,widget,item,entry.optString("id")));root.addView(R.id.widget_purchases,row);shown++;
   }
   if(total>0&&done==total&&room>0){
    RemoteViews row=new RemoteViews(c.getPackageName(),R.layout.family_widget_row);row.setTextViewText(R.id.widget_row_title,c.getString(R.string.widget_complete));row.setViewVisibility(R.id.widget_row_meta,View.GONE);
    if(!pending)row.setOnClickPendingIntent(R.id.widget_row,check(c,widget,item,""));root.addView(R.id.widget_purchases,row);
   }
  }
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
