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

    let events = "/calendar/v3/calendars/" + calendarId + "/events";
    let tasks = "/tasks/v1/lists/" + tasksId + "/tasks";
    let calendarList = "/calendar/v3/users/me/calendarList/" + calendarId;

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

    get baseUri() "http://localhost:" + this.server.identity.primaryPort + "/",

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
            "email": "xpcshell@example.com",
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
         } else if (method == "PUT" && request.path.match(/\/events\/([a-z0-9_TZ]+)$/)) {
            // Modify an event
            dump("PUTTING EVENT\n" + body);
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
        gServer = new GDataServer("calendarId", "tasksId");
        gServer.start();
        run_next_test();
    }});
}

add_test(function test_migrate_uri() {
    function checkMigrate(fromUri, session, calendarId, tasksId) {
        let uri = Services.io.newURI(fromUri, null, null);
        let client = cal.getCalendarManager().createCalendar("gdata", uri);

        if (session) {
            let target = ("googleapi://" + session + "/?" +
                         (calendarId ? "&calendar=" + encodeURIComponent(calendarId) : "") +
                         (tasksId ? "&tasks=" + encodeURIComponent(tasksId) : "")).replace("?&", "?");
            do_check_eq(client.getProperty("uri"), target);
        } else {
            do_check_eq(client.getProperty("uri"), null);
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

add_task(function* test_organizerCN() {
    gServer.events = [];
    let client = yield gServer.getClient();
    do_check_eq(client.getProperty("organizerCN"), null);
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
    let client = yield gServer.getClient();
    do_check_eq(client.getProperty("organizerCN"), gServer.creator.displayName);
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
    do_check_true(client.readOnly)
    client.readOnly = false;
    do_check_true(client.readOnly)

    let items = yield pclient.getAllItems();
    do_check_eq(items.length, 1);
    do_check_neq(items[0].title, "New Event");
    gServer.resetClient(client);

    gServer.calendarListData.accessRole = "reader";
    let client = yield gServer.getClient();
    do_check_true(client.readOnly)
    client.readOnly = false;
    do_check_true(client.readOnly)
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
    do_check_eq(items.length, 4);

    do_check_neq(client.getProperty("syncToken.events"), "");
    do_check_neq(client.getProperty("lastUpdated.tasks"), "");

    yield uncached.resetSync();
    let items = yield pclient.getAllItems();
    do_check_eq(items.length, 0);

    do_check_eq(client.getProperty("syncToken.events"), "");
    do_check_eq(client.getProperty("lastUpdated.tasks"), "");

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
    do_check_eq(items.length, 2);

    let event = cal.isEvent(items[0]) ? items[0]: items[1];
    do_check_eq(event.id, "go6ijb0b46hlpbu4eeu92njevo@google.com");
    do_check_eq(event.getProperty("STATUS"), "CONFIRMED");
    do_check_eq(event.getProperty("URL"), gServer.baseUri + "/calendar/event?eid=eventhash");
    do_check_eq(event.getProperty("CREATED").icalString, "20060608T210452Z");
    do_check_eq(event.getProperty("LAST-MODIFIED").icalString, "20060608T210549Z");
    do_check_eq(event.title, "New Event");
    do_check_eq(event.getProperty("DESCRIPTION"), "description");
    do_check_eq(event.getProperty("LOCATION"), "Hard Drive");
    do_check_eq(event.organizer.id, "mailto:xpcshell@example.com");
    do_check_eq(event.organizer.commonName, "Eggs P. Seashell");
    do_check_true(event.organizer.isOrganizer);
    do_check_eq(event.startDate.icalString, "20060610T180000");
    do_check_eq(event.startDate.timezone.tzid, "Europe/Berlin");
    do_check_eq(event.endDate.icalString, "20060610T200000");
    do_check_eq(event.getProperty("TRANSP"), "TRANSPARENT");
    do_check_eq(event.privacy, "PRIVATE");
    do_check_eq(event.getProperty("SEQUENCE"), 1);
    let alarms = event.getAlarms({});
    do_check_eq(alarms.length, 1);
    do_check_eq(alarms[0].action, "EMAIL");
    do_check_eq(alarms[0].related, alarms[0].ALARM_RELATED_START);
    do_check_eq(alarms[0].offset.icalString, "-PT20M");
    do_check_null(alarms[0].getProperty("X-DEFAULT-ALARM"));
    let attendees = event.getAttendees({});
    do_check_eq(attendees.length, 1);
    do_check_eq(attendees[0].id, "mailto:attendee@example.com");
    do_check_eq(attendees[0].commonName, "attendee name");
    do_check_eq(attendees[0].role, "OPT-PARTICIPANT");
    do_check_eq(attendees[0].participationStatus, "TENTATIVE");
    do_check_eq(event.getCategories({}), "foo,bar");
    do_check_eq(event.alarmLastAck.icalString, "20140101T010101Z");
    do_check_eq(event.getProperty("X-MOZ-SNOOZE-TIME"), "20140101T020202Z");

    let task = cal.isToDo(items[0]) ? items[0] : items[1];
    do_check_eq(task.id, "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU");
    do_check_eq(task.title, "New Task");
    do_check_eq(task.getProperty("LAST-MODIFIED").icalString, "20140908T163027Z");
    do_check_eq(task.getProperty("X-GOOGLE-SORTKEY"), "00000000000000130998");
    do_check_true(task.isCompleted);
    do_check_eq(task.dueDate.icalString, "20140904");
    do_check_eq(task.completedDate.icalString, "20140901T170000Z");
    do_check_eq(task.getProperty("DESCRIPTION"), "description");
    let relations = task.getRelations({});
    do_check_eq(relations.length, 1);
    do_check_eq(relations[0].relType, "PARENT");
    do_check_eq(relations[0].relId, "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo4MDIzOTU2NDc");
    let attachments = task.getAttachments({});
    do_check_eq(attachments.length, 1);
    do_check_eq(attachments[0].uri.spec, "mailto:something@example.com");
    do_check_eq(attachments[0].getParameter("X-GOOGLE-TYPE"), "email");
    do_check_eq(attachments[0].getParameter("FILENAME"), "link description");

    gServer.resetClient(client);
});

add_task(function* test_addModifyDeleteItem() {
    let client = yield gServer.getClient();
    let pclient = cal.async.promisifyCalendar(client.wrappedJSObject);
    do_check_eq(gServer.events.length, 0);
    do_check_eq(gServer.tasks.length, 0);

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
        "DUE:20140904",
        "COMPLETED:20140901T170000Z",
        "RELATED-TO;RELTYPE=PARENT:MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo4MDIzOTU2NDc",
        "ATTACH;FILENAME=\"link description\";X-GOOGLE-TYPE=email:mailto:something@example.com",
        "END:VTODO"
    ].join("\r\n"));

    // Add an event
    let addedEvent = yield pclient.adoptItem(event);
    do_check_neq(addedEvent.id, null);
    do_check_eq(addedEvent.organizer.id, "mailto:xpcshell@example.com");

    let items = yield pclient.getAllItems();
    do_check_eq(items.length, 1);
    do_check_eq(items[0].id, addedEvent.id);
    do_check_eq(items[0].organizer.id, "mailto:xpcshell@example.com");

    do_check_eq(gServer.events.length, 1)
    do_check_eq(gServer.tasks.length, 0);

    // Add a task
    let addedTask = yield pclient.adoptItem(task);
    do_check_neq(addedTask.id, null);

    let items = yield pclient.getAllItems();
    do_check_eq(items.length, 2);
    do_check_eq(items[1].id, addedTask.id);

    do_check_eq(gServer.events.length, 1)
    do_check_eq(gServer.tasks.length, 1);

    // Modify an event
    let newEvent = items[0].clone();
    newEvent.title = "changed";

    let modifiedEvent = yield pclient.modifyItem(newEvent, items[0]);
    do_check_eq(modifiedEvent.title, "changed");
    do_check_neq(modifiedEvent.getProperty("LAST-MODIFIED"), addedEvent.getProperty("LAST-MODIFIED"));
    items = yield pclient.getAllItems();
    do_check_eq(items.length, 2);
    do_check_eq(items[0].title, "changed");
    do_check_eq(items[0].id, addedEvent.id);
    do_check_eq(items[0].getProperty("LAST-MODIFIED"), modifiedEvent.getProperty("LAST-MODIFIED"));
    do_check_eq(gServer.events.length, 1);
    do_check_eq(gServer.tasks.length, 1);

    // Modify a task
    let newTask = items[1].clone();
    newTask.title = "changed";

    let modifiedTask = yield pclient.modifyItem(newTask, items[1]);
    do_check_eq(modifiedTask.title, "changed");
    do_check_neq(modifiedTask.getProperty("LAST-MODIFIED"), addedTask.getProperty("LAST-MODIFIED"));
    items = yield pclient.getAllItems();
    do_check_eq(items.length, 2);
    do_check_eq(items[1].title, "changed");
    do_check_eq(items[1].id, addedTask.id);
    do_check_eq(items[1].getProperty("LAST-MODIFIED"), modifiedTask.getProperty("LAST-MODIFIED"));
    do_check_eq(gServer.events.length, 1);
    do_check_eq(gServer.tasks.length, 1);

    // Delete an event
    yield pclient.deleteItem(modifiedEvent);
    items = yield pclient.getAllItems();
    do_check_eq(items.length, 1);
    do_check_eq(gServer.events.length, 0);
    do_check_eq(gServer.tasks.length, 1);

    // Delete a task
    yield pclient.deleteItem(modifiedTask);
    items = yield pclient.getAllItems();
    do_check_eq(items.length, 0);
    do_check_eq(gServer.events.length, 0);
    do_check_eq(gServer.tasks.length, 0);

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
    do_check_eq(gServer.events.length, 1);
    do_check_eq(gServer.events[0].recurrence.length, 1);
    do_check_eq(gServer.events[0].recurrence[0], "RRULE:FREQ=WEEKLY");

    let occ = event.recurrenceInfo.getNextOccurrence(event.startDate);
    let changedOcc = occ.clone();
    changedOcc.title = "changed";
    event.recurrenceInfo.modifyException(occ, true);

    event = yield pclient.modifyItem(changedOcc, occ);
    occ = event.recurrenceInfo.getNextOccurrence(event.startDate);
    do_check_eq(occ.title, "changed");
    do_check_eq(gServer.events.length, 2);

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
    do_check_eq(gServer.events.length, 1);
    do_check_eq(addedItem.icalString, event.icalString);
    gServer.resetClient(client);
    Preferences.set("calendar.google.enableAttendees", false);
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
    do_check_true(cal.isEvent(event));
    do_check_true(cal.isToDo(task));
    do_check_eq(meta.size, 2);
    do_check_eq(meta.get(event.hashId), ['"1"', "go6ijb0b46hlpbu4eeu92njevo", false].join("\u001A"));
    do_check_eq(meta.get(task.hashId), ['"2"', "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU", false].join("\u001A"));

    // Modify an event
    gServer.nextEtag = '"3"';
    let newEvent = event.clone();
    newEvent.title = "changed";
    yield pclient.modifyItem(newEvent, event);

    items = yield pclient.getAllItems();
    meta = getAllMeta(offline);
    [event, task] = items;
    do_check_true(cal.isEvent(event));
    do_check_true(cal.isToDo(task));
    do_check_eq(meta.size, 2);
    do_check_eq(meta.get(event.hashId), ['"3"', "go6ijb0b46hlpbu4eeu92njevo", false].join("\u001A"));
    do_check_eq(meta.get(task.hashId), ['"2"', "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU", false].join("\u001A"));

    // Modify a task
    gServer.nextEtag = '"4"';
    let newTask = task.clone();
    newTask.title = "changed";
    yield pclient.modifyItem(newTask, task);

    items = yield pclient.getAllItems();
    meta = getAllMeta(offline);
    [event, task] = items;
    do_check_eq(meta.size, 2);
    do_check_eq(meta.get(event.hashId), ['"3"', "go6ijb0b46hlpbu4eeu92njevo", false].join("\u001A"));
    do_check_eq(meta.get(task.hashId), ['"4"', "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU", false].join("\u001A"));

    // Delete an event
    yield pclient.deleteItem(event);
    meta = getAllMeta(offline);
    do_check_eq(meta.size, 1);
    do_check_eq(meta.get(task.hashId), ['"4"', "MTEyMDE2MDE5NzE0NjYzMDk4ODI6MDo0MDI1NDg2NjU", false].join("\u001A"));

    // Delete a task
    yield pclient.deleteItem(task);
    meta = getAllMeta(offline);
    do_check_eq(meta.size, 0);

    // Add an event
    gServer.nextEtag = '"6"';
    newEvent = yield pclient.addItem(event);
    meta = getAllMeta(offline);
    do_check_eq(meta.size, 1);
    do_check_eq(gServer.events.length, 1);
    do_check_eq(meta.get(newEvent.hashId), ['"6"', gServer.events[0].id, false].join("\u001A"));

    // Add a task
    gServer.nextEtag = '"7"';
    newTask = yield pclient.addItem(task);
    meta = getAllMeta(offline);
    do_check_eq(meta.size, 2);
    do_check_eq(gServer.events.length, 1);
    do_check_eq(gServer.tasks.length, 1);
    do_check_eq(meta.get(newEvent.hashId), ['"6"', gServer.events[0].id, false].join("\u001A"));
    do_check_eq(meta.get(newTask.hashId), ['"7"', gServer.tasks[0].id, false].join("\u001A"));

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
        "id": "go6ijb0b46hlpbu4eeu92njevo_20060610T160000Z",
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
    do_check_eq(meta.size, 3);
    do_check_eq(meta.get(items[0].hashId), ['"1"', "go6ijb0b46hlpbu4eeu92njevo", false].join("\u001A"));

    // The exception metadata should also exist
    let exIds = items[0].recurrenceInfo.getExceptionIds({});
    do_check_eq(exIds.length, 2);
    let ex = items[0].recurrenceInfo.getExceptionFor(exIds[0]);
    do_check_eq(meta.get(ex.hashId), ['"2"', "go6ijb0b46hlpbu4eeu92njevo_20060610T160000Z", false].join("\u001A"));

    // Changing an exception should retain the metadata entries
    let newEx = ex.clone();
    newEx.title = "New Event changed again";
    gServer.nextEtag = '"4"';
    yield pclient.modifyItem(newEx, ex);
    let meta = getAllMeta(offline);
    do_check_eq(meta.size, 3);
    do_check_eq(meta.get(newEx.hashId), ['"4"', "go6ijb0b46hlpbu4eeu92njevo_20060610T160000Z", false].join("\u001A"));

    // Deleting an exception should delete the metadata, as it turns into an EXDATE
    let newItem = items[0].clone();
    newItem.recurrenceInfo.removeOccurrenceAt(exIds[0]);
    yield pclient.modifyItem(newItem, items[0]);

    let meta = getAllMeta(offline);
    do_check_eq(meta.size, 2);

    // Deleting the master item should remove all metadata entries
    yield pclient.deleteItem(items[0]);
    let meta = getAllMeta(offline);
    do_check_eq(meta.size, 0);

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
    do_check_eq(gServer.events[0].summary, "local change");
    do_check_neq(gServer.events[0].etag, '"2"')
    do_check_eq(item.title, "local change");
    do_check_eq(modifiedItem.title, "local change");
    do_check_eq(gServer.events.length, 1);

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
    do_check_eq(gServer.events[0].summary, "remote change");
    do_check_eq(gServer.events[0].etag, '"3"')
    do_check_eq(item.title, "remote change");

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
    do_check_eq(gServer.events[0].summary, "remote change");
    do_check_eq(gServer.events[0].etag, '"4"')
    do_check_eq(item.title, "remote change");

    // Case #4: Modified on server, delete locally, overwrite conflict
    MockConflictPrompt.overwrite = true;
    gServer.events[0].etag = '"5"';
    gServer.events[0].summary = "remote change";
    yield pclient.deleteItem(item);
    item = (yield pclient.getAllItems())[0];
    do_check_eq(gServer.events.length, 0);

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
    do_check_eq(gServer.events[0].summary, "local change");
    do_check_neq(gServer.events[0].etag, '"2"')
    do_check_eq(item.title, "local change");
    do_check_eq(modifiedItem.title, "local change");
    do_check_eq(gServer.events.length, 1);

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
    do_check_eq(items.length, 0);
    do_check_eq(gServer.events.length, 1);

    // Put the event back in the calendar for the next run
    delete gServer.events[0].status;
    client.refresh();
    yield gServer.waitForLoad(client);
    items = yield pclient.getAllItems();
    do_check_eq(items.length, 1);

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
    do_check_eq(items.length, 0);

    // Put the event back in the calendar for the next run
    delete gServer.events[0].status;
    client.refresh();
    yield gServer.waitForLoad(client);
    items = yield pclient.getAllItems();
    do_check_eq(items.length, 1);

    // Case #4: Deleted on server, delete locally, overwrite conflict
    MockConflictPrompt.overwrite = true;
    gServer.events = [];
    yield pclient.deleteItem(item);
    items = yield pclient.getAllItems();
    do_check_eq(items.length, 0);

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
    do_check_eq(client.getProperty("settings.defaultReminders"), JSON.stringify(defaultReminders));

    let item = (yield pclient.getAllItems())[0];
    let alarms = item.getAlarms({});

    do_check_eq(alarms.length, 2);
    do_check_true(alarms.every(x => x.getProperty("X-DEFAULT-ALARM") == "TRUE"));
    do_check_eq(alarms[0].action, "DISPLAY");
    do_check_eq(alarms[0].offset.icalString, "-PT10M");
    do_check_eq(alarms[1].action, "EMAIL");
    do_check_eq(alarms[1].offset.icalString, "-PT20M");

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
    do_check_true(gServer.events[1].reminders.useDefault);
    do_check_eq(gServer.events[1].reminders.overrides.length, 0);

    // Case #3: Mixed default/non-default alarms. Not sure this will happen
    let event = cal.createEvent([
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
    do_check_true(gServer.events[2].reminders.useDefault);
    do_check_eq(gServer.events[2].reminders.overrides.length, 1);
    do_check_eq(gServer.events[2].reminders.overrides[0].minutes, 5);

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
    do_check_eq(gServer.eventsData.nextPageToken, null);
    do_check_eq(gServer.tasksData.nextPageToken, null);

    // ...and we have all items. Not checking props
    // because the other tests do this sufficiently.
    let items = yield pclient.getAllItems();
    do_check_eq(items.length, 4);

    do_check_eq(client.getProperty("syncToken.events"), "next-sync-token");

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
    do_check_eq(items.length, 1);
    do_check_eq(items[0].title, "New Event");

    client.refresh();
    yield gServer.waitForLoad(client);

    items = yield pclient.getAllItems();
    do_check_eq(items.length, 1);
    do_check_eq(items[0].title, "New Event 2");

    do_check_eq(gServer.syncs.length, 0);
    do_check_eq(client.getProperty("syncToken.events"), "last");

    gServer.resetClient(client);
});
