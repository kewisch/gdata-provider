/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["gdataInitUI"];

function gdataInitUI(window, document) {
  ChromeUtils.import("resource://gdata-provider/legacy/modules/gdataUI.jsm").recordModule(
    "ui/gdata-calendar-creation.jsm"
  );

  const { Services } = ChromeUtils.import("resource://gre/modules/Services.jsm");
  const { cal } = ChromeUtils.import("resource:///modules/calendar/calUtils.jsm");
  const { getGoogleSessionManager } = ChromeUtils.import(
    "resource://gdata-provider/legacy/modules/gdataSession.jsm"
  );
  const { monkeyPatch, getMessenger } = ChromeUtils.import(
    "resource://gdata-provider/legacy/modules/gdataUtils.jsm"
  );
  let messenger = getMessenger();

  (function() {
    /* initXUL */
    let style = document.createElement("style");
    style.textContent = `
      #calendar-list richlistitem[loading="true"] {
        -moz-box-flex: 1;
        background: url("chrome://global/skin/icons/loading.png") center 33% / 16px no-repeat;
      }
      @media (min-resolution: 1.1dppx) {
        #calendar-list richlistitem[loading="true"] {
          background-image: url("chrome://global/skin/icons/loading@2x.png");
        }
      }

      #calendar-list richlistitem[selected] {
        color: unset;
        background-color: unset;
      }

      #calendar-list .header-label {
        font-weight: bold;
      }
    `;
    document.documentElement.appendChild(style);

    // <radiogroup id="calendar-format">
    //   <radio value="gdata" label="&gdata-provider.label;"/>
    // </radiogroup>
    let format = document.getElementById("calendar-format");
    let gdataRadioItem = format.appendChild(document.createXULElement("radio"));
    gdataRadioItem.id = "gdata-calendar-format";
    gdataRadioItem.value = "gdata";
    gdataRadioItem.label = messenger.i18n.getMessage("gdata-provider.label");

    let calendarWizard = document.getElementById("calendar-wizard");
    calendarWizard.appendChild(
      window.MozXULElement.parseXULToFragment(`
        <wizardpage id="gdata-session"
                    pageid="gdata-session"
                    description="">
          <description>${messenger.i18n.getMessage(
            "gdata.wizard.session.description"
          )}</description>
          <radiogroup id="gdata-session-group" onselect="checkRequired()">
            <hbox id="session-new" class="input-container">
              <radio value=""/>
              <html:input id="gdata-session-name"
                          type="email"
                          onfocus="gdataFocusNewSession()"
                          oninput="gdataFocusNewSession(); checkRequired();"
                          class="input-inline"/>
            </hbox>
          </radiogroup>
        </wizardpage>
        <wizardpage id="gdata-calendars"
                    pageid="gdata-calendars"
                    description="">
          <description>${messenger.i18n.getMessage(
            "gdata.wizard.calendars.description"
          )}</description>
          <richlistbox id="calendar-list"
                       flex="1"
                       onclick="checkRequired();"/>
        </wizardpage>
`)
    );

    // <description id="gdata-nextstep-description" hidden="true">&gdata.wizard.nextstep.description;</description>
    let notificationLocation = document.getElementById("calendar-notification-location");

    let nextStep = notificationLocation.parentNode.insertBefore(
      document.createXULElement("description"),
      notificationLocation.nextElementSibling
    );
    nextStep.id = "gdata-nextstep-description";
    nextStep.setAttribute("hidden", "true");
    nextStep.textContent = messenger.i18n.getMessage("gdata.wizard.nextstep.description");
  })();

  function pageorder(anchor, ...pages) {
    let page = document.getElementById(anchor);
    for (let id of pages) {
      page.next = id;
      page = document.getElementById(id);
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

    curi.closest("tr").style.visibility = isGdata ? "hidden" : "visible";
    document.getElementById("cache").parentNode.style.visibility = isGdata ? "hidden" : "visible";

    let nextStepDescr = document.getElementById("gdata-nextstep-description");
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

    window.checkRequired();
  }
  window.gdataSelectProvider = selectProvider;

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
        window.checkRequired();
      }
      return rv;
    });
  }

  monkeyPatch(window, "prepareCreateCalendar", protofunc => {
    let type = document.getElementById("calendar-format").selectedItem.value;
    return type == "gdata" ? true : protofunc();
  });

  monkeyPatch(window, "checkRequired", protofunc => {
    let wizard = document.getElementById("calendar-wizard");
    let currentPageId = wizard.currentPage && wizard.currentPage.pageid;

    if (currentPageId == "gdata-session") {
      let sessionGroup = document.getElementById("gdata-session-group");
      let sessionName = document.getElementById("gdata-session-name");
      wizard.canAdvance = sessionGroup.value || (sessionName.value && sessionName.validity.valid);
    } else if (currentPageId == "gdata-calendars") {
      let calendarList = document.getElementById("calendar-list");
      wizard.canAdvance = !!calendarList.querySelector(
        ".calendar-selected[checked]:not([readonly])"
      );
    } else {
      protofunc();
    }
  });

  window.gdataSessionShow = trycatch(() => {
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

    for (let session of sessions) {
      if (!session) {
        continue;
      }

      let radio = document.createXULElement("radio");
      radio.setAttribute("value", session.id);
      radio.setAttribute("label", session.id);
      sessionContainer.insertBefore(radio, newSessionItem);
      radio.gdataSession = session;
    }

    sessionContainer.value = sessionContainer.firstElementChild.value;
    if (sessionContainer.value == "") {
      let sessionName = document.getElementById("gdata-session-name");
      sessionName.focus();
    }
  });

  window.gdataCalendarsShow = trycatch(() => {
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
        let header = document.createXULElement("richlistitem");
        let headerLabel = document.createXULElement("label");
        headerLabel.classList.add("header-label");
        headerLabel.value = messenger.i18n.getMessage("calendarsHeader");
        header.appendChild(headerLabel);
        calendarList.appendChild(header);

        for (let calendar of calcals) {
          addCalendarItem(calendar);
        }

        header = document.createXULElement("richlistitem");
        headerLabel = document.createXULElement("label");
        headerLabel.classList.add("header-label");
        headerLabel.value = messenger.i18n.getMessage("taskListsHeader");
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

  window.gdataCalendarsAdvance = trycatch(() => {
    let calendarList = document.getElementById("calendar-list");

    let calMgr = cal.getCalendarManager();
    for (let item of calendarList.children) {
      let checkbox = item.querySelector(".calendar-selected[checked]:not([readonly])");
      if (checkbox) {
        calMgr.registerCalendar(item.calendar);
      }
    }
  });

  window.gdataFocusNewSession = trycatch(() => {
    let sessionContainer = document.getElementById("gdata-session-group");
    sessionContainer.value = "";
  });

  let gdataSessionPage = document.getElementById("gdata-session");
  gdataSessionPage.addEventListener("pageshow", () => {
    window.gdataSessionShow();
    window.checkRequired();
  });
  let gdataCalendarsPage = document.getElementById("gdata-calendars");
  gdataCalendarsPage.addEventListener("pageshow", () => {
    window.gdataCalendarsShow();
    window.checkRequired();
  });
  gdataCalendarsPage.addEventListener("pageadvanced", window.gdataCalendarsAdvance);
}
