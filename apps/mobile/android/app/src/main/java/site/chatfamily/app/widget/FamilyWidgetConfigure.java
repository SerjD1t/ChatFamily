package site.chatfamily.app.widget;

import android.app.Activity;
import android.appwidget.AppWidgetManager;
import android.content.Intent;
import android.os.Bundle;
import android.view.View;
import android.widget.*;
import org.json.*;
import java.util.ArrayList;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import site.chatfamily.app.R;

public class FamilyWidgetConfigure extends Activity {
 private final ExecutorService executor=Executors.newSingleThreadExecutor();
 private int widgetId;private String owner;private JSONArray families;
 private LinearLayout box;private TextView message;private int generation;
 @Override public void onCreate(Bundle state){
  super.onCreate(state);setResult(RESULT_CANCELED);
  widgetId=getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,AppWidgetManager.INVALID_APPWIDGET_ID);
  boolean exists=false;for(int id:FamilyWidgetProvider.ids(this))if(id==widgetId)exists=true;
  if(!exists){finish();return;}
  box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);int pad=(int)(20*getResources().getDisplayMetrics().density);box.setPadding(pad,pad,pad,pad);
  ScrollView scroll=new ScrollView(this);scroll.addView(box);setContentView(scroll);
  TextView title=new TextView(this);title.setText(R.string.widget_name);title.setTextSize(24);box.addView(title);
  message=new TextView(this);box.addView(message);
 }
 @Override public void onResume(){super.onResume();if(box!=null)load();}
 @Override public void onPause(){generation++;super.onPause();}
 private void load(){
  int request=++generation;long epoch=WidgetStore.epoch(this);
  if(box.getChildCount()>2)box.removeViews(2,box.getChildCount()-2);
  message.setText(R.string.widget_loading);
  executor.execute(()->{
   try{
    JSONObject data=WidgetHttp.discover();String account=data.getString("userId");JSONArray available=data.getJSONArray("families");
    runOnUiThread(()->{
     if(!current(request))return;
     synchronized(WidgetStore.class){
      if(epoch!=WidgetStore.epoch(this)){failure(R.string.widget_config_error);return;}
      WidgetStore.session(this,account);owner=account;families=available;
     }
     FamilyWidgetProvider.renderAll(this);showOptions(box,message);
    });
   }catch(Exception error){
    int text=error instanceof WidgetHttp.Status&&((WidgetHttp.Status)error).code==401?R.string.widget_login_required:R.string.widget_config_error;
    runOnUiThread(()->{if(current(request)){
     if(text==R.string.widget_login_required&&WidgetStore.clearIfCurrent(this,epoch))FamilyWidgetProvider.renderAll(this);
     failure(text);
    }});
   }
  });
 }
 private boolean current(int request){return request==generation&&!isFinishing()&&!isDestroyed();}
 private void failure(int text){
  message.setText(text);
  Button open=new Button(this);open.setText(R.string.widget_open_app);box.addView(open);
  open.setOnClickListener(v->startActivity(new Intent(this,site.chatfamily.app.MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_REORDER_TO_FRONT)));
  Button retry=new Button(this);retry.setText(R.string.widget_retry);box.addView(retry);retry.setOnClickListener(v->load());
 }
 private void showOptions(LinearLayout box,TextView message){
  if(!owner.equals(WidgetStore.user(this))){message.setText(R.string.widget_sign_in);return;}
  if(families.length()==0){message.setText(R.string.widget_no_family);return;}
  message.setText(R.string.widget_privacy);
  ArrayList<String> names=new ArrayList<>();int selected=0;JSONObject old=WidgetStore.config(this,widgetId);
  for(int i=0;i<families.length();i++){JSONObject f=families.optJSONObject(i);names.add(f.optString("title"));if(f.optString("id").equals(old.optString("family")))selected=i;}
  TextView label=new TextView(this);label.setText(R.string.widget_choose_family);box.addView(label);
  Spinner spinner=new Spinner(this);spinner.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,names));spinner.setSelection(selected);spinner.setMinimumHeight(dp(48));box.addView(spinner);
  CheckBox mine=new CheckBox(this);mine.setText(R.string.widget_mine);mine.setChecked(old.optBoolean("mine"));mine.setMinHeight(dp(48));box.addView(mine);
  TextView purchases=new TextView(this);purchases.setText(R.string.widget_all_purchases);box.addView(purchases);
  CheckBox chats=new CheckBox(this);chats.setText(R.string.widget_show_chats);chats.setChecked(old.optBoolean("chats"));chats.setMinHeight(dp(48));box.addView(chats);
  CheckBox pinMode=new CheckBox(this);pinMode.setText(R.string.widget_pin_mode);pinMode.setMinHeight(dp(48));pinMode.setChecked(old.optJSONArray("pins")!=null&&old.optJSONArray("pins").length()>0);box.addView(pinMode);
  LinearLayout choices=new LinearLayout(this);choices.setOrientation(LinearLayout.VERTICAL);box.addView(choices);
  Button save=new Button(this);save.setText(R.string.widget_save);box.addView(save);
  Runnable loadPins=()->{
   choices.removeAllViews();choices.setVisibility(pinMode.isChecked()?View.VISIBLE:View.GONE);
   if(!pinMode.isChecked()){save.setEnabled(true);return;}
   save.setEnabled(false);int request=++generation;
   String family=families.optJSONObject(spinner.getSelectedItemPosition()).optString("id");String account=owner;
   executor.execute(()->{try{
    JSONObject data=WidgetHttp.get("?familyId="+family+"&configure=true&timezone="+java.net.URLEncoder.encode(java.time.ZoneId.systemDefault().getId(),"UTF-8"),account);
    runOnUiThread(()->{if(!current(request)||!account.equals(WidgetStore.user(this)))return;
     JSONArray items=data.optJSONArray("purchases");
     if(items==null){message.setText(R.string.widget_server_update);return;}
     for(int i=0;i<items.length();i++){
      JSONObject item=items.optJSONObject(i);CheckBox pick=new CheckBox(this);pick.setText(item.optString("title"));pick.setTag(item.optString("id"));pick.setMinHeight(dp(48));
      JSONArray oldPins=old.optJSONArray("pins");if(family.equals(old.optString("family"))&&oldPins!=null)for(int j=0;j<oldPins.length();j++)if(oldPins.optString(j).equals(pick.getTag()))pick.setChecked(true);
      choices.addView(pick);
     }
     save.setEnabled(true);message.setText(items.length()==0?R.string.widget_no_pins:R.string.widget_pin_hint);
    });
   }catch(Exception ignored){runOnUiThread(()->{if(current(request))message.setText(R.string.widget_config_error);});}});
  };
  pinMode.setOnCheckedChangeListener((b,checked)->{++generation;loadPins.run();});
  spinner.setOnItemSelectedListener(new AdapterView.OnItemSelectedListener(){public void onItemSelected(AdapterView<?> parent,View v,int pos,long id){loadPins.run();}public void onNothingSelected(AdapterView<?> p){}});
  save.setOnClickListener(v->{try{
   String family=families.getJSONObject(spinner.getSelectedItemPosition()).getString("id");
   if(!WidgetStore.validID(family))throw new IllegalArgumentException();
   JSONArray pins=new JSONArray();if(pinMode.isChecked())for(int i=0;i<choices.getChildCount();i++){CheckBox pick=(CheckBox)choices.getChildAt(i);if(pick.isChecked())pins.put(pick.getTag());}
   if(pinMode.isChecked()&&(pins.length()==0||pins.length()>3)){message.setText(R.string.widget_pin_hint);return;}
   WidgetStore.configure(this,widgetId,family,mine.isChecked(),chats.isChecked(),pins,owner);FamilyWidgetProvider.render(this,widgetId);FamilyWidgetWorker.refresh(this);
   setResult(RESULT_OK,new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,widgetId));finish();
  }catch(Exception ignored){message.setText(R.string.widget_config_error);}});
 }
 private int dp(int value){return (int)(value*getResources().getDisplayMetrics().density);}
 @Override public void onDestroy(){executor.shutdownNow();super.onDestroy();}
}
