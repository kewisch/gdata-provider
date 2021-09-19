/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2020 */

const { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
const { cal } = ChromeUtils.import("resource:///modules/calendar/calUtils.jsm");

const { ExtensionAPI } = ExtensionCommon;

const GDATA_LEGACY_PREFS = {
  useHTTPMethodOverride: true,
  alarmClosest: true,
  migrate: true,
  maxResultsPerRequest: 1000,
  idleTime: 300,
  sendEventNotifications: true,
  enableAttendees: true,
  enableEmailInvitations: false,
};

this.gdata = class extends ExtensionAPI {
  onStartup() {
    Services.io
      .getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler)
      .setSubstitution("gdata-provider", this.extension.rootURI);

    let aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(
      Ci.amIAddonManagerStartup
    );
    let manifestURI = Services.io.newURI("manifest.json", null, this.extension.rootURI);

    this.chromeHandle = aomStartup.registerChrome(manifestURI, [
      ["content", "gdata-provider", "legacy/content/"],
    ]);

    // Load this early to get the messenger up and running for SyncPrefs
    let { getMessenger } = ChromeUtils.import(
      "resource://gdata-provider/legacy/modules/gdataUtils.jsm"
    );

    getMessenger().gdataSyncPrefs.initComplete.then(() => {
      let { calGoogleCalendar } = ChromeUtils.import(
        "resource://gdata-provider/legacy/modules/gdataCalendar.jsm"
      );
      if (cal.getCalendarManager().wrappedJSObject.hasCalendarProvider("gdata")) {
        cal.getCalendarManager().wrappedJSObject.unregisterCalendarProvider("gdata", true);
      }
      cal.getCalendarManager().wrappedJSObject.registerCalendarProvider("gdata", calGoogleCalendar);

      let gdataUI = ChromeUtils.import("resource://gdata-provider/legacy/modules/gdataUI.jsm");
      gdataUI.register();
    });
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }

    cal.getCalendarManager().wrappedJSObject.unregisterCalendarProvider("gdata", true);

    let gdataUI = ChromeUtils.import("resource://gdata-provider/legacy/modules/gdataUI.jsm");
    gdataUI.unregister();

    Services.io
      .getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler)
      .setSubstitution("gdata-provider", null);

    this.chromeHandle.destruct();
    this.chromeHandle = null;

    // if (this.extension.addonData.temporarilyInstalled) {
    Services.obs.notifyObservers(null, "startupcache-invalidate");
    // }
  }

  getAPI(context) {
    return {
      gdata: {
        async getLegacyPrefs() {
          let wxprefs = {};
          let branch = Services.prefs.getBranch("calendar.google.");
          for (let [pref, defaultValue] of Object.entries(GDATA_LEGACY_PREFS)) {
            let type = branch.getPrefType(pref);
            switch (type) {
              case Ci.nsIPrefBranch.PREF_BOOL:
                wxprefs["settings." + pref] = branch.getBoolPref(pref, defaultValue);
                break;
              case Ci.nsIPrefBranch.PREF_INT:
                wxprefs["settings." + pref] = branch.getIntPref(pref, defaultValue);
                break;
              case Ci.nsIPrefBranch.PREF_STRING:
                wxprefs["settings." + pref] = branch.getStringPref(pref, defaultValue);
                break;
            }
          }

          return Object.keys(wxprefs).length ? wxprefs : null;
        },

        async purgeLegacyPrefs() {
          Services.prefs.deleteBranch("calendar.google.");
        },
      },
    };
  }
};
