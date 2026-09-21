package site.chatfamily.app.widget;

import android.webkit.CookieManager;
import java.net.HttpURLConnection;
import java.net.URL;
import java.io.InputStream;
import java.io.ByteArrayOutputStream;
import java.nio.charset.StandardCharsets;
import org.json.JSONObject;

final class WidgetHttp {
 static final String ORIGIN="https://www.chatfamily.site";
 static final class Status extends Exception {final int code;Status(int code){this.code=code;}}
 static JSONObject get(String query,String expected)throws Exception {
  String cookie=CookieManager.getInstance().getCookie(ORIGIN);
  if(cookie==null||!cookie.contains("family_session="))throw new Status(401);
  HttpURLConnection conn=(HttpURLConnection)new URL(ORIGIN+"/api/v1/mobile/widget"+query).openConnection();
  try {
   conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(8000);conn.setReadTimeout(10000);
   conn.setRequestProperty("Cookie",cookie);conn.setRequestProperty("X-Expected-User",expected);
   if(conn.getResponseCode()!=200)throw new Status(conn.getResponseCode());
   try(InputStream in=conn.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
    byte[] buf=new byte[4096];int n;
    while((n=in.read(buf))!=-1){if(out.size()+n>131072)throw new Status(413);out.write(buf,0,n);}
    JSONObject data=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));
    if(!expected.equals(data.optString("userId")))throw new Status(401);
    return data;
   }
  }finally{conn.disconnect();}
 }
}
