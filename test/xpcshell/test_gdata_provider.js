/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* global __LOCATION__, cal, monkeyPatch */

/* Alas, tests are currently broken. Something must have changed in terms of how cached calendars
 * are loaded and updated. There is a mad mix of promises and callback code, and code that just
 * ignores async effects in Lightning. This works ok when the app runs and will keep running, but
 * the xpcshell test here doesn't cope well with that. I tried to debug this a while back for a
 * different case and eventually gave up. The test failure you will see is e.g. executeAsync
 * failing. This is triggered by xpcshell head code that spins the event loop until it is empty.
 * There is some cached calendar code that will run async that keeps running afterwards. By the time
 * it does run, the storage calendar is already shut down.
 *
 * I'm going to retry this after I have time for some cleanup in the calendar code, which will
 * hopefully make things more predictable.
 */

var { HttpServer } = ChromeUtils.import("resource://testing-common/httpd.js");
var { NetUtil } = ChromeUtils.import("resource://gre/modules/NetUtil.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");

Services.prefs.setBoolPref("javascript.options.showInConsole", true);
Services.prefs.setBoolPref("browser.dom.window.dump.enabled", true);
Services.prefs.setBoolPref("calendar.debug.log", true);
Services.prefs.setBoolPref("calendar.debug.log.verbose", true);

var { AddonTestUtils } = ChromeUtils.import("resource://testing-common/AddonTestUtils.jsm");
AddonTestUtils.maybeInit(this);

var { ExtensionTestUtils } = ChromeUtils.import(
  "resource://testing-common/ExtensionXPCShellUtils.jsm"
);
ExtensionTestUtils.init(this);

var gServer;

var MockConflictPrompt = {
  _origFunc: null,
  overwrite: false,
  register: function() {
    if (!this._origFunc) {
      this._origFunc = cal.provider.promptOverwrite;
      cal.provider.promptOverwrite = (aMode, aItem) => {
        return this.overwrite;
      };
    }
  },

  unregister: function() {
    if (this._origFunc) {
      cal.provider.promptOverwrite = this._origFunc;
      this._origFunc = null;
    }
  },
};

function MockAlertsService() {}

MockAlertsService.prototype = {
  showAlertNotification: function() {},
  QueryInterface: ChromeUtils.generateQI([Ci.nsIAlertsService]),
};

function replaceAlertsService() {
  let { MockRegistrar } = ChromeUtils.import("resource://testing-common/MockRegistrar.jsm");

  let originalAlertsServiceCID = MockRegistrar.register(
    "@mozilla.org/alerts-service;1",
    MockAlertsService
  );
  registerCleanupFunction(() => {
    MockRegistrar.unregister(originalAlertsServiceCID);
  });
}

function GDataServer(calendarId, tasksId) {
  this.server = new HttpServer();
  this.calendarId = calendarId;
  this.tasksId = tasksId;

  let encCalendarId = encodeURIComponent(calendarId);
  let encTasksId = encodeURIComponent(tasksId);

  let events = "/calendar/v3/calendars/" + encCalendarId + "/events";
  let tasks = "/tasks/v1/lists/" + encTasksId + "/tasks";
  let calendarList = "/calendar/v3/users/me/calendarList/" + encCalendarId;

  this.server.registerPathHandler(
    calendarList,
    this.router.bind(this, this.calendarListRequest.bind(this))
  );
  this.server.registerPathHandler(events, this.router.bind(this, this.eventsRequest.bind(this)));
  this.server.registerPrefixHandler(
    events + "/",
    this.router.bind(this, this.eventsRequest.bind(this))
  );
  this.server.registerPathHandler(tasks, this.router.bind(this, this.tasksRequest.bind(this)));
  this.server.registerPrefixHandler(
    tasks + "/",
    this.router.bind(this, this.tasksRequest.bind(this))
  );

  this.resetRequest();

  let { getGoogleSessionManager } = ChromeUtils.import(
    "resource://gdata-provider/legacy/modules/gdataSession.jsm"
  );

  let sessionMgr = getGoogleSessionManager();
  this.session = sessionMgr.getSessionById("xpcshell", true);
  this.session.oauth = {
    accessToken: "accessToken",
    refreshToken: "refreshToken",
    tokenExpires: Number.MAX_VALUE,
    connect: function(success, failure, withUi, refresh) {
      this.accessToken = "accessToken";
      success();
    },
  };
}

