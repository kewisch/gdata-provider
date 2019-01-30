/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { Preferences } = ChromeUtils.import("resource://gre/modules/Preferences.jsm");
var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

// Backwards compatibility with Thunderbird <60.
if (!("Cc" in this)) {
    // eslint-disable-next-line mozilla/no-define-cc-etc, no-unused-vars
    const { classes: Cc, interfaces: Ci, results: Cr } = Components;
}

var { cal } = ChromeUtils.import("resource://gdata-provider/modules/calUtilsShim.jsm");
var { stringException } = ChromeUtils.import("resource://gdata-provider/modules/gdataLogging.jsm");
var {
    calGoogleRequest,
    getCorrectedDate,
    API_BASE
} = ChromeUtils.import("resource://gdata-provider/modules/gdataRequest.jsm");
var { getGoogleSessionManager } = ChromeUtils.import("resource://gdata-provider/modules/gdataSession.jsm");
var {
    ItemToJSON,
    JSONToItem,
    ItemSaver,
    checkResolveConflict,
    getGoogleId,
    getItemMetadata,
    saveItemMetadata,
    deleteItemMetadata,
    migrateItemMetadata,
    JSONToAlarm
} = ChromeUtils.import("resource://gdata-provider/modules/gdataUtils.jsm");

var cIOL = Ci.calIOperationListener;

var MIN_REFRESH_INTERVAL = 30;

/**
 * calGoogleCalendar
 * This Implements a calICalendar Object adapted to the Google Calendar
 * Provider.
 *
 * @class
 * @constructor
 */
function calGoogleCalendar() {
    this.initProviderBase();
    this.mThrottle = Object.create(null);
}

