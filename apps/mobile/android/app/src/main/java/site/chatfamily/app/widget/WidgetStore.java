package site.chatfamily.app.widget;

import android.content.Context;
import android.content.SharedPreferences;
import org.json.JSONObject;

// Private application storage; contains only bounded widget snapshots, never cookies.
public final class WidgetStore {
 private WidgetStore(){}
 private static SharedPreferences prefs(Context c){return c.getSharedPreferences("family-widgets",Context.MODE_PRIVATE);}
 public static synchronized String user(Context c){return prefs(c).getString("user","");}
 public static synchronized long epoch(Context c){return prefs(c).getLong("epoch",0);}
 public static synchronized void session(Context c,String user){
  if(user.equals(user(c)))return;
  long next=epoch(c)+1;
  prefs(c).edit().clear().putString("user",user).putLong("epoch",next).commit();
 }
 public static synchronized boolean clearIfCurrent(Context c,long expectedEpoch){if(epoch(c)!=expectedEpoch)return false;session(c,"");return true;}
 public static synchronized JSONObject config(Context c,int id){try{return new JSONObject(prefs(c).getString("config-"+id,"{}"));}catch(Exception e){return new JSONObject();}}
 public static synchronized void configure(Context c,int id,String family,boolean mine,String owner)throws Exception {
  if(!owner.equals(user(c))||owner.isEmpty())throw new IllegalStateException();
  JSONObject value=new JSONObject().put("family",family).put("mine",mine).put("owner",owner);
  prefs(c).edit().putLong("epoch",epoch(c)+1).putString("config-"+id,value.toString()).remove("data-"+id).remove("error-"+id).commit();
 }
 public static synchronized JSONObject data(Context c,int id){try{
  JSONObject data=new JSONObject(prefs(c).getString("data-"+id,"{}"));
  if(!WidgetPolicy.fresh(data.optLong("fetchedAt"),System.currentTimeMillis())){prefs(c).edit().remove("data-"+id).commit();return new JSONObject();}
  return data;
 }catch(Exception e){return new JSONObject();}}
 public static synchronized String error(Context c,int id){return prefs(c).getString("error-"+id,"");}
 public static synchronized void result(Context c,int id,long epoch,String family,JSONObject data,String error,boolean revoke){
  if(epoch!=epoch(c)||!family.equals(config(c,id).optString("family")))return;
  SharedPreferences.Editor edit=prefs(c).edit().putString("error-"+id,error);
  if(revoke)edit.remove("data-"+id);
  else if(data!=null)edit.putString("data-"+id,data.toString());
  edit.commit();
 }
 public static synchronized void remove(Context c,int id){prefs(c).edit().remove("config-"+id).remove("data-"+id).remove("error-"+id).commit();}
 public static boolean validID(String value){return value!=null&&value.matches("[a-zA-Z0-9_-]{1,100}");}
}
