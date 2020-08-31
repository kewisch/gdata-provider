/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { cal } = ChromeUtils.import("resource:///modules/calendar/calUtils.jsm");

var { ExtensionAPI } = ExtensionCommon;

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

    let aomStartup = Cc["@mozilla.org/addons/addon-manager-startup;1"].getService(
      Ci.amIAddonManagerStartup
    );
    let manifestURI = Services.io.newURI("manifest.json", null, this.extension.rootURI);

    this.chromeHandle = aomStartup.registerChrome(manifestURI, [
      ["content", "gdata-provider", "legacy/content/"],
    ]);

    // let gdataUI = ChromeUtils.import("resource://gdata-provider/legacy/modules/gdataUI.jsm");
    // gdataUI.register();
  }

  onShutdown(isAppShutdown) {
    if (isAppShutdown) {
      return;
    }

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
        /* onLegacyEvent: new ExtensionCommon.EventManager({
          context,
          name: "gdata.onLegacyEvent",
          register: fire => {
            let { legacyEventManager } = ChromeUtils.import(
              "resource://gdata-provider/legacy/modules/gdataUtils.jsm"
            );
            let listener = (event, name, ...args) => {
              return fire.async(name, args);
            };

            legacyEventManager._emitter.on("legacyEvent", listener);
            return () => {
              legacyEventManager._emitter.off("legacyEvent", listener);
            };
          },
        }).api(),
        */

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

          branch = Services.prefs.getBranch("calendar.google.calPrefs.");
          for (let pref of branch.getChildList("")) {
            if (!pref.endsWith(".googleUser")) {
              continue;
            }

            try {
              wxprefs["googleUser." + pref] = branch.getStringPref(pref, "");
            } catch (e) {}
          }

          return Object.keys(wxprefs).length ? wxprefs : null;
        },

        async purgeLegacyPrefs() {
          Services.prefs.deleteBranch("calendar.google.");
        },

        getOAuthToken(sessionId) {
          let pass = { value: null };
          try {
            let origin = "oauth:" + sessionId;
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
            let origin = "oauth:" + sessionId;
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
