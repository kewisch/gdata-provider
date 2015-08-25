/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

(function load_gdata_manifest() {
  Components.utils.import("resource:///modules/Services.jsm");
  Services.prefs.setBoolPref("javascript.options.showInConsole", true);
  Services.prefs.setBoolPref("browser.dom.window.dump.enabled", true);
  Services.prefs.setBoolPref("calendar.debug.log", true);
  Services.prefs.setBoolPref("calendar.debug.log.verbose", true);

  let bindir = Services.dirsvc.get("CurProcD", Components.interfaces.nsIFile);
  bindir.append("extensions");
  bindir.append("{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}");
  bindir.append("chrome.manifest");
  dump("Loading" + bindir.path + "\n");
  Components.manager.autoRegister(bindir);
})();

Components.utils.import("resource://testing-common/httpd.js");
Components.utils.import("resource://gre/modules/NetUtil.jsm");
Components.utils.import("resource://gre/modules/Preferences.jsm");

Components.utils.import("resource://gdata-provider/modules/gdataSession.jsm");
Components.utils.import("resource://gdata-provider/modules/gdataUtils.jsm");
Components.utils.import("resource://calendar/modules/calAsyncUtils.jsm");
Components.utils.import("resource://calendar/modules/calProviderUtils.jsm");

var gServer;

var MockConflictPrompt = {
    _origFunc: null,
    overwrite: false,
    register: function() {
        if (!this._origFunc) {
            this._origFunc = cal.promptOverwrite;
            cal.promptOverwrite = (aMode, aItem) => {
                return this.overwrite;
            };
        }
    },

    unregister: function() {
        if (this._origFunc) {
            cal.promptOverwrite = this._origFunc;
            this._origFunc = null;
        }
    }
};

function GDataServer(calendarId, tasksId) {
    this.server = new HttpServer();
    this.calendarId = calendarId;
    this.tasksId = tasksId;

    let encCalendarId = encodeURIComponent(calendarId);
    let encTasksId = encodeURIComponent(tasksId);

    let events = "/calendar/v3/calendars/" + encCalendarId + "/events";
    let tasks = "/tasks/v1/lists/" + encTasksId + "/tasks";
    let calendarList = "/calendar/v3/users/me/calendarList/" + encCalendarId;

    this.server.registerPathHandler(calendarList, this.router.bind(this, this.calendarListRequest.bind(this)));
    this.server.registerPathHandler(events, this.router.bind(this, this.eventsRequest.bind(this)));
    this.server.registerPrefixHandler(events + "/", this.router.bind(this, this.eventsRequest.bind(this)));
    this.server.registerPathHandler(tasks, this.router.bind(this, this.tasksRequest.bind(this)));
    this.server.registerPrefixHandler(tasks + "/", this.router.bind(this, this.tasksRequest.bind(this)));

    this.resetRequest();

    let sessionMgr = getGoogleSessionManager();
    this.session = sessionMgr.getSessionById("xpcshell", true);
    this.session.oauth = {
        accessToken: "accessToken",
        refreshToken: "refreshToken",
        tokenExpires: Number.MAX_VALUE,
        connect: function(succ, fail, ui, refresh) {
            this.accessToken = "accessToken";
            succ();
        }
    };
}

