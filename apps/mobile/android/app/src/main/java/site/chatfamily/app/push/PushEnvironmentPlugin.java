package site.chatfamily.app.push;

import android.content.Context;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.*;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import java.util.UUID;

@CapacitorPlugin(name="PushEnvironment")
public class PushEnvironmentPlugin extends Plugin {
    @PluginMethod public void status(PluginCall call) {
        var prefs=getContext().getSharedPreferences("push-installation",Context.MODE_PRIVATE);
        String id=prefs.getString("id",null);
        if(id==null) { id=UUID.randomUUID().toString(); prefs.edit().putString("id",id).apply(); }
        JSObject result=new JSObject();
        result.put("installationId",id);
        result.put("bridgeVersion",3);
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
