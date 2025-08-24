/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import { isTesting } from "../background/utils.js";

export async function main() {
  for (let node of document.querySelectorAll("*[data-l10n-id]")) {
    node.textContent = messenger.i18n.getMessage(node.getAttribute("data-l10n-id"));
  }

  let sessions = await messenger.runtime.sendMessage({ action: "getSessions" });
  let sessionContainer = document.getElementById("gdata-existing-sessions");

  for (let sessionId of sessions) {
    let label = document.createElement("label");
    let input = document.createElement("input");

    input.type = "radio";
    input.value = sessionId;
    input.name = "session";
    label.appendChild(input);
    label.appendChild(document.createTextNode(sessionId));

    sessionContainer.appendChild(label);
  }

  document.getElementById("gdata-session-name").addEventListener("click", clickNewSession);
  document.getElementById("gdata-session-name").addEventListener("input", inputNewSession);
  document.querySelector("input[name='session']").checked = true;

  document.getElementById("gdata-session").addEventListener("change", checkedSession, true);

  await messenger.calendar.provider.setAdvanceAction({ forward: "authenticate", back: null, label: "Authenticate" });
  messenger.calendar.provider.onAdvanceNewCalendar.addListener(advanceNewCalendar);
}

async function advanceNewCalendar(id) {
  if (id == "initial") {
    return onInitial();
  } else if (id == "authenticate") {
    return onAuthenticate();
  } else if (id == "subscribe") {
    return onCreate();
  }

  return true;
}

function clickNewSession() {
  document.querySelector("input[name='session'][value='_new']").checked = true;
}

function inputNewSession() {
  let sessionName = document.getElementById("gdata-session-name");
  let valid = sessionName.checkValidity();
  messenger.calendar.provider.setAdvanceAction({ canForward: valid, forward: "authenticate", back: null, label: "Authenticate" });
}

function checkedSession() {
  let sessionId = document.querySelector("input[name='session']:checked").value;
  if (sessionId == "_new") {
    inputNewSession();
  } else {
    messenger.calendar.provider.setAdvanceAction({ canForward: true, forward: "authenticate", back: null, label: "Authenticate" });
  }
}

async function onInitial() {
  document.getElementById("gdata-calendars").setAttribute("hidden", "true");
  document.getElementById("gdata-session").removeAttribute("hidden");
  await messenger.calendar.provider.setAdvanceAction({ forward: "authenticate", back: null, label: "Authenticate" });
  return false;
}

async function onAuthenticate() {
  let sessionId = document.querySelector("input[name='session']:checked").value;
  if (sessionId == "_new") {
    let sessionName = document.getElementById("gdata-session-name");
    if (!sessionName.checkValidity()) {
      return false;
    }

    sessionId = sessionName.value;
  }

  let { calendars, tasks } = await messenger.runtime.sendMessage({
    action: "getCalendarsAndTasks",
    sessionId,
  });
  document.getElementById("gdata-session").setAttribute("hidden", "true");
  document.getElementById("gdata-calendars").removeAttribute("hidden");
  let calendarList = document.getElementById("calendar-list");
  let tasklistList = document.getElementById("tasklist-list");

  let existing = await messenger.calendar.calendars.query({
    type: "ext-" + messenger.runtime.id
  });

  let existingSet = new Set(existing.map(calendar => {
    let url = new URL(calendar.url);
    let id = url.searchParams.get("calendar") || url.searchParams.get("tasks");
    let eventTypes = url.searchParams.get("eventTypes");

    return `${id}#${eventTypes || ""}`;
  }));

  let primary = [];
  let selected = [];

  calendarList.innerHTML = "";
  tasklistList.innerHTML = "";

  for (let calendar of calendars) {
    let listItem = calendarList.appendChild(document.createElement("li"));
    let label = listItem.appendChild(document.createElement("label"));

    if (calendar.primary) {
      primary.unshift(listItem);
    }
    if (calendar.selected) {
      selected.unshift(listItem);
    }

    let check = document.createElement("input");
    check.type = "checkbox";
    check.value = calendar.id;
    check.dataset.listType = "calendar";

    let color = document.createElement("span");
    color.style.backgroundColor = calendar.backgroundColor;
    color.className = "color";
    check.dataset.color = calendar.backgroundColor;

    let name = document.createElement("span");
    name.textContent = calendar.summaryOverride || calendar.summary;
    name.className = "name";

    if (existingSet.has(calendar.id + "#")) {
      check.checked = true;
      check.disabled = true;
    }

    label.appendChild(check);
    label.appendChild(color);
    label.appendChild(name);
  }

  for (let listItem of selected) {
    calendarList.insertBefore(listItem, calendarList.firstChild);
  }
  for (let listItem of primary) {
    let birthdayItem = listItem.cloneNode(true);
    let check = birthdayItem.querySelector("input");
    check.dataset.eventTypes = "birthday";

    let birthdayName = messenger.i18n.getMessage("gdata.wizard.calendars.birthdays", [
      birthdayItem.querySelector("span.name").textContent
    ]);
    birthdayItem.querySelector("span.name").textContent = birthdayName;

    if (!existingSet.has(check.value + "#birthday")) {
      check.checked = false;
      check.disabled = false;
    }

    calendarList.insertBefore(birthdayItem, calendarList.firstChild);
  }
  for (let listItem of primary) {
    calendarList.insertBefore(listItem, calendarList.firstChild);
  }

  for (let tasklist of tasks) {
    let listItem = tasklistList.appendChild(document.createElement("li"));
    let label = listItem.appendChild(document.createElement("label"));

    let check = document.createElement("input");
    check.type = "checkbox";
    check.value = tasklist.id;
    check.dataset.listType = "tasks";

    let color = document.createElement("span");
    color.style.backgroundColor = "#a8c2e1";
    color.className = "color";

    let name = document.createElement("span");
    name.textContent = tasklist.title;
    name.className = "name";

    if (existingSet.has(tasklist.id + "#")) {
      check.checked = true;
      check.disabled = true;
    }

    label.appendChild(check);
    label.appendChild(color);
    label.appendChild(name);
  }

  await messenger.calendar.provider.setAdvanceAction({ forward: "subscribe", back: "initial", label: "Subscribe" });
  return false;
}

async function onCreate() {
  let sessionId = document.querySelector("input[name='session']:checked").value;
  if (sessionId == "_new") {
    sessionId = document.getElementById("gdata-session-name").value;
  }
  let selector = "#calendar-list input:checked:not([disabled]), #tasklist-list input:checked:not([disabled])";
  let calendars = [...document.querySelectorAll(selector)].map(input => {
    return {
      name: input.parentNode.querySelector(".name").textContent,
      id: input.value,
      color: input.dataset.color,
      type: input.dataset.listType,
      eventTypes: input.dataset.eventTypes,
    };
  });
  await messenger.runtime.sendMessage({ action: "createCalendars", sessionId, calendars });
  return true;
}

/* istanbul ignore next */
(async function() {
  if (await isTesting()) {
    return;
  }

  await main();
})();
