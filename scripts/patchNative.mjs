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
