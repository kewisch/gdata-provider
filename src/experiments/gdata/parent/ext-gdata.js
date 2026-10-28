/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

/* global Services */

var { ExtensionCommon: { ExtensionAPI } } = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");
var { ExtensionUtils: { ExtensionError } } = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");
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

// The token is saved under this origin, with the session id as the username. Older versions used
// "oauth:" + sessionId, which the Rust login storage turns into "oauth:", so the token could no
// longer be found by that origin. This origin stays the same in both login storages and in the
// password helpers of Thunderbird 128, which shorten an origin like "gdata-provider://oauth" to
// "gdata-provider:".
// Keep the token functions in sync with src/legacy/modules/old/gdataSession.sys.mjs
const GDATA_PWMGR_ORIGIN = "gdata-provider:";

// All logins holding the token of this session, newest first. This includes the ones older
// versions saved under "oauth:" + sessionId, or "oauth:" in the Rust login storage.
async function findOAuthLogins(sessionId) {
  const found = new Map();
  for (const origin of [GDATA_PWMGR_ORIGIN, "oauth:" + sessionId, "oauth:"]) {
    const logins = await Services.logins.searchLoginsAsync({ origin, httpRealm: GDATA_PWMGR_ID });
    for (const login of logins) {
      if (login.username == sessionId) {
        login.QueryInterface(Ci.nsILoginMetaInfo);
        found.set(login.guid, login);
      }
    }
  }
  return [...found.values()].sort((a, b) => b.timePasswordChanged - a.timePasswordChanged);
}

async function removeOAuthLogins(sessionId, logins) {
  for (const login of logins) {
    await cal.auth.passwordManagerRemove(sessionId, login.origin, GDATA_PWMGR_ID);
  }
}

// Saves the token under the current origin. Copies under the old origins are only removed once the
// token can be read back, passwordManagerSave does not report most errors.
async function saveOAuthToken(sessionId, token) {
  await cal.auth.passwordManagerSave(sessionId, token, GDATA_PWMGR_ORIGIN, GDATA_PWMGR_ID);

  const pass = { value: null };
  const saved = await cal.auth.passwordManagerGet(sessionId, pass, GDATA_PWMGR_ORIGIN, GDATA_PWMGR_ID);
  if (saved && pass.value == token) {
    const logins = await findOAuthLogins(sessionId);
    await removeOAuthLogins(sessionId, logins.filter(login => login.origin != GDATA_PWMGR_ORIGIN));
  }
}

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

  getAPI(context) {
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

        async getOAuthToken(sessionId) {
          let logins = [];
          try {
            logins = await findOAuthLogins(sessionId);
          } catch (e) {
            // User might have cancelled the master password prompt, that's ok. For other errors
            // we can't read the token, so the user needs to log in again.
            if (e.result != Cr.NS_ERROR_ABORT) {
              console.error("Could not read the OAuth token", e);
            }
          }
          if (!logins.length) {
            return null;
          }

          const token = logins[0].password;
          if (logins.some(login => login.origin != GDATA_PWMGR_ORIGIN)) {
            // Saved by an older version, move it to the current origin. If that fails, for example
            // because password saving is disabled, the token stays where it is.
            try {
              await saveOAuthToken(sessionId, token);
            } catch (e) {
              if (e.result != Cr.NS_ERROR_ABORT && e.result != Cr.NS_ERROR_NOT_AVAILABLE) {
                console.error("Could not move the OAuth token", e);
              }
            }
          }
          return token;
        },

        async setOAuthToken(sessionId, value) {
          try {
            if (value) {
              await saveOAuthToken(sessionId, value);
            } else {
              await removeOAuthLogins(sessionId, await findOAuthLogins(sessionId));
            }
          } catch (e) {
            // User might have cancelled the master password prompt, or password saving
            // could be disabled. That is ok, throw for everything else.
            if (e.result != Cr.NS_ERROR_ABORT && e.result != Cr.NS_ERROR_NOT_AVAILABLE) {
              throw e;
            }
          }
        },

        async upgradeCalendar(calendarId) {
          let calendar = cal.manager.getCalendarById(calendarId);
          if (calendar.type != "gdata") {
            throw new ExtensionError(`Could not upgrade calendar type ${calendar.type}`)
          }

          const new_calendar_type = `ext-${context.extension.id}`;
          let calendars = cal.manager.getCalendars();
          let alreadyHasCalendar = calendars.some(checkCal => {
            return checkCal.type == new_calendar_type && checkCal.uri.spec == calendar.uri.spec;
          });

          if (!alreadyHasCalendar) {
            let newCalendar = cal.manager.createCalendar(new_calendar_type, calendar.uri);
            newCalendar.id = cal.getUUID();
            newCalendar.readOnly = calendar.readOnly;

             const propsToCopy = [
              "color",
              "disabled",
              "forceEmailScheduling",
              "auto-enabled",
              "cache.enabled",
              "refreshInterval",
              "suppressAlarms",
              "calendar-main-in-composite",
              "calendar-main-default",
              "readOnly",
              "imip.identity.key",
              "username",
            ];
            for (const prop of propsToCopy) {
              newCalendar.setProperty(prop, calendar.getProperty(prop));
            }

            const legacyLabel = context.extension.localizeMessage("gdataProviderLabelLegacy", [""], {
              cloneScope: context.cloneScope
            });

            if (calendar.name.endsWith(legacyLabel)) {
              newCalendar.name = calendar.name.substring(0, calendar.name.length - legacyLabel.length);
            } else if (calendar.name.startsWith(legacyLabel)) {
              newCalendar.name = calendar.name.substring(legacyLabel.length);
            } else {
              newCalendar.name = calendar.name;
            }

            cal.manager.registerCalendar(newCalendar);
          }
          cal.manager.removeCalendar(calendar, Ci.calICalendarManager.REMOVE_NO_DELETE);
        }
      },
    };
  }
};
