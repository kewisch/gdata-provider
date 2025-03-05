/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2020 */

async function migrate() {
  let legacyprefs = await messenger.gdata.getLegacyPrefs();
  if (legacyprefs) {
    console.log("[gdata-provider] Migrating legacy prefs", legacyprefs); // eslint-disable-line no-console
    await messenger.storage.local.set(legacyprefs);
    await messenger.gdata.purgeLegacyPrefs();
  }
}

browser.runtime.onInstalled.addListener(({ reason, previousVersion }) => {
  let versionParts = previousVersion?.split(".") || [];
  let majorMinorVersion = parseInt(versionParts[0] + versionParts[1], 10);

  if (reason == "update" && majorMinorVersion < 1281) {
    browser.tabs.create({ url: "/onboarding/changes-128.html" });
  } else if (reason == "install") {
    browser.tabs.create({ url: "/onboarding/welcome.html" });
  }
});

migrate();