GDataServer.prototype = {
  items: null,

  get baseUri() {
    return "http://localhost:" + this.server.identity.primaryPort + "/";
  },

  start: function() {
    this.server.start(-1);
    registerCleanupFunction(() => this.server.stop(() => {}));
  },

  resetClient: function(client) {
    this.resetRequest();
    MockConflictPrompt.unregister();
    cal.getCalendarManager().unregisterCalendar(client);
  },

  resetRequest: function() {
    this.events = [];
    this.tasks = [];
    this.nextEtag = null;
    this.syncs = [];
    this.nextEventStatus = [];

    this.creator = {
      email: this.calendarId,
      self: true,
      displayName: "Eggs P. Seashell",
    };

    this.eventsData = {
      kind: "calendar#events",
      etag: '"1410880601360000"',
      nextSyncToken: generateID(),
      updated: "2014-09-16T15:16:41.360Z",
      accessRole: "owner",
      summary: "xpcshell",
      timeZone: "Europe/Berlin",
      defaultReminders: [],
      items: [],
    };

    this.tasksData = {
      kind: "tasks#tasks",
      etag: '"1410880601360000"',
      items: [],
    };

    this.calendarListData = {
      kind: "calendar#calendarListEntry",
      etag: '"1410084814736000"',
      id: this.calendarId,
      summary: "xpcshell",
      timeZone: "Europe/Berlin",
      colorId: "17",
      backgroundColor: "#9a9cff",
      foregroundColor: "#000000",
      primary: true,
      selected: true,
      accessRole: "owner",
      defaultReminders: [],
      notificationSettings: {
        notifications: [
          { type: "eventCreation", method: "email" },
          { type: "eventChange", method: "email" },
          { type: "eventCancellation", method: "email" },
        ],
      },
    };
  },

  waitForLoad: function(aCalendar) {
    return new Promise((resolve, reject) => {
      let observer = cal.createAdapter(Ci.calIObserver, {
        onLoad: function() {
          let uncached = aCalendar.wrappedJSObject.mUncachedCalendar.wrappedJSObject;
          aCalendar.removeObserver(observer);

          if (Components.isSuccessCode(uncached._lastStatus)) {
            resolve(aCalendar);
          } else {
            reject(uncached._lastMessage);
          }
        },
      });
      aCalendar.addObserver(observer);
    });
  },

  getClient: function() {
    let uri =
      "googleapi://xpcshell/" +
      "?testport=" +
      this.server.identity.primaryPort +
      (this.calendarId ? "&calendar=" + encodeURIComponent(this.calendarId) : "") +
      (this.tasksId ? "&tasks=" + encodeURIComponent(this.tasksId) : "");
    let calmgr = cal.getCalendarManager();
    let client = calmgr.createCalendar("gdata", Services.io.newURI(uri));
    let uclient = client.wrappedJSObject;
    client.name = "xpcshell";

    // Make sure we catch the last error message in case sync fails
    monkeyPatch(uclient, "replayChangesOn", (protofunc, aListener) => {
      protofunc({
        onResult: function(operation, detail) {
          uclient._lastStatus = operation.status;
          uclient._lastMessage = detail;
          aListener.onResult(operation, detail);
        },
      });
    });

    calmgr.registerCalendar(client);
    uclient.mThrottleLimits = {};
    MockConflictPrompt.register();

    let cachedCalendar = calmgr.getCalendarById(client.id);
    return this.waitForLoad(cachedCalendar);
  },

  router: function(nextHandler, request, response) {
    try {
      let method = request.hasHeader("X-HTTP-Method-Override")
        ? request.getHeader("X-HTTP-Method-Override")
        : request.method;
      let parameters = new Map(request.queryString.split("&").map(part => part.split("=", 2)));

      let body;
      try {
        body = JSON.parse(
          NetUtil.readInputStreamToString(
            request.bodyInputStream,
            request.bodyInputStream.available()
          )
        );
      } catch (e) {
        // Don't bail if json parsing failed.
      }

      this.lastMethod = method;
      return nextHandler(request, response, method, parameters, body);
    } catch (e) {
      info("Server Error: " + e.fileName + ":" + e.lineNumber + ": " + e + "\n");
      return null;
    }
  },

  calendarListRequest: function(request, response, method, parameters, body) {
    let data = this.calendarListData;
    response.write(JSON.stringify(data));
  },

  eventsRequest: function(request, response, method, parameters, body) {
    if (method == "GET") {
      let data = this.eventsData;
      if (request.hasHeader("timeZone")) {
        data.timeZone = request.getHeader("timeZone");
      }

      // The fakeserver doesn't support both pagination and sync tokens
      // for sake of simplicity.
      if (this.syncs.length) {
        let syncToken = parameters.get("syncToken") || this.syncs[0].token;
        let sync = this.syncs.shift();
        let nextSyncToken = this.syncs[0] ? this.syncs[0].token : "last";

        if (!sync || syncToken != sync.token) {
          do_throw("Request in wrong order or not enough syncs");
        }
        if (sync.reset) {
          response.setStatusLine(null, 410, "Gone");
          return;
        }
        data.nextSyncToken = nextSyncToken;
        data.items = sync.events;
      } else {
        this.paginateRequest(parameters, this.events, data);
      }
      response.write(JSON.stringify(data));
    } else if (method == "POST") {
      // Add an event
      let isImport = request.path.endsWith("/events/import");
      let data = this.processAddEvent(body, isImport);
      this.events.push(data);
      response.setStatusLine(null, 201, "Created");
      response.write(JSON.stringify(data));
    } else if (
      (method == "PUT" || method == "PATCH") &&
      request.path.match(/\/events\/([a-z0-9_TZ]+)$/)
    ) {
      // Modify an event
      let eventId = RegExp.$1;
      this.handleModify(
        request,
        response,
        body,
        this.events,
        eventId,
        this.processModifyEvent.bind(this)
      );
    } else if (method == "DELETE" && request.path.match(/\/events\/([a-z0-9_TZ]+)$/)) {
      let eventId = RegExp.$1;
      this.handleDelete(request, response, this.events, eventId);
    }
  },

  tasksRequest: function(request, response, method, parameters, body) {
    if (method == "GET") {
      let data = this.tasksData;

      this.paginateRequest(parameters, this.tasks, data);
      delete data.nextSyncToken;

      response.write(JSON.stringify(data));
    } else if (method == "POST") {
      let data = this.processAddTask(body);
      this.tasks.push(data);
      response.setStatusLine(null, 201, "Created");
      response.write(JSON.stringify(data));
    } else if (method == "PUT" && request.path.match(/\/tasks\/([A-Za-z0-9]+)$/)) {
      let taskId = RegExp.$1;
      this.handleModify(
        request,
        response,
        body,
        this.tasks,
        taskId,
        this.processModifyTask.bind(this)
      );
    } else if (method == "DELETE" && request.path.match(/\/tasks\/([A-Za-z0-9]+)$/)) {
      let taskId = RegExp.$1;
      this.handleDelete(request, response, this.tasks, taskId);
    }
  },

  paginateRequest: function(parameters, items, data) {
    let maxResults = parameters.has("maxResults") ? parseInt(parameters.get("maxResults"), 10) : 50;
    let offset = parameters.has("pageToken") ? parseInt(parameters.get("pageToken"), 10) || 0 : 0;
    let nextOffset = offset + maxResults;
    if (nextOffset > items.length) {
      delete data.nextPageToken;
      data.nextSyncToken = "next-sync-token";
    } else {
      delete data.nextSyncToken;
      data.nextPageToken = nextOffset;
    }

    data.items = items.slice(offset, offset + maxResults);
  },

  handleModify: function(request, response, body, items, itemId, modifyFunc) {
    // Modify an event
    let [foundIndex, foundItem] = findKey(items, "id", itemId);

    let matchTag = request.hasHeader("If-Match") ? request.getHeader("If-Match") : null;

    if (foundIndex != -1) {
      if (!matchTag || matchTag == "*" || foundItem.etag == matchTag) {
        items[foundIndex] = modifyFunc(body, itemId);
        response.write(JSON.stringify(items[foundIndex]));
      } else {
        response.setStatusLine(null, 412, "Precondition Failed");
      }
    } else if (matchTag == "*") {
      let data = modifyFunc(body, itemId);
      items.push(data);
      response.write(JSON.stringify(data));
    } else if (body.recurringEventId) {
      // Special case for events, won't happen on tasks.  This is an
      // exception that doesn't exist yet. Allow creation in this case.
      let [, foundParent] = findKey(items, "id", body.recurringEventId);
      if (!matchTag || foundParent.etag == matchTag) {
        let data = modifyFunc(body, itemId);
        items.push(data);
        response.write(JSON.stringify(data));
      } else {
        response.setStatusLine(null, 412, "Precondition Failed");
      }
    } else if (matchTag) {
      response.setStatusLine(null, 412, "Precondition Failed");
    } else {
      response.setStatusLine(null, 404, "Not Found");
    }
  },

  handleDelete: function(request, response, items, itemId) {
    // eslint-disable-next-line array-bracket-spacing
    let [foundIndex] = findKey(items, "id", itemId);

    let matchTag = request.hasHeader("If-Match") ? request.getHeader("If-Match") : null;

    if (foundIndex != -1) {
      if (!matchTag || matchTag == "*" || items[foundIndex].etag == matchTag) {
        items.splice(foundIndex, 1);
        response.setStatusLine(null, 204, "No Content");
      } else {
        response.setStatusLine(null, 412, "Precondition Failed");
      }
    } else if (matchTag == "*") {
      response.setStatusLine(null, 410, "Gone");
    } else if (matchTag) {
      response.setStatusLine(null, 412, "Precondition Failed");
    } else {
      response.setStatusLine(null, 404, "Not Found");
    }
  },

  processAddEvent: function(jsonData, isImport) {
    jsonData.kind = "calendar#event";
    jsonData.etag = this.nextEtag || '"' + new Date().getTime() + '"';
    jsonData.id = generateID();
    if (!isImport) {
      jsonData.htmlLink = this.baseUri + "/calendar/event?eid=" + jsonData.id;
    }
    if (!isImport || !jsonData.iCalUID) {
      jsonData.iCalUID = jsonData.id + "@google.com";
    }
    if (!isImport || !jsonData.created) {
      jsonData.created = cal.dtz.toRFC3339(cal.dtz.now());
    }
    if (!isImport || !jsonData.updated) {
      jsonData.updated = cal.dtz.toRFC3339(cal.dtz.now());
    }
    if (!isImport || !jsonData.creator) {
      jsonData.creator = this.creator;
    }
    if (!isImport || !jsonData.organizer) {
      jsonData.organizer = this.creator;
    }
    this.nextEtag = null;
    return jsonData;
  },

  processModifyEvent: function(jsonData, id) {
    jsonData.kind = "calendar#event";
    jsonData.etag = this.nextEtag || '"' + new Date().getTime() + '"';
    jsonData.updated = cal.dtz.toRFC3339(cal.dtz.now());
    jsonData.id = id;
    jsonData.iCalUID = (jsonData.recurringEventId || jsonData.id) + "@google.com";
    if (!jsonData.creator) {
      jsonData.creator = this.creator;
    }
    if (!jsonData.organizer) {
      jsonData.organizer = this.creator;
    }

    this.nextEtag = null;
    return jsonData;
  },

  processAddTask: function(jsonData) {
    jsonData.kind = "tasks#task";
    jsonData.etag = this.nextEtag || '"' + new Date().getTime() + '"';
    jsonData.id = generateID();
    jsonData.position = generateID(); // Not a real position, but we don't really use this at the moment
    if (!jsonData.status) {
      jsonData.status = "needsAction";
    }
    if (!jsonData.updated) {
      jsonData.updated = cal.dtz.toRFC3339(cal.dtz.now());
    }

    this.nextEtag = null;
    return jsonData;
  },

  processModifyTask: function(jsonData) {
    jsonData.kind = "tasks#task";
    jsonData.etag = this.nextEtag || '"' + new Date().getTime() + '"';
    jsonData.updated = cal.dtz.toRFC3339(cal.dtz.now());
    if (!jsonData.status) {
      jsonData.status = "needsAction";
    }
    if (!jsonData.updated) {
      jsonData.updated = cal.dtz.toRFC3339(cal.dtz.now());
    }

    this.nextEtag = null;
    return jsonData;
  },
};

function findKey(container, key, searchKey) {
  let foundIndex = -1;
  for (let i = 0; i < container.length; i++) {
    if (container[i][key] == searchKey) {
      foundIndex = i;
      break;
    }
  }

  let foundItem = foundIndex == -1 ? null : container[foundIndex];
  return [foundIndex, foundItem];
}

function generateID() {
  let chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let str = "";
  for (let i = 26; i; i--) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}

function getAllMeta(calendar) {
  let keys = {},
    values = {};
  calendar.getAllMetaData({}, keys, values);
  return new Map(keys.value.map((k, i) => [k, values.value[i]]));
}

function run_test() {
  do_test_pending();
  run_test_async()
    .then(run_next_test)
    .finally(do_test_finished);
}

let gExtension = null;

async function run_test_async() {
  replaceAlertsService();

  // TODO: make do_calendar_startup to work with this test and replace the startup code here
  do_get_profile();

  await new Promise(resolve => cal.getCalendarManager().startup({ onResult: resolve }));
  await new Promise(resolve => cal.getTimezoneService().startup({ onResult: resolve }));

  Services.prefs.setBoolPref("xpinstall.signatures.required", false);

  AddonTestUtils.createAppInfo("xpcshell@tests.mozilla.org", "XPCShell", "78.2.0", "78.2.0");

  await AddonTestUtils.promiseStartupManager();

  let xpiFile = __LOCATION__.parent.parent.parent;
  xpiFile.append("dist");
  xpiFile.append("gdata-provider.xpi");
  let extension = ExtensionTestUtils.loadExtensionXPI(xpiFile);

  // We're starting up and then immediately marking as unloaded, otherwise code will complain the
  // test wasn't shut down between test runs. We want to keep the extension installed during the
  // whole duration of all tests.
  await extension.startup();
  await extension.markUnloaded();

  gServer = new GDataServer("xpcshell@example.com", "tasksId");
  gServer.start();
}

