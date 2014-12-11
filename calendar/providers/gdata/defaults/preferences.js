/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* extension description */
pref("extensions.{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}.description",
     "chrome://gdata-provider/locale/gdata.properties");
pref("extensions.{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}.name",
     "chrome://gdata-provider/locale/gdata.properties");

/* other default prefs */
pref("calendar.google.useHTTPMethodOverride", true);
pref("calendar.google.alarmClosest", true);
pref("calendar.google.migrate", true);
pref("calendar.google.maxResultsPerRequest", 1000);
pref("calendar.google.idleTime", 300);

/**
 * Invitations and notifications.
 * Note that if enableEmailInvitations is enabled it is a good idea to disable
 * attendees or at least sending event notifications.
 */
pref("calendar.google.sendEventNotifications", true);
pref("calendar.google.enableAttendees", true);
pref("calendar.google.enableEmailInvitations", false);
