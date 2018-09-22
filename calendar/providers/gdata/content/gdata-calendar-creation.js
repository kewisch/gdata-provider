/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Backwards compatibility with Thunderbird <60.
if (!("Cc" in this)) {
    // eslint-disable-next-line mozilla/no-define-cc-etc, no-unused-vars
    const { utils: Cu } = Components;
}

var { cal } = ChromeUtils.import("resource://gdata-provider/modules/calUtilsShim.jsm", null);
const { getGoogleSessionManager } = ChromeUtils.import("resource://gdata-provider/modules/gdataSession.jsm", null);
const { monkeyPatch } = ChromeUtils.import("resource://gdata-provider/modules/gdataUtils.jsm", null);

(function() {
    function pageorder(anchor, ...pages) {
        let wizard = document.documentElement;
        let page = wizard.getPageById(anchor);
        for (let id of pages) {
            page.next = id;
            page = wizard.getPageById(id);
        }
    }

    function trycatch(func) {
        return function() {
            try {
                return func.apply(this, arguments);
            } catch (e) {
                Cu.reportError(e);
                throw e;
            }
        };
    }

    let previousUriValue = null;
    function selectProvider(type) {
        let isGdata = (type == "gdata");
        let curi = document.getElementById("calendar-uri");

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
        monkeyPatch(window, "onSelectProvider", (protofunc, type) => {
            selectProvider(type);
            return protofunc(type);
        });
    } else {
        // The exchange provider overwrites the select handler, which causes
        // our provider to fail. The exchange provider overwrites the select
        // handler, which causes our provider to fail. Given the exchange
        // provider is currently not maintained and we want them to work
        // together, here is a workaround.
        monkeyPatch(tmpCalendarCreation, "doRadioExchangeCalendar", (protofunc, target) => {
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

    monkeyPatch(window, "prepareCreateCalendar", (protofunc) => {
        let type = document.getElementById("calendar-format").selectedItem.value;
        return (type == "gdata" ? true : protofunc());
    });

    monkeyPatch(window, "checkRequired", (protofunc) => {
        let wizard = document.documentElement;
        let currentPageId = wizard.currentPage && wizard.currentPage.pageid;

        if (currentPageId == "gdata-session") {
            let sessionGroup = document.getElementById("gdata-session-group");
            let sessionName = document.getElementById("gdata-session-name");
            let sessionNameIsValid = document.getAnonymousElementByAttribute(sessionName, "anonid", "input").validity.valid;
            // TODO for some reason the validity doesn't work on windows. Here is a hack:
            // eslint-disable-next-line no-useless-escape
            sessionNameIsValid = !!sessionName.value.match(/^[^\/]+@[^\/]+\.[^\/]+$/);
            wizard.canAdvance = sessionGroup.value || (sessionName.value && sessionNameIsValid);
        } else if (currentPageId == "gdata-calendars") {
            let calendarList = document.getElementById("calendar-list");
            let calendars = calendarList.selectedCalendars.filter(calendar => !calendar.getProperty("disabled") && !calendar.readOnly);
            wizard.canAdvance = !!calendars.length;
        } else {
            protofunc();
        }
    });

    this.gdataSessionShow = trycatch(() => {
        let sessionMgr = getGoogleSessionManager();
        let sessionContainer = document.getElementById("gdata-session-group");
        let newSessionItem = document.getElementById("session-new");
        let calendars = cal.getCalendarManager().getCalendars({});
        let sessions = new Set(calendars.map((calendar) => {
            return sessionMgr.getSessionByCalendar(calendar, true);
        }));

        while (sessionContainer.firstChild.id != "session-new") {
            sessionContainer.firstChild.remove();
        }

        // forEach is needed for backwards compatibility.
        sessions.forEach((session) => {
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

    this.gdataCalendarsShow = trycatch(() => {
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

        Promise.all([session.getTasksList(), session.getCalendarList()]).then(([tasksLists, calendarList]) => {
            let existing = new Set();
            let sessionPrefix = "googleapi://" + session.id;
            for (let calendar of calMgr.getCalendars({})) {
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

            let taskcals = tasksLists.map((tasklist) => {
                let uri = "googleapi://" + session.id + "/?tasks=" + encodeURIComponent(tasklist.id);
                let calendar = calMgr.createCalendar("gdata", Services.io.newURI(uri));
                calendar.id = cal.getUUID();
                calendar.setProperty("color", cal.view.hashColor(tasklist.title));
                calendar.name = tasklist.title;
                if (existing.has("tasks=" + tasklist.id)) {
                    calendar.readOnly = true;
                }
                return calendar;
            });
            let calcals = calendarList.map((calendarEntry) => {
                let uri = "googleapi://" + session.id + "/?calendar=" + encodeURIComponent(calendarEntry.id);
                let calendar = calMgr.createCalendar("gdata", Services.io.newURI(uri));
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
        }, (e) => {
            Cu.reportError(e);
        });
    });

    this.gdataCalendarsAdvance = trycatch(() => {
        let calendarList = document.getElementById("calendar-list");
        let calendars = calendarList.selectedCalendars.filter(calendar => !calendar.getProperty("disabled") && !calendar.readOnly);
        let calMgr = cal.getCalendarManager();
        calendars.forEach(calMgr.registerCalendar, calMgr);
        return true;
    });

    this.gdataFocusNewSession = trycatch(() => {
        let sessionContainer = document.getElementById("gdata-session-group");
        sessionContainer.value = "";
    });

    document.addEventListener("DOMContentLoaded", () => {
        // Older versions of Lightning don't set the onselect attribute at all.
        let calendarFormat = document.getElementById("calendar-format");
        if (!calendarFormat.hasAttribute("onselect")) {
            calendarFormat.setAttribute("onselect", "gdataSelectProvider(this.value)");
        }

        if (!("updateStyleSheetForViews" in window)) {
            window.updateStyleSheetForViews = function() {};
        }

        if (document.getElementById("gdata-session").pageIndex == -1) {
            let wizard = document.documentElement;
            wizard._initPages();
        }
    });
}).call(window);