GDataServer.prototype = {
    items: null,

    get baseUri() { return "http://localhost:" + this.server.identity.primaryPort + "/"; },

    start: function() {
        this.server.start(-1);
        do_register_cleanup(() => this.server.stop(() => {}));
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
            "email": this.calendarId,
            "self": true,
            "displayName": "Eggs P. Seashell"
        };

        this.eventsData = {
           "kind": "calendar#events",
           "etag": "\"1410880601360000\"",
           "nextSyncToken": generateID(),
           "updated": "2014-09-16T15:16:41.360Z",
           "accessRole": "owner",
           "summary": "xpcshell",
           "timeZone": "Europe/Berlin",
           "defaultReminders": [],
           "items": []
        };

        this.tasksData = {
            "kind": "tasks#tasks",
            "etag": "\"1410880601360000\"",
            "items": []
        };

        this.calendarListData = {
            "kind": "calendar#calendarListEntry",
            "etag": "\"1410084814736000\"",
            "id": this.calendarId,
            "summary": "xpcshell",
            "timeZone": "Europe/Berlin",
            "colorId": "17",
            "backgroundColor": "#9a9cff",
            "foregroundColor": "#000000",
            "primary": true,
            "selected": true,
            "accessRole": "owner",
            "defaultReminders": [],
            "notificationSettings": {
                "notifications": [
                    { "type": "eventCreation", "method": "email" },
                    { "type": "eventChange", "method": "email" },
                    { "type": "eventCancellation",  "method": "email" }
                ]
            }
        };
    },

    waitForLoad: function(aCalendar) {
        return new Promise(function(resolve, reject) {
            let observer = cal.createAdapter(Components.interfaces.calIObserver, {
                onLoad: function() {
                    aCalendar.removeObserver(observer);
                    resolve(aCalendar);
                }
            });
            aCalendar.addObserver(observer);
        });
    },

    getClient: function() {
        let uri = "googleapi://xpcshell/" +
                  "?testport=" + this.server.identity.primaryPort +
                  (this.calendarId ? "&calendar=" + encodeURIComponent(this.calendarId) : "") +
                  (this.tasksId ? "&tasks=" + encodeURIComponent(this.tasksId) : "");
        let calmgr = cal.getCalendarManager();
        let client = calmgr.createCalendar("gdata", Services.io.newURI(uri, null, null));
        client.name = "xpcshell";
        calmgr.registerCalendar(client);
        client.wrappedJSObject.mThrottleLimits = {};
        MockConflictPrompt.register();

        let cachedCalendar = calmgr.getCalendarById(client.id);
        return this.waitForLoad(cachedCalendar);
    },

    router: function(nextHandler, request, response) {
        try {
            let method = request.hasHeader("X-HTTP-Method-Override") ?
                         request.getHeader("X-HTTP-Method-Override") :
                         request.method;
            let parameters = new Map([ p.split("=", 2) for (p of request.queryString.split("&")) ]);

            let body;
            try {
                body = JSON.parse(NetUtil.readInputStreamToString(request.bodyInputStream,
                                  request.bodyInputStream.available()));
            } catch (e) {}

            this.lastMethod = method;
            return nextHandler(request, response, method, parameters, body);
        } catch (e) {
            do_print("Server Error: " + e.fileName + ":" + e.lineNumber + ": " + e + "\n");
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
         } else if ((method == "PUT" || method == "PATCH") && request.path.match(/\/events\/([a-z0-9_TZ]+)$/)) {
            // Modify an event
            let eventId = RegExp.$1;
            this.handleModify(request, response, body, this.events, eventId,
                              this.processModifyEvent.bind(this));
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
            this.handleModify(request, response, body, this.tasks, taskId,
                              this.processModifyTask.bind(this));
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

        let matchTag = request.hasHeader("If-Match") ?
                       request.getHeader("If-Match") : null;

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
            let [foundParentIndex, foundParent] = findKey(items, "id", body.recurringEventId);
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
        let [foundIndex, foundItem] = findKey(items, "id", itemId);

        let matchTag = request.hasHeader("If-Match") ?
                       request.getHeader("If-Match") : null;

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
        jsonData.etag = this.nextEtag || '"' + (new Date()).getTime() + '"';
        jsonData.id = generateID();
        if (!isImport) jsonData.htmlLink = this.baseUri + "/calendar/event?eid=" + jsonData.id;
        if (!isImport || !jsonData.iCalUID) jsonData.iCalUID = jsonData.id + "@google.com";
        if (!isImport || !jsonData.created) jsonData.created = cal.toRFC3339(cal.now());
        if (!isImport || !jsonData.updated) jsonData.updated = cal.toRFC3339(cal.now());
        if (!isImport || !jsonData.creator) jsonData.creator = this.creator;
        if (!isImport || !jsonData.organizer) jsonData.organizer = this.creator;
        this.nextEtag = null;
        return jsonData;
    },

    processModifyEvent: function(jsonData, id) {
        jsonData.kind = "calendar#event";
        jsonData.etag = this.nextEtag || '"' + (new Date()).getTime() + '"';
        jsonData.updated  = cal.toRFC3339(cal.now());
        jsonData.id = id;
        jsonData.iCalUID = (jsonData.recurringEventId || jsonData.id) + "@google.com";
        if (!jsonData.creator) jsonData.creator = this.creator;
        if (!jsonData.organizer) jsonData.organizer = this.creator;

        this.nextEtag = null;
        return jsonData;
    },

    processAddTask: function(jsonData) {
        jsonData.kind = "tasks#task";
        jsonData.etag = this.nextEtag || '"' + (new Date()).getTime() + '"';
        jsonData.id = generateID();
        jsonData.position = generateID(); // Not a real position, but we don't really use this at the moment
        if (!jsonData.status) jsonData.status = "needsAction";
        if (!jsonData.updated) jsonData.updated = cal.toRFC3339(cal.now());

        this.nextEtag = null;
        return jsonData;
    },

    processModifyTask: function(jsonData) {
        jsonData.kind = "tasks#task";
        jsonData.etag = this.nextEtag || '"' + (new Date()).getTime() + '"';
        jsonData.updated  = cal.toRFC3339(cal.now());
        if (!jsonData.status) jsonData.status = "needsAction";
        if (!jsonData.updated) jsonData.updated = cal.toRFC3339(cal.now());

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
    let c = "abcdefghijklmnopqrstuvwxyz0123456789"
    let s = "";
    for (let i = 26; i; i--) {
      s += c[Math.floor(Math.random() * c.length)];
    }
    return s;
}

function getAllMeta(calendar) {
    let keys = {}, values = {};
    calendar.getAllMetaData({}, keys, values);
    return new Map(keys.value.map((k,i) => [k,values.value[i]]));
}

function run_test() {
    do_get_profile();
    cal.getCalendarManager().startup({onResult: function() {
        gServer = new GDataServer("xpcshell@example.com", "tasksId");
        gServer.start();
        cal.getTimezoneService().startup({onResult: function() {
            run_next_test();
        }});
    }});
}

add_task(function* test_migrate_cache() {
    let uriString = "googleapi://xpcshell/?calendar=xpcshell%40example.com";
    let uri = Services.io.newURI(uriString, null, null);
    let client = cal.getCalendarManager().createCalendar("gdata", uri);
    let unwrapped = client.wrappedJSObject;
    let migrateStorageCache = unwrapped.migrateStorageCache.bind(unwrapped);

    monkeyPatch(unwrapped, "resetSync", function(protofunc) {
        return Promise.resolve();
    });

    // No version, should not reset
    equal((yield migrateStorageCache()), false);
    equal(client.getProperty("cache.version"), 3);

    // Check migrate 1 -> 2
    unwrapped.CACHE_DB_VERSION = 2;
    client.setProperty("cache.version", 1);
    equal((yield migrateStorageCache()), true);
    equal(client.getProperty("cache.version"), 2);

    // Check migrate 2 -> 3 normal calendar
    unwrapped.CACHE_DB_VERSION = 3;
    client.setProperty("cache.version", 2);
    equal((yield migrateStorageCache()), false);

    // Check migrate 2 -> 3 birthday calendar
    unwrapped.CACHE_DB_VERSION = 3;
    uri = "googleapi://xpcshell/?calendar=%23contacts%40group.v.calendar.google.com";
    unwrapped.uri = Services.io.newURI(uri, null, null);
    client.setProperty("cache.version", 2);
    equal((yield migrateStorageCache()), true);
});

add_test(function test_migrate_uri() {
    function checkMigrate(fromUri, session, calendarId, tasksId) {
        let uri = Services.io.newURI(fromUri, null, null);
        let client = cal.getCalendarManager().createCalendar("gdata", uri);

        if (session) {
            let target = ("googleapi://" + session + "/?" +
                         (calendarId ? "&calendar=" + encodeURIComponent(calendarId) : "") +
                         (tasksId ? "&tasks=" + encodeURIComponent(tasksId) : "")).replace("?&", "?");
            equal(client.getProperty("uri"), target);
        } else {
            equal(client.getProperty("uri"), null);
        }
    }

    checkMigrate("http://www.google.com/calendar/feeds/example%40example.com/public/full",
                 "example@example.com", "example@example.com", null);

    checkMigrate("webcal://www.google.com/calendar/feeds/example%40example.com/public/full",
                 "example@example.com", "example@example.com", null);

    Preferences.set("calendar.google.calPrefs.example@example.com.googleUser", "example@example.com");
    checkMigrate("http://www.google.com/calendar/feeds/example%40example.com/public/full",
                 "example@example.com", "example@example.com", "@default");

    checkMigrate("ehmwtf://www.google.com/calendar/feeds/example%40example.com/public/full");
    checkMigrate("googleapi://session/?calendar=calendarId&tasksId=tasksId");

    run_next_test();
});

add_test(function test_dateToJSON() {
    function _createDateTime(timezone) {
        let dt = cal.createDateTime();
        dt.resetTo(2015, 0, 30, 12, 0, 0, timezone);
    }

    let tzProvider = cal.getTimezoneService();
    let localTz = Services.prefs.getCharPref("calendar.timezone.local") || null;

    // no timezone
    let dt = _createDateTime(cal.floating());
    equal(dateToJSON(dt), {});

    // valid non-Olson tz name
    dt = _createDateTime(tzProvider.getTimezone("Eastern Standard Time"));
    equal(dateToJSON(dt), {"dateTime": "2015-01-30T12:00:00", "timeZone": "America/New_York"});

    // valid continent/city Olson tz
    dt = _createDateTime(tzProvider.getTimezone("America/New_York"));
    equal(dateToJSON(dt), {"dateTime": "2015-01-30T12:00:00", "timeZone": "America/New_York"});

    // valid continent/region/city Olson tz
    dt = _createDateTime(tzProvider.getTimezone("America/Argentina/Buenos_Aires"));
    equal(dateToJSON(dt), {"dateTime": "2015-01-30T12:00:00", "timeZone": "America/New_York"});

    // unknown but formal valid Olson tz
    dt = _createDateTime(tzProvider.getTimezone("Unknown/Olson/Timezone"));
    equal(dateToJSON(dt), {"dateTime": "2015-01-30T12:00:00", "timeZone": "Unknown/Olson/Timezone"});

    // invalid non-Olson tz
    dt = _createDateTime(tzProvider.getTimezone("InvalidTimeZone"));
    notEqual(dateToJSON(dt), {"dateTime": "2015-01-30T12:00:00", "timeZone": "InvalidTimeZone"});

    // timezone guessing: UTC
    Services.prefs.setCharPref("calendar.timezone.local", "UTC");
    equal(dateToJSON(dt), {"dateTime": "2015-01-30T12:00:00", "timeZone": "UTC"});

    // timezone guessing Etc
    Services.prefs.setCharPref("calendar.timezone.local", "Europe/Berlin");
    let now = cal.now();
    ok((now.timezoneOffset == 3600 || now.timezoneOffset == 7200),
       "Invalid timezone offset for testing Etc guessing!");
    let tz = (now.timezoneOffset == 3600) ? "Etc/GMT-1" : "Etc/GMT-2";
    equal(dateToJSON(dt), {"dateTime": "2015-01-30T12:00:00", "timeZone": tz});

    // date only
    dt.isDate = true;
    equal(dateToJSON(dt), {"date": "2015-01-30"});

    if (localTz) {
        Services.prefs.setCharPref("calendar.timezone.local", localTz);
    } else {
        Services.prefs.clearUserPref("calendar.timezone.local");
    }

    run_next_test();
});

add_task(function* test_organizerCN() {
    gServer.events = [];
    let client = yield gServer.getClient();
    equal(client.getProperty("organizerCN"), null);
    gServer.resetClient(client);

    gServer.events = [{
       "kind": "calendar#event",
       "etag": "\"2299601498276000\"",
       "id": "go6ijb0b46hlpbu4eeu92njevo",
       "created": "2006-06-08T21:04:52.000Z",
       "updated": "2006-06-08T21:05:49.138Z",
       "summary": "New Event",
       "creator": gServer.creator,
       "organizer": gServer.creator,
       "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
       "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
       "iCalUID": "go6ijb0b46hlpbu4eeu92njevo@google.com"
    }];
    client = yield gServer.getClient();
    equal(client.getProperty("organizerCN"), gServer.creator.displayName);
    gServer.resetClient(client);
});

add_task(function* test_always_readOnly() {
    gServer.events = [{
       "kind": "calendar#event",
       "etag": "\"2299601498276000\"",
       "id": "go6ijb0b46hlpbu4eeu92njevo",
       "created": "2006-06-08T21:04:52.000Z",
       "updated": "2006-06-08T21:05:49.138Z",
       "summary": "New Event",
       "creator": gServer.creator,
       "organizer": gServer.creator,
       "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
       "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
       "iCalUID": "go6ijb0b46hlpbu4eeu92njevo@google.com"
    }];
    gServer.calendarListData.accessRole = "freeBusyReader";
    let client = yield gServer.getClient();
    let pclient = cal.async.promisifyCalendar(client);
    ok(client.readOnly)
    client.readOnly = false;
    ok(client.readOnly)

    let items = yield pclient.getAllItems();
    equal(items.length, 1);
    notEqual(items[0].title, "New Event");
    gServer.resetClient(client);

    gServer.calendarListData.accessRole = "reader";
    client = yield gServer.getClient();
    ok(client.readOnly)
    client.readOnly = false;
    ok(client.readOnly)
    gServer.resetClient(client);
});

add_task(function* test_reset_sync() {
    gServer.tasks = [
       {
        "kind": "tasks#task",
        "id": "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
        "etag": "\"Lck7VNWFJuXdzMtOmrYPx0KFV2s/LTIwNjA4MDcyNDM\"",
        "title": "New Task",
        "updated": "2014-09-08T16:30:27.000Z",
        "selfLink": gServer.baseUri + "/tasks/v1/lists/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDow/tasks/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
        "position": "00000000000000130998",
        "status": "needsAction"
      },{
        "kind": "tasks#task",
        "id": "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo5OTU0Mjk2MzQ",
        "etag": "\"Lck7VNWFJuXdzMtOmrYPx0KFV2s/LTQyNTY0MjUwOQ\"",
        "title": "New Task 2",
        "updated": "2014-09-08T16:30:27.000Z",
        "selfLink": gServer.baseUri + "/tasks/v1/lists/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDow/tasks/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo5OTU0Mjk2MzQ",
        "position": "00000000000000130993",
        "status": "needsAction"
      }
    ];
    gServer.events = [{
       "kind": "calendar#event",
       "etag": "\"1\"",
       "id": "go6ijb0b46hlpbu4eeu92njevo",
       "created": "2006-06-08T21:04:52.000Z",
       "updated": "2006-06-08T21:05:49.138Z",
       "summary": "New Event",
       "creator": gServer.creator,
       "organizer": gServer.creator,
       "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
       "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
       "iCalUID": "go6ijb0b46hlpbu4eeu92njevo@google.com"
    },{
       "kind": "calendar#event",
       "etag": "\"2\"",
       "id": "fepf8uf6n7n04w7feukucs9n8e",
       "created": "2006-06-08T21:04:52.000Z",
       "updated": "2006-06-08T21:05:49.138Z",
       "summary": "New Event 2",
       "creator": gServer.creator,
       "organizer": gServer.creator,
       "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
       "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
       "iCalUID": "fepf8uf6n7n04w7feukucs9n8e@google.com"
    }];
    let client = yield gServer.getClient();
    let uncached = client.wrappedJSObject.mUncachedCalendar.wrappedJSObject;
    let pclient = cal.async.promisifyCalendar(client);

    let items = yield pclient.getAllItems();
    equal(items.length, 4);

    notEqual(client.getProperty("syncToken.events"), "");
    notEqual(client.getProperty("lastUpdated.tasks"), "");

    yield uncached.resetSync();
    items = yield pclient.getAllItems();
    equal(items.length, 0);

    equal(client.getProperty("syncToken.events"), "");
    equal(client.getProperty("lastUpdated.tasks"), "");

    gServer.resetClient(client);
});

add_task(function* test_basicItems() {
    gServer.events = [
      {
         "kind": "calendar#event",
         "etag": "\"2299601498276000\"",
         "id": "go6ijb0b46hlpbu4eeu92njevo",
         "status": "confirmed",
         "htmlLink": gServer.baseUri + "/calendar/event?eid=eventhash",
         "created": "2006-06-08T21:04:52.000Z",
         "updated": "2006-06-08T21:05:49.138Z",
         "summary": "New Event",
         "description": "description",
         "location": "Hard Drive",
         "colorId": 17,
         "creator": gServer.creator,
         "organizer": gServer.creator,
         "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
         "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
         "transparency": "transparent",
         "visibility": "private",
         "iCalUID": "go6ijb0b46hlpbu4eeu92njevo@google.com",
         "sequence": 1,
         "reminders": {
            "useDefault": false,
            "overrides": [{
                "method": "email",
                "minutes": 20
             }]
         },
         "attendees": [{
            "displayName": "attendee name",
            "email": "attendee@example.com",
            "optional": true,
            "responseStatus": "tentative"
        }],

        "extendedProperties": {
          "shared": {
            "X-MOZ-CATEGORIES": "foo,bar"
          },
          "private": {
            "X-MOZ-LASTACK": "2014-01-01T01:01:01Z",
            "X-MOZ-SNOOZE-TIME": "2014-01-01T02:02:02Z"
          }
        }
      }
    ];

    gServer.tasks = [
       {
        "kind": "tasks#task",
        "id": "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
        "etag": "\"Lck7VNWFJuXdzMtOmrYPx0KFV2s/LTIwNjA4MDcyNDM\"",
        "title": "New Task",
        "updated": "2014-09-08T16:30:27.000Z",
        "selfLink": gServer.baseUri + "/tasks/v1/lists/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDow/tasks/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
        "position": "00000000000000130998",
        "status": "completed",
        "due": "2014-09-04T00:00:00.000Z",
        "completed": "2014-09-01T17:00:00.000Z",
        "notes": "description",
        "parent": "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo4MDIzOTU2NDc",
        "links": [{
          "link": "mailto:something@example.com",
          "description": "link description",
          "type": "email"
        }]
      }
    ];

    let client = yield gServer.getClient();
    let pclient = cal.async.promisifyCalendar(client);

    let items = yield pclient.getAllItems();
    equal(items.length, 2);

    let event = cal.isEvent(items[0]) ? items[0]: items[1];
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

    let task = cal.isToDo(items[0]) ? items[0] : items[1];
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

add_task(function* test_addModifyDeleteItem() {
    let client = yield gServer.getClient();
    let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);
    equal(gServer.events.length, 0);
    equal(gServer.tasks.length, 0);

    let event = cal.createEvent([
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
        "END:VEVENT"
    ].join("\r\n"));

    let task = cal.createTodo([
        "BEGIN:VTODO",
        "SUMMARY:New Task",
        "DESCRIPTION:description",
        "X-SORTKEY:00000000000000130998",
        "STATUS:COMPLETED",
        "DUE;VALUE=DATE:20140904",
        "COMPLETED:20140901T170000Z",
        "RELATED-TO;RELTYPE=PARENT:MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo4MDIzOTU2NDc",
        "ATTACH;FILENAME=\"link description\";X-GOOGLE-TYPE=email:mailto:something@example.com",
        "END:VTODO"
    ].join("\r\n"));

    // Add an event
    let addedEvent = yield pclient.adoptItem(event);
    notEqual(addedEvent.id, null);
    equal(addedEvent.organizer.id, "mailto:xpcshell@example.com");

    let items = yield pclient.getAllItems();
    equal(items.length, 1);
    equal(items[0].id, addedEvent.id);
    equal(items[0].organizer.id, "mailto:xpcshell@example.com");

    equal(gServer.events.length, 1)
    equal(gServer.tasks.length, 0);

    // Add a task
    let addedTask = yield pclient.adoptItem(task);
    notEqual(addedTask.id, null);

    items = yield pclient.getAllItems();
    equal(items.length, 2);
    equal(items[1].id, addedTask.id);

    equal(gServer.events.length, 1)
    equal(gServer.tasks.length, 1);

    // Modify an event
    let newEvent = items[0].clone();
    newEvent.title = "changed";

    let modifiedEvent = yield pclient.modifyItem(newEvent, items[0]);
    equal(modifiedEvent.title, "changed");
    notEqual(modifiedEvent.getProperty("LAST-MODIFIED"), addedEvent.getProperty("LAST-MODIFIED"));
    items = yield pclient.getAllItems();
    equal(items.length, 2);
    equal(items[0].title, "changed");
    equal(items[0].id, addedEvent.id);
    equal(items[0].getProperty("LAST-MODIFIED"), modifiedEvent.getProperty("LAST-MODIFIED"));
    equal(gServer.events.length, 1);
    equal(gServer.tasks.length, 1);

    // Modify a task
    let newTask = items[1].clone();
    newTask.title = "changed";

    let modifiedTask = yield pclient.modifyItem(newTask, items[1]);
    equal(modifiedTask.title, "changed");
    notEqual(modifiedTask.getProperty("LAST-MODIFIED"), addedTask.getProperty("LAST-MODIFIED"));
    items = yield pclient.getAllItems();
    equal(items.length, 2);
    equal(items[1].title, "changed");
    equal(items[1].id, addedTask.id);
    equal(items[1].getProperty("LAST-MODIFIED"), modifiedTask.getProperty("LAST-MODIFIED"));
    equal(gServer.events.length, 1);
    equal(gServer.tasks.length, 1);

    // Delete an event
    yield pclient.deleteItem(modifiedEvent);
    items = yield pclient.getAllItems();
    equal(items.length, 1);
    equal(gServer.events.length, 0);
    equal(gServer.tasks.length, 1);

    // Delete a task
    yield pclient.deleteItem(modifiedTask);
    items = yield pclient.getAllItems();
    equal(items.length, 0);
    equal(gServer.events.length, 0);
    equal(gServer.tasks.length, 0);

    gServer.resetClient(client);
});

add_task(function* test_recurring_event() {
    let client = yield gServer.getClient();
    let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

    let event = cal.createEvent([
        "BEGIN:VEVENT",
        "SUMMARY:Recurring Event",
        "DTSTART:20060610T180000Z",
        "DTEND:20060610T200000Z",
        "RRULE:FREQ=WEEKLY",
        "END:VEVENT"
    ].join("\r\n"));

    event = yield pclient.addItem(event);
    equal(gServer.events.length, 1);
    equal(gServer.events[0].recurrence.length, 1);
    equal(gServer.events[0].recurrence[0], "RRULE:FREQ=WEEKLY");

    let occ = event.recurrenceInfo.getNextOccurrence(event.startDate);
    let changedOcc = occ.clone();
    changedOcc.title = "changed";
    event.recurrenceInfo.modifyException(occ, true);

    event = yield pclient.modifyItem(changedOcc, occ);
    occ = event.recurrenceInfo.getNextOccurrence(event.startDate);
    equal(occ.title, "changed");
    equal(gServer.events.length, 2);

    gServer.resetClient(client);
});

add_task(function* test_recurring_exception() {
    gServer.syncs = [{
        token: "1",
        events: [{
            "kind": "calendar#event",
            "etag": "\"1\"",
            "id": "go6ijb0b46hlpbu4eeu92njevo",
            "created": "2006-06-08T21:04:52.000Z",
            "updated": "2006-06-08T21:05:49.138Z",
            "summary": "New Event",
            "creator": gServer.creator,
            "organizer": gServer.creator,
            "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
            "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
            "iCalUID": "go6ijb0b46hlpbu4eeu92njevo@google.com",
            "recurrence": [
                "RRULE:FREQ=WEEKLY"
            ]
        },{
            "kind": "calendar#event",
            "etag": "\"2\"",
            "id": "go6ijb0b46hlpbu4eeu92njevo_20060617T160000Z",
            "summary": "New Event changed",
            "start": { "dateTime": "2006-06-17T18:00:00+02:00" },
            "end": {"dateTime": "2006-06-17T20:00:00+02:00" },
            "recurringEventId": "go6ijb0b46hlpbu4eeu92njevo",
            "originalStartTime": { "dateTime": "2006-06-17T18:00:00+02:00" }
        }]
    },{
        // This sync run tests an exception where the master item is not part
        // of the item stream.
        token: "2",
        events: [{
            "kind": "calendar#event",
            "etag": "\"3\"",
            "id": "go6ijb0b46hlpbu4eeu92njevo_20060617T160000Z",
            "summary": "New Event changed",
            "start": { "dateTime": "2006-06-17T18:00:00+02:00" },
            "end": {"dateTime": "2006-06-17T20:00:00+02:00" },
            "status": "cancelled",
            "recurringEventId": "go6ijb0b46hlpbu4eeu92njevo",
            "originalStartTime": { "dateTime": "2006-06-17T18:00:00+02:00" }
        }]
    }];

    let client = yield gServer.getClient();
    let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

    let items = yield pclient.getAllItems();
    equal(items.length, 1);

    let exIds = items[0].recurrenceInfo.getExceptionIds({});
    equal(exIds.length, 1);

    let ex = items[0].recurrenceInfo.getExceptionFor(exIds[0]);
    equal(ex.title, "New Event changed");

    client.refresh();
    yield gServer.waitForLoad(client);

    items = yield pclient.getAllItems();
    equal(items.length, 1);

    exIds = items[0].recurrenceInfo.getExceptionIds({});
    equal(exIds.length, 0);

    gServer.resetClient(client);
});

add_task(function* test_import_invitation() {
    Preferences.set("calendar.google.enableAttendees", true);
    let client = yield gServer.getClient();
    let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);
    let event = cal.createEvent([
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
        "END:VEVENT"
    ].join("\r\n"));

    let addedItem = yield pclient.adoptItem(event);
    equal(gServer.events.length, 1);
    equal(addedItem.icalString, event.icalString);
    gServer.resetClient(client);
    Preferences.set("calendar.google.enableAttendees", false);
});

add_task(function* test_modify_invitation() {
    Preferences.set("calendar.google.enableAttendees", true);
    let organizer = {
        "displayName": "organizer name",
        "email": "organizer@example.com",
        "organizer": true,
        "responseStatus": "tentative"
    };
    let attendee = Object.assign({}, gServer.creator);
    attendee.responseStatus = "needsAction";

    gServer.events = [
      {
         "kind": "calendar#event",
         "etag": "\"2299601498276000\"",
         "id": "go6ijb0b46hlpbu4eeu92njevo",
         "status": "confirmed",
         "htmlLink": gServer.baseUri + "/calendar/event?eid=eventhash",
         "created": "2006-06-08T21:04:52.000Z",
         "updated": "2006-06-08T21:05:49.138Z",
         "summary": "New Event",
         "description": "description",
         "location": "Hard Drive",
         "colorId": 17,
         "creator": organizer,
         "organizer": organizer,
         "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
         "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
         "transparency": "transparent",
         "visibility": "private",
         "iCalUID": "go6ijb0b46hlpbu4eeu92njevo@google.com",
         "sequence": 1,
         "attendees": [organizer, attendee],
      }
    ];

    // Case #1: User is attendee
    let client = yield gServer.getClient();
    let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

    let items = yield pclient.getAllItems();
    equal(items.length, 1);

    let item = items[0];
    let att = cal.getInvitedAttendee(item);
    let newItem = item.clone();

    notEqual(att, null);
    equal(att.id, "mailto:" + attendee.email);
    equal(att.participationStatus, "NEEDS-ACTION");

    newItem.removeAttendee(att);
    att = att.clone();
    att.participationStatus = "ACCEPTED";
    newItem.addAttendee(att);

    let modifiedItem = yield pclient.modifyItem(newItem, items[0]);
    equal(gServer.lastMethod, "PATCH");

    // Case #2: User is organizer
    let events = gServer.events;
    gServer.resetClient(client);
    gServer.events = events;

    organizer = Object.assign({}, gServer.creator);
    organizer.responseStatus = "accepted";
    organizer.organizer = true;
    attendee = {
        "displayName": "attendee name",
        "email": "attendee@example.com",
        "responseStatus": "tentative"
    };

    gServer.events[0].organizer = gServer.creator;
    gServer.events[0].creator = gServer.creator;
    gServer.events[0].attendees = [organizer, attendee];

    client = yield gServer.getClient();
    pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

    items = yield pclient.getAllItems();
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

    modifiedItem = yield pclient.modifyItem(newItem, items[0]);
    equal(gServer.lastMethod, "PUT");

    gServer.resetClient(client);
});

add_task(function* test_metadata() {
    gServer.events = [{
        "kind": "calendar#event",
        "etag": "\"1\"",
        "id": "go6ijb0b46hlpbu4eeu92njevo",
        "created": "2006-06-08T21:04:52.000Z",
        "updated": "2006-06-08T21:05:49.138Z",
        "summary": "New Event",
        "creator": gServer.creator,
        "organizer": gServer.creator,
        "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
        "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
        "iCalUID": "go6ijb0b46hlpbu4eeu92njevo@google.com"
    }];
    gServer.tasks = [{
        "kind": "tasks#task",
        "id": "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
        "etag": "\"2\"",
        "title": "New Task",
        "updated": "2014-09-08T16:30:27.000Z",
        "selfLink": gServer.baseUri + "/tasks/v1/lists/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDow/tasks/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
        "notes": "description"
    }];

    let idToEtag = {
        "go6ijb0b46hlpbu4eeu92njevo@google.com": '"1"',
        "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU": '"2"'
    }

    let client = yield gServer.getClient();
    let offline = client.wrappedJSObject.mCachedCalendar;
    let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

    // Check initial metadata
    let items = yield pclient.getAllItems();
    let meta = getAllMeta(offline);
    let [event, task] = items;
    ok(cal.isEvent(event));
    ok(cal.isToDo(task));
    equal(meta.size, 2);
    equal(meta.get(event.hashId), ['"1"', "go6ijb0b46hlpbu4eeu92njevo", false].join("\u001A"));
    equal(meta.get(task.hashId), ['"2"', "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU", false].join("\u001A"));

    // Modify an event
    gServer.nextEtag = '"3"';
    let newEvent = event.clone();
    newEvent.title = "changed";
    yield pclient.modifyItem(newEvent, event);

    items = yield pclient.getAllItems();
    meta = getAllMeta(offline);
    [event, task] = items;
    ok(cal.isEvent(event));
    ok(cal.isToDo(task));
    equal(meta.size, 2);
    equal(meta.get(event.hashId), ['"3"', "go6ijb0b46hlpbu4eeu92njevo", false].join("\u001A"));
    equal(meta.get(task.hashId), ['"2"', "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU", false].join("\u001A"));

    // Modify a task
    gServer.nextEtag = '"4"';
    let newTask = task.clone();
    newTask.title = "changed";
    yield pclient.modifyItem(newTask, task);

    items = yield pclient.getAllItems();
    meta = getAllMeta(offline);
    [event, task] = items;
    equal(meta.size, 2);
    equal(meta.get(event.hashId), ['"3"', "go6ijb0b46hlpbu4eeu92njevo", false].join("\u001A"));
    equal(meta.get(task.hashId), ['"4"', "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU", false].join("\u001A"));

    // Delete an event
    yield pclient.deleteItem(event);
    meta = getAllMeta(offline);
    equal(meta.size, 1);
    equal(meta.get(task.hashId), ['"4"', "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU", false].join("\u001A"));

    // Delete a task
    yield pclient.deleteItem(task);
    meta = getAllMeta(offline);
    equal(meta.size, 0);

    // Add an event
    gServer.nextEtag = '"6"';
    newEvent = yield pclient.addItem(event);
    meta = getAllMeta(offline);
    equal(meta.size, 1);
    equal(gServer.events.length, 1);
    equal(meta.get(newEvent.hashId), ['"6"', gServer.events[0].id, false].join("\u001A"));

    // Add a task
    gServer.nextEtag = '"7"';
    newTask = yield pclient.addItem(task);
    meta = getAllMeta(offline);
    equal(meta.size, 2);
    equal(gServer.events.length, 1);
    equal(gServer.tasks.length, 1);
    equal(meta.get(newEvent.hashId), ['"6"', gServer.events[0].id, false].join("\u001A"));
    equal(meta.get(newTask.hashId), ['"7"', gServer.tasks[0].id, false].join("\u001A"));

    gServer.resetClient(client);
});

add_task(function* test_metadata_recurring() {
    gServer.events = [{
        "kind": "calendar#event",
        "etag": "\"1\"",
        "id": "go6ijb0b46hlpbu4eeu92njevo",
        "created": "2006-06-08T21:04:52.000Z",
        "updated": "2006-06-08T21:05:49.138Z",
        "summary": "New Event",
        "creator": gServer.creator,
        "organizer": gServer.creator,
        "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
        "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
        "iCalUID": "go6ijb0b46hlpbu4eeu92njevo@google.com",
        "recurrence": [
            "RRULE:FREQ=WEEKLY"
        ]
    },{
        "kind": "calendar#event",
        "etag": "\"2\"",
        "id": "go6ijb0b46hlpbu4eeu92njevo_20060610T160000Z",
        "summary": "New Event changed",
        "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
        "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
        "recurringEventId": "go6ijb0b46hlpbu4eeu92njevo",
        "originalStartTime": { "dateTime": "2006-06-10T18:00:00+02:00" }
    },{
        "kind": "calendar#event",
        "etag": "\"3\"",
        "id": "go6ijb0b46hlpbu4eeu92njevo_20060617T160000Z",
        "summary": "New Event next week",
        "start": { "dateTime": "2006-06-17T18:00:00+02:00" },
        "end": {"dateTime": "2006-06-17T20:00:00+02:00" },
        "recurringEventId": "go6ijb0b46hlpbu4eeu92njevo",
        "originalStartTime": { "dateTime": "2006-06-17T18:00:00+02:00" }
    }];

    let client = yield gServer.getClient();
    let offline = client.wrappedJSObject.mCachedCalendar;
    let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);
    let items = yield pclient.getAllItems();

    let meta = getAllMeta(offline);
    equal(meta.size, 3);
    equal(meta.get(items[0].hashId), ['"1"', "go6ijb0b46hlpbu4eeu92njevo", false].join("\u001A"));

    // The exception metadata should also exist
    let exIds = items[0].recurrenceInfo.getExceptionIds({});
    equal(exIds.length, 2);
    let ex = items[0].recurrenceInfo.getExceptionFor(exIds[0]);
    equal(meta.get(ex.hashId), ['"2"', "go6ijb0b46hlpbu4eeu92njevo_20060610T160000Z", false].join("\u001A"));

    // Changing an exception should retain the metadata entries
    let newEx = ex.clone();
    newEx.title = "New Event changed again";
    gServer.nextEtag = '"4"';
    yield pclient.modifyItem(newEx, ex);
    meta = getAllMeta(offline);
    equal(meta.size, 3);
    equal(meta.get(newEx.hashId), ['"4"', "go6ijb0b46hlpbu4eeu92njevo_20060610T160000Z", false].join("\u001A"));

    // Deleting an exception should delete the metadata, as it turns into an EXDATE
    let newItem = items[0].clone();
    newItem.recurrenceInfo.removeOccurrenceAt(exIds[0]);
    yield pclient.modifyItem(newItem, items[0]);

    meta = getAllMeta(offline);
    equal(meta.size, 2);

    // Deleting the master item should remove all metadata entries
    yield pclient.deleteItem(items[0]);
    meta = getAllMeta(offline);
    equal(meta.size, 0);

    gServer.resetClient(client);
});

