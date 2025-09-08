/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  cal: "resource:///modules/calendar/calUtils.sys.mjs", /* global cal */
  MailE10SUtils: "resource:///modules/MailE10SUtils.sys.mjs" /* global MailE10SUtils */
});

const CODE_TYPES = ["meetingCode", "accessCode", "passcode", "password", "pin"];
const GDATA_CALENDAR_TYPE = "ext-{a62ef8ec-5fdc-40c2-873c-223b8a6925cc}";
const GDATA_LEGACY_CALENDAR_TYPE = "gdata";

export const CONFERENCE_ROW_FRAGMENT = `
  <html:tr id="gdata-conference-row">
    <html:th>
      <label id="gdata-conf-label" value="Conference:" control="gdata-conf-info-cell"/>
    </html:th>
    <html:td id="gdata-conf-info-cell">
      <html:div id="gdata-conf-deleted">
        <html:span id="gdata-conf-deleted-none">None</html:span> <html:button id="gdata-conf-undo">Undo</html:button>
      </html:div>
      <menulist id="gdata-conf-new">
        <menupopup id="gdata-conf-new-select-menupopup">
          <menuitem id="gdata-conf-new-none" value="" label="None"></menuitem>
        </menupopup>
      </menulist>
      <html:div id="gdata-conf-info">
        <html:canvas id="gdata-conf-logo" width="24" height="24"></html:canvas>
        <html:span id="gdata-conf-name"/>
        <html:button id="gdata-conf-remove">×</html:button>
      </html:div>
      <html:ul id="gdata-conf-entrypoints">
      </html:ul>
    </html:td>
  </html:tr>
  <html:template id="gdata-conf-entrypoint-template">
    <html:li class="gdata-conf-entrypoint">
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
    document.getElementById("gdata-conference-row").style.display = "none";
    return null;
  }

  document.getElementById("gdata-conf-entrypoints").replaceChildren();

  let workingCalendar = calendar || item.calendar;
  if (workingCalendar.type != GDATA_CALENDAR_TYPE && workingCalendar.type != GDATA_LEGACY_CALENDAR_TYPE) {
    return noconference();
  }

  let eventType = item.getProperty("X-GOOGLE-EVENT-TYPE");
  if (item.isTodo() || eventType == "outOfOffice" || eventType == "focusTime") {
    return noconference();
  }

  let confdata;
  try {
    confdata = JSON.parse(item.getProperty("X-GOOGLE-CONFDATA"));
  } catch (e) {
    // will be handled down below
  }

  if (confdata) {
    return initExistingConfdata(document, messenger, item, workingCalendar, confdata);
  } else if (workingCalendar.type != GDATA_LEGACY_CALENDAR_TYPE && document.documentElement.id != "calendar-summary-dialog") {
    return initNewConference(document, messenger, item, workingCalendar);
  } else {
    return noconference();
  }
}

async function initNewConference(document, messenger, item, calendar) {
  function i18n(str, subs) {
    return messenger.i18n.getMessage("eventdialog." + str, subs);
  }

  let prefKey = `calendars.${calendar.id}.conferenceSolutions`;
  let prefs = await messenger.storage.local.get(prefKey);
  let conferenceSolutions = prefs[prefKey];
  let confNew = document.getElementById("gdata-conf-new-select-menupopup");

  document.getElementById("gdata-conference-row").setAttribute("mode", "new");
  document.getElementById("gdata-conf-new-none").setAttribute("label", i18n("conferenceNone"));

  for (let solution of Object.values(conferenceSolutions)) {
    let option = document.createXULElement("menuitem");
    option.value = solution.key.type;
    option.label = solution.name;
    confNew.appendChild(option);
  }
}

function removeConfdata(event) {
  let document = event.target.ownerDocument;
  document.getElementById("gdata-conference-row").setAttribute("mode", "delete");
}
function undoRemoveConfdata(event) {
  let document = event.target.ownerDocument;
  document.getElementById("gdata-conference-row").setAttribute("mode", "existing");
}

async function initExistingConfdata(document, messenger, item, calendar, confdata) {
  function i18n(str, subs) {
    return messenger.i18n.getMessage("eventdialog." + str, subs);
  }

  document.getElementById("gdata-conference-row").setAttribute("mode", "existing");

  let confEntryPoints = document.getElementById("gdata-conf-entrypoints");
  let confEntryTemplate = document.getElementById("gdata-conf-entrypoint-template");

  if (document.documentElement.id == "calendar-summary-dialog") {
    document.getElementById("gdata-conf-label").parentNode.textContent = i18n("conferenceLabel");
    document.getElementById("gdata-conference-row").setAttribute("readonly", "true");
  } else {
    document.getElementById("gdata-conf-label").value = i18n("conferenceLabel");
  }

  if (calendar.type == GDATA_LEGACY_CALENDAR_TYPE) {
    document.getElementById("gdata-conference-row").setAttribute("readonly", "true");
  }

  document.getElementById("gdata-conf-deleted-none").textContent = i18n("conferenceNone");
  document.getElementById("gdata-conf-undo").textContent = i18n("conferenceUndo");

  document.getElementById("gdata-conf-name").textContent = confdata.conferenceSolution?.name;

  let prefKey = `calendars.${calendar.id}.conferenceSolutions`;
  let prefs = await messenger.storage.local.get(prefKey);
  let conferenceSolutions = prefs[prefKey];
  let cachedSolution = conferenceSolutions[confdata.conferenceSolution.key.type];

  let image;
  if (cachedSolution?.iconCache) {
    image = Uint8Array.from(cachedSolution.iconCache);
  } else {
    image = await fetch(confdata.conferenceSolution.iconUri).then(resp => resp.bytes()).catch(() => null);
  }

  let canvas = document.getElementById("gdata-conf-logo");
  if (image) {
    let decoder = new ImageDecoder({ type: "image/png", data: image, desiredWidth: 24, desiredHeight: 24 });
    let decoded = await decoder.decode();

    let context = canvas.getContext("2d");
    context.drawImage(decoded.image, 0, 0);
  } else {
    canvas.style.display = "none";
  }

  let confRemove = document.getElementById("gdata-conf-remove");
  confRemove.title = i18n("conferenceRemove");
  confRemove.addEventListener("click", removeConfdata);

  let confUndo = document.getElementById("gdata-conf-undo");
  confUndo.addEventListener("click", undoRemoveConfdata);

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
