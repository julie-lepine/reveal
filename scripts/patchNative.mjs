/**
 * Patch projets natifs Android / iOS : AdMob, deep links auth, ATT iOS, ProGuard AGP 9+.
 * À lancer après `npx cap add android|ios` ou `npx cap sync`.
 */
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const ANDROID_APP_ID = "ca-app-pub-6332424645114129~4800114696";
const IOS_APP_ID = "ca-app-pub-6332424645114129~1825936767";
const URL_SCHEME = "com.reveal.partygames";

const SPLASH_SCREEN_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Fond plein écran (portrait : drawable-port-*/splash.png) -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android" android:opacity="opaque">
    <item android:drawable="@color/splash_background" />
    <item>
        <bitmap
            android:gravity="fill"
            android:src="@drawable/splash" />
    </item>
</layer-list>
`;

const SPLASH_ICON_LEGACY_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- API < 26 : pas d'adaptive-icon. -->
<inset xmlns:android="http://schemas.android.com/apk/res/android"
    android:drawable="@mipmap/ic_launcher_foreground"
    android:inset="18%" />
`;

const SPLASH_ICON_V26_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 8+ / splash 12+ : AdaptiveIconDrawable (un PNG 1024 en layer-list est recadré → « D »). -->
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/splash_background" />
    <foreground>
        <inset android:drawable="@mipmap/ic_launcher_foreground" android:inset="18%" />
    </foreground>
</adaptive-icon>
`;

const MAIN_ACTIVITY_JAVA = `package com.reveal.partygames;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
    }
}
`;

const ANDROID_LAUNCH_STYLE_BLOCK = `    <style name="AppTheme.NoActionBarLaunch" parent="Theme.SplashScreen">
        <item name="android:background">@drawable/splash_screen</item>
        <item name="windowSplashScreenBackground">@color/splash_background</item>
        <item name="windowSplashScreenAnimatedIcon">@drawable/splash_icon</item>
        <item name="windowSplashScreenIconBackgroundColor">@color/splash_background</item>
        <item name="postSplashScreenTheme">@style/AppTheme.NoActionBar</item>
        <item name="android:statusBarColor">@color/splash_background</item>
        <item name="android:navigationBarColor">@color/splash_background</item>
    </style>`;

const ANDROID_BASE_STYLES = `    <!-- Base application theme. -->
    <style name="AppTheme" parent="Theme.AppCompat.Light.DarkActionBar">
        <!-- Customize your theme here. -->
        <item name="colorPrimary">@color/colorPrimary</item>
        <item name="colorPrimaryDark">@color/colorPrimaryDark</item>
        <item name="colorAccent">@color/colorAccent</item>
    </style>

    <style name="AppTheme.NoActionBar" parent="Theme.AppCompat.DayNight.NoActionBar">
        <item name="windowActionBar">false</item>
        <item name="windowNoTitle">true</item>
        <item name="android:background">@null</item>
    </style>
