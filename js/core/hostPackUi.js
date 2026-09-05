import { PACK_HOST_LABEL, PACK_SIGNATURE_LABEL } from "../config/premiumPacks.js";
import { isHostPack } from "./entitlements.js";
import { getState } from "./state.js";
import { hostSkuForUser } from "./purchases.js";
import {
  PLAY_PRODUCT_ID_HOST_UPGRADE_ADFREE,
  PLAY_PRODUCT_ID_HOST_UPGRADE_PROFILE,
} from "../../data/revenueCatConfig.js";
import { canBuyPremiumPacks, premiumPackCardHtml } from "./premiumOfferUi.js";

function hostPriceForUser(user) {
  const sku = hostSkuForUser(user);
  if (sku === PLAY_PRODUCT_ID_HOST_UPGRADE_PROFILE) return { amount: "3,00", euros: 3 };
  if (sku === PLAY_PRODUCT_ID_HOST_UPGRADE_ADFREE) return { amount: "7,00", euros: 7 };
  return { amount: "9,99", euros: 9.99 };
}

const HOST_FEATURES = [
  "14 joueurs dans le lobby (toi + 13)",
  "Tout Signature : ton profil, pas un pseudo générique",
  "Plus de pub, sur tous tes appareils",
];

/** Carte Menu → Forfaits (Maître de soirée 9,99 €). */
export function hostPackSettingsCardHtml() {
  const unlocked = isHostPack();
  const user = getState().user || {};
  const { amount, euros } = hostPriceForUser(user);
  const canBuy = canBuyPremiumPacks();

  let badge = "Le plus complet";
  let badgeTone = "gold";
  let price = "9,99 €";
  let priceSuffix = "à vie";
  let priceNote = "";
  let buttonId = "";
  let buttonLabel = "";

  if (unlocked) {
    badge = "Actif";
    badgeTone = "ok";
    price = "";
    priceSuffix = "";
  } else {
    if (euros === 3) {
      price = "3,00 €";
      priceSuffix = "de plus";
      priceNote = `Tu as déjà ${PACK_SIGNATURE_LABEL}. ${PACK_HOST_LABEL} à vie, Signature et pubs inclus.`;
    } else if (euros === 7) {
      price = "7,00 €";
      priceSuffix = "de plus";
      priceNote = `Tu as déjà Sans pub. ${PACK_HOST_LABEL} à vie, ${PACK_SIGNATURE_LABEL} et pubs inclus.`;
    }
    if (canBuy) {
      buttonId = "btn-host-buy";
      buttonLabel = `Débloquer Maître - ${amount}&nbsp;€`;
    }
  }

  return premiumPackCardHtml({
    hero: true,
    icon: "👑",
    title: PACK_HOST_LABEL,
    badge,
    badgeTone,
    price,
    priceSuffix,
    priceNote,
    features: HOST_FEATURES,
    buttonId,
    buttonLabel,
    buttonPrimary: true,
  });
}
