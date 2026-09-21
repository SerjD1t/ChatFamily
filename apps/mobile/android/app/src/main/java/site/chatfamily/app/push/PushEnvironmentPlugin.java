package site.chatfamily.app.push;

import android.content.Context;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import java.util.UUID;

@CapacitorPlugin(name="PushEnvironment")
public class PushEnvironmentPlugin extends Plugin {
    @PluginMethod public void setBadge(PluginCall call) {
        Integer count=call.getInt("count");
        if(count==null || count<0) {call.reject("Invalid count");return;}
        NotificationManager manager=getContext().getSystemService(NotificationManager.class);
        // Remove only messaging notifications, never upload/update notifications.
        for(var item:manager.getActiveNotifications()) {
            String tag=item.getTag();
            if(tag!=null && tag.startsWith("chat-"))manager.cancel(tag,item.getId());
        }
        if(count==0 || !NotificationManagerCompat.from(getContext()).areNotificationsEnabled()) {call.resolve();return;}
        if(Build.VERSION.SDK_INT>=26) {
            NotificationChannel channel=new NotificationChannel("chat_badge","Unread messages",NotificationManager.IMPORTANCE_LOW);
            channel.setShowBadge(true);manager.createNotificationChannel(channel);
        }
        Intent intent=getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
        if(intent==null){call.resolve();return;}
        PendingIntent launch=PendingIntent.getActivity(getContext(),701,intent,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        var notification=new NotificationCompat.Builder(getContext(),"chat_badge")
            .setSmallIcon(site.chatfamily.app.R.drawable.ic_stat_chat).setContentTitle("ChatFamily")
            .setContentText(String.valueOf(count)).setNumber(count).setOnlyAlertOnce(true).setSilent(true)
            .setContentIntent(launch).setAutoCancel(true).build();
        try {manager.notify("chat-unread",0,notification);call.resolve();}
        catch(SecurityException ignored){call.resolve();}
    }
    @PluginMethod public void status(PluginCall call) {
        if(Build.VERSION.SDK_INT>=26) {
            NotificationChannel reactions=new NotificationChannel("chat_reactions","Reactions",NotificationManager.IMPORTANCE_DEFAULT);
            reactions.setShowBadge(false);
            getContext().getSystemService(NotificationManager.class).createNotificationChannel(reactions);
        }
        var prefs=getContext().getSharedPreferences("push-installation",Context.MODE_PRIVATE);
        String id=prefs.getString("id",null);
        if(id==null) { id=UUID.randomUUID().toString(); prefs.edit().putString("id",id).apply(); }
        JSObject result=new JSObject();
        result.put("installationId",id);
        result.put("bridgeVersion",4);
        result.put("appBadge",true);
        result.put("familyWidget",true);
        result.put("deviceStorage",true);
        result.put("appUpdates",true);
        result.put("remoteInterface",true);
        result.put("incomingShares",true);
        result.put("nativePush",true);
        result.put("configured",!FirebaseApp.getApps(getContext()).isEmpty());
        result.put("systemEnabled",NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(result);
    }
}
