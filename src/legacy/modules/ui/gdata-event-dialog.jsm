/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var { recordModule, recordWindow } = ChromeUtils.import(
  "resource://gdata-provider/legacy/modules/gdataUI.jsm"
);
recordModule("ui/gdata-event-dialog.jsm");

var EXPORTED_SYMBOLS = ["gdataInitUI"];

var { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");

/* global monkeyPatch, getMessenger */
XPCOMUtils.defineLazyModuleGetters(this, {
  monkeyPatch: "resource://gdata-provider/legacy/modules/gdataUtils.jsm",
  getMessenger: "resource://gdata-provider/legacy/modules/gdataUtils.jsm",
});

ChromeUtils.defineLazyGetter(this, "messenger", () => getMessenger());

const ITEM_IFRAME_URL = "chrome://calendar/content/calendar-item-iframe.xhtml";

function gdataInitUI(window, document) {
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
    if (privacyOptionsPopup && !document.getElementById(optionsPrivacyItem.id)) {
      privacyOptionsPopup.insertBefore(optionsPrivacyItem, privacyOptionsPopup.firstElementChild);
    }

    let privacyToolbarPopup = document.getElementById("event-privacy-menupopup");
    if (privacyToolbarPopup && !document.getElementById(toolbarPrivacyItem.id)) {
      privacyToolbarPopup.insertBefore(toolbarPrivacyItem, privacyToolbarPopup.firstElementChild);
    }

    const gdataStatusPrivacyHbox = document.createXULElement("hbox");
    gdataStatusPrivacyHbox.id = "gdata-status-privacy-default-box";
    gdataStatusPrivacyHbox.setAttribute("privacy", "DEFAULT");
    gdataStatusPrivacyHbox.setAttribute("provider", "gdata");

    const statusPrivacy = document.getElementById("status-privacy");
    if (statusPrivacy && !document.getElementById(gdataStatusPrivacyHbox.id)) {
      statusPrivacy.insertBefore(
        gdataStatusPrivacyHbox,
        document.getElementById("status-privacy-public-box")
      );
    }
  })();

  function loadPanel(passedFrameId) {
    let frameId;
    if (window.tabmail) {
      frameId = passedFrameId || window.tabmail.currentTabInfo.iframe?.id;
    } else {
      frameId = "calendar-item-panel-iframe";
    }

    let frame = document.getElementById(frameId);
    let frameScript = ChromeUtils.import(
      "resource://gdata-provider/legacy/modules/ui/gdata-lightning-item-iframe.jsm"
    );

    if (
      frame.contentDocument.location == ITEM_IFRAME_URL &&
      frame.contentDocument.readyState == "complete"
    ) {
      frameScript.gdataInitUI(frame.contentWindow, frame.contentDocument);
    } else {
      let loader = function() {
        if (frame.contentDocument.location == ITEM_IFRAME_URL) {
          frameScript.gdataInitUI(frame.contentWindow, frame.contentDocument);
          frame.removeEventListener("load", loader, { capture: true });
        }
      };
      frame.addEventListener("load", loader, { capture: true });
    }
  }

  if (window.location.href == "chrome://calendar/content/calendar-event-dialog.xhtml") {
    window.setTimeout(() => loadPanel(), 0);
  } else {
    monkeyPatch(window, "onLoadCalendarItemPanel", (protofunc, passedFrameId, ...args) => {
      let rv = protofunc(passedFrameId, ...args);
      loadPanel(passedFrameId);
      return rv;
    });
  }

  window.addEventListener("message", aEvent => {
    let validOrigin = window.tabmail ? "chrome://messenger" : "chrome://calendar";
    if (!aEvent.isTrusted && aEvent.origin !== validOrigin) {
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
        break;
      }
      case "gdataSettingsMigrate":
        messenger.storage.local.set({ "settings.migrate": aEvent.data.value });
        break;
    }
  });
}
