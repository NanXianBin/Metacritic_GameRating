package com.nanxian.metacritic;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageInstaller;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.view.WindowInsets;
import android.view.WindowInsetsController;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Metacritic 游戏评分 —— Android 客户端。
 * 开发者：南仙
 *
 * 界面由本地 assets 中的 HTML/CSS/JS 渲染，原生层只负责两件事：
 * 1) 通过 cn.bing.com 的免费接口翻译（App 内不使用任何大模型翻译）；
 * 2) 抓取并解析 Metacritic 详情页，补全简介、开发商与平台信息。
 */
public class MainActivity extends Activity {

    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    private static final String ACTION_INSTALL_COMMIT = "com.nanxian.metacritic.INSTALL_COMMIT";

    private WebView web;
    private FrameLayout root;
    private String bingIg;
    private String bingToken;
    private String bingKey;
    private long bingAt;
    private final Map<String, String> httpResults = new ConcurrentHashMap<>();
    private final ExecutorService httpPool = Executors.newFixedThreadPool(6);
    private volatile boolean downloadCancelled = false;
    private volatile HttpURLConnection downloadConnection = null;
    private BroadcastReceiver installReceiver = null;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        Window window = getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(Color.TRANSPARENT);
        window.setNavigationBarColor(Color.TRANSPARENT);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            window.setDecorFitsSystemWindows(false);
        }

        root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#0B0618"));

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#0B0618"));
        WebSettings settings = web.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setSupportZoom(false);
        settings.setBuiltInZoomControls(false);
        settings.setMediaPlaybackRequiresUserGesture(false);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        }
        web.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                int accent = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
                        ? getColor(android.R.color.system_accent1_500)
                        : 0xFF4D6BFE;
                String hex = String.format("#%06X", 0xFFFFFF & accent);
                view.evaluateJavascript(
                        "window.__dynamicColors&&window.__dynamicColors({accent:'" + hex + "'})", null);
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");

        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Android 12 edge-to-edge: draw behind the system bars, pad the content
        // so the WebView never sits under the status/navigation bar.
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            android.graphics.Insets bars = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            return insets;
        });

        web.loadUrl("file:///android_asset/www/index.html");
    }

    @Override
    public void onBackPressed() {
        // Let the web layer decide first (detail -> list), then fall back to exit.
        web.evaluateJavascript(
                "(function(){if(window.__appBack&&window.__appBack()){return '1';}return '0';})()",
                value -> {
                    boolean handled = value != null && (value.contains("1") || value.contains("true"));
                    if (!handled) {
                        MainActivity.super.onBackPressed();
                    }
                });
    }

    private class Bridge {
        @JavascriptInterface
        public void translate(final String text, final String mode, final String id) {
            new Thread(() -> {
                String result = null;
                try {
                    result = bingTranslate(text);
                } catch (Exception ignored) {
                }
                final String payload = result == null ? "null" : JSONObject.quote(result);
                runOnUiThread(() -> web.evaluateJavascript(
                        "window.__nativeTranslate(" + JSONObject.quote(id) + "," + payload + ")", null));
            }).start();
        }

        @JavascriptInterface
        public void detail(final String slug, final String id) {
            new Thread(() -> {
                JSONObject result = null;
                try {
                    result = fetchDetail(slug);
                } catch (Exception ignored) {
                }
                final String payload = result == null ? "null" : result.toString();
                runOnUiThread(() -> web.evaluateJavascript(
                        "window.__nativeDetail(" + JSONObject.quote(id) + "," + payload + ")", null));
            }).start();
        }

        @JavascriptInterface
        public void toast(final String message) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, message, Toast.LENGTH_SHORT).show());
        }

        @JavascriptInterface
        public void openUrl(String url) {
            try {
                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(intent);
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String getVersionName() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception error) {
                return "";
            }
        }

        @JavascriptInterface
        public void setTheme(final boolean light) {
            runOnUiThread(() -> {
                if (root != null) {
                    root.setBackgroundColor(light ? Color.parseColor("#F4F5F7") : Color.parseColor("#0B0618"));
                }
                WindowInsetsController controller = getWindow().getInsetsController();
                if (controller != null) {
                    int mask = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                            | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                    controller.setSystemBarsAppearance(light ? mask : 0, mask);
                }
            });
        }

        @JavascriptInterface
        public void httpGet(final String url, final String id) {
            httpPool.execute(() -> {
                int status = 0;
                String body = "";
                try {
                    HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
                    connection.setConnectTimeout(20000);
                    connection.setReadTimeout(25000);
                    connection.setInstanceFollowRedirects(true);
                    connection.setRequestProperty("User-Agent", UA);
                    connection.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
                    connection.setRequestProperty("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,*/*;q=0.7");
                    connection.setRequestProperty("Referer", "https://www.metacritic.com/");
                    connection.setRequestProperty("Cache-Control", "no-cache");
                    status = connection.getResponseCode();
                    InputStream input = status >= 400 ? connection.getErrorStream() : connection.getInputStream();
                    if (input != null) {
                        body = read(input);
                    }
                } catch (Exception ignored) {
                }
                httpResults.put(id, body);
                final int code = status;
                runOnUiThread(() -> web.evaluateJavascript(
                        "window.__onHttp(" + JSONObject.quote(id) + "," + code + ")", null));
            });
        }

        @JavascriptInterface
        public String takeHttp(String id) {
            String body = httpResults.remove(id);
            return body == null ? "" : body;
        }

        @JavascriptInterface
        public void saveState(String json) {
            try (FileOutputStream out = new FileOutputStream(new File(getFilesDir(), "state.json"))) {
                out.write(json.getBytes(StandardCharsets.UTF_8));
            } catch (Exception ignored) {
            }
        }

        @JavascriptInterface
        public String loadState() {
            File file = new File(getFilesDir(), "state.json");
            if (!file.exists()) {
                return null;
            }
            try {
                return new String(Files.readAllBytes(file.toPath()), StandardCharsets.UTF_8);
            } catch (Exception error) {
                return null;
            }
        }

        @JavascriptInterface
        public void downloadApk(final String directUrl, final String proxyUrl, final String pageUrl) {
            downloadCancelled = false;
            new Thread(() -> {
                File apk = new File(getCacheDir(), "update.apk");
                boolean ok = tryDownload(directUrl, apk, "直连");
                if (!ok && !downloadCancelled) {
                    ok = tryDownload(proxyUrl, apk, "代理");
                }
                if (downloadCancelled) {
                    sendDownloadState("cancelled", 0, "已取消下载");
                    return;
                }
                if (!ok) {
                    sendDownloadState("fallback", 0, "下载失败，正在打开浏览器");
                    runOnUiThread(() -> openUrl(pageUrl));
                    return;
                }
                sendDownloadState("installing", 100, "下载完成，正在安装…");
                installApk(apk);
            }).start();
        }

        @JavascriptInterface
        public void cancelDownload() {
            downloadCancelled = true;
            HttpURLConnection connection = downloadConnection;
            if (connection != null) {
                try {
                    connection.disconnect();
                } catch (Exception ignored) {
                }
            }
        }
    }

    // ------------------------------------------------------------------
    // Bing 免费翻译（cn.bing.com/translator）
    // ------------------------------------------------------------------

    private void ensureBing() throws Exception {
        if (bingIg != null && System.currentTimeMillis() - bingAt < 50L * 60L * 1000L) {
            return;
        }
        String html = get("https://cn.bing.com/translator", null);
        Matcher ig = Pattern.compile("IG:\"([0-9A-F]+)\"").matcher(html);
        Matcher helper = Pattern.compile(
                "params_AbusePreventionHelper\\s*=\\s*\\[(\\d+),\"([^\"]+)\",(\\d+)\\]").matcher(html);
        if (!ig.find() || !helper.find()) {
            throw new Exception("Bing token not found");
        }
        bingIg = ig.group(1);
        bingKey = helper.group(1);
        bingToken = helper.group(2);
        bingAt = System.currentTimeMillis();
    }

    private String bingTranslate(String text) throws Exception {
        ensureBing();
        String body = "fromLang=en&to=zh-Hans&text=" + URLEncoder.encode(text, "UTF-8")
                + "&token=" + URLEncoder.encode(bingToken, "UTF-8")
                + "&key=" + URLEncoder.encode(bingKey, "UTF-8");
        String url = "https://cn.bing.com/ttranslatev3?isVertical=1&&IG=" + bingIg
                + "&IID=translator.5028.1";
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(25000);
        connection.setRequestProperty("User-Agent", UA);
        connection.setRequestProperty("Content-Type", "application/x-www-form-urlencoded");
        connection.setRequestProperty("Referer", "https://cn.bing.com/translator");
        connection.setRequestProperty("Accept-Language", "zh-CN,zh;q=0.9,en;q=0.8");
        connection.setDoOutput(true);
        try (OutputStream out = connection.getOutputStream()) {
            out.write(body.getBytes(StandardCharsets.UTF_8));
        }
        String response = read(connection.getInputStream());
        JSONArray array = new JSONArray(response);
        return array.getJSONObject(0).getJSONArray("translations").getJSONObject(0).getString("text");
    }

    // ------------------------------------------------------------------
    // Metacritic 详情
    // ------------------------------------------------------------------

    private JSONObject fetchDetail(String slug) throws Exception {
        String url = "https://www.metacritic.com/game/" + slug + "/";
        String html = get(url, "https://www.metacritic.com/");
        JSONObject out = new JSONObject();

        Matcher ld = Pattern.compile(
                "<script type=\"application/ld\\+json\">([\\s\\S]*?)</script>").matcher(html);
        if (ld.find()) {
            try {
                JSONObject json = new JSONObject(ld.group(1));
                out.put("description", json.optString("description", ""));
                out.put("releaseDate", json.optString("datePublished", ""));
                out.put("publisher", joinObjects(json.optJSONArray("publisher")));
                out.put("platforms", joinStrings(json.optJSONArray("gamePlatform")));
                out.put("genres", joinStrings(json.optJSONArray("genre")));
            } catch (Exception ignored) {
            }
        }

        Matcher dev = Pattern.compile(
                "(?s)Developer.{0,700}?<a[^>]+href=\"[^\"]*/company/[^\"]*\"[^>]*>([^<]+)</a>")
                .matcher(html);
        if (dev.find()) {
            out.put("developer", dev.group(1).trim());
        }

        Matcher user = Pattern.compile(
                "\"userScoreSummary\"\\s*:\\s*\\{[^}]*?\"score\"\\s*:\\s*([0-9]+(?:\\.[0-9]+)?)")
                .matcher(html);
        if (user.find()) {
            out.put("userScore", user.group(1));
        }
        Matcher count = Pattern.compile(
                "\"userScoreSummary\"\\s*:\\s*\\{[^}]*?\"reviewCount\"\\s*:\\s*(\\d+)")
                .matcher(html);
        if (count.find()) {
            out.put("userCount", count.group(1));
        }
        return out;
    }

    private String joinObjects(JSONArray array) {
        if (array == null) return "";
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < array.length(); i++) {
            try {
                JSONObject item = array.getJSONObject(i);
                String name = item.optString("name", "");
                if (name.isEmpty()) continue;
                if (builder.length() > 0) builder.append("、");
                builder.append(name);
            } catch (Exception ignored) {
            }
        }
        return builder.toString();
    }

    private String joinStrings(JSONArray array) {
        if (array == null) return "";
        StringBuilder builder = new StringBuilder();
        for (int i = 0; i < array.length(); i++) {
            String value = array.optString(i, "");
            if (value.isEmpty()) continue;
            if (builder.length() > 0) builder.append("、");
            builder.append(value);
        }
        return builder.toString();
    }

    private String get(String url, String referer) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(25000);
        connection.setRequestProperty("User-Agent", UA);
        connection.setRequestProperty("Accept-Language", "en-US,en;q=0.9");
        if (referer != null) connection.setRequestProperty("Referer", referer);
        return read(connection.getInputStream());
    }

    private boolean tryDownload(String url, File target, String label) {
        if (downloadCancelled) return false;
        HttpURLConnection connection = null;
        try {
            connection = (HttpURLConnection) new URL(url).openConnection();
            downloadConnection = connection;
            connection.setConnectTimeout(20000);
            connection.setReadTimeout(60000);
            connection.setInstanceFollowRedirects(true);
            connection.setRequestProperty("User-Agent", UA);
            connection.setRequestProperty("Accept", "application/vnd.android.package-archive,*/*");
            int status = connection.getResponseCode();
            if (status != 200) return false;
            long total = connection.getContentLengthLong();
            if (total > 0 && total < 500000L) return false;
            try (InputStream input = connection.getInputStream();
                 FileOutputStream output = new FileOutputStream(target)) {
                byte[] buffer = new byte[64 * 1024];
                long done = 0;
                int read;
                int lastPercent = -1;
                while ((read = input.read(buffer)) != -1) {
                    if (downloadCancelled) return false;
                    output.write(buffer, 0, read);
                    done += read;
                    int percent = total > 0 ? (int) (done * 100 / total) : -1;
                    if (percent != lastPercent) {
                        lastPercent = percent;
                        sendDownloadState("downloading", Math.max(0, percent), label + "下载中");
                    }
                }
            }
            if (target.length() < 500000L) return false;
            try (FileInputStream input = new FileInputStream(target)) {
                byte[] head = new byte[2];
                if (input.read(head) != 2 || head[0] != 'P' || head[1] != 'K') return false;
            }
            return true;
        } catch (Exception error) {
            return false;
        } finally {
            if (connection != null) connection.disconnect();
            downloadConnection = null;
        }
    }

    private void sendDownloadState(String status, int percent, String message) {
        final String script = "window.__downloadProgress&&window.__downloadProgress({status:"
                + JSONObject.quote(status) + ",percent:" + percent + ",message:" + JSONObject.quote(message) + "})";
        runOnUiThread(() -> web.evaluateJavascript(script, null));
    }

    private void installApk(File apk) {
        try {
            PackageInstaller installer = getPackageManager().getPackageInstaller();
            PackageInstaller.SessionParams params = new PackageInstaller.SessionParams(
                    PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            int sessionId = installer.createSession(params);
            PackageInstaller.Session session = installer.openSession(sessionId);
            try (InputStream input = new FileInputStream(apk);
                 OutputStream output = session.openWrite("update.apk", 0, apk.length())) {
                byte[] buffer = new byte[64 * 1024];
                int read;
                while ((read = input.read(buffer)) != -1) {
                    output.write(buffer, 0, read);
                }
                session.fsync(output);
            }
            Intent resultIntent = new Intent(ACTION_INSTALL_COMMIT);
            int flags = PendingIntent.FLAG_UPDATE_CURRENT;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                flags |= PendingIntent.FLAG_MUTABLE;
            }
            PendingIntent pending = PendingIntent.getBroadcast(this, sessionId, resultIntent, flags);
            if (installReceiver == null) {
                installReceiver = new BroadcastReceiver() {
                    @Override
                    public void onReceive(Context context, Intent intent) {
                        int status = intent.getIntExtra(PackageInstaller.EXTRA_STATUS,
                                PackageInstaller.STATUS_FAILURE);
                        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
                            Intent confirm = intent.getParcelableExtra(Intent.EXTRA_INTENT);
                            if (confirm != null) {
                                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                                startActivity(confirm);
                            }
                            sendDownloadState("confirm", 100, "请在系统弹窗中确认安装");
                        } else if (status == PackageInstaller.STATUS_SUCCESS) {
                            sendDownloadState("done", 100, "安装完成");
                        } else {
                            String message = intent.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
                            sendDownloadState("error", 0, "安装失败：" + (message == null ? "未知错误" : message));
                        }
                    }
                };
                IntentFilter filter = new IntentFilter(ACTION_INSTALL_COMMIT);
                if (Build.VERSION.SDK_INT >= 33) {
                    registerReceiver(installReceiver, filter, Context.RECEIVER_EXPORTED);
                } else {
                    registerReceiver(installReceiver, filter);
                }
            }
            session.commit(pending.getIntentSender());
            session.close();
        } catch (Exception error) {
            sendDownloadState("error", 0, "安装失败：" + error.getMessage());
        }
    }

    private String read(InputStream input) throws Exception {
        StringBuilder builder = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(input, StandardCharsets.UTF_8))) {
            char[] buffer = new char[8192];
            int read;
            while ((read = reader.read(buffer)) != -1) {
                builder.append(buffer, 0, read);
            }
        }
        return builder.toString();
    }
}