var calGoogleCalendarClassID = Components.ID("{d1a6e988-4b4d-45a5-ba46-43e501ea96e3}");
var calGoogleCalendarInterfaces = [
    Ci.calICalendar,
    Ci.calISchedulingSupport,
    Ci.calIChangeLog
];
calGoogleCalendar.prototype = {
    __proto__: cal.provider.BaseClass.prototype,

    classID: calGoogleCalendarClassID,
    QueryInterface: cal.generateQI(calGoogleCalendarInterfaces),
    classInfo: cal.generateCI({
        classDescription: "Google Calendar Provider",
        contractID: "@mozilla.org/calendar/calendar;1?type=gdata",
        classID: calGoogleCalendarClassID,
        interfaces: calGoogleCalendarInterfaces
    }),

    /* Used to reset the local cache between releases */
    CACHE_DB_VERSION: 3,

    /* Member Variables */
    mCalendarName: null,
    mThrottle: null,
    mThrottleLimits: {
        calendarList: 3600 * 1000,
        events: 30 * 1000,
        tasks: 30 * 1000
    },

    /* Public Members */
    session: null,

    /**
     * Make sure a session is available.
     */
    ensureSession: function() {
        if (!this.session) {
            // Now actually set up the session
            let sessionMgr = getGoogleSessionManager();
            this.session = sessionMgr.getSessionByCalendar(this, true);

            // Aside from setting up the session, bump the refresh interval to
            // a higher value if its below the minimal refresh interval to
            // avoid exceeding quota.
            let interval = this.getProperty("refreshInterval");
            if (interval < MIN_REFRESH_INTERVAL && interval != 0) {
                cal.LOG("[calGoogleCalendar] Sorry, auto-refresh intervals under " + MIN_REFRESH_INTERVAL + " minutes would cause the quota to be reached too fast.");
                this.setProperty("refreshInterval", 2 * MIN_REFRESH_INTERVAL);
            }
        }
    },

    ensureWritable: function() {
        // Check if calendar is readonly
        if (this.readOnly) {
            throw new Components.Exception("", Ci.calIErrors.CAL_IS_READONLY);
        }
    },

    get isDefaultCalendar() { return this.mCalendarName ? !this.mCalendarName.endsWith("@group.calendar.google.com") : false; },

    /*
     * implement calICalendar
     */
    get type() { return "gdata"; },
    get providerID() { return "{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}"; },
    get canRefresh() { return true; },

    get id() { return this.mID; },
    set id(val) {
        let setter = this.__proto__.__proto__.__lookupSetter__("id");
        val = setter.call(this, val);

        if (this.id && this.uri) {
            this.ensureSession();
        }
        return val;
    },

    get uri() { return this.mUri; },
    set uri(aUri) {
        const protocols = ["http", "https", "webcal", "webcals"];
        this.mUri = aUri;
        if (aUri && aUri.schemeIs("googleapi")) {
            // new format:  googleapi://session-id/?calendar=calhash@group.calendar.google.com&tasks=taskhash
            let [fullUser, path] = aUri.pathQueryRef.substr(2).split("/", 2);
            let keyvalues = path.substr(1).split("&").filter(Boolean);
            let pairs = keyvalues.map(keyvalue => keyvalue.split("=", 2).map(decodeURIComponent));
            let parameters = new Map(pairs);

            if (parameters.size == 0) {
                this.mCalendarName = fullUser;
                this.mTasklistName = this.isDefaultCalendar ? "@default" : null;
            } else {
                this.mCalendarName = parameters.get("calendar");
                this.mTasklistName = parameters.get("tasks");
            }

            // Users that installed 1.0 had an issue where secondary calendars
            // were migrated to their own session. This code fixes that and
            // should be removed once 1.0.1 has been out for a while.
            let googleUser = Preferences.get("calendar.google.calPrefs." + fullUser + ".googleUser");
            if (googleUser && googleUser != fullUser) {
                let newUri = "googleapi://" + googleUser + "/" + path;
                cal.LOG("[calGoogleCalendar] Migrating url format from " + aUri.spec + " to " + newUri);
                this.setProperty("uri", newUri);
                this.mUri = Services.io.newURI(newUri);
            }

            // Unit tests will use a local uri, if the magic parameter is passed.
            let port = parameters.get("testport");
            if (port) {
                cal.LOG("[calGoogleCalendar] Redirecting request to test port " + port);
                API_BASE.EVENTS = "http://localhost:" + port + "/calendar/v3/";
                API_BASE.TASKS = "http://localhost:" + port + "/tasks/v1/";
            }
        } else if (aUri && protocols.some(scheme => aUri.schemeIs(scheme))) {
            // Parse google url, catch private cookies, public calendars,
            // basic and full types, bogus ics file extensions, invalid hostnames
            let re = new RegExp("/calendar/(feeds|ical)/" +
                                "([^/]+)/(public|private|free-busy)-?([^/]+)?/" +
                                "(full|basic)(.ics)?$");

            let matches = aUri.pathQueryRef.match(re);
            if (matches) {
                this.mCalendarName = decodeURIComponent(matches[2]);

                let googleUser = Preferences.get("calendar.google.calPrefs." + this.mCalendarName + ".googleUser");
                let newUri = "googleapi://" + (googleUser || this.mCalendarName) + "/?calendar=" + matches[2];

                // Use the default task list, but only if this is the primary account.
                if (googleUser && googleUser == this.mCalendarName) {
                    this.mTasklistName = "@default";
                    newUri += "&tasks=%40default";
                }

                cal.LOG("[calGoogleCalendar] Migrating url format from " + aUri.spec +
                        " to " + newUri);
                this.setProperty("uri", newUri);
                this.mUri = Services.io.newURI(newUri);
            }
        }

        if (this.id && this.uri) {
            this.ensureSession();
        }

        return this.mUri;
    },

    createEventsURI: function(...extraParts) {
        let eventsURI = null;
        if (this.mCalendarName) {
            let encodedName = encodeURIComponent(this.mCalendarName);
            let parts = ["calendars", encodedName].concat(extraParts.filter(Boolean));
            eventsURI = API_BASE.EVENTS + parts.join("/");
        }
        return eventsURI;
    },

    createUsersURI: function(...extraParts) {
        let parts = ["users", "me"].concat(extraParts).map(encodeURIComponent);
        return API_BASE.EVENTS + parts.join("/");
    },

    createTasksURI: function(...extraParts) {
        let tasksURI = null;
        if (this.mTasklistName) {
            let encodedName = encodeURIComponent(this.mTasklistName);
            let parts = ["lists", encodedName].concat(extraParts.filter(Boolean));
            tasksURI = API_BASE.TASKS + parts.join("/");
        }
        return tasksURI;
    },

    getUpdatedMin: function(aWhich) {
        let updatedMin = null;
        let lastUpdated = this.getProperty("lastUpdated." + aWhich);
        if (lastUpdated) {
            updatedMin = cal.createDateTime(lastUpdated);
            let lastWeek = cal.dtz.now();
            lastWeek.day -= 7;
            if (updatedMin.compare(lastWeek) <= 0) {
                cal.LOG("[calGoogleCalendar] Last updated time for " + aWhich +
                        " is very old, doing full sync");
                this.resetLog();
                updatedMin = null;
            }
        }
        return updatedMin ? getCorrectedDate(updatedMin) : null;
    },

    checkThrottle: function(type) {
        let shouldRequest = true;
        let now = new Date().getTime();

        if (type in this.mThrottle) {
            let then = this.mThrottle[type];

            if (now - then < this.mThrottleLimits[type]) {
                shouldRequest = false;
            }
        }

        if (shouldRequest) {
            this.mThrottle[type] = now;
        } else {
            cal.LOG("[calGoogleCalendar] Skipping " + type + " request to reduce requests");
        }

        return shouldRequest;
    },

    getProperty: function(aName) {
        switch (aName) {
            case "googleCalendarName":
                return this.mCalendarName;
            case "isDefaultCalendar":
                return this.isDefaultCalendar;

            // Capabilities
            case "cache.enabled":
            case "cache.always":
                return true;
            case "capabilities.timezones.floating.supported":
            case "capabilities.attachments.supported":
            case "capabilities.priority.supported":
                return false;
            case "capabilities.privacy.values":
                return ["DEFAULT", "PUBLIC", "PRIVATE"];
            case "capabilities.alarms.maxCount":
                return 5;
            case "capabilities.alarms.actionValues": {
                let actionValues = ["DISPLAY", "EMAIL"];
                if (Preferences.get("calendar.google.enableSMSReminders", false)) {
                    actionValues.push("SMS");
                }
                return actionValues;
            }
            case "capabilities.tasks.supported":
                return !!this.mTasklistName;
            case "capabilities.events.supported":
                return !!this.mCalendarName;
            case "readOnly": {
                // If this calendar displays events, make it readonly if we are
                // not the owner or have write access.
                let accessRole = this.getProperty("settings.accessRole");
                let isReader = (accessRole == "freeBusyReader" || accessRole == "reader");
                if (this.mCalendarName && isReader) {
                    return true;
                }
                // Otherwise fall through
                break;
            }
            case "organizerId":
                return "mailto:" + this.mCalendarName;
            case "itip.transport":
                if (!this.isDefaultCalendar ||
                    !Preferences.get("calendar.google.enableEmailInvitations", false)) {
                    // If we explicitly return null here, then these calendars
                    // will not be included in the list of calendars to accept
                    // invitations to and imip will effectively be disabled.
                    return null;
                }
                break;
            case "imip.identity.disabled":
                // Disabling this hides the picker for identities in the new
                // calendar wizard and calendar properties dialog. This should
                // be done for all secondary calendars as they cannot accept
                // invitations and if email invitations are generally disabled.
                if (!this.isDefaultCalendar ||
                    !Preferences.get("calendar.google.enableEmailInvitations", false)) {
                    return true;
                }
                break;
        }

        return this.__proto__.__proto__.getProperty.apply(this, arguments);
    },

    setProperty: function(aName, aValue) {
        switch (aName) {
            case "refreshInterval":
                if (aValue < MIN_REFRESH_INTERVAL && aValue != 0) {
                    cal.LOG("[calGoogleCalendar] Sorry, auto-refresh intervals under " +
                            MIN_REFRESH_INTERVAL + " minutes would cause the quota " +
                            "to be reached too fast.");
                    this.superCalendar.setProperty("refreshInterval", 2 * MIN_REFRESH_INTERVAL);
                    return undefined;
                }
                break;
        }

        return this.__proto__.__proto__.setProperty.apply(this, arguments);
    },

    addItem: function(aItem, aListener) { return this.adoptItem(aItem.clone(), aListener); },
    adoptItem: function(aItem, aListener) {
        function stackContains(part, max=8) {
            let stack = Components.stack.caller;
            while (stack && --max) {
                if (stack.filename && stack.filename.endsWith(part)) {
                    return true;
                }
                stack = stack.caller;
            }
            return false;
        }

        // Now this sucks...both invitations and the offline cache send over
        // items with the id set, but we have no way to figure out which is
        // happening just by inspecting the item. Adding offline items should
        // not be an import, but invitations should.
        let isImport = aItem.id && (aItem.id == "xpcshell-import" || stackContains("calItipUtils.jsm"));
        let request = new calGoogleRequest();

        (async () => {
            let itemData = ItemToJSON(aItem, this.offlineStorage, isImport);

            // Add the calendar to the item, for later use.
            aItem.calendar = this.superCalendar;

            request.type = request.ADD;
            request.calendar = this;
            if (cal.item.isEvent(aItem)) {
                if (isImport) {
                    cal.LOG("[calGoogleCalendar] Adding invitation event " + aItem.title);
                    request.uri = this.createEventsURI("events", "import");
                } else {
                    cal.LOG("[calGoogleCalendar] Adding regular event " + aItem.title);
                    request.uri = this.createEventsURI("events");
                }

                if (Preferences.get("calendar.google.sendEventNotifications", false)) {
                    request.addQueryParameter("sendNotifications", "true");
                }
            } else if (cal.item.isToDo(aItem)) {
                cal.LOG("[calGoogleCalendar] Adding task " + aItem.title);
                request.uri = this.createTasksURI("tasks");
                // Tasks sent with an id will cause a bad request
                delete itemData.id;
            }

            if (!request.uri) {
                throw Components.Exception("Item type not supported",
                                           Cr.NS_ERROR_NOT_IMPLEMENTED);
            }

            request.setUploadData("application/json; charset=UTF-8",
                                  JSON.stringify(itemData));
            let data = await this.session.asyncItemRequest(request);

            // All we need to do now is parse the item and complete the
            // operation. The cache layer will take care of adding the item
            // to the storage.
            let metaData = Object.create(null);
            let item = JSONToItem(data, this, this.defaultReminders || [],
                                  null, metaData);

            // Make sure to update the etag and id
            saveItemMetadata(this.offlineStorage, item.hashId, metaData);

            if (aItem.id && item.id != aItem.id) {
                // Looks like the id changed, probably because its an offline
                // item. This really sucks for us now, because the cache will
                // reset the wrong item. As a hack, delete the item with its
                // original id and complete the adoptItem call with the new
                // item. This will add the new item to the calendar.
                let pcal = cal.async.promisifyCalendar(this.offlineStorage);
                await pcal.deleteItem(aItem);
            }
            return item;
        })().then((item) => {
            cal.LOG("[calGoogleCalendar] Adding " + item.title + " succeeded");
            this.observers.notify("onAddItem", [item]);
            this.notifyOperationComplete(aListener, Cr.NS_OK,
                                         cIOL.ADD, item.id, item);
        }, (e) => {
            let code = e.result || Cr.NS_ERROR_FAILURE;
            cal.ERROR("[calGoogleCalendar] Adding Item " + aItem.title +
                      " failed:" + code + ": " + e.message);
            this.notifyPureOperationComplete(aListener, code, cIOL.ADD, aItem.id, e.message);
        });
        return request;
    },

    modifyItem: function(aNewItem, aOldItem, aListener) {
        cal.LOG("[calGoogleCalendar] Modifying item " + aNewItem.title + " (" +
                (aNewItem.recurrenceId ? aNewItem.recurrenceId.icalString
                                       : "master item") + ")");

        // Set up the request
        let request = new calGoogleRequest();
        (async () => {
            request.type = request.MODIFY;
            request.calendar = this;
            if (cal.item.isEvent(aNewItem)) {
                let googleId = getGoogleId(aNewItem, this.offlineStorage);
                request.uri = this.createEventsURI("events", googleId);

                // Updating invitations often causes a forbidden error becase
                // some parts are not writable. Using PATCH ignores anything
                // that isn't allowed.
                if (cal.itip.isInvitation(aNewItem)) {
                    request.type = request.PATCH;
                }

                if (Preferences.get("calendar.google.sendEventNotifications", false)) {
                    request.addQueryParameter("sendNotifications", "true");
                }
            } else if (cal.item.isToDo(aNewItem)) {
                request.uri = this.createTasksURI("tasks", aNewItem.id);
            }

            if (!request.uri) {
                throw Components.Exception("Item type not supported",
                                           Cr.NS_ERROR_NOT_IMPLEMENTED);
            }

            request.setUploadData("application/json; charset=UTF-8",
                                  JSON.stringify(ItemToJSON(aNewItem, this.offlineStorage)));

            // Set up etag from storage so we don't overwrite any foreign changes
            let refItem = aOldItem || aNewItem;
            let meta = getItemMetadata(this.offlineStorage, refItem) ||
                       getItemMetadata(this.offlineStorage, refItem.parentItem);
            if (meta && meta.etag) {
                request.addRequestHeader("If-Match", meta.etag);
            } else {
                cal.ERROR("[calGoogleCalendar] Missing ETag for " + refItem.hashId);
            }

            let data;
            try {
                data = await this.session.asyncItemRequest(request);
            } catch (e) {
                if (e.result == calGoogleRequest.CONFLICT_MODIFY ||
                    e.result == calGoogleRequest.CONFLICT_DELETED) {
                    data = await checkResolveConflict(request, this, aNewItem);
                } else {
                    throw e;
                }
            }

            // All we need to do now is parse the item and complete the
            // operation. The cache layer will take care of adding the item
            // to the storage cache.
            let metaData = Object.create(null);
            let item = JSONToItem(data, this,
                                  this.defaultReminders || [],
                                  aNewItem.clone(), metaData);

            // Make sure to update the etag. Do so before switching to the
            // parent item, as google saves its own etags for changed
            // instances.
            migrateItemMetadata(this.offlineStorage, aOldItem, item, metaData);

            if (item.recurrenceId) {
                // If we only modified an exception item, then we need to
                // set the parent item and modify the exception.
                let modifiedItem = aNewItem.parentItem.clone();
                if (item.status == "CANCELLED") {
                    // Canceled means the occurrence is an EXDATE.
                    modifiedItem.recurrenceInfo.removeOccurrenceAt(item.recurrenceId);
                } else {
                    // Not canceled means the occurrence was modified.
                    modifiedItem.recurrenceInfo.modifyException(item, true);
                }
                item = modifiedItem;
            }

            return item;
        })().then((item) => {
            cal.LOG("[calGoogleCalendar] Modifying " + aNewItem.title + " succeeded");
            this.observers.notify("onModifyItem", [item, aOldItem]);
            this.notifyOperationComplete(aListener, Cr.NS_OK,
                                         cIOL.MODIFY, item.id, item);
        }, (e) => {
            let code = e.result || Cr.NS_ERROR_FAILURE;
            if (code != Ci.calIErrors.OPERATION_CANCELLED) {
                cal.ERROR("[calGoogleCalendar] Modifying item " + aNewItem.title +
                          " failed:" + code + ": " + e.message);
            }
            this.notifyPureOperationComplete(aListener, code, cIOL.MODIFY, aNewItem.id, e.message);
        });
        return request;
    },

    deleteItem: function(aItem, aListener) {
        cal.LOG("[calGoogleCalendar] Deleting item " + aItem.title + "(" + aItem.id + ")");

        let request = new calGoogleRequest();
        (async () => {
            request.type = request.DELETE;
            request.calendar = this;
            if (cal.item.isEvent(aItem)) {
                request.uri = this.createEventsURI("events", getGoogleId(aItem, this.offlineStorage));
                if (Preferences.get("calendar.google.sendEventNotifications", false)) {
                    request.addQueryParameter("sendNotifications", "true");
                }
            } else if (cal.item.isToDo(aItem)) {
                request.uri = this.createTasksURI("tasks", aItem.id);
            }

            if (!request.uri) {
                throw Components.Exception("Item type not supported",
                                           Cr.NS_ERROR_NOT_IMPLEMENTED);
            }

            // Set up etag from storage so we don't overwrite any foreign changes
            let meta = getItemMetadata(this.offlineStorage, aItem) ||
                       getItemMetadata(this.offlineStorage, aItem.parentItem);
            if (meta && meta.etag) {
                request.addRequestHeader("If-Match", meta.etag);
            } else {
                cal.ERROR("[calGoogleCalendar] Missing ETag for " + aItem.hashId);
            }

            try {
                await this.session.asyncItemRequest(request);
            } catch (e) {
                if (e.result == calGoogleRequest.CONFLICT_MODIFY ||
                    e.result == calGoogleRequest.CONFLICT_DELETED) {
                    await checkResolveConflict(request, this, aItem);
                } else {
                    throw e;
                }
            }

            deleteItemMetadata(this.offlineStorage, aItem);

            return aItem;
        })().then((item) => {
            cal.LOG("[calGoogleCalendar] Deleting " + aItem.title + " succeeded");
            this.observers.notify("onDeleteItem", [item]);
            this.notifyOperationComplete(aListener, Cr.NS_OK,
                                         cIOL.DELETE, item.id, item);
        }, (e) => {
            let code = e.result || Cr.NS_ERROR_FAILURE;
            if (code != Ci.calIErrors.OPERATION_CANCELLED) {
                cal.ERROR("[calGoogleCalendar] Deleting item " + aItem.title +
                          " failed:" + code + ": " + e.message);
            }
            this.notifyPureOperationComplete(aListener, code, cIOL.DELETE, aItem.id, e.message);
        });
        return request;
    },

    getItem: function(aId, aListener) {
        this.mOfflineStorage.getItem(...arguments);
    },

    getItems: function(aFilter, aCount, aRangeStart, aRangeEnd, aListener) {
        this.mOfflineStorage.getItems(...arguments);
    },

    refresh: function() {
        this.mObservers.notify("onLoad", [this]);
    },

    migrateStorageCache: function() {
        let cacheVersion = this.getProperty("cache.version");
        if (!cacheVersion || cacheVersion >= this.CACHE_DB_VERSION) {
            // Either up to date or first run, make sure property set right.
            this.setProperty("cache.version", this.CACHE_DB_VERSION);
            return Promise.resolve(false);
        }

        let needsReset = false;
        cal.LOG("[calGoogleCalendar] Migrating cache from " +
                cacheVersion + " to " + this.CACHE_DB_VERSION + " for " + this.name);

        if (cacheVersion < 2) {
            // The initial version 1.0 had some issues that required resetting
            // the cache.
            needsReset = true;
        }

        if (cacheVersion < 3) {
            // There was an issue with ids from the birthday calendar, we need
            // to reset just this calendar. See bug 1169062.
            let birthdayCalendar = "#contacts@group.v.calendar.google.com";
            if (this.mCalendarName && this.mCalendarName == birthdayCalendar) {
                needsReset = true;
            }
        }

        // Migration all done. Reset if requested.
        if (needsReset) {
            return this.resetSync().then(() => {
                this.setProperty("cache.version", this.CACHE_DB_VERSION);
                return needsReset;
            });
        } else {
            this.setProperty("cache.version", this.CACHE_DB_VERSION);
            return Promise.resolve(needsReset);
        }
    },

    /**
     * Implement calIChangeLog
     */
    get offlineStorage() { return this.mOfflineStorage; },
    set offlineStorage(val) {
        this.mOfflineStorage = val;
        this.migrateStorageCache();
        return val;
    },

    resetLog: function() {
        this.resetSync().then(() => {
            this.mObservers.notify("onLoad", [this]);
        });
    },

    resetSync: function() {
        return new Promise((resolve, reject) => {
            cal.LOG("[calGoogleCalendar] Resetting last updated counter for " + this.name);
            this.setProperty("syncToken.events", "");
            this.setProperty("lastUpdated.tasks", "");
            this.mThrottle = Object.create(null);
            let listener = {
                onDeleteCalendar: function(aCalendar, aStatus, aDetail) {
                    if (Components.isSuccessCode(aStatus)) {
                        resolve();
                    } else {
                        reject(aDetail);
                    }
                }
            };
            this.mOfflineStorage.QueryInterface(Ci.calICalendarProvider)
                                .deleteCalendar(this.mOfflineStorage, listener);
        });
    },

    replayChangesOn: function(aListener) {
        // Figure out if the user is idle, no need to synchronize if so.
        let idleTime = Cc["@mozilla.org/widget/idleservice;1"].getService(Ci.nsIIdleService).idleTime;
        let maxIdleTime = Preferences.get("calendar.google.idleTime", 300) * 1000;

        if (maxIdleTime != 0 && idleTime > maxIdleTime) {
            cal.LOG("[calGoogleCalendar] Skipping refresh since user is idle");
            aListener.onResult({ status: Cr.NS_OK }, null);
            return Promise.resolve();
        }

        // Now that we've determined we are not idle we can continue with the sync.
        let maxResults = Preferences.get("calendar.google.maxResultsPerRequest", null);

        // We are going to be making potentially lots of changes to the offline
        // storage, start a batch operation.
        this.mOfflineStorage.startBatch();

        // Update the calendar settings
        let calendarPromise = Promise.resolve();
        if (this.mCalendarName && this.checkThrottle("calendarList")) {
            let calendarRequest = new calGoogleRequest();
            calendarRequest.calendar = this;
            calendarRequest.type = calendarRequest.GET;
            calendarRequest.uri = this.createUsersURI("calendarList", this.mCalendarName);
            calendarPromise = this.session.asyncItemRequest(calendarRequest).then((aData) => {
                if (aData.defaultReminders) {
                    this.defaultReminders = aData.defaultReminders.map(reminder => JSONToAlarm(reminder, true));
                } else {
                    this.defaultReminders = [];
                }

                let settings = [
                    "accessRole", "backgroundColor", "description",
                    "foregroundColor", "location", "primary", "summary",
                    "summaryOverride", "timeZone"
                ];

                for (let k of settings) {
                    this.setProperty("settings." + k, aData[k]);
                }
                this.setProperty("settings.defaultReminders", JSON.stringify(aData.defaultReminders));
            });
        }

        // Set up a request for the events
        let eventsRequest = new calGoogleRequest();
        let eventsPromise = Promise.resolve();
        eventsRequest.calendar = this;
        eventsRequest.type = eventsRequest.GET;
        eventsRequest.uri = this.createEventsURI("events");
        eventsRequest.addQueryParameter("maxResults", maxResults);
        let syncToken = this.getProperty("syncToken.events");
        if (syncToken) {
            eventsRequest.addQueryParameter("showDeleted", "true");
            eventsRequest.addQueryParameter("syncToken", syncToken);
        }
        if (eventsRequest.uri && this.checkThrottle("events")) {
            let saver = new ItemSaver(this);
            eventsPromise = this.session.asyncPaginatedRequest(eventsRequest, null, (aData) => {
                // On each request...
                return saver.parseItemStream(aData);
            }, (aData) => {
                // On last request...
                return saver.complete().then(() => {
                    if (aData.nextSyncToken) {
                        cal.LOG("[calGoogleCalendar] New sync token for " +
                                this.name + "(events) is now: " + aData.nextSyncToken);
                        this.setProperty("syncToken.events", aData.nextSyncToken);
                    }
                });
            });
        }

        // Set up a request for tasks
        let tasksRequest = new calGoogleRequest();
        let tasksPromise = Promise.resolve();
        tasksRequest.calendar = this;
        tasksRequest.type = tasksRequest.GET;
        tasksRequest.uri = this.createTasksURI("tasks");
        tasksRequest.addQueryParameter("maxResults", maxResults);
        let lastUpdated = this.getUpdatedMin("tasks");
        if (lastUpdated) {
            tasksRequest.addQueryParameter("updatedMin", cal.dtz.toRFC3339(lastUpdated));
            tasksRequest.addQueryParameter("showDeleted", "true");
        }
        if (tasksRequest.uri && this.checkThrottle("tasks")) {
            let saver = new ItemSaver(this);
            let newLastUpdated = null;
            tasksPromise = this.session.asyncPaginatedRequest(tasksRequest, (aData) => {
                // On the first request...
                newLastUpdated = tasksRequest.requestDate.icalString;
            }, (aData) => {
                // On each request...
                return saver.parseItemStream(aData);
            }, (aData) => {
                // On last request...
                return saver.complete().then(() => {
                    cal.LOG("[calGoogleCalendar] Last sync date for " + this.name +
                            "(tasks) is now: " + tasksRequest.requestDate.toString());
                    this.setProperty("newLastUpdated.tasks", newLastUpdated);
                });
            });
        }

        return Promise.all([calendarPromise, eventsPromise, tasksPromise]).then(() => {
            this.mOfflineStorage.endBatch();
            aListener.onResult({ status: Cr.NS_OK }, null);
        }, (e) => {
            this.mOfflineStorage.endBatch();
            let code = e.result || Cr.NS_ERROR_FAILURE;
            if (code == calGoogleRequest.RESOURCE_GONE) {
                cal.LOG("[calGoogleCalendar] Server did not accept " +
                        "incremental update, resetting calendar and " +
                        "starting over.");
                this.resetSync().then(() => {
                    this.replayChangesOn(aListener);
                }, (err) => {
                    cal.ERROR("[calGoogleCalendar] Error resetting calendar:\n" +
                              stringException(err));
                    aListener.onResult({ status: err.result }, err.message);
                });
            } else {
                cal.LOG("[calGoogleCalendar] Error syncing:\n" + code + ":" +
                        stringException(e));
                aListener.onResult({ status: code }, e.message);
            }
        });
    },

    /**
     * Implement calISchedulingSupport. Most is taken care of by the base
     * provider, but we want to advertise that we will always take care of
     * notifications.
     */
    canNotify: function(aMethod, aItem) { return true; }
};

var NSGetFactory = XPCOMUtils.generateNSGetFactory([calGoogleCalendar]); /* exported NSGetFactory */
