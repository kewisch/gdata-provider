/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

Components.utils.import("resource://gdata-provider/modules/shim/Loader.jsm").shimIt(this);
Components.utils.import("resource://gdata-provider/modules/shim/Calendar.jsm");
Components.utils.import("resource://gdata-provider/modules/shim/PromiseExtras.jsm");
Components.utils.import("resource://gdata-provider/modules/gdataSession.jsm");
Components.utils.import("resource://gdata-provider/modules/gdataUtils.jsm");

CuImport("resource://gre/modules/Promise.jsm", this);

(function() {
    function pageorder(anchor /*, ...pages */) {
        let pages = Array.slice(arguments, 1);
        let wizard = document.documentElement;
        let page = wizard.getPageById(anchor);
        for each (let id in pages) {
            page.next = id;
            page = wizard.getPageById(id);
        }
    }

    function trycatch(func) {
        return function() {
            try {
                return func.apply(this, arguments);
            } catch (e) {
                Components.utils.reportError(e);
                throw e;
            }
        };
    }

    let previousUriValue = null;
    function selectProvider(type) {
        let isGdata = (type == "gdata");
        let curi = document.getElementById("calendar-uri");
        let wizard = document.documentElement;

        curi.parentNode.style.visibility = (isGdata ? "hidden" : "visible");
        document.getElementById("cache").parentNode.style.visibility = (isGdata ? "hidden" : "visible");

        // Move the next step descrition to the right place
        let locationRows = document.querySelector("#calendar-wizard > [pageid='locationPage'] > grid > rows");
        let nextStepDescr = document.getElementById("gdata-nextstep-description");
        locationRows.appendChild(nextStepDescr);

        if (isGdata) {
            pageorder("locationPage", "gdata-session", "gdata-calendars", "finishPage");
            previousUriValue = curi.value;
            curi.value = "googleapi://unknown";
            nextStepDescr.removeAttribute("hidden");
        } else {
            nextStepDescr.setAttribute("hidden", "true");
            pageorder("locationPage", "customizePage", "finishPage");
            if (previousUriValue !== null) {
                curi.value = previousUriValue;
                previousUriValue = null;
            }
        }

        checkRequired();
    }
    this.gdataSelectProvider = selectProvider;

    if (typeof tmpCalendarCreation == "undefined") {
        monkeyPatch(window, "onSelectProvider", function(protofunc, type) {
            selectProvider(type);
            return protofunc(type);
        });
    } else {
        // The exchange provider overwrites the select handler, which causes
        // our provider to fail. The exchange provider overwrites the select
        // handler, which causes our provider to fail. Given the exchange
        // provider is currently not maintained and we want them to work
        // together, here is a workaround.
        monkeyPatch(tmpCalendarCreation, "doRadioExchangeCalendar", function(protofunc, target) {
            // We need to run our function first, otherwise resetting the
            // pageorder will overwrite what the exchange provider does.
            selectProvider(target.value);
            let rv = protofunc(target);

            // But then again, when switching to the gdata provider, the
            // exchange provider overwrites the uri we set.
            if (target.value == "gdata") {
                let curi = document.getElementById("calendar-uri");
                curi.value = "googleapi://unknown";
                checkRequired();
            }
            return rv;
        });
    }

    monkeyPatch(window, "prepareCreateCalendar", function(protofunc) {
        let type = document.getElementById('calendar-format').selectedItem.value;
        return (type == "gdata" ? true : protofunc());
    });

    monkeyPatch(window, "checkRequired", function(protofunc) {
        let wizard = document.documentElement;
        let currentPageId = wizard.currentPage && wizard.currentPage.pageid;

        if (currentPageId == "gdata-session") {
            let sessionGroup = document.getElementById("gdata-session-group");
            let sessionName = document.getElementById("gdata-session-name");
            let sessionNameIsValid = document.getAnonymousElementByAttribute(sessionName, "anonid", "input").validity.valid;
            // TODO for some reason the validity doesn't work on windows. Here is a hack:
            sessionNameIsValid = !!sessionName.value.match(/^[^\/]+@[^\/]+\.[^\/]+$/);
            wizard.canAdvance = sessionGroup.value || (sessionName.value && sessionNameIsValid);
        } else if (currentPageId == "gdata-calendars") {
            let calendarList = document.getElementById("calendar-list");
            let calendars = calendarList.selectedCalendars.filter(function(x) { return !x.getProperty("disabled") && !x.readOnly; });
            wizard.canAdvance = !!calendars.length;
        } else {
            protofunc();
        }
    });

    this.gdataSessionShow = trycatch(function() {
        let sessionMgr = getGoogleSessionManager();
        let sessionContainer = document.getElementById("gdata-session-group");
        let newSessionItem = document.getElementById("session-new");
        let calendars = cal.getCalendarManager().getCalendars({});
        let sessions = new Set([ sessionMgr.getSessionByCalendar(calendar, true)
                                 for each (calendar in calendars) ]);

        while (sessionContainer.firstChild.id != "session-new") {
            sessionContainer.removeChild(sessionContainer.firstChild);
        }

        // forEach is needed for backwards compatibility.
        sessions.forEach(function(session) {
            if (!session) {
                return;
            }

            let radio = document.createElement("radio");
            radio.setAttribute("value", session.id);
            radio.setAttribute("label", session.id);
            sessionContainer.insertBefore(radio, newSessionItem);
            radio.gdataSession = session;
        });

        sessionContainer.value = sessionContainer.firstChild.value;
        if (sessionContainer.value == "") {
            let sessionName = document.getElementById("gdata-session-name");
            sessionName.focus();
        }
    });

    this.gdataCalendarsShow = trycatch(function() {
        let calMgr = cal.getCalendarManager();
        let sessionMgr = getGoogleSessionManager();
        let sessionContainer = document.getElementById("gdata-session-group");
        let calendarListWidget = document.getElementById("calendar-list");
        calendarListWidget.clear();

        let session = sessionContainer.selectedItem.gdataSession;
        if (!session) {
            let newSessionItem = document.getElementById("gdata-session-name");
            session = sessionMgr.getSessionById(newSessionItem.value, true);
        }

        PromiseAll([session.getTasksList(), session.getCalendarList()])
               .then(function([tasksLists, calendarList]) {
            let existing = new Set();
            let sessionPrefix = "googleapi://" + session.id;
            for each (let calendar in calMgr.getCalendars({})) {
                let spec = calendar.uri.spec;
                if (calendar.type == "gdata" && spec.substr(0, sessionPrefix.length) == sessionPrefix) {
                    let match;
                    if ((match = spec.match(/calendar=([^&]*)/))) {
                        existing.add(decodeURIComponent(match[0]));
                    }
                    if ((match = spec.match(/tasks=([^&]*)/))) {
                        existing.add(decodeURIComponent(match[0]));
                    }
                }
            }

            let taskcals = tasksLists.map(function(tasklist) {
                let uri = "googleapi://" + session.id + "/?tasks=" + encodeURIComponent(tasklist.id);
                let calendar = calMgr.createCalendar("gdata", Services.io.newURI(uri, null, null));
                calendar.id = cal.getUUID();
                calendar.setProperty("color", cal.hashColor(tasklist.title));
                calendar.name = tasklist.title;
                if (existing.has("tasks=" + tasklist.id)) {
                    calendar.readOnly = true;
                }
                return calendar;
            });
            let calcals = calendarList.map(function(calendarEntry) {
                let uri = "googleapi://" + session.id + "/?calendar=" + encodeURIComponent(calendarEntry.id);
                let calendar = calMgr.createCalendar("gdata", Services.io.newURI(uri, null, null));
                calendar.name = calendarEntry.summary;
                calendar.id = cal.getUUID();
                calendar.setProperty("color", calendarEntry.backgroundColor);
                if (existing.has("calendar=" + calendarEntry.id)) {
                    calendar.readOnly = true;
                }
                return calendar;
            });

            let calendars = [calendarListWidget.mockCalendarHeader]
                            .concat(calcals)
                            .concat([calendarListWidget.mockTaskHeader])
                            .concat(taskcals);

            calendarListWidget.calendars = calendars;
        }.bind(this), function(e) {
            Components.utils.reportError(e);
        }.bind(this));
    });

    this.gdataCalendarsAdvance = trycatch(function() {
        let calendarList = document.getElementById("calendar-list");
        let calendars = calendarList.selectedCalendars.filter(function(x) { return !x.getProperty("disabled") && !x.readOnly; });
        let calMgr = cal.getCalendarManager();

        if (Services.vc.compare(Services.appinfo.platformVersion, "9.0") < 0) {
            // This version didn't allow creating calendars with an id set, we
            // will have to hack it in.
            calendars.forEach(gdataRegisterCalendar);
        } else {
            calendars.forEach(calMgr.registerCalendar, calMgr);
        }
        return true;
    });

    this.gdataFocusNewSession = trycatch(function() {
        let sessionContainer = document.getElementById("gdata-session-group");
        sessionContainer.value = "";
    });

    document.addEventListener("DOMContentLoaded", function() {
        // Older versions of Lightning don't set the onselect attribute at all.
        let calendarFormat = document.getElementById("calendar-format");
        if (!calendarFormat.hasAttribute("onselect")) {
            calendarFormat.setAttribute("onselect", "gdataSelectProvider(this.value)");
        }

        if (!("updateStyleSheetForViews" in window)) {
            window.updateStyleSheetForViews = function() {};
        }
    });
}).call(window);
