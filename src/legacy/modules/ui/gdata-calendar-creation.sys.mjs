/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

export function gdataInitUI(window, document, version) {
  const { cal } = ChromeUtils.importESModule("resource:///modules/calendar/calUtils.sys.mjs");
  const { getGoogleSessionManager } = ChromeUtils.importESModule(
    `resource://gdata-provider/legacy/modules/gdataSession.sys.mjs?version=${version}`
  );
  const { monkeyPatch, getMessenger } = ChromeUtils.importESModule(
    `resource://gdata-provider/legacy/modules/gdataUtils.sys.mjs?version=${version}`
  );
  const messenger = getMessenger();

  (function() {
    /* initXUL */
    let style = document.createElement("style");
    style.textContent = `
      #gdata-calendar-list richlistitem[loading="true"] {
        -moz-box-flex: 1;
        background: url("chrome://global/skin/icons/loading.png") center 33% / 16px no-repeat;
        height: 75vh;
      }
      @media (min-resolution: 1.1dppx) {
        #gdata-calendar-list richlistitem[loading="true"] {
          background-image: url("chrome://global/skin/icons/loading@2x.png");
        }
      }

      #gdata-calendar-list richlistitem[error] {
        margin: 20px;
        padding-inline-start: 20px;
        position: relative;
      }
      #gdata-calendar-list richlistitem[error]::before {
        content: " ";
        background: url("chrome://global/skin/icons/error.svg");
        position: absolute;
        top: 0;
        left: 0;
        height: 16px;
        width: 16px;
      }

      #gdata-calendar-list richlistitem[selected] {
        color: unset;
        background-color: unset;
      }

      #gdata-calendar-list .header-label {
        font-weight: bold;
      }

      .calendar-color {
        width: 20px;
        border-radius: 5px;
      }

      #gdata-calendar-list {
        flex: 1 1 0;
      }
      #gdata-calendars {
        flex: 1;
      }
    `;
    let calendarWizard = document.getElementById("calendar-creation-dialog");
    calendarWizard.appendChild(style);

    window.registerCalendarType({
      onSelected: () => {
        window.selectPanel("gdata-session");
        window.gdataSessionShow();
      },
      label: messenger.i18n.getMessage("gdata-provider.label"),
    });

    let localPanel = document.getElementById("panel-local-calendar-settings");
    let netPanel = document.getElementById("panel-network-calendar-settings");
    let selectPanel = document.getElementById("panel-select-calendars");
    let findCalendarLabel =
      `buttonlabelaccept="${netPanel.getAttribute("buttonlabelaccept")}"` +
      ` buttonaccesskeyaccept="${netPanel.getAttribute("buttonaccesskeyaccept")}"`;
    let subscribeLabel =
      `buttonlabelaccept="${selectPanel.getAttribute("buttonlabelaccept")}"` +
      ` buttonaccesskeyaccept="${selectPanel.getAttribute("buttonaccesskeyaccept")}"`;
    let backLabel =
      `buttonlabelextra2="${localPanel.getAttribute("buttonlabelextra2")}"` +
      ` buttonaccesskeyextra2="${localPanel.getAttribute("buttonaccesskeyextra2")}"`;

    calendarWizard.appendChild(
      window.MozXULElement.parseXULToFragment(`
        <vbox id="gdata-session" ${backLabel} ${findCalendarLabel}>
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
        </vbox>
        <vbox id="gdata-calendars" ${backLabel} ${subscribeLabel}>
          <description>${messenger.i18n.getMessage(
            "gdata.wizard.calendars.description"
          )}</description>
          <richlistbox id="gdata-calendar-list" onclick="checkRequired();"/>
        </vbox>
`)
    );
  })();

  function trycatch(func) {
    return function() {
      try {
        return func.apply(this, arguments);
      } catch (e) {
        console.log(e); // eslint-disable-line no-console
        throw e;
      }
    };
  }

  window.gButtonHandlers.forNodeId["gdata-session"] = {
    accept: event => {
      event.preventDefault();
      event.stopPropagation();
      window.selectPanel("gdata-calendars");
      window.gdataCalendarsShow();
    },
    extra2: () => window.selectPanel("panel-select-calendar-type"),
  };

  window.gButtonHandlers.forNodeId["gdata-calendars"] = {
    accept: event => {
      window.gdataCalendarsAdvance();
    },
    extra2: () => window.selectPanel("gdata-session"),
  };

  monkeyPatch(window, "prepareCreateCalendar", protofunc => {
    let type = document.getElementById("calendar-format").selectedItem.value;
    return type == "gdata" ? true : protofunc();
  });

  monkeyPatch(window, "checkRequired", protofunc => {
    let dialog = document.getElementById("calendar-creation-dialog");

    let selectedPanel = null;
    for (let element of dialog.children) {
      if (!element.hidden) {
        selectedPanel = element;
      }
    }

    if (!selectedPanel) {
      protofunc();
      return;
    }

    let disabled;

    if (selectedPanel.id == "gdata-session") {
      let sessionGroup = document.getElementById("gdata-session-group");
      let sessionName = document.getElementById("gdata-session-name");
      disabled = !sessionGroup.value && !(sessionName.value && sessionName.validity.valid);
    } else if (selectedPanel.id == "gdata-calendars") {
      let calendarList = document.getElementById("gdata-calendar-list");
      disabled = !calendarList.querySelector(".calendar-selected[checked]:not([readonly])");
    } else {
      protofunc();
      return;
    }

    if (disabled) {
      dialog.setAttribute("buttondisabledaccept", "true");
    } else {
      dialog.removeAttribute("buttondisabledaccept");
    }
  });

  window.gdataSessionShow = trycatch(() => {
    let sessionMgr = getGoogleSessionManager();
    let sessionContainer = document.getElementById("gdata-session-group");
    let newSessionItem = document.getElementById("session-new");
    let calendars = cal.manager.getCalendars();
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
    let calMgr = cal.manager;
    let sessionMgr = getGoogleSessionManager();
    let sessionContainer = document.getElementById("gdata-session-group");

    let calendarList = document.getElementById("gdata-calendar-list");
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

    Promise.allSettled([session.getTasksList(), session.getCalendarList()]).then(
      ([
        { value: tasksLists = [], reason: tasksError },
        { value: calendars = [], reason: calendarError },
      ]) => {
        if (tasksError) {
          console.error(tasksError); // eslint-disable-line no-console
        }
        if (calendarError) {
          console.error(calendarError); // eslint-disable-line no-console
        }

        let existing = new Set();
        let sessionPrefix = "googleapi://" + session.id;
        for (let calendar of calMgr.getCalendars()) {
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

        const roleOrder = ["owner", "writer", "reader", "freeBusyReader"];
        calendars.sort((a, b) => {
          if (a.primary != b.primary) {
            return Number(b.primary ?? false) - Number(a.primary ?? false);
          }

          let roleA = roleOrder.indexOf(a.accessRole);
          let roleB = roleOrder.indexOf(b.accessRole);

          if (roleA != roleB) {
            return roleA - roleB;
          }

          return 0;
        });

        let calcals = calendars.map(calendarEntry => {
          let uri =
            "googleapi://" + session.id + "/?calendar=" + encodeURIComponent(calendarEntry.id);
          let calendar = calMgr.createCalendar("gdata", Services.io.newURI(uri));
          calendar.name = calendarEntry.summaryOverride || calendarEntry.summary;
          calendar.id = cal.getUUID();
          calendar.setProperty("color", calendarEntry.backgroundColor);
          if (existing.has("calendar=" + calendarEntry.id)) {
            calendar.readOnly = true;
          }
          return calendar;
        });

        loadingItem.remove();
        let header, headerLabel;
        if (calcals.length) {
          header = document.createXULElement("richlistitem");
          headerLabel = document.createXULElement("label");
          headerLabel.classList.add("header-label");
          headerLabel.value = messenger.i18n.getMessage("calendarsHeader");
          header.appendChild(headerLabel);
          calendarList.appendChild(header);

          for (let calendar of calcals) {
            addCalendarItem(calendar);
          }
        }

        if (taskcals.length) {
          header = document.createXULElement("richlistitem");
          headerLabel = document.createXULElement("label");
          headerLabel.classList.add("header-label");
          headerLabel.value = messenger.i18n.getMessage("taskListsHeader");
          header.appendChild(headerLabel);
          calendarList.appendChild(header);

          for (let calendar of taskcals) {
            addCalendarItem(calendar);
          }
        }

        if (!taskcals.length && !calcals.length && (calendarError || tasksError)) {
          let errorItem = document.createXULElement("richlistitem");
          errorItem.setAttribute("error", "true");
          calendarList.appendChild(errorItem);

          let error = calendarError || tasksError;
          if (error.message) {
            error = error.message;
          }

          if (error == "cancelled") {
            window.selectPanel("gdata-session");
            return;
          }
          errorItem.textContent = messenger.i18n.getMessage("errors." + error) || error;
        }

        function addCalendarItem(calendar) {
          let item = document.createXULElement("richlistitem");
          item.calendar = calendar;
          item.setAttribute("calendar-id", calendar.id);

          let checkbox = document.createXULElement("checkbox");
          checkbox.classList.add("calendar-selected");
          if (calendar.readOnly) {
            checkbox.checked = true;
            checkbox.disabled = true;
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
        if (e.message == "cancelled") {
          window.selectPanel("gdata-session");
        } else {
          console.error(e); // eslint-disable-line no-console
        }
      }
    );
  });

  window.gdataCalendarsAdvance = trycatch(() => {
    let calendarList = document.getElementById("gdata-calendar-list");

    let calMgr = cal.manager;
    for (let item of calendarList.children) {
      let checkbox = item.querySelector(".calendar-selected[checked]");
      if (checkbox && !checkbox.disabled) {
        calMgr.registerCalendar(item.calendar);
      }
    }
  });

  window.gdataFocusNewSession = trycatch(() => {
    let sessionContainer = document.getElementById("gdata-session-group");
    sessionContainer.value = "";
  });
}