add_task(async function test_migrate_cache() {
  let uriString = "googleapi://xpcshell/?calendar=xpcshell%40example.com";
  let uri = Services.io.newURI(uriString);
  let client = cal.getCalendarManager().createCalendar("gdata", uri);
  let unwrapped = client.wrappedJSObject;
  let migrateStorageCache = unwrapped.migrateStorageCache.bind(unwrapped);

  monkeyPatch(unwrapped, "resetSync", protofunc => {
    return Promise.resolve();
  });

  // No version, should not reset
  equal(await migrateStorageCache(), false);
  equal(client.getProperty("cache.version"), 3);

  // Check migrate 1 -> 2
  unwrapped.CACHE_DB_VERSION = 2;
  client.setProperty("cache.version", 1);
  equal(await migrateStorageCache(), true);
  equal(client.getProperty("cache.version"), 2);

  // Check migrate 2 -> 3 normal calendar
  unwrapped.CACHE_DB_VERSION = 3;
  client.setProperty("cache.version", 2);
  equal(await migrateStorageCache(), false);

  // Check migrate 2 -> 3 birthday calendar
  unwrapped.CACHE_DB_VERSION = 3;
  uri = "googleapi://xpcshell/?calendar=%23contacts%40group.v.calendar.google.com";
  unwrapped.uri = Services.io.newURI(uri);
  client.setProperty("cache.version", 2);
  equal(await migrateStorageCache(), true);
});

add_test(function test_migrate_uri() {
  function checkMigrate(fromUri, session, calendarId, tasksId) {
    let uri = Services.io.newURI(fromUri);
    let client = cal.getCalendarManager().createCalendar("gdata", uri);

    if (session) {
      let target = (
        "googleapi://" +
        session +
        "/?" +
        (calendarId ? "&calendar=" + encodeURIComponent(calendarId) : "") +
        (tasksId ? "&tasks=" + encodeURIComponent(tasksId) : "")
      ).replace("?&", "?");
      equal(client.getProperty("uri"), target);
    } else {
      equal(client.getProperty("uri"), null);
    }
  }

  checkMigrate(
    "http://www.google.com/calendar/feeds/example%40example.com/public/full",
    "example@example.com",
    "example@example.com",
    null
  );

  checkMigrate(
    "webcal://www.google.com/calendar/feeds/example%40example.com/public/full",
    "example@example.com",
    "example@example.com",
    null
  );

  Services.prefs.setStringPref(
    "calendar.google.calPrefs.example@example.com.googleUser",
    "example@example.com"
  );
  checkMigrate(
    "http://www.google.com/calendar/feeds/example%40example.com/public/full",
    "example@example.com",
    "example@example.com",
    "@default"
  );

  checkMigrate("ehmwtf://www.google.com/calendar/feeds/example%40example.com/public/full");
  checkMigrate("googleapi://session/?calendar=calendarId&tasksId=tasksId");

  run_next_test();
});

