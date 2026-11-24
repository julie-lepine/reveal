/**
 * Liste SKAdNetwork demandée par Google AdMob pour iOS (Google + acheteurs tiers).
 * Permet aux annonceurs de mesurer leurs résultats quand le joueur refuse le suivi :
 * sans elle, moins d'annonceurs enchérissent sur la bannière (revenu iOS plus bas).
 *
 * Source : https://developers.google.com/admob/ios/quick-start (« Update your Info.plist »)
 * et https://developers.google.com/admob/ios/3p-skadnetworks — liste du 30 janvier 2026.
 * Pour la mettre à jour : remplacer le tableau, puis `npm run cap:sync`.
 */
export const ADMOB_SKADNETWORK_IDS = [
  "cstr6suwn9.skadnetwork",
  "4fzdc2evr5.skadnetwork",
  "2fnua5tdw4.skadnetwork",
  "ydx93a7ass.skadnetwork",
  "p78axxw29g.skadnetwork",
  "v72qych5uu.skadnetwork",
  "ludvb6z3bs.skadnetwork",
  "cp8zw746q7.skadnetwork",
  "3sh42y64q3.skadnetwork",
  "c6k4g5qg8m.skadnetwork",
  "s39g8k73mm.skadnetwork",
  "wg4vff78zm.skadnetwork",
  "3qy4746246.skadnetwork",
  "f38h382jlk.skadnetwork",
  "hs6bdukanm.skadnetwork",
  "mlmmfzh3r3.skadnetwork",
  "v4nxqhlyqp.skadnetwork",
  "wzmmz9fp6w.skadnetwork",
  "su67r6k2v3.skadnetwork",
  "yclnxrl5pm.skadnetwork",
  "t38b2kh725.skadnetwork",
  "7ug5zh24hu.skadnetwork",
  "gta9lk7p23.skadnetwork",
  "vutu7akeur.skadnetwork",
  "y5ghdn5j9k.skadnetwork",
  "v9wttpbfk9.skadnetwork",
  "n38lu8286q.skadnetwork",
  "47vhws6wlr.skadnetwork",
  "kbd757ywx3.skadnetwork",
  "9t245vhmpl.skadnetwork",
  "a2p9lx4jpn.skadnetwork",
  "22mmun2rn5.skadnetwork",
  "44jx6755aq.skadnetwork",
  "k674qkevps.skadnetwork",
  "4468km3ulz.skadnetwork",
  "2u9pt9hc89.skadnetwork",
  "8s468mfl3y.skadnetwork",
  "klf5c3l5u5.skadnetwork",
  "ppxm28t8ap.skadnetwork",
  "kbmxgpxpgc.skadnetwork",
  "uw77j35x4d.skadnetwork",
  "578prtvx9j.skadnetwork",
  "4dzt52r2t5.skadnetwork",
  "tl55sbb4fm.skadnetwork",
  "c3frkrj4fj.skadnetwork",
  "e5fvkxwrpn.skadnetwork",
  "8c4e2ghe7u.skadnetwork",
  "3rd42ekr43.skadnetwork",
  "97r2b46745.skadnetwork",
  "3qcr597p9d.skadnetwork",
];

function itemXml(id) {
  return `\t\t<dict>\n\t\t\t<key>SKAdNetworkIdentifier</key>\n\t\t\t<string>${id}</string>\n\t\t</dict>\n`;
}

/**
 * Ajoute à Info.plist les identifiants manquants (idempotent).
 * - pas de clé SKAdNetworkItems : insère la liste complète juste après `<dict>` ;
 * - clé présente : ajoute seulement les identifiants absents en fin de tableau.
 * Retourne { plist, added } (added = nombre d'identifiants ajoutés).
 */
export function addSkAdNetworkItems(plist, ids = ADMOB_SKADNETWORK_IDS) {
  const keyRe = /<key>SKAdNetworkItems<\/key>\s*<array>([\s\S]*?)<\/array>/i;
  const match = plist.match(keyRe);

  if (!match) {
    const block = `\t<key>SKAdNetworkItems</key>\n\t<array>\n${ids.map(itemXml).join("")}\t</array>\n`;
    const idx = plist.indexOf("<dict>");
    if (idx < 0) return { plist, added: 0 };
    const at = idx + "<dict>".length;
    return { plist: `${plist.slice(0, at)}\n${block}${plist.slice(at)}`, added: ids.length };
  }

  const existing = match[1].toLowerCase();
  const missing = ids.filter((id) => !existing.includes(`<string>${id.toLowerCase()}</string>`));
  if (!missing.length) return { plist, added: 0 };

  const closeAt = match.index + match[0].lastIndexOf("</array>");
  const next = `${plist.slice(0, closeAt)}${missing.map(itemXml).join("")}${plist.slice(closeAt)}`;
  return { plist: next, added: missing.length };
}
