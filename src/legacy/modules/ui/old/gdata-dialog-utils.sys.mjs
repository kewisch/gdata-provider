/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  cal: "resource:///modules/calendar/calUtils.sys.mjs", /* global cal */
  MailE10SUtils: "resource:///modules/MailE10SUtils.sys.mjs" /* global MailE10SUtils */
});

const CODE_TYPES = ["meetingCode", "accessCode", "passcode", "password", "pin"];

export const CONFERENCE_ROW_FRAGMENT = `
  <html:tr provider="gdata" id="gdata-legacy-conference-row">
    <html:th>
      <label id="gdata-legacy-conf-label" value="Conference:" control="gdata-conf-info-cell"/>
    </html:th>
    <html:td id="gdata-legacy-conf-info-cell">
      <html:div id="gdata-legacy-conf-info">
        <browser id="gdata-legacy-conf-logo" type="content"/>
        <html:span id="gdata-legacy-conf-name"/>
      </html:div>
      <html:ul id="gdata-legacy-conf-entrypoints">
      </html:ul>
    </html:td>
  </html:tr>
  <html:template id="gdata-legacy-conf-entrypoint-template">
    <html:li class="gdata-legacy-conf-entrypoint">
      <html:button onclick="launchBrowser(this.getAttribute('href'), event)"/>
      <html:div>
        <html:span class="label"/>
        <label
          class="text-link"
          onclick="launchBrowser(this.getAttribute('href'), event)"
          oncommand="launchBrowser(this.getAttribute('href'), event)"
        />
      </html:div>
      <html:div class="pin">
        <html:span class="pinlabel"/>: <html:span class="pinvalue"/>
      </html:div>
    </html:li>
  </html:template>
`;

function showOrHideItemURL(url) {
  if (!url) {
    return false;
  }
  let handler;
  let uri;
  try {
    uri = Services.io.newURI(url);
    handler = Services.io.getProtocolHandler(uri.scheme);
  } catch (e) {
    // No protocol handler for the given protocol, or invalid uri
    // hideOrShow(false);
    return false;
  }
  // Only show if its either an internal protocol handler, or its external
  // and there is an external app for the scheme
  handler = lazy.cal.wrapInstance(handler, Ci.nsIExternalProtocolHandler);
  return !handler || handler.externalAppExistsForScheme(uri.scheme);
}

export function initConferenceRow(document, messenger, item, calendar) {
  function noconference() {
    document.getElementById("gdata-legacy-conference-row").style.display = "none";
    return null;
  }
  function i18n(str, subs) {
    return messenger.i18n.getMessage("eventdialog." + str, subs);
  }

  document.getElementById("gdata-legacy-conf-entrypoints").replaceChildren();

  let workingCalendar = calendar || item.calendar;
  if (workingCalendar.type != "gdata") {
    return noconference();
  }

  let eventType = item.getProperty("X-GOOGLE-EVENT-TYPE");
  if (eventType == "outOfOffice" || eventType == "focusTime") {
    return noconference();
  }

  let confdata;
  try {
    confdata = JSON.parse(item.getProperty("X-GOOGLE-CONFDATA"));
  } catch (e) {
    return noconference();
  }

  if (!confdata) {
    return noconference();
  }

  let confEntryPoints = document.getElementById("gdata-legacy-conf-entrypoints");
  let confEntryTemplate = document.getElementById("gdata-legacy-conf-entrypoint-template");

  if (document.documentElement.id == "calendar-summary-dialog") {
    document.getElementById("gdata-legacy-conf-label").parentNode.textContent = i18n("conferenceLabel");
  } else {
    document.getElementById("gdata-legacy-conf-label").value = i18n("conferenceLabel");
  }
  document.getElementById("gdata-legacy-conf-name").textContent = confdata.conferenceSolution?.name;

  let logoBrowser = document.getElementById("gdata-legacy-conf-logo");
  lazy.MailE10SUtils.loadURI(logoBrowser, confdata.conferenceSolution?.iconUri);

  for (let entry of confdata.entryPoints || []) {
    if (!showOrHideItemURL(entry?.uri)) {
      continue;
    }

    confEntryPoints.appendChild(confEntryTemplate.content.cloneNode(true));
    let listItem = confEntryPoints.lastElementChild;
    let textLink = listItem.querySelector(".text-link");
    let textLabel = listItem.querySelector(".label");
    let button = listItem.querySelector("button");

    if (entry.entryPointType == "video") {
      button.textContent = i18n("joinVia.video");
      button.setAttribute("href", entry.uri);
      textLabel.textContent = entry.label;
    } else if (entry?.label) {
      textLabel.textContent = i18n("joinVia." + entry.entryPointType) + ":";
      textLink.textContent = entry.label;
      textLink.setAttribute("href", entry.uri);
    } else {
      textLink.textContent = i18n("joinVia." + entry.entryPointType);
      textLink.setAttribute("href", entry.uri);
    }

    let pinLabel = listItem.querySelector(".pinlabel");
    let pinValue = listItem.querySelector(".pinvalue");
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