add_task(async function test_dateToJSON() {
  function _createDateTime(tzid, offset = 0) {
    let offsetFrom = offset <= 0 ? "-0" + (offset - 1) : "+0" + (offset - 1) + "00";
    let offsetTo = "+0" + offset + "00";
    let ics = [
      "BEGIN:VCALENDAR",
      "BEGIN:VTIMEZONE",
      "TZID:ThirdPartyZone",
      "BEGIN:STANDARD",
      "DTSTART:20071104T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU;INTERVAL=1",
      "TZOFFSETFROM:" + offsetFrom,
      "TZOFFSETTO:" + offsetTo,
      "TZNAME:TPT",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "DTSTART:20070311T020000",
      "RRULE:FREQ=YEARLY;BYMONTH=4;BYDAY=1SU;INTERVAL=1",
      "TZOFFSETFROM:" + offsetTo,
      "TZOFFSETTO:" + offsetFrom,
      "TZNAME:TPDT",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:123",
      "DTSTART;TZID=" + tzid + ":20150130T120000",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    let parser = Cc["@mozilla.org/calendar/ics-parser;1"].createInstance(Ci.calIIcsParser);
    parser.parseString(ics);
    let items = parser.getItems({});
    return items[0].startDate;
  }

  let { dateToJSON } = ChromeUtils.import(
    "resource://gdata-provider/legacy/modules/gdataUtils.jsm"
  );

  let date;

  // no timezone
  date = _createDateTime(cal.dtz.floating);
  deepEqual(dateToJSON(date), { dateTime: "2015-01-30T12:00:00-00:00" });

  // valid non-Olson tz name
  date = _createDateTime("Eastern Standard Time");
  deepEqual(dateToJSON(date), { dateTime: "2015-01-30T12:00:00", timeZone: "America/New_York" });

  // valid continent/city Olson tz
  date = _createDateTime("America/New_York");
  deepEqual(dateToJSON(date), { dateTime: "2015-01-30T12:00:00", timeZone: "America/New_York" });

  // valid continent/region/city Olson tz
  date = _createDateTime("America/Argentina/Buenos_Aires");
  deepEqual(dateToJSON(date), {
    dateTime: "2015-01-30T12:00:00",
    timeZone: "America/Argentina/Buenos_Aires",
  });

  // ical.js and libical currently have slightly different timezone handling.
  if (Services.prefs.getBoolPref("calendar.icaljs", false)) {
    // unknown but formal valid Olson tz. ical.js assumes floating
    date = _createDateTime("Unknown/Olson/Timezone");
    deepEqual(dateToJSON(date), { dateTime: "2015-01-30T12:00:00-00:00" });

    // Etc with offset. ical.js doesn't understand third party zones and uses floating
    date = _createDateTime("ThirdPartyZone", 5);
    deepEqual(dateToJSON(date), { dateTime: "2015-01-30T12:00:00-00:00" });

    // Etc with zero offset. ical.js doesn't understand third party zones and uses floating
    date = _createDateTime("ThirdPartyZone", 0);
    deepEqual(dateToJSON(date), { dateTime: "2015-01-30T12:00:00-00:00" });
  } else {
    // This causes an assertion failure.
    if (!mozinfo.debug) {
      // unknown but formal valid Olson tz
      date = _createDateTime("Unknown/Olson/Timezone");
      deepEqual(dateToJSON(date), {
        dateTime: "2015-01-30T12:00:00",
        timeZone: "Unknown/Olson/Timezone",
      });
    }

    // Etc with offset
    date = _createDateTime("ThirdPartyZone", 5);
    deepEqual(dateToJSON(date), { dateTime: "2015-01-30T12:00:00", timeZone: "Etc/GMT-5" });

    // Etc with zero offset
    date = _createDateTime("ThirdPartyZone", 0);
    deepEqual(dateToJSON(date), { dateTime: "2015-01-30T12:00:00Z", timeZone: "UTC" });
  }

  // This causes an assertion failure.
  if (!mozinfo.debug) {
    // invalid non-Olson tz
    date = _createDateTime("InvalidTimeZone");
    notEqual(dateToJSON(date), { dateTime: "2015-01-30T12:00:00", timeZone: "InvalidTimeZone" });
  }

  // Zone with 0 offset but not UTC
  date = _createDateTime("Europe/London");
  deepEqual(dateToJSON(date), { dateTime: "2015-01-30T12:00:00", timeZone: "Europe/London" });

  // date only
  date.isDate = true;
  deepEqual(dateToJSON(date), { date: "2015-01-30" });
});

add_task(async function test_JSONToDate() {
  function convert(aEntry, aTimezone = "Europe/Berlin") {
    let tzs = cal.getTimezoneService();
    let calendarTz = tzs.getTimezone(aTimezone);
    let date = JSONToDate(aEntry, calendarTz);
    return date ? date.icalString + " in " + date.timezone.tzid : null;
  }

  let { JSONToDate } = ChromeUtils.import(
    "resource://gdata-provider/legacy/modules/gdataUtils.jsm"
  );

  // A date, using the passed in default timezone
  equal(convert({ date: "2015-01-02" }), "20150102 in Europe/Berlin");

  // A date, with a timezone that has zero offset
  equal(convert({ date: "2015-01-02", timeZone: "Africa/Accra" }), "20150102 in Africa/Accra");

  // A date, using a timezone with a nonzero offset that is not the default timezone
  equal(convert({ date: "2015-01-02", timeZone: "Asia/Baku" }), "20150102 in Asia/Baku");

  // UTC date with and without timezone specified, with a calendar in a timezone without DST
  equal(
    convert({ dateTime: "2015-01-02T03:04:05Z", timeZone: "UTC" }, "Africa/Accra"),
    "20150102T030405Z in UTC"
  );
  equal(
    convert({ dateTime: "2015-01-02T03:04:05Z" }, "Africa/Accra"),
    "20150102T030405 in Africa/Accra"
  );

  // An America/Los_Angeles date-time viewed in Europe/Berlin
  equal(
    convert({ dateTime: "2015-12-01T21:13:14+01:00", timeZone: "America/Los_Angeles" }),
    "20151201T121314 in America/Los_Angeles"
  );
  equal(
    convert({ dateTime: "2015-07-01T21:13:14+02:00", timeZone: "America/Los_Angeles" }),
    "20150701T121314 in America/Los_Angeles"
  );

  // A timezone that is sometimes in GMT, get ready for: Europe/London!
  equal(
    convert({ dateTime: "2015-12-01T12:13:14Z", timeZone: "Europe/London" }, "Europe/London"),
    "20151201T121314 in Europe/London"
  );
  equal(
    convert({ dateTime: "2015-07-01T12:13:14+01:00", timeZone: "Europe/London" }, "Europe/London"),
    "20150701T121314 in Europe/London"
  );

  // An event in Los Angeles, with a calendar set to Asia/Baku
  equal(
    convert(
      { dateTime: "2015-07-01T12:13:14+05:00", timeZone: "America/Los_Angeles" },
      "Asia/Baku"
    ),
    "20150701T001314 in America/Los_Angeles"
  );
  equal(
    convert(
      { dateTime: "2015-12-01T12:13:14+04:00", timeZone: "America/Los_Angeles" },
      "Asia/Baku"
    ),
    "20151201T001314 in America/Los_Angeles"
  );

  // An event without specified timezone, with a calendar set to Asia/Baku
  equal(
    convert({ dateTime: "2015-07-01T12:13:14+04:00" }, "Asia/Baku"),
    "20150701T121314 in Asia/Baku"
  );

  // An offset matching the passed in calendar timezone. This should NOT be Africa/Algiers
  equal(convert({ dateTime: "2015-01-02T03:04:05+01:00" }), "20150102T030405 in Europe/Berlin");

  // An offset that doesn't match the calendar timezone, will use the first timezone in that offset
  info(
    "The following warning is expected: 2015-01-02T03:04:05+04:00 does not match timezone offset for Europe/Berlin"
  );
  equal(convert({ dateTime: "2015-01-02T03:04:05+05:00" }), "20150102T030405 in Antarctica/Mawson");
});

add_task(async function test_organizerCN() {
  gServer.events = [];
  let client = await gServer.getClient();
  equal(client.getProperty("organizerCN"), null);
  gServer.resetClient(client);

  gServer.events = [
    {
      kind: "calendar#event",
      etag: '"2299601498276000"',
      id: "go6ijb0b46hlpbu4eeu92njevo",
      created: "2006-06-08T21:04:52.000Z",
      updated: "2006-06-08T21:05:49.138Z",
      summary: "New Event",
      creator: gServer.creator,
      organizer: gServer.creator,
      start: { dateTime: "2006-06-10T18:00:00+02:00" },
      end: { dateTime: "2006-06-10T20:00:00+02:00" },
      iCalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
    },
  ];
  client = await gServer.getClient();
  equal(client.getProperty("organizerCN"), gServer.creator.displayName);
  gServer.resetClient(client);
});

add_task(async function test_always_readOnly() {
  gServer.events = [
    {
      kind: "calendar#event",
      etag: '"2299601498276000"',
      id: "go6ijb0b46hlpbu4eeu92njevo",
      created: "2006-06-08T21:04:52.000Z",
      updated: "2006-06-08T21:05:49.138Z",
      summary: "New Event",
      creator: gServer.creator,
      organizer: gServer.creator,
      start: { dateTime: "2006-06-10T18:00:00+02:00" },
      end: { dateTime: "2006-06-10T20:00:00+02:00" },
      iCalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
    },
  ];
  gServer.calendarListData.accessRole = "freeBusyReader";
  let client = await gServer.getClient();
  let pclient = cal.async.promisifyCalendar(client);
  ok(client.readOnly);
  client.readOnly = false;
  ok(client.readOnly);

  let items = await pclient.getAllItems();
  equal(items.length, 1);
  notEqual(items[0].title, "New Event");
  gServer.resetClient(client);

  gServer.calendarListData.accessRole = "reader";
  client = await gServer.getClient();
  ok(client.readOnly);
  client.readOnly = false;
  ok(client.readOnly);
  gServer.resetClient(client);
});

add_task(async function test_reset_sync() {
  gServer.tasks = [
    {
      kind: "tasks#task",
      id: "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
      etag: '"Lck7VNWFJuXdzMtOmrYPx0KFV2s/LTIwNjA4MDcyNDM"',
      title: "New Task",
      updated: "2014-09-08T16:30:27.000Z",
      selfLink:
        gServer.baseUri +
        "/tasks/v1/lists/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDow/tasks/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
      position: "00000000000000130998",
      status: "needsAction",
    },
    {
      kind: "tasks#task",
      id: "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo5OTU0Mjk2MzQ",
      etag: '"Lck7VNWFJuXdzMtOmrYPx0KFV2s/LTQyNTY0MjUwOQ"',
      title: "New Task 2",
      updated: "2014-09-08T16:30:27.000Z",
      selfLink:
        gServer.baseUri +
        "/tasks/v1/lists/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDow/tasks/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo5OTU0Mjk2MzQ",
      position: "00000000000000130993",
      status: "needsAction",
    },
  ];
  gServer.events = [
    {
      kind: "calendar#event",
      etag: '"1"',
      id: "go6ijb0b46hlpbu4eeu92njevo",
      created: "2006-06-08T21:04:52.000Z",
      updated: "2006-06-08T21:05:49.138Z",
      summary: "New Event",
      creator: gServer.creator,
      organizer: gServer.creator,
      start: { dateTime: "2006-06-10T18:00:00+02:00" },
      end: { dateTime: "2006-06-10T20:00:00+02:00" },
      iCalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
    },
    {
      kind: "calendar#event",
      etag: '"2"',
      id: "fepf8uf6n7n04w7feukucs9n8e",
      created: "2006-06-08T21:04:52.000Z",
      updated: "2006-06-08T21:05:49.138Z",
      summary: "New Event 2",
      creator: gServer.creator,
      organizer: gServer.creator,
      start: { dateTime: "2006-06-10T18:00:00+02:00" },
      end: { dateTime: "2006-06-10T20:00:00+02:00" },
      iCalUID: "fepf8uf6n7n04w7feukucs9n8e@google.com",
    },
  ];
  let client = await gServer.getClient();
  let uncached = client.wrappedJSObject.mUncachedCalendar.wrappedJSObject;
  let pclient = cal.async.promisifyCalendar(client);

  let items = await pclient.getAllItems();
  equal(items.length, 4);

  notEqual(client.getProperty("syncToken.events"), "");
  notEqual(client.getProperty("lastUpdated.tasks"), "");

  await uncached.resetSync();
  items = await pclient.getAllItems();
  equal(items.length, 0);

  equal(client.getProperty("syncToken.events"), "");
  equal(client.getProperty("lastUpdated.tasks"), "");

  gServer.resetClient(client);
});

add_task(async function test_basicItems() {
  gServer.events = [
    {
      kind: "calendar#event",
      etag: '"2299601498276000"',
      id: "go6ijb0b46hlpbu4eeu92njevo",
      status: "confirmed",
      htmlLink: gServer.baseUri + "/calendar/event?eid=eventhash",
      created: "2006-06-08T21:04:52.000Z",
      updated: "2006-06-08T21:05:49.138Z",
      summary: "New Event",
      description: "description",
      location: "Hard Drive",
      colorId: 17,
      creator: gServer.creator,
      organizer: gServer.creator,
      start: { dateTime: "2006-06-10T18:00:00+02:00" },
      end: { dateTime: "2006-06-10T20:00:00+02:00" },
      transparency: "transparent",
      visibility: "private",
      iCalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
      sequence: 1,
      reminders: {
        useDefault: false,
        overrides: [
          {
            method: "email",
            minutes: 20,
          },
        ],
      },
      attendees: [
        {
          displayName: "attendee name",
          email: "attendee@example.com",
          optional: true,
          responseStatus: "tentative",
        },
      ],

      extendedProperties: {
        shared: { "X-MOZ-CATEGORIES": "foo,bar" },
        private: {
          "X-MOZ-LASTACK": "2014-01-01T01:01:01Z",
          "X-MOZ-SNOOZE-TIME": "2014-01-01T02:02:02Z",
        },
      },
    },
  ];

  gServer.tasks = [
    {
      kind: "tasks#task",
      id: "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
      etag: '"Lck7VNWFJuXdzMtOmrYPx0KFV2s/LTIwNjA4MDcyNDM"',
      title: "New Task",
      updated: "2014-09-08T16:30:27.000Z",
      selfLink:
        gServer.baseUri +
        "/tasks/v1/lists/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDow/tasks/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
      position: "00000000000000130998",
      status: "completed",
      due: "2014-09-04T00:00:00.000Z",
      completed: "2014-09-01T17:00:00.000Z",
      notes: "description",
      parent: "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo4MDIzOTU2NDc",
      links: [
        {
          link: "mailto:something@example.com",
          description: "link description",
          type: "email",
        },
      ],
    },
  ];

  let client = await gServer.getClient();
  let pclient = cal.async.promisifyCalendar(client);

  let items = await pclient.getAllItems();
  equal(items.length, 2);

  let event = cal.item.isEvent(items[0]) ? items[0] : items[1];
  equal(event.id, "go6ijb0b46hlpbu4eeu92njevo@google.com");
  equal(event.getProperty("STATUS"), "CONFIRMED");
  equal(event.getProperty("URL"), gServer.baseUri + "/calendar/event?eid=eventhash");
  equal(event.getProperty("CREATED").icalString, "20060608T210452Z");
  equal(event.getProperty("LAST-MODIFIED").icalString, "20060608T210549Z");
  equal(event.title, "New Event");
  equal(event.getProperty("DESCRIPTION"), "description");
  equal(event.getProperty("LOCATION"), "Hard Drive");
  equal(event.organizer.id, "mailto:xpcshell@example.com");
  equal(event.organizer.commonName, "Eggs P. Seashell");
  ok(event.organizer.isOrganizer);
  equal(event.startDate.icalString, "20060610T180000");
  equal(event.startDate.timezone.tzid, "Europe/Berlin");
  equal(event.endDate.icalString, "20060610T200000");
  equal(event.getProperty("TRANSP"), "TRANSPARENT");
  equal(event.privacy, "PRIVATE");
  equal(event.getProperty("SEQUENCE"), 1);
  let alarms = event.getAlarms({});
  equal(alarms.length, 1);
  equal(alarms[0].action, "EMAIL");
  equal(alarms[0].related, alarms[0].ALARM_RELATED_START);
  equal(alarms[0].offset.icalString, "-PT20M");
  equal(alarms[0].getProperty("X-DEFAULT-ALARM"), null);
  let attendees = event.getAttendees({});
  equal(attendees.length, 1);
  equal(attendees[0].id, "mailto:attendee@example.com");
  equal(attendees[0].commonName, "attendee name");
  equal(attendees[0].role, "OPT-PARTICIPANT");
  equal(attendees[0].participationStatus, "TENTATIVE");
  equal(event.getCategories({}), "foo,bar");
  equal(event.alarmLastAck.icalString, "20140101T010101Z");
  equal(event.getProperty("X-MOZ-SNOOZE-TIME"), "20140101T020202Z");

  let task = cal.item.isToDo(items[0]) ? items[0] : items[1];
  equal(task.id, "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU");
  equal(task.title, "New Task");
  equal(task.getProperty("LAST-MODIFIED").icalString, "20140908T163027Z");
  equal(task.getProperty("X-GOOGLE-SORTKEY"), "00000000000000130998");
  ok(task.isCompleted);
  equal(task.dueDate.icalString, "20140904");
  equal(task.completedDate.icalString, "20140901T170000Z");
  equal(task.getProperty("DESCRIPTION"), "description");
  let relations = task.getRelations({});
  equal(relations.length, 1);
  equal(relations[0].relType, "PARENT");
  equal(relations[0].relId, "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo4MDIzOTU2NDc");
  let attachments = task.getAttachments({});
  equal(attachments.length, 1);
  equal(attachments[0].uri.spec, "mailto:something@example.com");
  equal(attachments[0].getParameter("X-GOOGLE-TYPE"), "email");
  equal(attachments[0].getParameter("FILENAME"), "link description");

  gServer.resetClient(client);
});

add_task(async function test_addModifyDeleteItem() {
  let client = await gServer.getClient();
  let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);
  equal(gServer.events.length, 0);
  equal(gServer.tasks.length, 0);

  let event = cal.createEvent(
    [
      "BEGIN:VEVENT",
      "CREATED:20060608T210452Z",
      "LAST-MODIFIED:20060608T210549Z",
      "DTSTAMP:20060608T210549Z",
      "SUMMARY:New Event",
      "STATUS:CONFIRMED",
      "ORGANIZER;CN=Eggs P. Seashell:mailto:xpcshell@example.com",
      "ATTENDEE;CN=attendee name;PARTSTAT=TENTATIVE;CUTYPE=INDIVIDUAL;ROLE=OPT-PA",
      " RTICIPANT:mailto:attendee@example.com",
      "CATEGORIES:foo",
      "CATEGORIES:bar",
      "X-MOZ-LASTACK:20140101T010101Z",
      "DTSTART:20060610T180000Z",
      "DTEND:20060610T200000Z",
      "CLASS:PRIVATE",
      "URL:http://eventlocation",
      "DESCRIPTION:description",
      "LOCATION:Hard Drive",
      "TRANSP:TRANSPARENT",
      "SEQUENCE:1",
      "X-MOZ-SNOOZE-TIME:20140101T020202Z",
      "BEGIN:VALARM",
      "ACTION:EMAIL",
      "TRIGGER;VALUE=DURATION:-PT20M",
      "SUMMARY:Default Mozilla Summary",
      "DESCRIPTION:Default Mozilla Description",
      "END:VALARM",
      "END:VEVENT",
    ].join("\r\n")
  );

  let task = cal.createTodo(
    [
      "BEGIN:VTODO",
      "SUMMARY:New Task",
      "DESCRIPTION:description",
      "X-SORTKEY:00000000000000130998",
      "STATUS:COMPLETED",
      "DUE;VALUE=DATE:20140904",
      "COMPLETED:20140901T170000Z",
      "RELATED-TO;RELTYPE=PARENT:MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo4MDIzOTU2NDc",
      'ATTACH;FILENAME="link description";X-GOOGLE-TYPE=email:mailto:something@example.com',
      "END:VTODO",
    ].join("\r\n")
  );

  // Add an event
  let addedEvent = await pclient.adoptItem(event);
  notEqual(addedEvent.id, null);
  equal(addedEvent.organizer.id, "mailto:xpcshell@example.com");

  let items = await pclient.getAllItems();
  equal(items.length, 1);
  equal(items[0].id, addedEvent.id);
  equal(items[0].organizer.id, "mailto:xpcshell@example.com");

  equal(gServer.events.length, 1);
  equal(gServer.tasks.length, 0);

  // Add a task
  let addedTask = await pclient.adoptItem(task);
  notEqual(addedTask.id, null);

  items = await pclient.getAllItems();
  equal(items.length, 2);
  equal(items[1].id, addedTask.id);

  equal(gServer.events.length, 1);
  equal(gServer.tasks.length, 1);

  // Modify an event
  let newEvent = items[0].clone();
  newEvent.title = "changed";

  let modifiedEvent = await pclient.modifyItem(newEvent, items[0]);
  equal(modifiedEvent.title, "changed");
  notEqual(modifiedEvent.getProperty("LAST-MODIFIED"), addedEvent.getProperty("LAST-MODIFIED"));
  items = await pclient.getAllItems();
  equal(items.length, 2);
  equal(items[0].title, "changed");
  equal(items[0].id, addedEvent.id);
  equal(items[0].getProperty("LAST-MODIFIED"), modifiedEvent.getProperty("LAST-MODIFIED"));
  equal(gServer.events.length, 1);
  equal(gServer.tasks.length, 1);

  // Modify a task
  let newTask = items[1].clone();
  newTask.title = "changed";

  let modifiedTask = await pclient.modifyItem(newTask, items[1]);
  equal(modifiedTask.title, "changed");
  notEqual(modifiedTask.getProperty("LAST-MODIFIED"), addedTask.getProperty("LAST-MODIFIED"));
  items = await pclient.getAllItems();
  equal(items.length, 2);
  equal(items[1].title, "changed");
  equal(items[1].id, addedTask.id);
  equal(items[1].getProperty("LAST-MODIFIED"), modifiedTask.getProperty("LAST-MODIFIED"));
  equal(gServer.events.length, 1);
  equal(gServer.tasks.length, 1);

  // Delete an event
  await pclient.deleteItem(modifiedEvent);
  items = await pclient.getAllItems();
  equal(items.length, 1);
  equal(gServer.events.length, 0);
  equal(gServer.tasks.length, 1);

  // Delete a task
  await pclient.deleteItem(modifiedTask);
  items = await pclient.getAllItems();
  equal(items.length, 0);
  equal(gServer.events.length, 0);
  equal(gServer.tasks.length, 0);

  gServer.resetClient(client);
});