add_task(function* test_conflict_modify() {
    // TODO task/event conflicts are handled in the same way so I'm going to
    // skip adding tests for tasks here, but it probably wouldn't hurt to
    // create them at some point.
    gServer.events = [{
       "kind": "calendar#event",
       "etag": "\"1\"",
       "id": "go6ijb0b46hlpbu4eeu92njevo",
       "created": "2006-06-08T21:04:52.000Z",
       "updated": "2006-06-08T21:05:49.138Z",
       "summary": "New Event",
       "creator": gServer.creator,
       "organizer": gServer.creator,
       "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
       "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
       "iCalUID": "go6ijb0b46hlpbu4eeu92njevo@google.com"
    }];
    let client = yield gServer.getClient();
    let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);
    let item = (yield pclient.getAllItems())[0];

    // Case #1: Modified on server, modify locally, overwrite conflict
    MockConflictPrompt.overwrite = true;
    let newItem = item.clone();
    newItem.title = "local change";
    gServer.events[0].etag = '"2"';
    gServer.events[0].summary = "remote change";
    let modifiedItem = yield pclient.modifyItem(newItem, item);
    item = (yield pclient.getAllItems())[0];
    equal(gServer.events[0].summary, "local change");
    notEqual(gServer.events[0].etag, '"2"')
    equal(item.title, "local change");
    equal(modifiedItem.title, "local change");
    equal(gServer.events.length, 1);

    // Case #2: Modified on server, modify locally, don't overwrite conflict
    MockConflictPrompt.overwrite = false;
    gServer.events[0].etag = '"3"';
    gServer.events[0].summary = "remote change";
    try {
        modifiedItem = yield pclient.modifyItem(newItem, item);
        do_throw("Expected modifyItem to be cancelled");
    } catch (e if e == Components.interfaces.calIErrors.OPERATION_CANCELLED) {
        // Swallow cancelling the request
    }

    yield gServer.waitForLoad(client);

    item = (yield pclient.getAllItems())[0];
    equal(gServer.events[0].summary, "remote change");
    equal(gServer.events[0].etag, '"3"')
    equal(item.title, "remote change");

    // Case #3: Modified on server, delete locally, don't overwrite conflict
    MockConflictPrompt.overwrite = false;
    gServer.events[0].etag = '"4"';
    gServer.events[0].summary = "remote change";
    try {
        yield pclient.deleteItem(item);
        do_throw("Expected deleteItem to be cancelled");
    } catch (e if e == Components.interfaces.calIErrors.OPERATION_CANCELLED) {
        // Swallow cancelling the request
    }

    yield gServer.waitForLoad(client);

    item = (yield pclient.getAllItems())[0];
    equal(gServer.events[0].summary, "remote change");
    equal(gServer.events[0].etag, '"4"')
    equal(item.title, "remote change");

    // Case #4: Modified on server, delete locally, overwrite conflict
    MockConflictPrompt.overwrite = true;
    gServer.events[0].etag = '"5"';
    gServer.events[0].summary = "remote change";
    yield pclient.deleteItem(item);
    item = (yield pclient.getAllItems())[0];
    equal(gServer.events.length, 0);

    gServer.resetClient(client);
});

