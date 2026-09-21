package site.chatfamily.app;

import com.getcapacitor.BridgeActivity;
import android.os.Bundle;
import android.content.Intent;
import android.widget.Toast;
import java.util.concurrent.Executors;
import java.util.concurrent.ExecutorService;
import site.chatfamily.app.share.IncomingSharePlugin;
import site.chatfamily.app.share.ShareStore;
import site.chatfamily.app.push.PushEnvironmentPlugin;
import com.getcapacitor.BridgeWebViewClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.net.Uri;

public class MainActivity extends BridgeActivity {
    private static final ExecutorService IMPORTS=Executors.newSingleThreadExecutor();
    @Override public void onCreate(Bundle state) {
        registerPlugin(IncomingSharePlugin.class);
        registerPlugin(PushEnvironmentPlugin.class);
        registerPlugin(site.chatfamily.app.widget.FamilyWidgetPlugin.class);
        registerPlugin(site.chatfamily.app.update.AppUpdatePlugin.class);
        super.onCreate(state);
        // Do not retain Capacitor's legacy unrestricted JavaScript-interface fallback.
        bridge.getWebView().removeJavascriptInterface("androidBridge");
        bridge.getWebView().getSettings().setAllowFileAccess(false);
        bridge.getWebView().getSettings().setAllowContentAccess(false);
        bridge.getWebView().getSettings().setSupportMultipleWindows(false);
        bridge.setWebViewClient(new BridgeWebViewClient(bridge) {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return navigate(request.getUrl(),request.isForMainFrame());
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return navigate(Uri.parse(url),true);
            }
            private boolean navigate(Uri uri, boolean mainFrame) {
                if (mainFrame && ShellNavigation.internal(uri.toString())) return false;
                if (mainFrame && ShellNavigation.external(uri.toString())) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW,uri).addCategory(Intent.CATEGORY_BROWSABLE)); }
                    catch(Exception ignored) { Toast.makeText(MainActivity.this,"Не удалось открыть ссылку",Toast.LENGTH_SHORT).show(); }
                }
                return true;
            }
        });
        if(state==null) receive(getIntent());
    }
    @Override protected void onNewIntent(Intent intent) { setIntent(intent); super.onNewIntent(intent); receive(intent); }
    @Override public void onPause() { android.webkit.CookieManager.getInstance().flush(); super.onPause(); }
    private void receive(Intent intent) {
        if(intent==null || !(Intent.ACTION_SEND.equals(intent.getAction()) || Intent.ACTION_SEND_MULTIPLE.equals(intent.getAction()))) return;
        Intent incoming=new Intent(intent);
        setIntent(new Intent(this,MainActivity.class));
        Toast.makeText(this,"Подготовка вложений…",Toast.LENGTH_SHORT).show();
        IMPORTS.execute(()->{
            try { ShareStore.receive(getApplicationContext(),incoming); }
            catch(Exception e) { runOnUiThread(()->Toast.makeText(this,"Не удалось принять вложения. Проверьте доступ и лимит 25 МиБ на файл (до 10 файлов).",Toast.LENGTH_LONG).show()); }
        });
    }
}
