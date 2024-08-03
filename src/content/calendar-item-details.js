/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch */

import ICAL from "../background/libs/ical.js";

const CODE_TYPES = ["meetingCode", "accessCode", "passcode", "password", "pin"];

function initEventTypeBanner(vevent) {
  let eventType = vevent.getFirstPropertyValue("x-google-event-type");
  if (eventType) {
    document.getElementById("event-type-banner").dataset.eventType = eventType;
  }
}

function initConferenceRow(vevent) {
  function noconference() {
    document.getElementById("conference-row").style.display = "none";
    return null;
  }
  function i18n(str, subs) {
    return messenger.i18n.getMessage("eventdialog." + str, subs);
  }

  document.getElementById("conf-entrypoints").replaceChildren();

  let eventType = vevent.getFirstPropertyValue("x-google-event-type");

  if (eventType == "outOfOffice" || eventType == "focusTime") {
    return noconference();
  }

  let confdata;
  try {
    confdata = JSON.parse(vevent.getFirstPropertyValue("x-google-confdata"));
  } catch (e) {
    return noconference();
  }

  if (!confdata) {
    return noconference();
  }

  let confEntryPoints = document.getElementById("conf-entrypoints");
  let confEntryTemplate = document.getElementById("conf-entrypoint-template");

  document.getElementById("conf-logo").src = confdata.conferenceSolution?.iconUri;
  document.getElementById("conf-name").textContent = confdata.conferenceSolution?.name;

  function joinLink(event) {
    event.preventDefault();
    let href = event.target.getAttribute("href");
    messenger.windows.openDefaultBrowser(href);
  }

  for (let entry of confdata.entryPoints || []) {
    confEntryPoints.appendChild(confEntryTemplate.content.cloneNode(true));
    let listItem = confEntryPoints.lastElementChild;
    let textLink = listItem.querySelector(".text-link");
    let textLabel = listItem.querySelector(".label");
    let button = listItem.querySelector(".join-button");

    if (entry.entryPointType == "video") {
      button.textContent = i18n("joinVia.video");
      button.setAttribute("href", entry.uri);
      button.addEventListener("click", joinLink);
      textLabel.textContent = entry.label;
    } else if (entry?.label) {
      textLabel.textContent = i18n("joinVia." + entry.entryPointType) + ":";
      textLink.textContent = entry.label;
      textLink.setAttribute("href", entry.uri);
      textLink.addEventListener("click", joinLink);
    } else {
      textLink.textContent = i18n("joinVia." + entry.entryPointType);
      textLink.setAttribute("href", entry.uri);
      textLink.addEventListener("click", joinLink);
    }

    let pinLabel = listItem.querySelector(".pin-label");
    let pinValue = listItem.querySelector(".pin-value");
    let found = false;

    for (let key of CODE_TYPES) {
      if (key in entry) {
        pinLabel.textContent = i18n("codeType." + key);
        pinValue.textContent = entry[key];
        found = true;
      }
    }

    if (!found) {
      listItem.querySelector(".pin").style.display = "none";
    }
  }
  return null;
}

async function main() {
  for (let node of document.querySelectorAll("[data-l10n-id]")) {
    node.textContent = messenger.i18n.getMessage(node.getAttribute("data-l10n-id"));
  }

  let params = new URLSearchParams(location.search);
  let area = params.get("area");
  document.body.classList.add("area-" + area);

  let item = await messenger.calendar.items.getCurrent({ returnFormat: "jcal" });

  let vcalendar = new ICAL.Component(item.formats.jcal);
  let vevent = vcalendar.getFirstSubcomponent("vevent");
  let vtodo = vcalendar.getFirstSubcomponent("vtodo");


  if (vevent) {
    initConferenceRow(vevent);
    initEventTypeBanner(vevent);
  } else if (vtodo) {
    document.getElementById("conference-row").style.display = "none";

    // TODO need to devise item-level capabilities
  }

  // TODO need an action on save. We need to set x-default-alarm as needed
}

main();