`;

const ANDROID_APPLICATION_ID = "com.reveal.partygames";
const PROGUARD_LEGACY = "getDefaultProguardFile('proguard-android.txt')";
const PROGUARD_OPTIMIZE = "getDefaultProguardFile('proguard-android-optimize.txt')";

function assertAndroidApplicationId() {
  const gradlePath = path.join(root, "android", "app", "build.gradle");
  if (!fs.existsSync(gradlePath)) return;
  const gradle = fs.readFileSync(gradlePath, "utf8");
  const match = gradle.match(/applicationId\s+"([^"]+)"/);
  const applicationId = match?.[1];
  if (applicationId !== ANDROID_APPLICATION_ID) {
    throw new Error(
      `Android applicationId doit rester ${ANDROID_APPLICATION_ID} (trouvé: ${applicationId || "absent"})`
    );
  }
}

/**
 * Le plugin RevenueCat pin AGP 8.13.2 (absent du cache local). 8.13.0 est déjà
 * résolu (AdMob). Évite un fetch Maven cassé par l’inspection HTTPS (PKIX).
 */
function patchRevenueCatAgpClasspath() {
  const filePath = path.join(root, "node_modules", "@revenuecat", "purchases-capacitor", "android", "build.gradle");
  if (!fs.existsSync(filePath)) return;
  let gradle = fs.readFileSync(filePath, "utf8");
  if (!gradle.includes("com.android.tools.build:gradle:8.13.2")) return;
  gradle = gradle.replaceAll(
    "com.android.tools.build:gradle:8.13.2",
    "com.android.tools.build:gradle:8.13.0"
  );
  fs.writeFileSync(filePath, gradle);
  console.log("Android: RevenueCat AGP classpath 8.13.2 → 8.13.0");
}

/** AGP 9+ : proguard-android.txt n'est plus accepté (plugins Capacitor pas encore tous à jour). */
function patchAndroidProguardGradle() {
  const candidates = [
    path.join(root, "android", "app", "build.gradle"),
    path.join(root, "node_modules", "@capacitor-community", "admob", "android", "build.gradle"),
    path.join(root, "node_modules", "@revenuecat", "purchases-capacitor", "android", "build.gradle"),
  ];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    let gradle = fs.readFileSync(filePath, "utf8");
    if (!gradle.includes(PROGUARD_LEGACY)) continue;
    gradle = gradle.replaceAll(PROGUARD_LEGACY, PROGUARD_OPTIMIZE);
    fs.writeFileSync(filePath, gradle);
    console.log(`Android: ProGuard AGP9 → ${path.relative(root, filePath)}`);
  }
}

function patchAndroidSplash() {
  const resDir = path.join(root, "android", "app", "src", "main", "res");
  const drawableDir = path.join(resDir, "drawable");
  const splashScreenPath = path.join(drawableDir, "splash_screen.xml");
  const splashIconPath = path.join(drawableDir, "splash_icon.xml");
  const stylesPath = path.join(resDir, "values", "styles.xml");
  const colorsPath = path.join(resDir, "values", "colors.xml");
  const iconBgPath = path.join(resDir, "values", "ic_launcher_background.xml");
  const portraitSplash = path.join(root, "resources", "splash_android_1080x1920.png");

  fs.mkdirSync(drawableDir, { recursive: true });
  const drawableV26Dir = path.join(resDir, "drawable-v26");
  fs.mkdirSync(drawableV26Dir, { recursive: true });
  fs.writeFileSync(splashScreenPath, SPLASH_SCREEN_XML);
  fs.writeFileSync(splashIconPath, SPLASH_ICON_LEGACY_XML);
  fs.writeFileSync(path.join(drawableV26Dir, "splash_icon.xml"), SPLASH_ICON_V26_XML);
  console.log("Android: splash_icon.xml (legacy + drawable-v26 adaptive)");

  const robotFg = path.join(resDir, "drawable-v24", "ic_launcher_foreground.xml");
  if (fs.existsSync(robotFg)) {
    fs.unlinkSync(robotFg);
    console.log("Android: suppression icône launcher template (robot)");
  }

  if (fs.existsSync(portraitSplash)) {
    let portCount = 0;
    for (const entry of fs.readdirSync(resDir, { withFileTypes: true })) {
      if (!entry.isDirectory() || !entry.name.startsWith("drawable-port")) continue;
      fs.copyFileSync(portraitSplash, path.join(resDir, entry.name, "splash.png"));
      portCount += 1;
    }
    if (portCount > 0) {
      console.log(`Android: splash portrait + tagline → ${portCount} drawable-port*`);
    }
  }

  if (fs.existsSync(stylesPath)) {
    let styles = fs.readFileSync(stylesPath, "utf8");

    // Ne matcher que le bloc <style> (pas les commentaires précédents — évite d'avaler AppTheme).
    const launchRe = /<style name="AppTheme\.NoActionBarLaunch"[\s\S]*?<\/style>/;
    if (launchRe.test(styles)) {
      styles = styles.replace(launchRe, ANDROID_LAUNCH_STYLE_BLOCK.trim());
    } else {
      styles = styles.replace("</resources>", `\n${ANDROID_LAUNCH_STYLE_BLOCK}\n</resources>`);
    }

    if (!styles.includes('name="AppTheme"') || !styles.includes('name="AppTheme.NoActionBar"')) {
      styles = styles.replace("<resources>", `<resources>\n\n${ANDROID_BASE_STYLES}`);
    }

    fs.writeFileSync(stylesPath, styles);
    console.log("Android: Theme.SplashScreen brandé (logo R + fond #0A0F1C)");
  }

  if (fs.existsSync(colorsPath) && !fs.readFileSync(colorsPath, "utf8").includes("splash_background")) {
    let colors = fs.readFileSync(colorsPath, "utf8");
    colors = colors.replace(
      "</resources>",
      `    <!-- Fond splash REVEAL -->\n    <color name="splash_background">#0A0F1C</color>\n</resources>`
    );
    fs.writeFileSync(colorsPath, colors);
    console.log("Android: splash_background ajouté");
  }

  if (fs.existsSync(iconBgPath)) {
    const next = `<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">#0A0F1C</color>
</resources>
`;
    if (fs.readFileSync(iconBgPath, "utf8") !== next) {
      fs.writeFileSync(iconBgPath, next);
      console.log("Android: ic_launcher_background → #0A0F1C");
    }
  }
}
function patchAndroidMainActivity() {
  const javaPath = path.join(
    root,
    "android",
    "app",
    "src",
    "main",
    "java",
    "com",
    "reveal",
    "partygames",
    "MainActivity.java"
  );
  if (!fs.existsSync(javaPath)) {
    console.log("Android: MainActivity.java absent - skip");
    return;
  }
  const current = fs.readFileSync(javaPath, "utf8");
  if (current.includes("SplashScreen.installSplashScreen")) return;
  fs.writeFileSync(javaPath, MAIN_ACTIVITY_JAVA);
  console.log("Android: MainActivity installe SplashScreen avant super.onCreate");
}

