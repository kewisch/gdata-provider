/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

/* global Services */

var { ExtensionCommon: { ExtensionAPI } } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { setTimeout } = ChromeUtils.importESModule("resource://gre/modules/Timer.sys.mjs");

var { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");

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

const GDATA_PWMGR_ID = "Google Calendar OAuth Token";

this.gdata = class extends ExtensionAPI {
  onStartup() {
    Services.io
      .getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler)
      .setSubstitution("gdata-provider", this.extension.rootURI);

    const aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(
      Ci.amIAddonManagerStartup
    );
    const manifestURI = Services.io.newURI("manifest.json", null, this.extension.rootURI);
    const version = this.extension.temporarilyInstalled ? new Date().getTime() : this.extension.version;

    this.chromeHandle = aomStartup.registerChrome(manifestURI, [
      ["content", "gdata-provider", "legacy/content/"],
    ]);

    // Make sure we're not using cached modules when upgrading/downgrading
    if (this.extension.startupReason == "ADDON_UPGRADE" || this.extension.startupReason == "ADDON_DOWNGRADE") {
      Services.obs.notifyObservers(null, "startupcache-invalidate");
    }

    // Do this in the next tick in case the startup cache needs more time to clear
    setTimeout(() => {
      let gdataUI = ChromeUtils.importESModule("resource://gdata-provider/legacy/modules/gdataUI.sys.mjs?bump=3");
      gdataUI.setExtensionVersion(version);
      gdataUI.register();

      // LEGACY
      // Load the old calendar provider as well until we have transitioned
      let { calGoogleCalendar } = gdataUI.loadGdataModule("resource://gdata-provider/legacy/modules/old/gdataCalendar.sys.mjs");
      if (cal.manager.wrappedJSObject.hasCalendarProvider("gdata")) {
        cal.manager.wrappedJSObject.unregisterCalendarProvider("gdata", true);
      }
      cal.manager.wrappedJSObject.registerCalendarProvider("gdata", calGoogleCalendar);
      // LEGACY END
    }, 0);
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }

    // LEGACY
    cal.manager.wrappedJSObject.unregisterCalendarProvider("gdata", true);
    // LEGACY END

    let gdataUI = ChromeUtils.importESModule("resource://gdata-provider/legacy/modules/gdataUI.sys.mjs?bump=3");
    gdataUI.unregister();

    Services.io
      .getProtocolHandler("resource")
      .QueryInterface(Ci.nsIResProtocolHandler)
      .setSubstitution("gdata-provider", null);

    this.chromeHandle.destruct();
    this.chromeHandle = null;
  }

  getAPI(_context) {
    return {
      gdata: {
        async getLegacyPrefs() {
          const wxprefs = {};
          let branch = Services.prefs.getBranch("calendar.google.");
          for (const [pref, defaultValue] of Object.entries(GDATA_LEGACY_PREFS)) {
            const type = branch.getPrefType(pref);
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

          branch = Services.prefs.getBranch("calendar.google.calPrefs.");
          for (const pref of branch.getChildList("")) {
            if (!pref.endsWith(".googleUser")) {
              continue;
            }

            try {
              wxprefs["googleUser." + pref] = branch.getStringPref(pref, "");
            } catch {
              // Ok not to set the wxpref if the stirng pref doesn't exist
            }
          }

          return Object.keys(wxprefs).length ? wxprefs : null;
        },

        async purgeLegacyPrefs() {
          Services.prefs.deleteBranch("calendar.google.");
        },

        getOAuthToken(sessionId) {
          const pass = { value: null };
          try {
            const origin = "oauth:" + sessionId;
            cal.auth.passwordManagerGet(sessionId, pass, origin, GDATA_PWMGR_ID);
          } catch (e) {
            // User might have cancelled the master password prompt, that's ok
            if (e.result != Cr.NS_ERROR_ABORT) {
              throw e;
            }
          }
          return pass.value;
        },

        setOAuthToken(sessionId, value) {
          try {
            const origin = "oauth:" + sessionId;
            if (value) {
              cal.auth.passwordManagerSave(sessionId, value, origin, GDATA_PWMGR_ID);
            } else {
              cal.auth.passwordManagerRemove(sessionId, origin, GDATA_PWMGR_ID);
            }
          } catch (e) {
            // User might have cancelled the master password prompt, or password saving
            // could be disabled. That is ok, throw for everything else.
            if (e.result != Cr.NS_ERROR_ABORT && e.result != Cr.NS_ERROR_NOT_AVAILABLE) {
              throw e;
            }
          }
        },
      },
    };
  }
};
