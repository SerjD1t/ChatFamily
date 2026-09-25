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
  TextView pinHint=new TextView(this);pinHint.setText(R.string.widget_pin_hint);box.addView(pinHint);
  CheckBox clock=new CheckBox(this);clock.setText(R.string.widget_show_clock);clock.setChecked(old.optBoolean("clock"));clock.setMinHeight(dp(48));box.addView(clock);
  TextView transparencyLabel=new TextView(this);box.addView(transparencyLabel);
  SeekBar transparency=new SeekBar(this);transparency.setMax(100);transparency.setProgress(Math.max(0,Math.min(100,old.optInt("transparency"))));transparency.setMinimumHeight(dp(48));box.addView(transparency);
  transparencyLabel.setText(getString(R.string.widget_transparency,transparency.getProgress()));transparency.setContentDescription(transparencyLabel.getText());
  transparency.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener(){
   public void onProgressChanged(SeekBar bar,int value,boolean fromUser){transparencyLabel.setText(getString(R.string.widget_transparency,value));bar.setContentDescription(transparencyLabel.getText());}
   public void onStartTrackingTouch(SeekBar bar){} public void onStopTrackingTouch(SeekBar bar){}
  });
  TextView colorLabel=new TextView(this);colorLabel.setText(R.string.widget_text_style);box.addView(colorLabel);
  Spinner textStyle=new Spinner(this);textStyle.setAdapter(new ArrayAdapter<>(this,android.R.layout.simple_spinner_dropdown_item,getResources().getStringArray(R.array.widget_text_styles)));textStyle.setSelection(Math.max(0,Math.min(2,old.optInt("textStyle"))));textStyle.setMinimumHeight(dp(48));box.addView(textStyle);
  Button save=new Button(this);save.setText(R.string.widget_save);box.addView(save);
  save.setOnClickListener(v->{try{
   String family=families.getJSONObject(spinner.getSelectedItemPosition()).getString("id");
   if(!WidgetStore.validID(family))throw new IllegalArgumentException();
   WidgetStore.configure(this,widgetId,family,mine.isChecked(),chats.isChecked(),new JSONArray(),owner,clock.isChecked(),transparency.getProgress(),textStyle.getSelectedItemPosition());FamilyWidgetProvider.render(this,widgetId);FamilyWidgetWorker.refresh(this);
   setResult(RESULT_OK,new Intent().putExtra(AppWidgetManager.EXTRA_APPWIDGET_ID,widgetId));finish();
  }catch(Exception ignored){message.setText(R.string.widget_config_error);}});
 }
 private int dp(int value){return (int)(value*getResources().getDisplayMetrics().density);}
 @Override public void onDestroy(){executor.shutdownNow();super.onDestroy();}
}
