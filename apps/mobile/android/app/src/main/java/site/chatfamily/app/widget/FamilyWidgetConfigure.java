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
 @Override public void onCreate(Bundle state){
  super.onCreate(state);setResult(RESULT_CANCELED);
  widgetId=getIntent().getIntExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,AppWidgetManager.INVALID_APPWIDGET_ID);
  boolean exists=false;for(int id:FamilyWidgetProvider.ids(this))if(id==widgetId)exists=true;
  if(!exists){finish();return;}
  LinearLayout box=new LinearLayout(this);box.setOrientation(LinearLayout.VERTICAL);int pad=(int)(20*getResources().getDisplayMetrics().density);box.setPadding(pad,pad,pad,pad);
  ScrollView scroll=new ScrollView(this);scroll.addView(box);setContentView(scroll);
  TextView title=new TextView(this);title.setText(R.string.widget_name);title.setTextSize(24);box.addView(title);
  TextView message=new TextView(this);message.setText(R.string.widget_loading);box.addView(message);
  owner=WidgetStore.user(this);
  if(owner.isEmpty()){message.setText(R.string.widget_sign_in);return;}
  executor.execute(()->{
   try{
    JSONObject data=WidgetHttp.get("",owner);families=data.getJSONArray("families");
    runOnUiThread(()->{if(!isFinishing()&&!isDestroyed())showOptions(box,message);});
   }catch(Exception ignored){runOnUiThread(()->{if(!isFinishing())message.setText(R.string.widget_config_error);});}
  });
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
  Button save=new Button(this);save.setText(R.string.widget_save);box.addView(save);
  save.setOnClickListener(v->{try{
   String family=families.getJSONObject(spinner.getSelectedItemPosition()).getString("id");
   if(!WidgetStore.validID(family))throw new IllegalArgumentException();
   WidgetStore.configure(this,widgetId,family,mine.isChecked(),owner);FamilyWidgetProvider.render(this,widgetId);FamilyWidgetWorker.refresh(this);
   setResult(RESULT_OK,new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,widgetId));finish();
  }catch(Exception ignored){message.setText(R.string.widget_config_error);}});
 }
 private int dp(int value){return (int)(value*getResources().getDisplayMetrics().density);}
 @Override public void onDestroy(){executor.shutdownNow();super.onDestroy();}
}
