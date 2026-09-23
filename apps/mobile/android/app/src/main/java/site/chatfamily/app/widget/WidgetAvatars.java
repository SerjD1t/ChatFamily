package site.chatfamily.app.widget;

import android.graphics.*;
import android.util.Base64;
import android.webkit.CookieManager;
import java.net.*;
import java.io.*;
import org.json.*;

/** Bounded thumbnails from our authenticated origin only. No URLs or cookies in cache. */
final class WidgetAvatars {
 private WidgetAvatars(){}
 static void load(JSONObject data){
  JSONArray chats=data.optJSONArray("chats");if(chats==null)return;
  for(int i=0;i<Math.min(5,chats.length());i++){
   JSONObject chat=chats.optJSONObject(i);if(chat==null)continue;
   String path=chat.optString("avatarUrl");chat.remove("avatarUrl");
   if(!WidgetPolicy.avatarPath(path))continue;
   String cookie=CookieManager.getInstance().getCookie(WidgetHttp.ORIGIN);if(cookie==null)return;
   HttpURLConnection conn=null;
   try{
    conn=(HttpURLConnection)new URL(WidgetHttp.ORIGIN+path).openConnection();
    conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(2000);conn.setReadTimeout(2000);conn.setRequestProperty("Cookie",cookie);
    if(conn.getResponseCode()!=200)continue;
    byte[] bytes;
    try(InputStream in=conn.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){
     byte[] buf=new byte[4096];int n;while((n=in.read(buf))!=-1){if(out.size()+n>2*1024*1024)throw new IOException();out.write(buf,0,n);}bytes=out.toByteArray();
    }
    if(!cookie.equals(CookieManager.getInstance().getCookie(WidgetHttp.ORIGIN)))return;
    BitmapFactory.Options bounds=new BitmapFactory.Options();bounds.inJustDecodeBounds=true;BitmapFactory.decodeByteArray(bytes,0,bytes.length,bounds);
    if(bounds.outWidth<=0||bounds.outHeight<=0||bounds.outWidth>8192||bounds.outHeight>8192)continue;
    BitmapFactory.Options options=new BitmapFactory.Options();options.inSampleSize=1;
    while(Math.max(bounds.outWidth,bounds.outHeight)/options.inSampleSize>192)options.inSampleSize*=2;
    Bitmap source=BitmapFactory.decodeByteArray(bytes,0,bytes.length,options);if(source==null)continue;
    Bitmap small=Bitmap.createBitmap(96,96,Bitmap.Config.ARGB_8888);Canvas canvas=new Canvas(small);
    Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG|Paint.FILTER_BITMAP_FLAG);
    BitmapShader shader=new BitmapShader(source,Shader.TileMode.CLAMP,Shader.TileMode.CLAMP);Matrix matrix=new Matrix();
    float scale=96f/Math.min(source.getWidth(),source.getHeight());matrix.setScale(scale,scale);matrix.postTranslate((96-source.getWidth()*scale)/2,(96-source.getHeight()*scale)/2);shader.setLocalMatrix(matrix);paint.setShader(shader);canvas.drawCircle(48,48,48,paint);
    try(ByteArrayOutputStream out=new ByteArrayOutputStream()){small.compress(Bitmap.CompressFormat.PNG,100,out);chat.put("avatar",Base64.encodeToString(out.toByteArray(),Base64.NO_WRAP));}
    source.recycle();small.recycle();
   }catch(Exception ignored){/* A failed picture never hides the chat. */}finally{if(conn!=null)conn.disconnect();}
  }
 }
 static Bitmap bitmap(JSONObject chat){
  try{String value=chat.optString("avatar");if(value.isEmpty()||value.length()>100000)return null;byte[] bytes=Base64.decode(value,Base64.NO_WRAP);return BitmapFactory.decodeByteArray(bytes,0,bytes.length);}catch(Exception ignored){return null;}
 }
}
