/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1/GPL 2.0/LGPL 2.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Google Calendar Provider code.
 *
 * The Initial Developer of the Original Code is
 *   Philipp Kewisch <mozilla@kewis.ch>
 * Portions created by the Initial Developer are Copyright (C) 2006
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *   Joey Minta <jminta@gmail.com>
 *   Daniel Boelzle <daniel.boelzle@sun.com>
 *
 * Alternatively, the contents of this file may be used under the terms of
 * either the GNU General Public License Version 2 or later (the "GPL"), or
 * the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
 * in which case the provisions of the GPL or the LGPL are applicable instead
 * of those above. If you wish to allow use of your version of this file only
 * under the terms of either the GPL or the LGPL, and not to allow others to
 * use your version of this file under the terms of the MPL, indicate your
 * decision by deleting the provisions above and replace them with the notice
 * and other provisions required by the GPL or the LGPL. If you do not delete
 * the provisions above, a recipient may use your version of this file under
 * the terms of any one of the MPL, the GPL or the LGPL.
 *
 * ***** END LICENSE BLOCK ***** */

Components.utils.import("resource://calendar/modules/calProviderUtils.jsm");

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
}

calGoogleCalendar.prototype = {
    __proto__: cal.ProviderBase.prototype,

    QueryInterface: function cGS_QueryInterface(aIID) {
        return doQueryInterface(this,
                                calGoogleCalendar.prototype,
                                aIID,
                                null,
                                g_classInfo["calGoogleCalendar"]);
    },

    /* Member Variables */
    mSession: null,
    mFullUri: null,
    mCalendarName: null,

    /*
     * Google Calendar Provider attributes
     */

    /**
     * readonly attribute googleCalendarName
     * Google's Calendar name. This represents the <calendar name> in
     * http[s]://www.google.com/calendar/feeds/<calendar name>/private/full
     */
    get googleCalendarName cGC_getGoogleCalendarName() {
        return this.mCalendarName;
    },

    get isDefaultCalendar cGC_isDefaultCalendar() {
        return !/@group\.calendar\.google\.com$/.test(this.mCalendarName);
    },

    /**
     * attribute session
     * An calGoogleSession Object that handles the session requests.
     */
    get session cGC_getSession() {
        return this.mSession;
    },
    set session cGC_setSession(v) {
        return this.mSession = v;
    },

    get title cGC_getTitle() {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    set title cGC_setTitle(v) {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get access cGC_getAccess() {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    set access cGC_setAccess(v) {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get selected cGC_getSelected() {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    set selected cGC_setSelected(v) {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get hidden cGC_getHidden() {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    set hidden cGC_setHidden(v) {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get color cGC_getColor() {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    set color cGC_setColor(v) {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },

    get timezone cGC_getTimezone() {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    set title cGC_setTitle(v) {
        throw Components.results.NS_ERROR_NOT_IMPLEMENTED;
    },
    /**
     * findSession
     * Populates the Session Object based on the preferences or the result of a
     * login prompt.
     *
     * @param aIgnoreExistingSession If set, find the session regardless of
     *                               whether the session has been previously set
     *                               or not
     */
    findSession: function cGC_findSession(aIgnoreExistingSession) {
        if (this.mSession && !aIgnoreExistingSession) {
            return true;
        }

        // We need to find out which Google account fits to this calendar.
        var sessionMgr = getGoogleSessionManager();
        var googleUser = getCalendarPref(this, "googleUser");
        if (googleUser) {
            this.mSession = sessionMgr.getSessionByUsername(googleUser, true);
        } else {
            // We have no user, therefore we need to ask the user. Show a
            // user/password prompt and set the session based on those
            // values.

            var username = { value: null };
            if (this.isDefaultCalendar) {
                // Only pre-fill the username if this is the default calendar,
                // otherwise users might think the cryptic hash is the username
                // they have to use.
                username.value = this.mCalendarName;
            }
            var password = { value: null };
            var persist = { value: false };

            if (getCalendarCredentials(this.mCalendarName,
                                       username,
                                       password,
                                       persist)) {
                this.mSession = sessionMgr.getSessionByUsername(username.value,
                                                                true);

                this.mSession.password = password.value;
                this.mSession.persist = persist.value;
                setCalendarPref(this,
                                "googleUser",
                                "CHAR",
                                this.mSession.userName);
            } else {
                // The password dialog was canceled, disable the calendar.
                this.setProperty("disabled", true);
                return false;
            }
        }
        return true;
    },

    /**
     * ensureSession
     * Make sure a session is available. If not, throw an exception
     */
    ensureSession: function cGC_ensureSession() {
        if (!this.mSession ||
            !this.mSession.password ||
            this.mSession.password == "") {
            if (!this.findSession) {
                throw new Components.Exception("Session was canceled",
                                               Components.results.NS_ERROR_FAILURE);
            }
        }
    },

    /*
     * implement calICalendar
     */
    get type cGC_getType() {
        return "gdata";
    },

    get uri cGC_getUri() {
        return this.mUri;
    },

    get fullUri cGC_getFullUri() {
        return this.mFullUri;
    },
    set uri cGC_setUri(aUri) {
        // Parse google url, catch private cookies, public calendars,
        // basic and full types, bogus ics file extensions, invalid hostnames
        var re = new RegExp("/calendar/(feeds|ical)/" +
                            "([^/]+)/(public|private)-?([^/]+)?/" +
                            "(full|basic)(.ics)?$");

        var matches = aUri.path.match(re);

        if (!matches) {
            throw new Components.Exception(aUri, Components.results.NS_ERROR_MALFORMED_URI);
        }

        // Set internal Calendar Name
        this.mCalendarName = decodeURIComponent(matches[2]);

        // Set normalized url. We need private visibility and full projection
        this.mFullUri = aUri.clone();
        this.mFullUri.path = "/calendar/feeds/" + matches[2] + "/private/full";

        // Remember the uri as it was passed, in case the calendar manager
        // relies on it.
        this.mUri = aUri;

        this.findSession(true);
        return this.mUri;
    },

    getProperty: function cGC_getProperty(aName) {
        switch (aName) {
            // Capabilities
            case "capabilities.timezones.floating.supported":
            case "capabilities.attachments.supported":
            case "capabilities.priority.supported":
            case "capabilities.tasks.supported":
            case "capabilities.alarms.oninvitations.supported":
                return false;
            case "capabilities.privacy.values":
                return ["DEFAULT", "PUBLIC", "PRIVATE"];
            case "capabilities.alarms.maxCount":
                return 5;
            case "capabilities.alarms.actionValues":
                return ["DISPLAY", "EMAIL", "SMS"];
            case "organizerId":
                if (this.mSession) {
                    return "mailto:" + this.session.userName;
                }
                break;
            case "organizerCN":
                if (this.mSession) {
                    return this.session.fullName;
                }
                break;
            case "itip.transport":
                if (!this.isDefaultCalendar ||
                    !getPrefSafe("calendar.google.enableEmailInvitations", false)) {
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
                    !getPrefSafe("calendar.google.enableEmailInvitations", false)) {
                    return true;
                }
                break;
        }

        return this.__proto__.__proto__.getProperty.apply(this, arguments);
    },

    get canRefresh cGC_getCanRefresh() {
        return true;
    },

    adoptItem: function cGC_adoptItem(aItem, aListener) {
        LOG("Adding item " + aItem.title);

        try {
            // Check if calendar is readonly
            if (this.readOnly) {
                throw new Components.Exception("",
                                               Components.interfaces.calIErrors.CAL_IS_READONLY);
            }

            // Make sure the item is an event
            aItem = aItem.QueryInterface(Components.interfaces.calIEvent);

            // Check if we have a session. If not, then the user has canceled
            // the login prompt.
            this.ensureSession();

            // Add the calendar to the item, for later use.
            aItem.calendar = this.superCalendar;

            var request = new calGoogleRequest(this);
            var xmlEntry = ItemToXMLEntry(aItem,
                                          this.session.userName,
                                          this.session.fullName);

            request.type = request.ADD;
            request.uri = this.fullUri.spec;
            request.setUploadData("application/atom+xml; charset=UTF-8", xmlEntry);
            request.operationListener = aListener;
            request.calendar = this;

            var calendar = this;
            request.responseListener = {
                onResult: function cGC_addItem_response_onResult(aOperation, aData) {
                    calendar.addItem_response(aOperation, aData);
                }
            };

            request.addQueryParameter("ctz", calendarDefaultTimezone().tzid);

            this.session.asyncItemRequest(request);
            return request;
        } catch (e) {
            LOG("adoptItem failed before request " + aItem.title + "\n:" + e);
            if (e.result == Components.interfaces.calIErrors.CAL_IS_READONLY) {
                // The calendar is readonly, make sure this is set and
                // notify the user. This can come from above or from
                // mSession.addItem which checks for the editURI
                this.readOnly = true;
            }

            this.notifyOperationComplete(aListener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.ADD,
                                         null,
                                         e.message);
        }
        return null;
    },

    addItem: function cGC_addItem(aItem, aListener) {
        // Google assigns an ID to every event added. Any id set here or in
        // adoptItem will be overridden.
        return this.adoptItem( aItem.clone(), aListener );
    },

    modifyItem: function cGC_modifyItem(aNewItem, aOldItem, aListener) {
        LOG("Modifying item " + aOldItem.title);

        try {
            if (this.readOnly) {
                throw new Components.Exception("",
                                               Components.interfaces.calIErrors.CAL_IS_READONLY);
            }

            // Check if we have a session. If not, then the user has canceled
            // the login prompt.
            this.ensureSession();

            // Check if enough fields have changed to warrant sending the event
            // to google. This saves network traffic.
            if (relevantFieldsMatch(aOldItem, aNewItem)) {
                LOG("Not requesting item modification for " + aOldItem.id +
                    "(" + aOldItem.title + "), relevant fields match");

                this.notifyOperationComplete(aListener,
                                             Components.results.NS_OK,
                                             Components.interfaces.calIOperationListener.MODIFY,
                                             aNewItem.id,
                                             aNewItem);
                this.mObservers.notify("onModifyItem", [aNewItem, aOldItem]);
                return null;
            }

            // Set up the request
            var request = new calGoogleRequest(this.session);

            // We need to clone the new item, its possible that ItemToXMLEntry
            // will modify the item. For example, if the item is organized by
            // someone else, we cannot save alarms on it and they should
            // therefore not be added in the returned item. 
            var newItem = aNewItem.clone();

            var xmlEntry = ItemToXMLEntry(newItem,
                                          this.session.userName,
                                          this.session.fullName);

            if (aOldItem.parentItem != aOldItem &&
                !aOldItem.parentItem.recurrenceInfo.getExceptionFor(aOldItem.startDate)) {

                // In this case we are modifying an occurence, not deleting it
                request.type = request.ADD;
                request.uri = this.fullUri.spec;
            } else {
                // We are  making a negative exception or modifying a parent item
                request.type = request.MODIFY;
                request.uri = getItemEditURI(aOldItem);
            }

            request.setUploadData("application/atom+xml; charset=UTF-8", xmlEntry);
            request.responseListener = this.modifyItem_response,
            request.operationListener = aListener;
            request.newItem = newItem;
            request.oldItem = aOldItem;
            request.calendar = this;

            var calendar = this;
            request.responseListener = {
                onResult: function cGC_modifyItem_response_onResult(aOperation, aData) {
                    calendar.modifyItem_response(aOperation, aData);
                }
            };

            request.addQueryParameter("ctz", calendarDefaultTimezone().tzid);

            this.session.asyncItemRequest(request);
            return request;
        } catch (e) {
            LOG("modifyItem failed before request " +
                aNewItem.title + "(" + aNewItem.id + "):\n" + e);

            if (e.result == Components.interfaces.calIErrors.CAL_IS_READONLY) {
                // The calendar is readonly, make sure this is set and
                // notify the user. This can come from above or from
                // mSession.modifyItem which checks for the editURI
                this.readOnly = true;
            }

            this.notifyOperationComplete(aListener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.MODIFY,
                                         null,
                                         e.message);
        }
        return null;
    },

    deleteItem: function cGC_deleteItem(aItem, aListener) {
        LOG("Deleting item " + aItem.title + "(" + aItem.id + ")");

        try {
            if (this.readOnly) {
                throw new Components.Exception("",
                                               Components.interfaces.calIErrors.CAL_IS_READONLY);
            }

            // Check if we have a session. If not, then the user has canceled
            // the login prompt.
            this.ensureSession();

            // We need the item in the response, since google dosen't return any
            // item XML data on delete, and we need to call the observers.
            var request = new calGoogleRequest(this);

            request.type = request.DELETE;
            request.uri = getItemEditURI(aItem);
            request.operationListener = aListener;
            request.oldItem = aItem;
            request.calendar = this;

            var calendar = this;
            request.responseListener = {
                onResult: function cGC_deleteItem_response_onResult(aOperation, aData) {
                    calendar.deleteItem_response(aOperation, aData);
                }
            };

            this.session.asyncItemRequest(request);
            return request;
        } catch (e) {
            LOG("deleteItem failed before request for " +
                aItem.title + "(" + aItem.id + "):\n" + e);

            if (e.result == Components.interfaces.calIErrors.CAL_IS_READONLY) {
                // The calendar is readonly, make sure this is set and
                // notify the user. This can come from above or from
                // mSession.deleteItem which checks for the editURI
                this.readOnly = true;
            }

            this.notifyOperationComplete(aListener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.DELETE,
                                         null,
                                         e.message);
        }
        return null;
    },

    getItem: function cGC_getItem(aId, aListener) {
        // This function needs a test case using mechanisms in bug 365212
        LOG("Getting item with id " + aId);
        try {

            // Check if we have a session. If not, then the user has canceled
            // the login prompt.
            this.ensureSession();

            // Set up the request

            var request = new calGoogleRequest(this);

            request.itemId = aId;
            request.type = request.GET;
            request.uri = this.fullUri.spec;
            request.operationListener = aListener;
            request.calendar = this;

            var calendar = this;
            request.responseListener = {
                onResult: function cGC_getItem_response_onResult(aOperation, aData) {
                    calendar.getItem_response(aOperation, aData);
                }
            };

            // Request Parameters
            request.addQueryParameter("ctz", calendarDefaultTimezone().tzid);
            request.addQueryParameter("max-results", kMANY_EVENTS);
            request.addQueryParameter("singleevents", "false");

            this.session.asyncItemRequest(request);
            return request;
        } catch (e) {
            LOG("getItem failed before request " + aId + "):\n" + e);

            this.notifyOperationComplete(aListener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.GET,
                                         null,
                                         e.message);
        }
        return null;
    },

    getItems: function cGC_getItems(aItemFilter,
                                    aCount,
                                    aRangeStart,
                                    aRangeEnd,
                                    aListener) {
        try {
            // Check if we have a session. If not, then the user has canceled
            // the login prompt.
            this.ensureSession();

            // item base type
            var wantEvents = ((aItemFilter &
                               Components.interfaces.calICalendar.ITEM_FILTER_TYPE_EVENT) != 0);
            var wantInvitations = ((aItemFilter &
                 Components.interfaces.calICalendar.ITEM_FILTER_REQUEST_NEEDS_ACTION) != 0);


            if (!wantEvents) {
                // Events are not wanted, nothing to do. The
                // notifyOperationComplete in the catch block below will catch
                // this.
                throw new Components.Exception("", Components.results.NS_OK);
            }

            // Requesting only a DATE returns items based on UTC. Therefore, we make
            // sure both start and end dates include a time and timezone. This may
            // not quite be what was requested, but I'd say its a shortcoming of
            // rfc3339.
            if (aRangeStart) {
                aRangeStart = aRangeStart.clone();
                aRangeStart.isDate = false;
            }
            if (aRangeEnd) {
                aRangeEnd = aRangeEnd.clone();
                aRangeEnd.isDate = false;
            }

            var rfcRangeStart = cal.toRFC3339(aRangeStart);
            var rfcRangeEnd = cal.toRFC3339(aRangeEnd);

            var request = new calGoogleRequest(this);

            request.type = request.GET;
            request.uri = this.fullUri.spec;
            request.operationListener = aListener;
            request.calendar = this;
            request.itemRangeStart = aRangeStart;
            request.itemRangeEnd = aRangeEnd;
            request.itemFilter = aItemFilter;

            // Request Parameters
            request.addQueryParameter("ctz", calendarDefaultTimezone().tzid);
            request.addQueryParameter("max-results",
                                      aCount ? aCount : kMANY_EVENTS);
            request.addQueryParameter("singleevents", "false");
            request.addQueryParameter("start-min", rfcRangeStart);
            request.addQueryParameter("start-max", rfcRangeEnd);

            var calendar = this;
            request.responseListener = {
                onResult: function cGC_getItems_response_onResult(aOperation, aData) {
                    calendar.getItems_response(aOperation, aData);
                }
            };

            this.session.asyncItemRequest(request);
            return request;
        } catch (e) {
            this.notifyOperationComplete(aListener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.GET,
                                         null,
                                         e.message);
        }
        return null;
    },

    refresh: function cGC_refresh() {
        this.mObservers.notify("onLoad", [this]);
    },

    /*
     * Google Calendar Provider Response Listener functions
     */

    /**
     * addItem_response
     * Response function, called by the session object when an item was added
     *
     * @param aOperation The calIGoogleRequest processing the request
     * @param aData      In case of an error, this is the error string, otherwise
     *                     an XML representation of the added item.
     */
    addItem_response: function cGC_addItem_response(aOperation, aData) {
        var item = this.general_response(aOperation, aData);

        if (item) {
            this.mObservers.notify("onAddItem", [item]);
        }
    },

    /**
     * modifyItem_response
     * Response function, called by the session object when an item was modified
     *
     * @param aOperation The calIGoogleRequest processing the request
     * @param aData      In case of an error, this is the error string, otherwise
     *                     an XML representation of the added item.
     */
    modifyItem_response: function cGC_modifyItem_response_onResult(aOperation,
                                                                   aData) {
        var item = this.general_response(aOperation,
                                         aData,
                                         aOperation.newItem);
        // Notify Observers
        if (item) {
            var oldItem = aOperation.oldItem;
            if (item.parentItem != item) {
                item.parentItem.recurrenceInfo.modifyException(item, false);
                item = item.parentItem;
                oldItem = oldItem.parentItem;
            }
            this.mObservers.notify("onModifyItem", [item, oldItem]);
        }
    },

    /**
     * deleteItem_response
     * Response function, called by the session object when an Item was deleted
     *
     * @param aOperation The calIGoogleRequest processing the request
     * @param aData      In case of an error, this is the error string, otherwise
     *                     an XML representation of the added item.
     */
    deleteItem_response: function cGC_deleteItem_response_onResult(aOperation,
                                                                   aData) {
        // The reason we are not using general_response here is because deleted
        // items are not returned as xml from google. We need to pass the item
        // we saved with the request.

        try {
            // Check if the call succeeded
            if (aOperation.status != Components.results.NS_OK) {
                throw new Components.Exception(aData, aOperation.status);
            }

            // All operations need to call onOperationComplete
            LOG("Deleting item " + aOperation.oldItem.id + " successful");
            this.notifyOperationComplete(aOperation.operationListener,
                                         Components.results.NS_OK,
                                         Components.interfaces.calIOperationListener.DELETE,
                                         aOperation.oldItem.id,
                                         aOperation.oldItem);

            // Notify Observers
            this.mObservers.notify("onDeleteItem", [aOperation.oldItem]);
        } catch (e) {
            LOG("Deleting item " + aOperation.oldItem.id + " failed");
            // Operation failed
            this.notifyOperationComplete(aOperation.operationListener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.DELETE,
                                         null,
                                         e.message);
        }
    },

    /**
     * getItem_response
     * Response function, called by the session object when a single Item was
     * downloaded.
     *
     * @param aOperation The calIGoogleRequest processing the request
     * @param aData      In case of an error, this is the error string, otherwise
     *                     an XML representation of the added item.
     */
    getItem_response: function cGC_getItem_response_onResult(aOperation,
                                                             aData) {
        // XXX Due to google issue 399, we need to parse a full feed here.
        try {
            if (!Components.isSuccessCode(aOperation.status)) {
                throw new Components.Exception(aData, aOperation.status);
            }

            // Prepare Namespaces
            var gCal = new Namespace("gCal",
                                     "http://schemas.google.com/gCal/2005");
            var gd = new Namespace("gd", "http://schemas.google.com/g/2005");
            var atom = new Namespace("", "http://www.w3.org/2005/Atom");
            default xml namespace = atom;

            // A feed was passed back, parse it. Due to bug 336551 we need to
            // filter out the <?xml...?> part.
            var xml = new XML(aData.substring(38));
            var timezoneString = xml.gCal::timezone.@value.toString() || "UTC";
            var timezone = gdataTimezoneService.getTimezone(timezoneString);

            // This line is needed, otherwise the for each () block will never
            // be entered. It may seem strange, but if you don't believe me, try
            // it!
            xml.link.(@rel);

            // We might be able to get the full name through this feed's author
            // tags. We need to make sure we have a session for that.
            this.ensureSession();

            // Get the item entry by id.
            var itemEntry = xml.entry.(id.substring(id.lastIndexOf('/') + 1) == aOperation.itemId ||
                                       gCal::uid.@value == aOperation.itemId);
            if (!itemEntry || !itemEntry.length()) {
                // Item wasn't found. Skip onGetResult and just complete. Not
                // finding an item isn't a user-important error, it may be a
                // wanted case. (i.e itip)
                throw new Components.Exception("Item not found", Components.results.NS_OK);
            }
            var item = XMLEntryToItem(itemEntry, timezone, this);

            if (item.recurrenceInfo) {
                // If this item is recurring, get all exceptions for this item.
                for each (var entry in xml.entry.gd::originalEvent.(@id == aOperation.itemId)) {
                    var excItem = XMLEntryToItem(entry.parent(), timezone, this);

                    // Google uses the status field to reflect negative
                    // exceptions.
                    if (excItem.status == "CANCELED") {
                        item.recurrenceInfo.removeOccurrenceAt(excItem.recurrenceId);
                    } else {
                        excItem.calendar = this;
                        item.recurrenceInfo.modifyException(excItem, true);
                    }
                }
            }
            // We are done, notify the listener of our result and that we are
            // done.
            aOperation.operationListener.onGetResult(this.superCalendar,
                                                     Components.results.NS_OK,
                                                     Components.interfaces.calIEvent,
                                                     null,
                                                     1,
                                                     [item]);
            this.notifyOperationComplete(aOperation.operationListener,
                                         Components.results.NS_OK,
                                         Components.interfaces.calIOperationListener.GET,
                                         item.id,
                                         null);
        } catch (e) {
            if (!Components.isSuccessCode(e.result)) {
                LOG("Error getting item " + aOperation.itemId + ":\n" + e);
                Components.utils.reportError(e);
            }
            this.notifyOperationComplete(aOperation.operationListener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.GET,
                                         null,
                                         e.message);
        }
    },

    /**
     * getItems_response
     * Response function, called by the session object when an Item feed was
     * downloaded.
     *
     * @param aOperation The calIGoogleRequest processing the request
     * @param aData      In case of an error, this is the error string, otherwise
     *                     an XML representation of the added item.
     */
    getItems_response: function cGC_getItems_response(aOperation, aData) {
        // To simplify code, provide a one-stop function to call, independant of
        // if and what type of listener was passed.
        var listener = aOperation.operationListener ||
            { onGetResult: function() {}, onOperationComplete: function() {} };

        LOG("Recieved response for " + aOperation.uri);
        try {
            // Check if the call succeeded
            if (!Components.isSuccessCode(aOperation.status)) {
                throw new Components.Exception(aData, aOperation.status);
            }

            // Prepare Namespaces
            var gCal = new Namespace("gCal",
                                     "http://schemas.google.com/gCal/2005");
            var gd = new Namespace("gd", "http://schemas.google.com/g/2005");
            var atom = new Namespace("", "http://www.w3.org/2005/Atom");
            default xml namespace = atom;

            // A feed was passed back, parse it. Due to bug 336551 we need to
            // filter out the <?xml...?> part.
            var xml = new XML(aData.substring(38));
            var timezoneString = xml.gCal::timezone.@value.toString() || "UTC";
            var timezone = gdataTimezoneService.getTimezone(timezoneString);
            
            // This line is needed, otherwise the for each () block will never
            // be entered. It may seem strange, but if you don't believe me, try
            // it!
            xml.link.(@rel);

            // We might be able to get the full name through this feed's author
            // tags. We need to make sure we have a session for that.
            this.ensureSession();

            if (xml.author.email == this.mSession.userName) {
                // If the current entry contains the user's email, then we can
                // extract the user's full name also.
                this.mSession.fullName = xml.author.name.toString();
            }


            var wantInvitations = ((aOperation.itemFilter &
                 Components.interfaces.calICalendar.ITEM_FILTER_REQUEST_NEEDS_ACTION) != 0);

            // Parse all <entry> tags
            for each (var entry in xml.entry) {
                if (entry.gd::originalEvent.toString().length) {
                    // This is an exception. If we are doing an uncached
                    // operation, then skip it for now since it will be parsed
                    // later.
                    continue;
                }


                var item = XMLEntryToItem(entry, timezone, this);
                item.calendar = this.superCalendar;

                if (wantInvitations) {
                    // If invitations are wanted and this is not an invitation,
                    // or if the user is not an attendee, or has already accepted
                    // then this is not an invitation.
                    var att = item.getAttendeeById("mailto:" + this.session.userName);
                    if (!this.isInvitation(item) ||
                        !att ||
                        att.participationStatus != "NEEDS-ACTION") {
                        continue;
                    }
                }

                LOG("Parsing entry:\n" + entry + "\n");

                if (item.recurrenceInfo) {
                    // If we are doing an uncached operation, then we need to
                    // gather all exceptions and put them into the item.
                    // Otherwise, our listener will take care of mapping the
                    // exception to the base item.
                    for each (var oid in xml.entry.gd::originalEvent.(@id == item.id)) {
                        // Get specific fields so we can speed up the parsing process
                        var status = oid.parent().gd::eventStatus.@value.toString().substring(39);

                        if (status == "canceled") {
                            let rId = oid.gd::when.@startTime.toString();
                            let rDate = cal.fromRFC3339(rId, timezone);
                            LOG("Negative exception " + rId + "/" + rDate);
                            item.recurrenceInfo.removeOccurrenceAt(rDate);
                        } else {
                            // Parse the exception and modify the current item
                            var excItem = XMLEntryToItem(oid.parent(),
                                                         timezone,
                                                         this);
                            if (excItem) {
                                // Google uses the status field to reflect negative
                                // exceptions.
                                excItem.calendar = this;
                                item.recurrenceInfo.modifyException(excItem, true);
                            }
                        }
                    }
                }

                item.makeImmutable();
                LOGitem(item);

                // This is an uncached call, expand the item and tell our
                // get listener about the item.
                var expandedItems = expandItems(item, aOperation);
                listener.onGetResult(this.superCalendar,
                                     Components.results.NS_OK,
                                     Components.interfaces.calIEvent,
                                     null,
                                     expandedItems.length,
                                     expandedItems);
            }
            // Operation Completed successfully.
            this.notifyOperationComplete(listener,
                                         Components.results.NS_OK,
                                         Components.interfaces.calIOperationListener.GET,
                                         null,
                                         null);
        } catch (e) {
            LOG("Error getting items:\n" + e);
            this.notifyOperationComplete(listener,
                                         e.result,
                                         Components.interfaces.calIOperationListener.GET,
                                         null,
                                         e.message);
        }
    },

    /**
     * general_response
     * Handles common actions for multiple response types. This does not notify
     * observers.
     *
     * @param aOperation        The calIGoogleRequest that initiated the request.
     * @param aData             The string represenation of the item
     * @param aReferenceItem    The item to apply the information from the xml
     *                            to. If null, a new item will be used.
     * @return                  The Item as a calIEvent, or null if an error
     *                            happened
     */
    general_response: function cGC_general_response(aOperation,
                                                    aData,
                                                    aReferenceItem) {

        try {
            // Check if the call succeeded, if not then aData is an error
            // message

            if (!Components.isSuccessCode(aOperation.status)) {
                throw new Components.Exception(aData, aOperation.status);
            }

            // An Item was passed back, parse it. Due to bug 336551 we need to
            // filter out the <?xml...?> part.
            var xml = new XML(aData.substring(38));

            // Get the local timezone from the preferences
            var timezone = calendarDefaultTimezone();

            // Parse the Item with the given timezone
            var item = XMLEntryToItem(xml,
                                      timezone,
                                      this,
                                      aReferenceItem);

            LOGitem(item);
            item.calendar = this.superCalendar;

            // GET operations need to call onGetResult
            if (aOperation.type == aOperation.GET) {
                aOperation.operationListener
                          .onGetResult(this.superCalendar,
                                       Components.results.NS_OK,
                                       Components.interfaces.calIEvent,
                                       null,
                                       1,
                                       [item]);
            }

            // All operations need to call onOperationComplete
            // calIGoogleRequest's type corresponds to calIOperationListener's
            // constants, so we can use them here.
            this.notifyOperationComplete(aOperation.operationListener,
                                         Components.results.NS_OK,
                                         aOperation.type,
                                         (item ? item.id : null),
                                         item);
            return item;
        } catch (e) {
            LOG("General response failed: " + e);

            if (e.result == Components.interfaces.calIErrors.CAL_IS_READONLY) {
                // The calendar is readonly, make sure this is set and
                // notify the user.
                this.readOnly = true;
            }

            // Operation failed
            this.notifyOperationComplete(aOperation.operationListener,
                                         e.result,
                                         aOperation.type,
                                         null,
                                         e.message);
        }
        return null;
    },

    /**
     * Implement calIChangeLog
     */
    resetLog: function cGC_resetLog() {
        LOG("Resetting last updated counter for " + this.name);
        this.deleteProperty("google.lastUpdated");
    },

    replayChangesOn: function cGC_replayChangesOn(aDestination, aListener) {
        var lastUpdate = this.getProperty("google.lastUpdated");
        var lastUpdateDateTime;
        if (lastUpdate) {
            // Set up the last sync stamp
            lastUpdateDateTime = createDateTime();
            lastUpdateDateTime.icalString = lastUpdate;

            // Set up last week
            var lastWeek = getCorrectedDate(now().getInTimezone(UTC()));
            lastWeek.day -= 7;
            if (lastWeek.compare(lastUpdateDateTime) >= 0) {
                // The last sync was longer than a week ago. Google requires a full
                // sync in that case. This call also takes care of calling
                // resetLog().
                this.superCalendar.wrappedJSObject.setupCachedCalendar();
                lastUpdateDateTime = null;
            }
            LOG("The calendar " + this.name + " was last modified: " + lastUpdateDateTime);

        }

        var request = new calGoogleRequest(this.mSession);

        request.type = request.GET;
        request.uri = this.fullUri.spec
        request.destinationCal = aDestination;

        var calendar = this;
        request.responseListener = {
            onResult: function cGC_syncItems_response_onResult(aOperation, aData) {
                calendar.syncItems_response(aOperation, aData, (lastUpdateDateTime == null));

            }
        };
        request.operationListener = aListener;
        request.calendar = this;

        // Request Parameters
        request.addQueryParameter("ctz", calendarDefaultTimezone().tzid);
        request.addQueryParameter("max-results", kMANY_EVENTS);
        request.addQueryParameter("singleevents", "false");

        if (lastUpdateDateTime) {
            // Partial sync requires sending updated-min
            request.addQueryParameter("updated-min", cal.toRFC3339(lastUpdateDateTime));
        }

        // Request the item. The response function is ready to take care of both
        // uncached getItem requests and this type of synchronization request.
        this.mSession.asyncItemRequest(request);
    },

    /**
     * syncItems_response
     * Response function, called by the session object when an Item feed was
     * downloaded.
     *
     * @param aOperation    The calIGoogleRequest processing the request
     * @param aData         In case of an error, this is the error string, otherwise
     *                        an XML representation of the added item.
     * @param aIsFullSync   If set, this is a full sync rather than an update.
     */
    syncItems_response: function cGC_syncItems_response(aOperation, aData, isFullSync) {
        LOG("Recieved response for " + aOperation.uri + (isFullSync ? " (full sync)" : ""));
        try {
            // Check if the call succeeded
            if (!Components.isSuccessCode(aOperation.status)) {
                throw new Components.Exception(aData, aOperation.status);
            }

            // Prepare Namespaces
            var gCal = new Namespace("gCal",
                                     "http://schemas.google.com/gCal/2005");
            var gd = new Namespace("gd", "http://schemas.google.com/g/2005");
            var atom = new Namespace("", "http://www.w3.org/2005/Atom");
            default xml namespace = atom;

            // A feed was passed back, parse it. Due to bug 336551 we need to
            // filter out the <?xml...?> part.
            var xml = new XML(aData.substring(38));
            var timezoneString = xml.gCal::timezone.@value.toString() || "UTC";
            var timezone = gdataTimezoneService.getTimezone(timezoneString);

            // This line is needed, otherwise the for each () block will never
            // be entered. It may seem strange, but if you don't believe me, try
            // it!
            xml.link.(@rel);

            // We might be able to get the full name through this feed's author
            // tags. We need to make sure we have a session for that.
            this.ensureSession();

            if (xml.author.email == this.mSession.userName) {
                // If the current entry contains the user's email, then we can
                // extract the user's full name also.
                this.mSession.fullName = xml.author.name.toString();
            }

            // This is the calendar we should sync changes into.
            var destinationCal = aOperation.destinationCal;

            for each (var entry in xml.entry) {

                var recurrenceId = getRecurrenceIdFromEntry(entry, timezone);
                if (isFullSync && recurrenceId) {
                    // On a full sync, we parse exceptions different.
                    continue;
                }
                LOG("Parsing entry:\n" + entry + "\n");

                var referenceItemObj = {}
                destinationCal.getItem(getIdFromEntry(entry),
                                       new syncSetter(referenceItemObj));
                var referenceItem = referenceItemObj.value &&
                                    referenceItemObj.value.clone();

                // Parse the item. If we got a reference item from the storage
                // calendar, put that in to make sure we get all exceptions and
                // such.
                var item = XMLEntryToItem(entry,
                                          timezone,
                                          this,
                                          (recurrenceId && referenceItem ? null : referenceItem));
                item.calendar = this.superCalendar;

                if (isFullSync && item.recurrenceInfo) {
                    // On a full synchronization, we can go ahead and pre-parse
                    // all exceptions and then add the item at once. This way we
                    // make sure
                    for each (var oid in xml.entry.gd::originalEvent.(@id == item.id)) {
                        // Get specific fields so we can speed up the parsing process
                        var status = oid.parent().gd::eventStatus.@value.toString().substring(39);

                        if (status == "canceled") {
                            let rId = oid.gd::when.@startTime.toString();
                            let rDate = cal.fromRFC3339(rId, timezone);
                            item.recurrenceInfo.removeOccurrenceAt(rDate);
                            LOG("Negative exception " + rId + "/" + rDate);
                        } else {
                            // Parse the exception and modify the current item
                            var excItem = XMLEntryToItem(oid.parent(),
                                                         timezone,
                                                         this);
                            if (excItem) {
                                // Google uses the status field to reflect negative
                                // exceptions.
                                excItem.calendar = this;
                                item.recurrenceInfo.modifyException(excItem, true);
                            }
                        }
                    }
                }

                LOGitem(item);

                if (!isFullSync && item.recurrenceId && referenceItem) {
                    // This is a single occurrence that has been updated.
                    if (item.status == "CANCELED") {
                        // Canceled means the occurrence is an EXDATE.
                        referenceItem.recurrenceInfo.removeOccurrenceAt(item.recurrenceId);
                    } else {
                        // Not canceled means the occurrence was modified.
                        item.parentItem = referenceItem;
                        referenceItem.recurrenceInfo.modifyException(item, true);
                    }
                    destinationCal.modifyItem(referenceItem, null, null);
                } else if (!item.recurrenceId) {
                    // This is a normal item. If it was canceled, then it should
                    // be deleted, otherwise it should be either added or
                    // modified. The relaxed mode of the destination calendar
                    // takes care of the latter two cases.
                    if (item.status == "CANCELED") {
                        destinationCal.deleteItem(item, null);
                    } else {
                        destinationCal.modifyItem(item, null, null);
                    }
                } else {
                    // We could not find the parent item for the occurrence in
                    // the feed.
                    WARN("occurrence without parent for item "  + item.id);
                }
            }

            // Set the last updated timestamp to now.
            LOG("Last sync date for " + this.name + " is now: " +
                aOperation.requestDate.toString());
            this.setProperty("google.lastUpdated",
                             aOperation.requestDate.icalString);

            // Tell our listener we are done.
            aOperation.operationListener.onResult(aOperation, null);
        } catch (e) {
            LOG("Error syncing items:\n" + e);
            aOperation.operationListener.onResult({ status: e.result }, e.message);
        }
    },

    /**
     * Implement calISchedulingSupport. Most is taken care of by the base
     * provider, but we want to advertise that we will always take care of
     * notifications.
     */
    canNotify: function cGC_canNotify(aMethod, aItem) {
        return true;
    }
};