add_task(async function test_recurring_event() {
  let client = await gServer.getClient();
  let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

  let event = cal.createEvent(
    [
      "BEGIN:VEVENT",
      "SUMMARY:Recurring Event",
      "DTSTART:20060610T180000Z",
      "DTEND:20060610T200000Z",
      "RRULE:FREQ=WEEKLY",
      "END:VEVENT",
    ].join("\r\n")
  );

  event = await pclient.addItem(event);
  equal(gServer.events.length, 1);
  equal(gServer.events[0].recurrence.length, 1);
  equal(gServer.events[0].recurrence[0], "RRULE:FREQ=WEEKLY");

  let occ = event.recurrenceInfo.getNextOccurrence(event.startDate);
  let changedOcc = occ.clone();
  changedOcc.title = "changed";
  event.recurrenceInfo.modifyException(occ, true);

  event = await pclient.modifyItem(changedOcc, occ);
  occ = event.recurrenceInfo.getNextOccurrence(event.startDate);
  equal(occ.title, "changed");
  equal(gServer.events.length, 2);

  gServer.resetClient(client);
});

add_task(async function test_recurring_exception() {
  gServer.syncs = [
    {
      token: "1",
      events: [
        {
          kind: "calendar#event",
          etag: '"1"',
          id: "go6ijb0b46hlpbu4eeu92njevo",
          created: "2006-06-08T21:04:52.000Z",
          updated: "2006-06-08T21:05:49.138Z",
          summary: "New Event",
          creator: gServer.creator,
          organizer: gServer.creator,
          start: { dateTime: "2006-06-10T18:00:00+02:00" },
          end: { dateTime: "2006-06-10T20:00:00+02:00" },
          iCalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
          recurrence: ["RRULE:FREQ=WEEKLY"],
        },
        {
          kind: "calendar#event",
          etag: '"2"',
          id: "go6ijb0b46hlpbu4eeu92njevo_20060617T160000Z",
          summary: "New Event changed",
          start: { dateTime: "2006-06-17T18:00:00+02:00" },
          end: { dateTime: "2006-06-17T20:00:00+02:00" },
          recurringEventId: "go6ijb0b46hlpbu4eeu92njevo",
          originalStartTime: { dateTime: "2006-06-17T18:00:00+02:00" },
        },
      ],
    },
    {
      // This sync run tests an exception where the master item is not part
      // of the item stream.
      token: "2",
      events: [
        {
          kind: "calendar#event",
          etag: '"3"',
          id: "go6ijb0b46hlpbu4eeu92njevo_20060617T160000Z",
          summary: "New Event changed",
          start: { dateTime: "2006-06-17T18:00:00+02:00" },
          end: { dateTime: "2006-06-17T20:00:00+02:00" },
          status: "cancelled",
          recurringEventId: "go6ijb0b46hlpbu4eeu92njevo",
          originalStartTime: { dateTime: "2006-06-17T18:00:00+02:00" },
        },
      ],
    },
  ];

  let client = await gServer.getClient();
  let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

  let items = await pclient.getAllItems();
  equal(items.length, 1);

  let exIds = items[0].recurrenceInfo.getExceptionIds({});
  equal(exIds.length, 1);

  let ex = items[0].recurrenceInfo.getExceptionFor(exIds[0]);
  equal(ex.title, "New Event changed");

  client.refresh();
  await gServer.waitForLoad(client);

  items = await pclient.getAllItems();
  equal(items.length, 1);

  exIds = items[0].recurrenceInfo.getExceptionIds({});
  equal(exIds.length, 0);

  gServer.resetClient(client);
});

