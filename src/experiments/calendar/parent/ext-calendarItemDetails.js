/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

var {
  ExtensionCommon: { ExtensionAPI, makeWidgetId }
} = ChromeUtils.importESModule("resource://gre/modules/ExtensionCommon.sys.mjs");

var {
  ExtensionUtils: { ExtensionError }
} = ChromeUtils.importESModule("resource://gre/modules/ExtensionUtils.sys.mjs");

Cu.importGlobalProperties(["URL"]);


var { ExtensionSupport } = ChromeUtils.importESModule("resource:///modules/ExtensionSupport.sys.mjs");

this.calendarItemDetails = class extends ExtensionAPI {
  onLoadCalendarItemPanel(window, origLoadCalendarItemPanel, iframeId, url) {
    const { setupE10sBrowser } = ChromeUtils.importESModule("resource://tb-experiments-calendar/experiments/calendar/ext-calendar-utils.sys.mjs");

    let res = origLoadCalendarItemPanel(iframeId, url);
    if (!this.extension.manifest.calendar_item_details) {
      return res;
    }
    let panelFrame;
    if (window.tabmail) {
      panelFrame = window.document.getElementById(iframeId|| tabmail.currentTabInfo.iframe?.id);
    } else {
      panelFrame = window.document.getElementById("calendar-item-panel-iframe");
    }

    panelFrame.contentWindow.addEventListener("load", (event) => {
      let document = event.target.ownerGlobal.document;

      let areas = this.extension.manifest.calendar_item_details.allowed_areas || ["secondary"];
      if (!Array.isArray(areas)) {
        areas = [areas];
      }

      if (areas.includes("secondary")) {
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

        let options = { maxWidth: null, fixedWidth: true };
        setupE10sBrowser(this.extension, browser, tabpanel, options).then(() => {
          let target = new URL(this.extension.manifest.calendar_item_details.default_content);
          target.searchParams.set("area", "secondary");
          browser.fixupAndLoadURIString(target.href, {
            triggeringPrincipal: this.extension.principal
          });
        });
      } else if (areas.includes("inline")) {
        let tabbox = document.getElementById("event-grid");

        let browserRow = tabbox.appendChild(document.createElementNS("http://www.w3.org/1999/xhtml", "tr"));
        let browserCell = browserRow.appendChild(document.createElementNS("http://www.w3.org/1999/xhtml", "td"));
        browserRow.className = "event-grid-link-row";
        browserCell.setAttribute("colspan", "2");

        let separator = tabbox.appendChild(document.createElementNS("http://www.w3.org/1999/xhtml", "tr"));
        separator.className = "separator";
        let separatorCell = separator.appendChild(document.createElementNS("http://www.w3.org/1999/xhtml", "td"));
        separatorCell.setAttribute("colspan", "2");

        let browser = document.createXULElement("browser");
        browser.setAttribute("flex", "1");

        // TODO The real version will need a max-height and auto-resizing
        browser.style.height = "200px";
        browser.style.width = "100%";
        browser.style.display = "block";

        // Fix an annoying bug, this should be part of a different patch
        document.getElementById("url-link").style.maxWidth = "42em";

        let options = { maxWidth: null, fixedWidth: true };
        setupE10sBrowser(this.extension, browser, browserCell, options).then(() => {
          let target = new URL(this.extension.manifest.calendar_item_details.default_content);
          target.searchParams.set("area", "inline");
          browser.fixupAndLoadURIString(target.href, {
            triggeringPrincipal: this.extension.principal
          });
        });
      }
    });

    return res;
  }

  onLoadSummary(window) {
    const { setupE10sBrowser } = ChromeUtils.importESModule("resource://tb-experiments-calendar/experiments/calendar/ext-calendar-utils.sys.mjs");

    let document = window.document;

    // Fix an annoying bug, this should be part of a different patch
    document.querySelector(".url-link").style.maxWidth = "42em";

    let areas = this.extension.manifest.calendar_item_details.allowed_areas || ["secondary"];
    if (!Array.isArray(areas)) {
      areas = [areas];
    }


    if (areas.includes("summary")) {
      let summaryBox = document.querySelector(".item-summary-box");

      let browser = document.createXULElement("browser");
      browser.id = "ext-calendar-item-details-" + this.extension.id;
      browser.style.minHeight = "150px";
      document.getElementById(browser.id)?.remove();

      let separator = document.createXULElement("separator");
      separator.id = "ext-calendar-item-details-separator-" + this.extension.id;
      separator.className = "groove";

      document.getElementById(separator.id)?.remove();
      summaryBox.appendChild(separator);

      let options = { maxWidth: null, fixedWidth: true };
      setupE10sBrowser(this.extension, browser, summaryBox, options).then(() => {
        let target = new URL(this.extension.manifest.calendar_item_details.default_content);
        target.searchParams.set("area", "summary");
        browser.fixupAndLoadURIString(target.href, {
          triggeringPrincipal: this.extension.principal
        });
      });
    }
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

      let areas = calendarItemDetails.allowed_areas;
      if (Array.isArray(areas) && areas.includes("inline") && areas.includes("secondary")) {
        throw new ExtensionError("Cannot show calendar_item_details both inline and secondary");
      }
    }
    ExtensionSupport.registerWindowListener("ext-calendarItemDetails-summary-" + this.extension.id, {
      chromeURLs: [
        "chrome://calendar/content/calendar-summary-dialog.xhtml"
      ],
      onLoadWindow: (window) => {
        this.onLoadSummary(window);
      }
    });

    ExtensionSupport.registerWindowListener("ext-calendarItemDetails-event-" + this.extension.id, {
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
    ExtensionSupport.unregisterWindowListener("ext-calendarItemDetails-event-" + this.extension.id);
    ExtensionSupport.unregisterWindowListener("ext-calendarItemDetails-summary-" + this.extension.id);

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
