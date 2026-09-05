import { PACK_SIGNATURE_LABEL } from "../config/premiumPacks.js";
import { isHostPack, isProfilePack } from "./entitlements.js";
import { getState } from "./state.js";
import { profileSkuForUser } from "./purchases.js";
import { PLAY_PRODUCT_ID_PROFILE_UPGRADE } from "../../data/revenueCatConfig.js";
import {
  canBuyPremiumPacks,
  includedInHostStatus,
  premiumPackCardHtml,
} from "./premiumOfferUi.js";

const SIGNATURE_FEATURES = [
  "Ta photo dans le lobby - plus un emoji anonyme",
  "Un pseudo en couleur, rien qu’à toi",
  "Emojis Signature + carnet des 20 dernières soirées (rangs, carte à partager)",
  "Sans pub inclus",
];

/** Carte Menu → Forfaits (Signature 6,99 €). */
export function profilePackSettingsCardHtml() {
  const unlocked = isProfilePack();
  const user = getState().user || {};
  const upgrade = profileSkuForUser(user) === PLAY_PRODUCT_ID_PROFILE_UPGRADE;
  const priceLabel = upgrade ? "4,00" : "6,99";
  const canBuy = canBuyPremiumPacks();
  const includedHost = unlocked && isHostPack();

  let badge = "";
  let badgeTone = "gold";
  let price = upgrade ? "4,00 €" : "6,99 €";
  let priceSuffix = upgrade ? "de plus" : "à vie";
  let priceNote = upgrade
    ? `Tu as déjà Sans pub. ${PACK_SIGNATURE_LABEL} à vie, pubs incluses.`
    : "";
  let status = "";
  let buttonId = "";
  let buttonLabel = "";

  if (unlocked) {
    badge = includedHost ? "Inclus" : "Actif";
    badgeTone = includedHost ? "included" : "ok";
    price = "";
    priceSuffix = "";
    priceNote = "";
    status = includedHost ? includedInHostStatus() : "";
  } else if (canBuy) {
    buttonId = "btn-profile-buy";
    buttonLabel = `Débloquer Signature - ${priceLabel}&nbsp;€`;
  }

  return premiumPackCardHtml({
    icon: "✨",
    title: PACK_SIGNATURE_LABEL,
    badge,
    badgeTone,
    price,
    priceSuffix,
    priceNote,
    status,
    features: SIGNATURE_FEATURES,
    buttonId,
    buttonLabel,
    buttonPrimary: false,
  });
}