add_task(async function test_recurring_cancelled_exception() {
  gServer.syncs = [
    {
      token: "1",
      events: [
        {
          kind: "calendar#event",
          etag: '"1"',
          id: "go6ijb0b46hlpbu4eeu92njevo",
          status: "cancelled",
        },
        {
          kind: "calendar#event",
          etag: '"2"',
          id: "go6ijb0b46hlpbu4eeu92njevo_20060617T160000Z",
          status: "cancelled",
          recurringEventId: "go6ijb0b46hlpbu4eeu92njevo",
          originalStartTime: { dateTime: "2006-06-17T18:00:00+02:00" },
        },
      ],
    },
  ];

  let client = await gServer.getClient();
  let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

  let items = await pclient.getAllItems();
  equal(items.length, 0);

  gServer.resetClient(client);
});

add_task(async function test_import_invitation() {
  Services.prefs.setBoolPref("calendar.google.enableAttendees", true);
  let client = await gServer.getClient();
  let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);
  let event = cal.createEvent(
    [
      "BEGIN:VEVENT",
      "UID:xpcshell-import",
      "CREATED:20060608T210452Z",
      "LAST-MODIFIED:20060608T210549Z",
      "DTSTAMP:20060608T210549Z",
      "SUMMARY:New Event",
      "STATUS:CONFIRMED",
      "ORGANIZER;CN=Omlettte B. Clam:mailto:ombclam@example.com",
      "ATTENDEE;CN=Omlettte B. Clam;PARTSTAT=ACCEPTED;CUTYPE=INDIVIDUAL;",
      " ROLE=REQ-PARTICIPANT:mailto:ombclam@example.com",
      "ATTENDEE;CN=Eggs P. Seashell;PARTSTAT=TENTATIVE;CUTYPE=INDIVIDUAL;",
      " ROLE=REQ-PARTICIPANT:mailto:xpcshell@example.com",
      "DTSTART:20060610T180000Z",
      "DTEND:20060610T200000Z",
      "SEQUENCE:1",
      "END:VEVENT",
    ].join("\r\n")
  );

  let addedItem = await pclient.adoptItem(event);
  equal(gServer.events.length, 1);
  equal(addedItem.icalString, event.icalString);
  gServer.resetClient(client);
  Services.prefs.setBoolPref("calendar.google.enableAttendees", false);
});

add_task(async function test_modify_invitation() {
  Services.prefs.setBoolPref("calendar.google.enableAttendees", true);
  let organizer = {
    displayName: "organizer name",
    email: "organizer@example.com",
    organizer: true,
    responseStatus: "tentative",
  };
  let attendee = Object.assign({}, gServer.creator);
  attendee.responseStatus = "needsAction";

  gServer.events = [
    {
      kind: "calendar#event",
      etag: '"2299601498276000"',
      id: "go6ijb0b46hlpbu4eeu92njevo",
      status: "confirmed",
      htmlLink: gServer.baseUri + "/calendar/event?eid=eventhash",
      created: "2006-06-08T21:04:52.000Z",
      updated: "2006-06-08T21:05:49.138Z",
      summary: "New Event",
      description: "description",
      location: "Hard Drive",
      colorId: 17,
      creator: organizer,
      organizer: organizer,
      start: { dateTime: "2006-06-10T18:00:00+02:00" },
      end: { dateTime: "2006-06-10T20:00:00+02:00" },
      transparency: "transparent",
      visibility: "private",
      iCalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
      sequence: 1,
      attendees: [organizer, attendee],
    },
  ];

  // Case #1: User is attendee
  let client = await gServer.getClient();
  let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

  let items = await pclient.getAllItems();
  equal(items.length, 1);

  let item = items[0];
  let att = cal.itip.getInvitedAttendee(item);
  let newItem = item.clone();

  notEqual(att, null);
  equal(att.id, "mailto:" + attendee.email);
  equal(att.participationStatus, "NEEDS-ACTION");

  newItem.removeAttendee(att);
  att = att.clone();
  att.participationStatus = "ACCEPTED";
  newItem.addAttendee(att);

  await pclient.modifyItem(newItem, items[0]);
  equal(gServer.lastMethod, "PATCH");

  // Case #2: User is organizer
  let events = gServer.events;
  gServer.resetClient(client);
  gServer.events = events;

  organizer = Object.assign({}, gServer.creator);
  organizer.responseStatus = "accepted";
  organizer.organizer = true;
  attendee = {
    displayName: "attendee name",
    email: "attendee@example.com",
    responseStatus: "tentative",
  };

  gServer.events[0].organizer = gServer.creator;
  gServer.events[0].creator = gServer.creator;
  gServer.events[0].attendees = [organizer, attendee];

  client = await gServer.getClient();
  pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

  items = await pclient.getAllItems();
  equal(items.length, 1);

  item = items[0];
  let org = item.getAttendeeById("mailto:" + organizer.email);
  newItem = item.clone();

  notEqual(org, null);
  equal(org.id, "mailto:" + organizer.email);
  equal(org.participationStatus, "ACCEPTED");

  newItem.removeAttendee(org);
  org = org.clone();
  org.participationStatus = "TENTATIVE";
  newItem.addAttendee(org);

  await pclient.modifyItem(newItem, items[0]);
  equal(gServer.lastMethod, "PUT");

  gServer.resetClient(client);
});

add_task(async function test_metadata() {
  gServer.events = [
    {
      kind: "calendar#event",
      etag: '"1"',
      id: "go6ijb0b46hlpbu4eeu92njevo",
      created: "2006-06-08T21:04:52.000Z",
      updated: "2006-06-08T21:05:49.138Z",
      summary: "New Event",
      creator: gServer.creator,
      organizer: gServer.creator,
      start: { dateTime: "2006-06-10T18:00:00+02:00" },
      end: { dateTime: "2006-06-10T20:00:00+02:00" },
      iCalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
    },
  ];
  gServer.tasks = [
    {
      kind: "tasks#task",
      id: "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
      etag: '"2"',
      title: "New Task",
      updated: "2014-09-08T16:30:27.000Z",
      selfLink:
        gServer.baseUri +
        "/tasks/v1/lists/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDow/tasks/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
      notes: "description",
    },
  ];

  let client = await gServer.getClient();
  let offline = client.wrappedJSObject.mCachedCalendar;
  let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

  // Check initial metadata
  let items = await pclient.getAllItems();
  let meta = getAllMeta(offline);
  let [event, task] = items;
  ok(cal.item.isEvent(event));
  ok(cal.item.isToDo(task));
  equal(meta.size, 2);
  equal(meta.get(event.hashId), ['"1"', "go6ijb0b46hlpbu4eeu92njevo", false].join("\u001A"));
  equal(
    meta.get(task.hashId),
    ['"2"', "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU", false].join("\u001A")
  );

  // Modify an event
  gServer.nextEtag = '"3"';
  let newEvent = event.clone();
  newEvent.title = "changed";
  await pclient.modifyItem(newEvent, event);

  items = await pclient.getAllItems();
  meta = getAllMeta(offline);
  [event, task] = items;
  ok(cal.item.isEvent(event));
  ok(cal.item.isToDo(task));
  equal(meta.size, 2);
  equal(meta.get(event.hashId), ['"3"', "go6ijb0b46hlpbu4eeu92njevo", false].join("\u001A"));
  equal(
    meta.get(task.hashId),
    ['"2"', "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU", false].join("\u001A")
  );

  // Modify a task
  gServer.nextEtag = '"4"';
  let newTask = task.clone();
  newTask.title = "changed";
  await pclient.modifyItem(newTask, task);

  items = await pclient.getAllItems();
  meta = getAllMeta(offline);
  [event, task] = items;
  equal(meta.size, 2);
  equal(meta.get(event.hashId), ['"3"', "go6ijb0b46hlpbu4eeu92njevo", false].join("\u001A"));
  equal(
    meta.get(task.hashId),
    ['"4"', "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU", false].join("\u001A")
  );

  // Delete an event
  await pclient.deleteItem(event);
  meta = getAllMeta(offline);
  equal(meta.size, 1);
  equal(
    meta.get(task.hashId),
    ['"4"', "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU", false].join("\u001A")
  );

  // Delete a task
  await pclient.deleteItem(task);
  meta = getAllMeta(offline);
  equal(meta.size, 0);

  // Add an event
  gServer.nextEtag = '"6"';
  newEvent = await pclient.addItem(event);
  meta = getAllMeta(offline);
  equal(meta.size, 1);
  equal(gServer.events.length, 1);
  equal(meta.get(newEvent.hashId), ['"6"', gServer.events[0].id, false].join("\u001A"));

  // Add a task
  gServer.nextEtag = '"7"';
  newTask = await pclient.addItem(task);
  meta = getAllMeta(offline);
  equal(meta.size, 2);
  equal(gServer.events.length, 1);
  equal(gServer.tasks.length, 1);
  equal(meta.get(newEvent.hashId), ['"6"', gServer.events[0].id, false].join("\u001A"));
  equal(meta.get(newTask.hashId), ['"7"', gServer.tasks[0].id, false].join("\u001A"));

  gServer.resetClient(client);
});

