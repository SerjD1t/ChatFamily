package site.chatfamily.app.widget;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.*;
import org.json.JSONObject;
import java.net.URLEncoder;
import java.time.ZoneId;
import java.util.concurrent.TimeUnit;

public class FamilyWidgetWorker extends Worker {
 public FamilyWidgetWorker(@NonNull Context c,@NonNull WorkerParameters p){super(c,p);}
 public static void schedule(Context c){
  if(FamilyWidgetProvider.ids(c).length==0)return;
  WorkManager.getInstance(c).enqueueUniquePeriodicWork("family-widget-periodic",ExistingPeriodicWorkPolicy.KEEP,
   new PeriodicWorkRequest.Builder(FamilyWidgetWorker.class,30,TimeUnit.MINUTES).build());
 }
 public static void refresh(Context c){
  if(FamilyWidgetProvider.ids(c).length==0)return;
  schedule(c);WorkManager.getInstance(c).enqueueUniqueWork("family-widget-refresh",ExistingWorkPolicy.REPLACE,new OneTimeWorkRequest.Builder(FamilyWidgetWorker.class).build());
 }
 @NonNull @Override public Result doWork(){
  Context c=getApplicationContext();String user;long epoch;
  synchronized(WidgetStore.class){user=WidgetStore.user(c);epoch=WidgetStore.epoch(c);}
  for(int id:FamilyWidgetProvider.ids(c)){
   FamilyWidgetProvider.render(c,id);
   JSONObject config=WidgetStore.config(c,id);String family=config.optString("family");
   if(user.isEmpty()||!user.equals(config.optString("owner"))||!WidgetStore.validID(family))continue;
   try {
    JSONObject data=WidgetHttp.get("?familyId="+family+"&mine="+config.optBoolean("mine")+"&timezone="+URLEncoder.encode(ZoneId.systemDefault().getId(),"UTF-8"),user);
    if(isStopped())return Result.success();
    if(!family.equals(data.optString("familyId")))throw new WidgetHttp.Status(403);
    data.put("fetchedAt",System.currentTimeMillis());WidgetStore.result(c,id,epoch,family,data,"",false);
   }catch(WidgetHttp.Status e){
    if(isStopped())return Result.success();
    if(e.code==401){if(WidgetStore.clearIfCurrent(c,epoch))FamilyWidgetProvider.renderAll(c);return Result.success();}
    WidgetStore.result(c,id,epoch,family,null,e.code==403?"access":e.code==404?"server":"offline",e.code==403);
   }catch(Exception ignored){if(isStopped())return Result.success();WidgetStore.result(c,id,epoch,family,null,"offline",false);}
   FamilyWidgetProvider.render(c,id);
  }
  return Result.success();
 }
}