function patchAndroid() {
  const manifestPath = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");
  const stringsPath = path.join(root, "android", "app", "src", "main", "res", "values", "strings.xml");

  if (!fs.existsSync(manifestPath)) {
    console.log("Android: AndroidManifest.xml absent - skip");
    return;
  }

  let manifest = fs.readFileSync(manifestPath, "utf8");

  if (!manifest.includes("com.google.android.gms.ads.APPLICATION_ID")) {
    const meta =
      `\n        <meta-data\n            android:name="com.google.android.gms.ads.APPLICATION_ID"\n            android:value="@string/admob_app_id"/>`;
    manifest = manifest.replace("</application>", `${meta}\n    </application>`);
    console.log("Android: meta-data AdMob ajouté");
  }

  if (!manifest.includes(`android:scheme="${URL_SCHEME}"`)) {
    const deepLink = `
            <intent-filter android:autoVerify="false">
                <action android:name="android.intent.action.VIEW" />
                <category android:name="android.intent.category.DEFAULT" />
                <category android:name="android.intent.category.BROWSABLE" />
                <data android:scheme="${URL_SCHEME}" android:host="auth" android:pathPrefix="/callback" />
            </intent-filter>`;
    manifest = manifest.replace(
      "</activity>",
      `${deepLink}\n\n        </activity>`
    );
    console.log("Android: deep link auth ajouté");
  }

  if (!manifest.includes("com.android.vending.BILLING")) {
    manifest = manifest.replace(
      "</manifest>",
      `    <uses-permission android:name="com.android.vending.BILLING" />\n</manifest>`
    );
    console.log("Android: permission BILLING ajoutée");
  }

  fs.writeFileSync(manifestPath, manifest);

  assertAndroidApplicationId();

  if (fs.existsSync(stringsPath)) {
    let strings = fs.readFileSync(stringsPath, "utf8");
    if (!strings.includes("admob_app_id")) {
      strings = strings.replace(
        "</resources>",
        `    <string name="admob_app_id">${ANDROID_APP_ID}</string>\n</resources>`
      );
      fs.writeFileSync(stringsPath, strings);
      console.log("Android: admob_app_id ajouté dans strings.xml");
    }
  }

  patchRevenueCatAgpClasspath();
  patchAndroidProguardGradle();
  patchAndroidSplash();
  patchAndroidMainActivity();
}

function plistInsertAfterDict(plist, insert) {
  if (plist.includes(insert.trim().split("\n")[0])) return plist;
  return plist.replace("<dict>", `<dict>\n${insert}`);
}

function patchIos() {
  const plistPath = path.join(root, "ios", "App", "App", "Info.plist");
  if (!fs.existsSync(plistPath)) {
    console.log("iOS: Info.plist absent - skip");
    return;
  }

  let plist = fs.readFileSync(plistPath, "utf8");

  if (!plist.includes("GADApplicationIdentifier")) {
    plist = plistInsertAfterDict(
      plist,
      `\t<key>GADApplicationIdentifier</key>\n\t<string>${IOS_APP_ID}</string>\n`
    );
    console.log("iOS: GADApplicationIdentifier ajouté");
  }

  if (!plist.includes("CFBundleURLTypes")) {
    const urlTypes = `\t<key>CFBundleURLTypes</key>
\t<array>
\t\t<dict>
\t\t\t<key>CFBundleURLName</key>
\t\t\t<string>${URL_SCHEME}</string>
\t\t\t<key>CFBundleURLSchemes</key>
\t\t\t<array>
\t\t\t\t<string>${URL_SCHEME}</string>
\t\t\t</array>
\t\t</dict>
\t</array>
`;
    plist = plistInsertAfterDict(plist, urlTypes);
    console.log("iOS: CFBundleURLTypes (deep link) ajouté");
  }

  if (!plist.includes("NSUserTrackingUsageDescription")) {
    const att = `\t<key>NSUserTrackingUsageDescription</key>
\t<string>REVEAL utilise cet identifiant pour afficher des publicités pertinentes. Tu peux refuser sans perdre l'accès au jeu.</string>
`;
    plist = plistInsertAfterDict(plist, att);
    console.log("iOS: NSUserTrackingUsageDescription ajouté");
  }

  fs.writeFileSync(plistPath, plist);
}

patchAndroid();
patchIos();