add_task(async function test_metadata_recurring() {
  gServer.events = [
    {
      kind: "calendar#event",
      etag: '"1"',
      id: "go6ijb0b46hlpbu4eeu92njevo",
      created: "2006-06-08T21:04:52.000Z",
      updated: "2006-06-08T21:05:49.138Z",
      summary: "New Event",
      creator: gServer.creator,
      organizer: gServer.creator,
      start: { dateTime: "2006-06-10T18:00:00+02:00" },
      end: { dateTime: "2006-06-10T20:00:00+02:00" },
      iCalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
      recurrence: ["RRULE:FREQ=WEEKLY"],
    },
    {
      kind: "calendar#event",
      etag: '"2"',
      id: "go6ijb0b46hlpbu4eeu92njevo_20060610T160000Z",
      summary: "New Event changed",
      start: { dateTime: "2006-06-10T18:00:00+02:00" },
      end: { dateTime: "2006-06-10T20:00:00+02:00" },
      recurringEventId: "go6ijb0b46hlpbu4eeu92njevo",
      originalStartTime: { dateTime: "2006-06-10T18:00:00+02:00" },
    },
    {
      kind: "calendar#event",
      etag: '"3"',
      id: "go6ijb0b46hlpbu4eeu92njevo_20060617T160000Z",
      summary: "New Event next week",
      start: { dateTime: "2006-06-17T18:00:00+02:00" },
      end: { dateTime: "2006-06-17T20:00:00+02:00" },
      recurringEventId: "go6ijb0b46hlpbu4eeu92njevo",
      originalStartTime: { dateTime: "2006-06-17T18:00:00+02:00" },
    },
  ];

  let client = await gServer.getClient();
  let offline = client.wrappedJSObject.mCachedCalendar;
  let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);
  let items = await pclient.getAllItems();

  let meta = getAllMeta(offline);
  equal(meta.size, 3);
  equal(meta.get(items[0].hashId), ['"1"', "go6ijb0b46hlpbu4eeu92njevo", false].join("\u001A"));

  // The exception metadata should also exist
  let exIds = items[0].recurrenceInfo.getExceptionIds({});
  equal(exIds.length, 2);
  let ex = items[0].recurrenceInfo.getExceptionFor(exIds[0]);
  equal(
    meta.get(ex.hashId),
    ['"2"', "go6ijb0b46hlpbu4eeu92njevo_20060610T160000Z", false].join("\u001A")
  );

  // Changing an exception should retain the metadata entries
  let newEx = ex.clone();
  newEx.title = "New Event changed again";
  gServer.nextEtag = '"4"';
  await pclient.modifyItem(newEx, ex);
  meta = getAllMeta(offline);
  equal(meta.size, 3);
  equal(
    meta.get(newEx.hashId),
    ['"4"', "go6ijb0b46hlpbu4eeu92njevo_20060610T160000Z", false].join("\u001A")
  );

  // Deleting an exception should delete the metadata, as it turns into an EXDATE
  let newItem = items[0].clone();
  newItem.recurrenceInfo.removeOccurrenceAt(exIds[0]);
  await pclient.modifyItem(newItem, items[0]);

  meta = getAllMeta(offline);
  equal(meta.size, 2);

  // Deleting the master item should remove all metadata entries
  await pclient.deleteItem(items[0]);
  meta = getAllMeta(offline);
  equal(meta.size, 0);

  gServer.resetClient(client);
});

add_task(async function test_conflict_modify() {
  // TODO task/event conflicts are handled in the same way so I'm going to
  // skip adding tests for tasks here, but it probably wouldn't hurt to
  // create them at some point.
  gServer.events = [
    {
      kind: "calendar#event",
      etag: '"1"',
      id: "go6ijb0b46hlpbu4eeu92njevo",
      created: "2006-06-08T21:04:52.000Z",
      updated: "2006-06-08T21:05:49.138Z",
      summary: "New Event",
      creator: gServer.creator,
      organizer: gServer.creator,
      start: { dateTime: "2006-06-10T18:00:00+02:00" },
      end: { dateTime: "2006-06-10T20:00:00+02:00" },
      iCalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
    },
  ];
  let client = await gServer.getClient();
  let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);
  let item = (await pclient.getAllItems())[0];

  // Case #1: Modified on server, modify locally, overwrite conflict
  MockConflictPrompt.overwrite = true;
  let newItem = item.clone();
  newItem.title = "local change";
  gServer.events[0].etag = '"2"';
  gServer.events[0].summary = "remote change";
  let modifiedItem = await pclient.modifyItem(newItem, item);
  item = (await pclient.getAllItems())[0];
  equal(gServer.events[0].summary, "local change");
  notEqual(gServer.events[0].etag, '"2"');
  equal(item.title, "local change");
  equal(modifiedItem.title, "local change");
  equal(gServer.events.length, 1);

  // Case #2: Modified on server, modify locally, don't overwrite conflict
  MockConflictPrompt.overwrite = false;
  gServer.events[0].etag = '"3"';
  gServer.events[0].summary = "remote change";
  try {
    modifiedItem = await pclient.modifyItem(newItem, item);
    do_throw("Expected modifyItem to be cancelled");
  } catch (e) {
    // Swallow cancelling the request
    if (e != Ci.calIErrors.OPERATION_CANCELLED) {
      throw e;
    }
  }

  await gServer.waitForLoad(client);

  item = (await pclient.getAllItems())[0];
  equal(gServer.events[0].summary, "remote change");
  equal(gServer.events[0].etag, '"3"');
  equal(item.title, "remote change");

  // Case #3: Modified on server, delete locally, don't overwrite conflict
  MockConflictPrompt.overwrite = false;
  gServer.events[0].etag = '"4"';
  gServer.events[0].summary = "remote change";
  try {
    await pclient.deleteItem(item);
    do_throw("Expected deleteItem to be cancelled");
  } catch (e) {
    // Swallow cancelling the request
    if (e != Ci.calIErrors.OPERATION_CANCELLED) {
      throw e;
    }
  }

  await gServer.waitForLoad(client);

  item = (await pclient.getAllItems())[0];
  equal(gServer.events[0].summary, "remote change");
  equal(gServer.events[0].etag, '"4"');
  equal(item.title, "remote change");

  // Case #4: Modified on server, delete locally, overwrite conflict
  MockConflictPrompt.overwrite = true;
  gServer.events[0].etag = '"5"';
  gServer.events[0].summary = "remote change";
  await pclient.deleteItem(item);
  item = (await pclient.getAllItems())[0];
  equal(gServer.events.length, 0);

  gServer.resetClient(client);
});

add_task(async function test_conflict_delete() {
  // TODO task/event conflicts are handled in the same way so I'm going to
  // skip adding tests for tasks here, but it probably wouldn't hurt to
  // create them at some point.
  let coreEvent = {
    kind: "calendar#event",
    etag: '"2"',
    id: "go6ijb0b46hlpbu4eeu92njevo",
    created: "2006-06-08T21:04:52.000Z",
    updated: "2006-06-08T21:05:49.138Z",
    summary: "New Event",
    creator: gServer.creator,
    organizer: gServer.creator,
    start: { dateTime: "2006-06-10T18:00:00+02:00" },
    end: { dateTime: "2006-06-10T20:00:00+02:00" },
    iCalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
  };

  // Load initial event to server
  gServer.events = [coreEvent];
  let client = await gServer.getClient();
  let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);
  let item = (await pclient.getAllItems())[0];

  // Case #1: Deleted on server, modify locally, overwrite conflict
  MockConflictPrompt.overwrite = true;
  gServer.events = [];
  let newItem = item.clone();
  newItem.title = "local change";
  let modifiedItem = await pclient.modifyItem(newItem, item);
  item = (await pclient.getAllItems())[0];
  equal(gServer.events[0].summary, "local change");
  notEqual(gServer.events[0].etag, '"2"');
  equal(item.title, "local change");
  equal(modifiedItem.title, "local change");
  equal(gServer.events.length, 1);

  // Case #2: Deleted on server, modify locally, don't overwrite conflict
  MockConflictPrompt.overwrite = false;
  gServer.events = [];
  try {
    modifiedItem = await pclient.modifyItem(newItem, item);
    do_throw("Expected modifyItem to be cancelled");
  } catch (e) {
    // Swallow cancelling the request
    if (e != Ci.calIErrors.OPERATION_CANCELLED) {
      throw e;
    }
  }
  // The next synchronize should cause the event to be deleted locally.
  coreEvent.status = "cancelled";
  gServer.events = [coreEvent];

  await gServer.waitForLoad(client);

  let items = await pclient.getAllItems();
  equal(items.length, 0);
  equal(gServer.events.length, 1);

  // Put the event back in the calendar for the next run
  delete gServer.events[0].status;
  client.refresh();
  await gServer.waitForLoad(client);
  items = await pclient.getAllItems();
  equal(items.length, 1);

  // Case #3: Deleted on server, delete locally, don't overwrite conflict
  MockConflictPrompt.overwrite = false;
  gServer.events = [];
  try {
    await pclient.deleteItem(item);
    do_throw("Expected deleteItem to be cancelled");
  } catch (e) {
    // Swallow cancelling the request
    if (e != Ci.calIErrors.OPERATION_CANCELLED) {
      throw e;
    }
  }
  // The next synchronize should cause the event to be deleted locally.
  coreEvent.status = "cancelled";
  gServer.events = [coreEvent];
  await gServer.waitForLoad(client);

  items = await pclient.getAllItems();
  equal(items.length, 0);

  // Put the event back in the calendar for the next run
  delete gServer.events[0].status;
  client.refresh();
  await gServer.waitForLoad(client);
  items = await pclient.getAllItems();
  equal(items.length, 1);

  // Case #4: Deleted on server, delete locally, overwrite conflict
  MockConflictPrompt.overwrite = true;
  gServer.events = [];
  await pclient.deleteItem(item);
  items = await pclient.getAllItems();
  equal(items.length, 0);

  gServer.resetClient(client);
});

