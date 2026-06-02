/**
 * Patch projets natifs Android / iOS : AdMob, deep links auth, ATT iOS.
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

const ANDROID_LAUNCH_STYLES = `    <!-- Plein écran : évite l'icône minuscule Android 12 (Theme.SplashScreen + animatedIcon). -->
    <style name="AppTheme.NoActionBarLaunch" parent="AppTheme.NoActionBar">
        <item name="android:background">@drawable/splash_screen</item>
        <item name="android:windowFullscreen">true</item>
        <item name="android:windowDrawsSystemBarBackgrounds">true</item>
        <item name="android:statusBarColor">@color/splash_background</item>
        <item name="android:navigationBarColor">@color/splash_background</item>
    </style>
`;

function patchAndroidSplash() {
  const resDir = path.join(root, "android", "app", "src", "main", "res");
  const splashScreenPath = path.join(resDir, "drawable", "splash_screen.xml");
  const stylesPath = path.join(resDir, "values", "styles.xml");
  const colorsPath = path.join(resDir, "values", "colors.xml");

  if (!fs.existsSync(splashScreenPath)) {
    fs.mkdirSync(path.dirname(splashScreenPath), { recursive: true });
    fs.writeFileSync(splashScreenPath, SPLASH_SCREEN_XML);
    console.log("Android: splash_screen.xml créé");
  }

  if (fs.existsSync(stylesPath)) {
    let styles = fs.readFileSync(stylesPath, "utf8");
    if (styles.includes("Theme.SplashScreen") || styles.includes("windowSplashScreenAnimatedIcon")) {
      styles = styles.replace(
        /<!-- Android 12\+[\s\S]*?<\/style>\s*\n\s*<\/resources>/,
        `${ANDROID_LAUNCH_STYLES}\n</resources>`
      );
      if (styles.includes("Theme.SplashScreen")) {
        styles = styles.replace(
          /<style name="AppTheme\.NoActionBarLaunch" parent="Theme\.SplashScreen">[\s\S]*?<\/style>/,
          ANDROID_LAUNCH_STYLES.trim()
        );
      }
      fs.writeFileSync(stylesPath, styles);
      console.log("Android: thème splash plein écran appliqué");
    }
  }

  if (fs.existsSync(colorsPath) && !fs.readFileSync(colorsPath, "utf8").includes("splash_background")) {
    let colors = fs.readFileSync(colorsPath, "utf8");
    colors = colors.replace(
      "</resources>",
      `    <color name="splash_background">#0A0F1C</color>\n</resources>`
    );
    fs.writeFileSync(colorsPath, colors);
    console.log("Android: splash_background ajouté");
  }
}

function patchAndroid() {
  const manifestPath = path.join(root, "android", "app", "src", "main", "AndroidManifest.xml");
  const stringsPath = path.join(root, "android", "app", "src", "main", "res", "values", "strings.xml");

  if (!fs.existsSync(manifestPath)) {
    console.log("Android: AndroidManifest.xml absent — skip");
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

  patchAndroidSplash();
}

function plistInsertAfterDict(plist, insert) {
  if (plist.includes(insert.trim().split("\n")[0])) return plist;
  return plist.replace("<dict>", `<dict>\n${insert}`);
}

function patchIos() {
  const plistPath = path.join(root, "ios", "App", "App", "Info.plist");
  if (!fs.existsSync(plistPath)) {
    console.log("iOS: Info.plist absent — skip");
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
