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

migrate();