add_task(async function test_default_alarms() {
  let defaultReminders = [{ method: "popup", minutes: 10 }, { method: "email", minutes: 20 }];
  gServer.calendarListData.defaultReminders = defaultReminders;
  gServer.eventsData.defaultReminders = defaultReminders;
  gServer.events = [
    {
      kind: "calendar#event",
      etag: '"2"',
      id: "go6ijb0b46hlpbu4eeu92njevo",
      created: "2006-06-08T21:04:52.000Z",
      updated: "2006-06-08T21:05:49.138Z",
      summary: "Default Reminder",
      creator: gServer.creator,
      organizer: gServer.creator,
      start: { dateTime: "2006-06-10T18:00:00+02:00" },
      end: { dateTime: "2006-06-10T20:00:00+02:00" },
      iCalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
      reminders: { useDefault: true },
    },
  ];

  // Case #1: read default alarms from event stream
  let client = await gServer.getClient();
  let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);
  equal(client.getProperty("settings.defaultReminders"), JSON.stringify(defaultReminders));

  let item = (await pclient.getAllItems())[0];
  let alarms = item.getAlarms({});

  equal(alarms.length, 2);
  ok(alarms.every(x => x.getProperty("X-DEFAULT-ALARM") == "TRUE"));
  equal(alarms[0].action, "DISPLAY");
  equal(alarms[0].offset.icalString, "-PT10M");
  equal(alarms[1].action, "EMAIL");
  equal(alarms[1].offset.icalString, "-PT20M");

  // Case #2: add an item with only default alarms
  let event = cal.createEvent(
    [
      "BEGIN:VEVENT",
      "SUMMARY:Default Alarms",
      "DTSTART:20060610T180000Z",
      "DTEND:20060610T200000Z",
      "BEGIN:VALARM",
      "X-DEFAULT-ALARM:TRUE",
      "ACTION:DISPLAY",
      "TRIGGER;VALUE=DURATION:PT0S",
      "DESCRIPTION:Description",
      "END:VALARM",
      "END:VEVENT",
    ].join("\r\n")
  );

  await pclient.addItem(event);
  ok(gServer.events[1].reminders.useDefault);
  equal(gServer.events[1].reminders.overrides.length, 0);

  // Case #3: Mixed default/non-default alarms. Not sure this will happen
  event = cal.createEvent(
    [
      "BEGIN:VEVENT",
      "SUMMARY:Default Alarms",
      "DTSTART:20060610T180000Z",
      "DTEND:20060610T200000Z",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "X-DEFAULT-ALARM:TRUE",
      "TRIGGER;VALUE=DURATION:-PT1M",
      "DESCRIPTION:Description",
      "END:VALARM",
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      "TRIGGER;VALUE=DURATION:-PT5M",
      "DESCRIPTION:Description",
      "END:VALARM",
      "END:VEVENT",
    ].join("\r\n")
  );

  await pclient.addItem(event);
  ok(gServer.events[2].reminders.useDefault);
  equal(gServer.events[2].reminders.overrides.length, 1);
  equal(gServer.events[2].reminders.overrides[0].minutes, 5);

  gServer.resetClient(client);

  // Case #4a: Empty default alarms
  gServer.calendarListData.defaultReminders = [];
  gServer.eventsData.defaultReminders = [];
  client = await gServer.getClient();
  pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

  event = cal.createEvent(
    [
      "BEGIN:VEVENT",
      "SUMMARY:Default Alarms Empty",
      "DTSTART:20060610T180000Z",
      "DTEND:20060610T200000Z",
      "X-DEFAULT-ALARM:TRUE",
      "END:VEVENT",
    ].join("\r\n")
  );

  await pclient.addItem(event);
  ok(gServer.events[0].reminders.useDefault);
  equal(gServer.events[0].reminders.overrides, undefined);

  let events = gServer.events;
  gServer.resetClient(client);

  // Case #4b: Read an item with empty default alarms
  gServer.events = events;
  client = await gServer.getClient();
  pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

  item = (await pclient.getAllItems())[0];
  equal(item.getProperty("X-DEFAULT-ALARM"), "TRUE");

  gServer.resetClient(client);
});

add_task(async function test_paginate() {
  gServer.events = [
    {
      kind: "calendar#event",
      etag: '"1"',
      id: "go6ijb0b46hlpbu4eeu92njevo",
      created: "2006-06-08T21:04:52.000Z",
      updated: "2006-06-08T21:05:49.138Z",
      summary: "New Event",
      creator: gServer.creator,
      organizer: gServer.creator,
      start: { dateTime: "2006-06-10T18:00:00+02:00" },
      end: { dateTime: "2006-06-10T20:00:00+02:00" },
      iCalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
    },
    {
      kind: "calendar#event",
      etag: '"2"',
      id: "fepf8uf6n7n04w7feukucs9n8e",
      created: "2006-06-08T21:04:52.000Z",
      updated: "2006-06-08T21:05:49.138Z",
      summary: "New Event 2",
      creator: gServer.creator,
      organizer: gServer.creator,
      start: { dateTime: "2006-06-10T18:00:00+02:00" },
      end: { dateTime: "2006-06-10T20:00:00+02:00" },
      iCalUID: "fepf8uf6n7n04w7feukucs9n8e@google.com",
    },
  ];

  gServer.tasks = [
    {
      kind: "tasks#task",
      id: "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
      etag: '"Lck7VNWFJuXdzMtOmrYPx0KFV2s/LTIwNjA4MDcyNDM"',
      title: "New Task",
      updated: "2014-09-08T16:30:27.000Z",
      selfLink:
        gServer.baseUri +
        "/tasks/v1/lists/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDow/tasks/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
      position: "00000000000000130998",
      status: "needsAction",
    },
    {
      kind: "tasks#task",
      id: "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo5OTU0Mjk2MzQ",
      etag: '"Lck7VNWFJuXdzMtOmrYPx0KFV2s/LTQyNTY0MjUwOQ"',
      title: "New Task 2",
      updated: "2014-09-08T16:30:27.000Z",
      selfLink:
        gServer.baseUri +
        "/tasks/v1/lists/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDow/tasks/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo5OTU0Mjk2MzQ",
      position: "00000000000000130993",
      status: "needsAction",
    },
  ];

  Services.prefs.setIntPref("calendar.google.maxResultsPerRequest", 1);

  let client = await gServer.getClient();
  let pclient = cal.async.promisifyCalendar(client);

  // Make sure all pages were requested
  equal(gServer.eventsData.nextPageToken, null);
  equal(gServer.tasksData.nextPageToken, null);

  // ...and we have all items. Not checking props
  // because the other tests do this sufficiently.
  let items = await pclient.getAllItems();
  equal(items.length, 4);

  equal(client.getProperty("syncToken.events"), "next-sync-token");

  Services.prefs.clearUserPref("calendar.google.maxResultsPerRequest");
  gServer.resetClient(client);
});

add_task(async function test_incremental_reset() {
  gServer.syncs = [
    {
      token: "1",
      events: [
        {
          kind: "calendar#event",
          etag: '"1"',
          id: "go6ijb0b46hlpbu4eeu92njevo",
          created: "2006-06-08T21:04:52.000Z",
          updated: "2006-06-08T21:05:49.138Z",
          summary: "New Event",
          creator: gServer.creator,
          organizer: gServer.creator,
          start: { dateTime: "2006-06-10T18:00:00+02:00" },
          end: { dateTime: "2006-06-10T20:00:00+02:00" },
          iCalUID: "go6ijb0b46hlpbu4eeu92njevo@google.com",
        },
      ],
    },
    {
      token: "2",
      reset: true,
    },
    {
      token: "3",
      events: [
        {
          kind: "calendar#event",
          etag: '"2"',
          id: "fepf8uf6n7n04w7feukucs9n8e",
          created: "2006-06-08T21:04:52.000Z",
          updated: "2006-06-08T21:05:49.138Z",
          summary: "New Event 2",
          creator: gServer.creator,
          organizer: gServer.creator,
          start: { dateTime: "2006-06-10T18:00:00+02:00" },
          end: { dateTime: "2006-06-10T20:00:00+02:00" },
          iCalUID: "fepf8uf6n7n04w7feukucs9n8e@google.com",
        },
      ],
    },
  ];
  let client = await gServer.getClient();
  let pclient = cal.async.promisifyCalendar(client);

  let items = await pclient.getAllItems();
  equal(items.length, 1);
  equal(items[0].title, "New Event");

  client.refresh();
  await gServer.waitForLoad(client);

  items = await pclient.getAllItems();
  equal(items.length, 1);
  equal(items[0].title, "New Event 2");

  equal(gServer.syncs.length, 0);
  equal(client.getProperty("syncToken.events"), "last");

  gServer.resetClient(client);
});
