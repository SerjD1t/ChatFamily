package site.chatfamily.app.widget;

import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.*;
import org.json.*;

/** Explicit versioned actions, never a blind toggle or an offline retry queue. */
public class WidgetCheckWorker extends Worker {
 public WidgetCheckWorker(@NonNull Context c,@NonNull WorkerParameters p){super(c,p);}
 @NonNull @Override public Result doWork(){
  Context c=getApplicationContext();Data in=getInputData();int widget=in.getInt("widget",-1);
  String user=in.getString("user"),item=in.getString("item"),entry=in.getString("entry");long epoch=in.getLong("epoch",-1),version=in.getLong("version",-1);
  JSONObject config=WidgetStore.config(c,widget);String family=config.optString("family");
  if(!WidgetStore.validID(user)||!WidgetStore.validID(item)||!WidgetStore.validID(family)||entry==null||(!entry.isEmpty()&&!WidgetStore.validID(entry)))return Result.success();
  synchronized(WidgetStore.class){if(epoch!=WidgetStore.epoch(c)||!user.equals(WidgetStore.user(c))||!user.equals(config.optString("owner")))return Result.success();}
  JSONObject purchase=null;JSONArray pins=WidgetStore.data(c,widget).optJSONArray("pinned");
  if(pins!=null)for(int i=0;i<pins.length();i++){JSONObject p=pins.optJSONObject(i);if(p!=null&&item.equals(p.optString("id")))purchase=p;}
  if(purchase==null||!WidgetPolicy.acceptsAction(user,WidgetStore.user(c),epoch,WidgetStore.epoch(c),version,purchase.optLong("version")))return Result.success();
  JSONArray checks=purchase.optJSONArray("checklist");boolean valid=false,all=checks!=null&&checks.length()>0;
  if(checks!=null)for(int i=0;i<checks.length();i++){JSONObject e=checks.optJSONObject(i);if(e==null)continue;if(!e.optBoolean("completed"))all=false;if(entry.equals(e.optString("id"))&&!e.optBoolean("completed"))valid=true;}
  if(entry.isEmpty()?!all:!valid)return Result.success();
  WidgetStore.result(c,widget,epoch,family,null,"pending",false);FamilyWidgetProvider.render(c,widget);
  try{
   JSONObject body=new JSONObject().put("version",version);
   if(entry.isEmpty())body.put("completed",true);else body.put("checkItem",new JSONObject().put("id",entry).put("completed",true));
   JSONObject saved=WidgetHttp.check(family,item,user,body);
   synchronized(WidgetStore.class){
    if(epoch!=WidgetStore.epoch(c)||!user.equals(WidgetStore.user(c)))return Result.success();
    // Invalidate older in-flight snapshots before displaying the confirmed server state.
    epoch=WidgetStore.advance(c);
    JSONObject data=WidgetStore.data(c,widget);JSONArray updated=new JSONArray();
    JSONArray old=data.optJSONArray("pinned");if(old!=null)for(int i=0;i<old.length();i++){JSONObject p=old.getJSONObject(i);if(item.equals(p.optString("id"))){if(saved.isNull("completedAt"))updated.put(saved);}else updated.put(p);}
    data.put("pinned",updated);WidgetStore.result(c,widget,epoch,family,data,"",false);
   }
   FamilyWidgetWorker.refresh(c);
  }catch(WidgetHttp.Status e){
   if(e.code==401){WidgetStore.clearIfCurrent(c,epoch);FamilyWidgetProvider.renderAll(c);return Result.success();}
   WidgetStore.result(c,widget,epoch,family,null,e.code==403?"access":e.code==409?"conflict":"write",e.code==403);
  }catch(Exception ignored){WidgetStore.result(c,widget,epoch,family,null,"write",false);}
  FamilyWidgetProvider.render(c,widget);return Result.success();
 }
}