add_task(function* test_conflict_delete() {
    // TODO task/event conflicts are handled in the same way so I'm going to
    // skip adding tests for tasks here, but it probably wouldn't hurt to
    // create them at some point.
    let coreEvent = {
       "kind": "calendar#event",
       "etag": "\"2\"",
       "id": "go6ijb0b46hlpbu4eeu92njevo",
       "created": "2006-06-08T21:04:52.000Z",
       "updated": "2006-06-08T21:05:49.138Z",
       "summary": "New Event",
       "creator": gServer.creator,
       "organizer": gServer.creator,
       "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
       "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
       "iCalUID": "go6ijb0b46hlpbu4eeu92njevo@google.com"
    };

    // Load intial event to server
    gServer.events = [coreEvent];
    let client = yield gServer.getClient();
    let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);
    let item = (yield pclient.getAllItems())[0];

    // Case #1: Deleted on server, modify locally, overwrite conflict
    MockConflictPrompt.overwrite = true;
    gServer.events = [];
    let newItem = item.clone();
    newItem.title = "local change";
    let modifiedItem = yield pclient.modifyItem(newItem, item);
    item = (yield pclient.getAllItems())[0];
    equal(gServer.events[0].summary, "local change");
    notEqual(gServer.events[0].etag, '"2"')
    equal(item.title, "local change");
    equal(modifiedItem.title, "local change");
    equal(gServer.events.length, 1);

    // Case #2: Deleted on server, modify locally, don't overwrite conflict
    MockConflictPrompt.overwrite = false;
    gServer.events = [];
    try {
        modifiedItem = yield pclient.modifyItem(newItem, item);
        do_throw("Expected modifyItem to be cancelled");
    } catch (e if e == Components.interfaces.calIErrors.OPERATION_CANCELLED) {
        // Swallow cancelling the request
    }
    // The next synchronize should cause the event to be deleted locally.
    coreEvent.status = "cancelled";
    gServer.events = [coreEvent];

    yield gServer.waitForLoad(client);

    let items = yield pclient.getAllItems();
    equal(items.length, 0);
    equal(gServer.events.length, 1);

    // Put the event back in the calendar for the next run
    delete gServer.events[0].status;
    client.refresh();
    yield gServer.waitForLoad(client);
    items = yield pclient.getAllItems();
    equal(items.length, 1);

    // Case #3: Deleted on server, delete locally, don't overwrite conflict
    MockConflictPrompt.overwrite = false;
    gServer.events = [];
    try {
        yield pclient.deleteItem(item);
        do_throw("Expected deleteItem to be cancelled");
    } catch (e if e == Components.interfaces.calIErrors.OPERATION_CANCELLED) {
        // Swallow cancelling the request
    }
    // The next synchronize should cause the event to be deleted locally.
    coreEvent.status = "cancelled";
    gServer.events = [coreEvent];
    yield gServer.waitForLoad(client);

    items = yield pclient.getAllItems();
    equal(items.length, 0);

    // Put the event back in the calendar for the next run
    delete gServer.events[0].status;
    client.refresh();
    yield gServer.waitForLoad(client);
    items = yield pclient.getAllItems();
    equal(items.length, 1);

    // Case #4: Deleted on server, delete locally, overwrite conflict
    MockConflictPrompt.overwrite = true;
    gServer.events = [];
    yield pclient.deleteItem(item);
    items = yield pclient.getAllItems();
    equal(items.length, 0);

    gServer.resetClient(client);
});

