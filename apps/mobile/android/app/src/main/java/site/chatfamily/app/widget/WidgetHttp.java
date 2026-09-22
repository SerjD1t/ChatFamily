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
  return request(query,expected,false);
 }
 // Only the foreground configuration screen may discover the current account.
 static JSONObject discover()throws Exception {return request("","",true);}
 private static JSONObject request(String query,String expected,boolean discover)throws Exception {
  return request("/api/v1/mobile/widget"+query,expected,discover,null);
 }
 static JSONObject check(String family,String item,String expected,JSONObject body)throws Exception {
  if(!WidgetStore.validID(family)||!WidgetStore.validID(item)||!WidgetStore.validID(expected))throw new Status(400);
  return request("/api/v1/families/"+family+"/needs/"+item,expected,false,body);
 }
 private static JSONObject request(String path,String expected,boolean discover,JSONObject body)throws Exception {
  String cookie=CookieManager.getInstance().getCookie(ORIGIN);
  if(cookie==null||!cookie.contains("family_session="))throw new Status(401);
  HttpURLConnection conn=(HttpURLConnection)new URL(ORIGIN+path).openConnection();
  try {
   conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(8000);conn.setReadTimeout(10000);
   conn.setRequestProperty("Cookie",cookie);conn.setRequestProperty("X-Expected-User",expected);
   if(body!=null){
    conn.setRequestMethod("PATCH");conn.setRequestProperty("Content-Type","application/json");conn.setRequestProperty("Origin",ORIGIN);conn.setDoOutput(true);
    try(java.io.OutputStream out=conn.getOutputStream()){out.write(body.toString().getBytes(StandardCharsets.UTF_8));}
   }
   if(conn.getResponseCode()!=200)throw new Status(conn.getResponseCode());
   try(InputStream in=conn.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
    byte[] buf=new byte[4096];int n;
    while((n=in.read(buf))!=-1){if(out.size()+n>524288)throw new Status(413);out.write(buf,0,n);}
    JSONObject data=new JSONObject(new String(out.toByteArray(),StandardCharsets.UTF_8));
    // Do not accept a response from a session replaced while the request was running.
    if(!WidgetPolicy.acceptsAccount(expected,body==null?data.optString("userId"):expected,discover,cookie,CookieManager.getInstance().getCookie(ORIGIN)))throw new Status(409);
    return data;
   }
  }finally{conn.disconnect();}
 }
}
