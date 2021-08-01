/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

ChromeUtils.defineModuleGetter(
  this,
  "ExtensionSupport",
  "resource:///modules/ExtensionSupport.jsm",
);

var { XPCOMUtils } = ChromeUtils.import("resource://gre/modules/XPCOMUtils.jsm");
var { ExtensionCommon } = ChromeUtils.import("resource://gre/modules/ExtensionCommon.jsm");
var { ExtensionUtils } = ChromeUtils.import("resource://gre/modules/ExtensionUtils.jsm");

var { promiseEvent } = ExtensionUtils;
var { makeWidgetId, ExtensionAPI } = ExtensionCommon;


XPCOMUtils.defineLazyGetter(this, "standaloneStylesheets", () => {
  let stylesheets = [];
  let { AppConstants } = ChromeUtils.import("resource://gre/modules/AppConstants.jsm");

  if (AppConstants.platform === "macosx") {
    stylesheets.push("chrome://browser/content/extension-mac-panel.css");
  } else if (AppConstants.platform === "win") {
    stylesheets.push("chrome://browser/content/extension-win-panel.css");
  } else if (AppConstants.platform === "linux") {
    stylesheets.push("chrome://browser/content/extension-linux-panel.css");
  }
  return stylesheets;
});


this.calendarItemDetails = class extends ExtensionAPI {
  async _attachBrowser(tabpanel) {
    let document = tabpanel.ownerDocument;
    let browser = document.createXULElement("browser");
    browser.setAttribute("flex", "1");
    browser.setAttribute("type", "content");
    browser.setAttribute("disableglobalhistory", "true");
    browser.setAttribute("messagemanagergroup", "webext-browsers");
    browser.setAttribute("transparent", "true");
    browser.setAttribute("class", "webextension-popup-browser");
    browser.setAttribute("webextension-view-type", "subview");

    // Ensure the browser will initially load in the same group as other browsers from the same
    // extension.
    browser.setAttribute(
      "initialBrowsingContextGroupId",
      this.extension.policy.browsingContextGroupId
    );

    if (this.extension.remote) {
      browser.setAttribute("remote", "true");
      browser.setAttribute("remoteType", this.extension.remoteType);
      browser.setAttribute("maychangeremoteness", "true");
    }

    let readyPromise;
    if (this.extension.remote) {
      readyPromise = promiseEvent(browser, "XULFrameLoaderCreated");
    } else {
      readyPromise = promiseEvent(browser, "load");
    }

    tabpanel.appendChild(browser);

    if (!this.extension.remote) {
      // FIXME: bug 1494029 - this code used to rely on the browser binding
      // accessing browser.contentWindow. This is a stopgap to continue doing
      // that, but we should get rid of it in the long term.
      browser.contentwindow; // eslint-disable-line no-unused-expressions
    }

    let sheets = [];
    if (this.extension.manifest.calendar_item_details.browser_style) {
      sheets.push(...ExtensionParent.extensionStylesheets);
    }
    sheets.push(...standaloneStylesheets);


    const initBrowser = () => {
      ExtensionParent.apiManager.emit("extension-browser-inserted", browser);
      let mm = browser.messageManager;
      mm.loadFrameScript(
        "chrome://extensions/content/ext-browser-content.js",
        false,
        true
      );

      mm.sendAsyncMessage("Extension:InitBrowser", {
        allowScriptsToClose: true,
        blockParser: false,
        maxWidth: 800,
        maxHeight: 600,
        stylesheets: sheets
      });
    };
    browser.addEventListener("DidChangeBrowserRemoteness", initBrowser);

    return readyPromise.then(() => {
      initBrowser();
      browser.loadURI(this.extension.manifest.calendar_item_details.default_content, { triggeringPrincipal: this.extension.principal });
    });
  }

  onLoadCalendarItemPanel(window, origLoadCalendarItemPanel, iframeId, url) {
    let res = origLoadCalendarItemPanel(iframeId, url);
    if (this.extension.manifest.calendar_item_details) {
      let panelFrame = window.document.getElementById(iframeId || "calendar-item-panel-iframe");
      panelFrame.contentWindow.addEventListener("load", (event) => {
        let document = event.target.ownerGlobal.document;
        console.log(this.extension.manifest.calendar_item_details);

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

        this._attachBrowser(tabpanel);
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
        let orig = window.onLoadCalendarItemPanel;
        window.onLoadCalendarItemPanel = this.onLoadCalendarItemPanel.bind(this, window, orig.bind(window));
      }
    });
  }
  onShutdown() {
    ExtensionSupport.unregisterWindowListener("ext-calendarItemDetails-" + this.extension.id);
  }
  getAPI(context) {
    return { calendar: { itemDetails: {} } };
  }
};