add_task(function* test_default_alarms() {
    let defaultReminders = [
        { method: "popup", minutes: 10 },
        { method: "email", minutes: 20 },
    ];
    gServer.calendarListData.defaultReminders = defaultReminders;
    gServer.eventsData.defaultReminders = defaultReminders;
    gServer.events = [{
       "kind": "calendar#event",
       "etag": "\"2\"",
       "id": "go6ijb0b46hlpbu4eeu92njevo",
       "created": "2006-06-08T21:04:52.000Z",
       "updated": "2006-06-08T21:05:49.138Z",
       "summary": "Default Reminder",
       "creator": gServer.creator,
       "organizer": gServer.creator,
       "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
       "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
       "iCalUID": "go6ijb0b46hlpbu4eeu92njevo@google.com",
       "reminders": { "useDefault": true }
    }];

    // Case #1: read default alarms from event stream
    let client = yield gServer.getClient();
    let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);
    equal(client.getProperty("settings.defaultReminders"), JSON.stringify(defaultReminders));

    let item = (yield pclient.getAllItems())[0];
    let alarms = item.getAlarms({});

    equal(alarms.length, 2);
    ok(alarms.every(x => x.getProperty("X-DEFAULT-ALARM") == "TRUE"));
    equal(alarms[0].action, "DISPLAY");
    equal(alarms[0].offset.icalString, "-PT10M");
    equal(alarms[1].action, "EMAIL");
    equal(alarms[1].offset.icalString, "-PT20M");

    // Case #2: add an item with only default alarms
    let event = cal.createEvent([
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
        "END:VEVENT"
    ].join("\r\n"));

    yield pclient.addItem(event);
    ok(gServer.events[1].reminders.useDefault);
    equal(gServer.events[1].reminders.overrides.length, 0);

    // Case #3: Mixed default/non-default alarms. Not sure this will happen
    event = cal.createEvent([
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
        "END:VEVENT"
    ].join("\r\n"));

    yield pclient.addItem(event);
    ok(gServer.events[2].reminders.useDefault);
    equal(gServer.events[2].reminders.overrides.length, 1);
    equal(gServer.events[2].reminders.overrides[0].minutes, 5);

    gServer.resetClient(client);

    // Case #4a: Empty default alarms
    gServer.calendarListData.defaultReminders = [];
    gServer.eventsData.defaultReminders = [];
    client = yield gServer.getClient();
    pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

    event = cal.createEvent([
        "BEGIN:VEVENT",
        "SUMMARY:Default Alarms Empty",
        "DTSTART:20060610T180000Z",
        "DTEND:20060610T200000Z",
        "X-DEFAULT-ALARM:TRUE",
        "END:VEVENT"
    ].join("\r\n"));

    yield pclient.addItem(event);
    ok(gServer.events[0].reminders.useDefault);
    equal(gServer.events[0].reminders.overrides, undefined);

    let events = gServer.events;
    gServer.resetClient(client);

    // Case #4b: Read an item with empty default alarms
    gServer.events = events;
    client = yield gServer.getClient();
    pclient = cal.async.promisifyCalendar(client.wrappedJSObject);

    item = (yield pclient.getAllItems())[0];
    equal(item.getProperty("X-DEFAULT-ALARM"), "TRUE");

    gServer.resetClient(client);
});

