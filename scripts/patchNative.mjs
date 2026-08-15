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

const SPLASH_ICON_XML = `<?xml version="1.0" encoding="utf-8"?>
<!-- Android 12+ animatedIcon : logo R sur fond brand (évite l'icône launcher / plaque claire). -->
<layer-list xmlns:android="http://schemas.android.com/apk/res/android">
    <item android:drawable="@color/splash_background" />
    <item>
        <bitmap
            android:gravity="center"
            android:src="@drawable/splash_logo" />
    </item>
</layer-list>
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

const PROGUARD_LEGACY = "getDefaultProguardFile('proguard-android.txt')";
const PROGUARD_OPTIMIZE = "getDefaultProguardFile('proguard-android-optimize.txt')";

/** AGP 9+ : proguard-android.txt n'est plus accepté (plugins Capacitor pas encore tous à jour). */
function patchAndroidProguardGradle() {
  const candidates = [
    path.join(root, "android", "app", "build.gradle"),
    path.join(root, "node_modules", "@capacitor-community", "admob", "android", "build.gradle"),
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
  const splashLogoPath = path.join(drawableDir, "splash_logo.png");
  const stylesPath = path.join(resDir, "values", "styles.xml");
  const colorsPath = path.join(resDir, "values", "colors.xml");
  const iconBgPath = path.join(resDir, "values", "ic_launcher_background.xml");
  const iconSrc = path.join(root, "resources", "icon.png");
  const portraitSplash = path.join(root, "resources", "splash_android_1080x1920.png");

  fs.mkdirSync(drawableDir, { recursive: true });
  fs.writeFileSync(splashScreenPath, SPLASH_SCREEN_XML);
  fs.writeFileSync(splashIconPath, SPLASH_ICON_XML);
  console.log("Android: splash_screen.xml + splash_icon.xml");

  if (fs.existsSync(iconSrc)) {
    fs.copyFileSync(iconSrc, splashLogoPath);
    console.log("Android: splash_logo.png (resources/icon.png)");
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

  fs.writeFileSync(manifestPath, manifest);

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

  patchAndroidProguardGradle();
  patchAndroidSplash();
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
