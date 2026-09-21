package site.chatfamily.app.widget;

import android.content.Intent;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONObject;
import site.chatfamily.app.ShellNavigation;

@CapacitorPlugin(name="FamilyWidget")
public class FamilyWidgetPlugin extends Plugin {
 private boolean trusted(PluginCall call){if(!ShellNavigation.internal(getBridge().getWebView().getUrl())){call.reject("Untrusted origin");return false;}return true;}
 @PluginMethod public void session(PluginCall call){
  getActivity().runOnUiThread(()->sessionOnUI(call));
 }
 private void sessionOnUI(PluginCall call){
  if(!trusted(call))return;String user=call.getString("userId","");
  if(!user.isEmpty()&&!WidgetStore.validID(user)){call.reject("Invalid account");return;}
  WidgetStore.session(getContext(),user);FamilyWidgetProvider.renderAll(getContext());
  if(!user.isEmpty())FamilyWidgetWorker.refresh(getContext());call.resolve();
 }
 @PluginMethod public void refresh(PluginCall call){getActivity().runOnUiThread(()->{if(!trusted(call))return;FamilyWidgetWorker.refresh(getContext());call.resolve();});}
 @Override protected void handleOnNewIntent(Intent intent){if("site.chatfamily.app.WIDGET_OPEN".equals(intent.getAction()))notifyListeners("open",new JSObject());}
 @PluginMethod public void consumeAction(PluginCall call){
  getActivity().runOnUiThread(()->consumeOnUI(call));
 }
 private void consumeOnUI(PluginCall call){
  if(!trusted(call))return;Intent intent=getActivity().getIntent();JSObject out=new JSObject();
  if(intent!=null&&"site.chatfamily.app.WIDGET_OPEN".equals(intent.getAction())){
   int id=intent.getIntExtra("widgetId",-1);JSONObject config=WidgetStore.config(getContext(),id);
   String user=WidgetStore.user(getContext()),action=intent.getStringExtra("widgetAction"),item=intent.getStringExtra("widgetItem");
   // Clear only after authenticated boot: a cold launch may still need login.
   if(!user.isEmpty()){
    getActivity().setIntent(new Intent(getContext(),site.chatfamily.app.MainActivity.class));
    if(user.equals(config.optString("owner"))&&WidgetStore.validID(config.optString("family"))&&
       ("list".equals(action)||"task".equals(action)||"purchase".equals(action)||"item".equals(action)&&WidgetStore.validID(item))){
     out.put("userId",user);out.put("familyId",config.optString("family"));out.put("action",action);out.put("itemId",item==null?"":item);
    }
   }
  }
  call.resolve(out);
 }
}