add_task(function* test_paginate() {
    gServer.events = [{
       "kind": "calendar#event",
       "etag": "\"1\"",
       "id": "go6ijb0b46hlpbu4eeu92njevo",
       "created": "2006-06-08T21:04:52.000Z",
       "updated": "2006-06-08T21:05:49.138Z",
       "summary": "New Event",
       "creator": gServer.creator,
       "organizer": gServer.creator,
       "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
       "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
       "iCalUID": "go6ijb0b46hlpbu4eeu92njevo@google.com"
    },{
       "kind": "calendar#event",
       "etag": "\"2\"",
       "id": "fepf8uf6n7n04w7feukucs9n8e",
       "created": "2006-06-08T21:04:52.000Z",
       "updated": "2006-06-08T21:05:49.138Z",
       "summary": "New Event 2",
       "creator": gServer.creator,
       "organizer": gServer.creator,
       "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
       "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
       "iCalUID": "fepf8uf6n7n04w7feukucs9n8e@google.com"
    }];

    gServer.tasks = [
       {
        "kind": "tasks#task",
        "id": "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
        "etag": "\"Lck7VNWFJuXdzMtOmrYPx0KFV2s/LTIwNjA4MDcyNDM\"",
        "title": "New Task",
        "updated": "2014-09-08T16:30:27.000Z",
        "selfLink": gServer.baseUri + "/tasks/v1/lists/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDow/tasks/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU",
        "position": "00000000000000130998",
        "status": "needsAction"
      },{
        "kind": "tasks#task",
        "id": "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo5OTU0Mjk2MzQ",
        "etag": "\"Lck7VNWFJuXdzMtOmrYPx0KFV2s/LTQyNTY0MjUwOQ\"",
        "title": "New Task 2",
        "updated": "2014-09-08T16:30:27.000Z",
        "selfLink": gServer.baseUri + "/tasks/v1/lists/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDow/tasks/MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo5OTU0Mjk2MzQ",
        "position": "00000000000000130993",
        "status": "needsAction"
      }
    ];

    Preferences.set("calendar.google.maxResultsPerRequest", 1);

    let client = yield gServer.getClient();
    let pclient = cal.async.promisifyCalendar(client);

    // Make sure all pages were requested
    equal(gServer.eventsData.nextPageToken, null);
    equal(gServer.tasksData.nextPageToken, null);

    // ...and we have all items. Not checking props
    // because the other tests do this sufficiently.
    let items = yield pclient.getAllItems();
    equal(items.length, 4);

    equal(client.getProperty("syncToken.events"), "next-sync-token");

    Preferences.reset("calendar.google.maxResultsPerRequest");
    gServer.resetClient(client);
});

