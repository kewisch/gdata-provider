/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var {
  ExtensionCommon: { ExtensionAPI, makeWidgetId }
} = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");

var { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");

this.calendarItemDetails = class extends ExtensionAPI {
  onLoadCalendarItemPanel(window, origLoadCalendarItemPanel, iframeId, url) {
    const { setupE10sBrowser } = ChromeUtils.importESModule("resource://tb-experiments-calendar/experiments/calendar/ext-calendar-utils.sys.mjs");

    let res = origLoadCalendarItemPanel(iframeId, url);
    if (this.extension.manifest.calendar_item_details) {
      let panelFrame;
      if (window.tabmail) {
        panelFrame = window.document.getElementById(iframeId|| tabmail.currentTabInfo.iframe?.id);
      } else {
        panelFrame = window.document.getElementById("calendar-item-panel-iframe");
      }

      panelFrame.contentWindow.addEventListener("load", (event) => {
        let document = event.target.ownerGlobal.document;

        let widgetId = makeWidgetId(this.extension.id);

        let tabs = document.getElementById("event-grid-tabs");
        let tab = document.createXULElement("tab");
        tabs.appendChild(tab);
        tab.setAttribute("label", this.extension.manifest.calendar_item_details.default_title);
        tab.setAttribute("id", widgetId + "-calendarItemDetails-tab");
        tab.setAttribute("image", this.extension.manifest.calendar_item_details.default_icon);
        tab.querySelector(".tab-icon").style.maxHeight = "19px";

        let tabpanels = document.getElementById("event-grid-tabpanels");
        let tabpanel = document.createXULElement("tabpanel");
        tabpanels.appendChild(tabpanel);
        tabpanel.setAttribute("id", widgetId + "-calendarItemDetails-tabpanel");
        tabpanel.setAttribute("flex", "1");

        let browser = document.createXULElement("browser");
        browser.setAttribute("flex", "1");
        let loadPromise = setupE10sBrowser(this.extension, browser, tabpanel);

        return loadPromise.then(() => {
          browser.fixupAndLoadURIString(this.extension.manifest.calendar_item_details.default_content, {
            triggeringPrincipal: this.extension.principal
          });
        });
      });
    }

    return res;
  }

  onStartup() {
    let calendarItemDetails = this.extension.manifest?.calendar_item_details;
    if (calendarItemDetails) {
      let localize = this.extension.localize.bind(this.extension);

      if (calendarItemDetails.default_icon) {
        calendarItemDetails.default_icon = this.extension.getURL(localize(calendarItemDetails.default_icon));
      }

      if (calendarItemDetails.default_content) {
        calendarItemDetails.default_content = this.extension.getURL(localize(calendarItemDetails.default_content));
      }
      if (calendarItemDetails.default_title) {
        calendarItemDetails.default_title = localize(calendarItemDetails.default_title);
      }
    }

    ExtensionSupport.registerWindowListener("ext-calendarItemDetails-" + this.extension.id, {
      chromeURLs: [
        "chrome://messenger/content/messenger.xhtml",
        "chrome://calendar/content/calendar-event-dialog.xhtml"
      ],
      onLoadWindow: (window) => {
        if (window.location.href == "chrome://messenger/content/messenger.xhtml") {
          let orig = window.onLoadCalendarItemPanel;
          window.onLoadCalendarItemPanel = this.onLoadCalendarItemPanel.bind(this, window, orig.bind(window));
          window._onLoadCalendarItemPanelOrig = orig;
        } else {
          window.setTimeout(() => {
            this.onLoadCalendarItemPanel(window, () => {});
          }, 0);
        }
      }
    });
  }
  onShutdown() {
    ExtensionSupport.unregisterWindowListener("ext-calendarItemDetails-" + this.extension.id);

    for (let wnd of ExtensionSupport.openWindows) {
      if (wnd.location.href == "chrome://messenger/content/messenger.xhtml") {
        if (wnd._onLoadCalendarItemPanelOrig) {
          wnd.onLoadCalendarItemPanel = wnd._onLoadCalendarItemPanelOrig;
          wnd._onLoadCalendarItemPanelOrig = null;
        }
      }
    }
  }
  getAPI(context) {
    return { calendar: { itemDetails: {} } };
  }
};
