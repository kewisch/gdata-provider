/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* import-globals-from ../../../lightning/content/lightning-calendar-creation.js */

// Backwards compatibility with Thunderbird <60.
if (!("Cc" in this)) {
  // eslint-disable-next-line mozilla/no-define-cc-etc, no-unused-vars
  const { utils: Cu } = Components;
}

var { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
var { cal } = ChromeUtils.import("resource://calendar/modules/calUtils.jsm");
var { getGoogleSessionManager } = ChromeUtils.import(
  "resource://gdata-provider/modules/gdataSession.jsm"
);
var { monkeyPatch } = ChromeUtils.import("resource://gdata-provider/modules/gdataUtils.jsm");

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
    let isGdata = type == "gdata";
    let curi = document.getElementById("calendar-uri");

    curi.parentNode.style.visibility = isGdata ? "hidden" : "visible";
    document.getElementById("cache").parentNode.style.visibility = isGdata ? "hidden" : "visible";

    // Move the next step description to the right place
    let locationRows = document.querySelector(
      "#calendar-wizard > [pageid='locationPage'] > grid > rows"
    );
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

    // eslint-disable-next-line no-undef
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

  monkeyPatch(window, "prepareCreateCalendar", protofunc => {
    let type = document.getElementById("calendar-format").selectedItem.value;
    return type == "gdata" ? true : protofunc();
  });

  monkeyPatch(window, "checkRequired", protofunc => {
    let wizard = document.documentElement;
    let currentPageId = wizard.currentPage && wizard.currentPage.pageid;

    if (currentPageId == "gdata-session") {
      let sessionGroup = document.getElementById("gdata-session-group");
      let sessionName = document.getElementById("gdata-session-name");
      let sessionNameIsValid = document.getAnonymousElementByAttribute(
        sessionName,
        "anonid",
        "input"
      ).validity.valid;
      // TODO for some reason the validity doesn't work on windows. Here is a hack:
      // eslint-disable-next-line no-useless-escape
      sessionNameIsValid = !!sessionName.value.match(/^[^\/]+@[^\/]+\.[^\/]+$/);
      wizard.canAdvance = sessionGroup.value || (sessionName.value && sessionNameIsValid);
    } else if (currentPageId == "gdata-calendars") {
      let calendarList = document.getElementById("calendar-list");
      wizard.canAdvance = !!calendarList.querySelector(
        ".calendar-selected[checked]:not([readonly])"
      );
    } else {
      protofunc();
    }
  });

  this.gdataSessionShow = trycatch(() => {
    let sessionMgr = getGoogleSessionManager();
    let sessionContainer = document.getElementById("gdata-session-group");
    let newSessionItem = document.getElementById("session-new");
    let calendars = cal.getCalendarManager().getCalendars({});
    let sessions = new Set(
      calendars.map(calendar => {
        return sessionMgr.getSessionByCalendar(calendar, true);
      })
    );

    while (sessionContainer.firstChild.id != "session-new") {
      sessionContainer.firstChild.remove();
    }

    // forEach is needed for backwards compatibility.
    sessions.forEach(session => {
      if (!session) {
        return;
      }

      let radio = document.createXULElement("radio");
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

    let calendarList = document.getElementById("calendar-list");
    while (calendarList.lastElementChild) {
      calendarList.lastElementChild.remove();
    }
    let loadingItem = document.createXULElement("richlistitem");
    loadingItem.setAttribute("loading", "true");
    calendarList.appendChild(loadingItem);

    let session = sessionContainer.selectedItem.gdataSession;
    if (!session) {
      let newSessionItem = document.getElementById("gdata-session-name");
      session = sessionMgr.getSessionById(newSessionItem.value, true);
    }

    Promise.all([session.getTasksList(), session.getCalendarList()]).then(
      ([tasksLists, calendars]) => {
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

        let taskcals = tasksLists.map(tasklist => {
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
        let calcals = calendars.map(calendarEntry => {
          let uri =
            "googleapi://" + session.id + "/?calendar=" + encodeURIComponent(calendarEntry.id);
          let calendar = calMgr.createCalendar("gdata", Services.io.newURI(uri));
          calendar.name = calendarEntry.summary;
          calendar.id = cal.getUUID();
          calendar.setProperty("color", calendarEntry.backgroundColor);
          if (existing.has("calendar=" + calendarEntry.id)) {
            calendar.readOnly = true;
          }
          return calendar;
        });

        loadingItem.remove();
        let strings = Services.strings.createBundle(
          "chrome://gdata-provider/locale/gdata.properties"
        );

        let header = document.createXULElement("richlistitem");
        let headerLabel = document.createXULElement("label");
        headerLabel.classList.add("header-label");
        headerLabel.value = strings.GetStringFromName("calendarsHeader");
        header.appendChild(headerLabel);
        calendarList.appendChild(header);

        for (let calendar of calcals) {
          addCalendarItem(calendar);
        }

        header = document.createXULElement("richlistitem");
        headerLabel = document.createXULElement("label");
        headerLabel.classList.add("header-label");
        headerLabel.value = strings.GetStringFromName("taskListsHeader");
        header.appendChild(headerLabel);
        calendarList.appendChild(header);

        for (let calendar of taskcals) {
          addCalendarItem(calendar);
        }

        function addCalendarItem(calendar) {
          let item = document.createXULElement("richlistitem");
          item.calendar = calendar;
          item.setAttribute("calendar-id", calendar.id);

          let checkbox = document.createXULElement("checkbox");
          checkbox.classList.add("calendar-selected");
          if (calendar.readOnly) {
            checkbox.checked = true;
            checkbox.setAttribute("readonly", "true");
          }
          item.appendChild(checkbox);

          let image = document.createXULElement("image");
          image.classList.add("calendar-color");
          item.appendChild(image);
          image.style.backgroundColor = calendar.getProperty("color");

          let label = document.createXULElement("label");
          label.classList.add("calendar-name");
          label.value = calendar.name;
          item.appendChild(label);

          calendarList.appendChild(item);
        }
      },
      e => {
        Cu.reportError(e);
      }
    );
  });

  this.gdataCalendarsAdvance = trycatch(() => {
    let calendarList = document.getElementById("calendar-list");

    let calMgr = cal.getCalendarManager();
    for (let item of calendarList.children) {
      let checkbox = item.querySelector(".calendar-selected[checked]:not([readonly])");
      if (checkbox) {
        calMgr.registerCalendar(item.calendar);
      }
    }
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

    if (document.getElementById("gdata-session").pageIndex == -1) {
      let wizard = document.documentElement;
      wizard._initPages();
    }
  });

  let gdataSessionPage = document.getElementById("gdata-session");
  gdataSessionPage.addEventListener("pageshow", () => {
    this.gdataSessionShow();
    checkRequired();
  });
  let gdataCalendarsPage = document.getElementById("gdata-calendars");
  gdataCalendarsPage.addEventListener("pageshow", () => {
    this.gdataCalendarsShow();
    checkRequired();
  });
  gdataCalendarsPage.addEventListener("pageadvanced", this.gdataCalendarsAdvance);
}.call(window));