add_task(function* test_incremental_reset() {
    gServer.syncs = [{
        token: "1",
        events: [{
            "kind": "calendar#event",
            "etag": "\"1\"",
            "id": "go6ijb0b46hlpbu4eeu92njevo",
            "created": "2006-06-08T21:04:52.000Z",
            "updated": "2006-06-08T21:05:49.138Z",
            "summary": "New Event",
            "creator": gServer.creator,
            "organizer": gServer.creator,
            "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
            "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
            "iCalUID": "go6ijb0b46hlpbu4eeu92njevo@google.com"
        }]
    },{
        token: "2",
        reset: true
    },{
        token: "3",
        events: [{
            "kind": "calendar#event",
            "etag": "\"2\"",
            "id": "fepf8uf6n7n04w7feukucs9n8e",
            "created": "2006-06-08T21:04:52.000Z",
            "updated": "2006-06-08T21:05:49.138Z",
            "summary": "New Event 2",
            "creator": gServer.creator,
            "organizer": gServer.creator,
            "start": { "dateTime": "2006-06-10T18:00:00+02:00" },
            "end": {"dateTime": "2006-06-10T20:00:00+02:00" },
            "iCalUID": "fepf8uf6n7n04w7feukucs9n8e@google.com"
        }]
    }];
    let client = yield gServer.getClient();
    let pclient = cal.async.promisifyCalendar(client);

    let items = yield pclient.getAllItems();
    equal(items.length, 1);
    equal(items[0].title, "New Event");

    client.refresh();
    yield gServer.waitForLoad(client);

    items = yield pclient.getAllItems();
    equal(items.length, 1);
    equal(items[0].title, "New Event 2");

    equal(gServer.syncs.length, 0);
    equal(client.getProperty("syncToken.events"), "last");

    gServer.resetClient(client);
});
