/**
 * Imports dynamiques Capacitor (native uniquement).
 * Évite les imports statiques qui casseraient la version web.
 */
import { isNativeApp } from "./platform.js";

const CAPACITOR_APP =
  "https://esm.sh/@capacitor/app@8.0.0?deps=@capacitor/core@8.3.4";
const CAPACITOR_BROWSER =
  "https://esm.sh/@capacitor/browser@8.0.0?deps=@capacitor/core@8.3.4";
const CAPACITOR_ADMOB =
  "https://esm.sh/@capacitor-community/admob@8.0.0?deps=@capacitor/core@8.3.4";

export async function loadCapacitorApp() {
  if (!isNativeApp()) return null;
  return import(/* @vite-ignore */ CAPACITOR_APP);
}

export async function loadCapacitorBrowser() {
  if (!isNativeApp()) return null;
  return import(/* @vite-ignore */ CAPACITOR_BROWSER);
}

export async function loadCapacitorAdMob() {
  if (!isNativeApp()) return null;
  return import(/* @vite-ignore */ CAPACITOR_ADMOB);
}
