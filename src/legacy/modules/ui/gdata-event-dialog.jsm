/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var EXPORTED_SYMBOLS = ["gdataInitUI"];

function gdataInitUI(window, document) {
  const { recordModule, recordWindow } = ChromeUtils.import(
    "resource://gdata-provider/legacy/modules/gdataUI.jsm"
  );
  recordModule("ui/gdata-event-dialog.jsm");

  const { monkeyPatch, getMessenger } = ChromeUtils.import(
    "resource://gdata-provider/legacy/modules/gdataUtils.jsm"
  );
  let messenger = getMessenger();

  // For event dialogs, record the window so it is closed when the extension is unloaded
  if (
    window.location.href == "chrome://calendar/content/calendar-event-dialog.xhtml" &&
    window.arguments[0].calendarEvent.calendar.type == "gdata"
  ) {
    recordWindow(window);
  }

  (function() {
    /* initXUL */
    const optionsPrivacyItem = document.createXULElement("menuitem");
    optionsPrivacyItem.label = messenger.i18n.getMessage("gdata.privacy.default.label");
    optionsPrivacyItem.accesskey = messenger.i18n.getMessage("gdata.privacy.default.accesskey");
    optionsPrivacyItem.type = "radio";
    optionsPrivacyItem.setAttribute("privacy", "DEFAULT");
    optionsPrivacyItem.setAttribute("provider", "gdata");
    optionsPrivacyItem.setAttribute("oncommand", "editPrivacy(this)");

    const toolbarPrivacyItem = optionsPrivacyItem.cloneNode();
    optionsPrivacyItem.id = "gdata-options-privacy-default-menuitem";
    toolbarPrivacyItem.id = "gdata-toolbar-privacy-default-menuitem";

    let privacyOptionsPopup = document.getElementById("options-privacy-menupopup");
    if (privacyOptionsPopup) {
      privacyOptionsPopup.insertBefore(optionsPrivacyItem, privacyOptionsPopup.firstElementChild);
    }

    let privacyToolbarPopup = document.getElementById("event-privacy-menupopup");
    if (privacyToolbarPopup) {
      privacyToolbarPopup.insertBefore(toolbarPrivacyItem, privacyToolbarPopup.firstElementChild);
    }

    const gdataStatusPrivacyHbox = document.createXULElement("hbox");
    gdataStatusPrivacyHbox.setAttribute("id", "gdata-status-privacy-default-box");
    gdataStatusPrivacyHbox.setAttribute("privacy", "DEFAULT");
    gdataStatusPrivacyHbox.setAttribute("provider", "gdata");

    const statusPrivacy = document.getElementById("status-privacy");
    statusPrivacy.insertBefore(
      gdataStatusPrivacyHbox,
      document.getElementById("status-privacy-public-box")
    );
  })();

  monkeyPatch(window, "onLoadCalendarItemPanel", (protofunc, passedFrameId, url) => {
    let rv = protofunc(passedFrameId, url);

    let frameId;
    if (window.gTabMail) {
      frameId = passedFrameId || window.gTabmail.currentTabInfo.iframe.id;
    } else {
      frameId = "calendar-item-panel-iframe";
    }

    let frame = document.getElementById(frameId);
    let frameScript = ChromeUtils.import(
      "resource://gdata-provider/legacy/modules/ui/gdata-lightning-item-iframe.jsm"
    );
    if (frame.readyState == "complete") {
      frameScript.gdataInitUI(frame.contentWindow, frame.contentDocument);
    } else {
      frame.contentWindow.addEventListener("load", () =>
        frameScript.gdataInitUI(frame.contentWindow, frame.contentDocument)
      );
    }
    return rv;
  });

  window.addEventListener("message", aEvent => {
    let validOrigin = window.gTabmail ? "chrome://messenger" : "chrome://calendar";
    if (aEvent.origin !== validOrigin) {
      return;
    }

    switch (aEvent.data.command) {
      case "gdataIsTask": {
        let disableForTaskIds = [
          "options-attachments-menu",
          "options-attendees-menuitem",
          "options-privacy-menu",
          "options-priority-menu",
          "options-freebusy-menu",
          "button-attendees",
          "button-privacy",
          "button-url",
        ];

        for (let id of disableForTaskIds) {
          let node = document.getElementById(id);
          if (node) {
            node.disabled = aEvent.data.isGoogleTask;
          }
        }
      }
    }
  });
}
