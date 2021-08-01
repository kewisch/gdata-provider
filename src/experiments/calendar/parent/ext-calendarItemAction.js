/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */


ChromeUtils.defineModuleGetter(
  this,
  "ToolbarButtonAPI",
  "resource:///modules/ExtensionToolbarButtons.jsm"
);
ChromeUtils.defineModuleGetter(
  this,
  "ExtensionParent",
  "resource://gre/modules/ExtensionParent.jsm"
);

ChromeUtils.defineModuleGetter(
  this,
  "ExtensionSupport",
  "resource:///modules/ExtensionSupport.jsm",
);


var { ExtensionCommon } = ChromeUtils.import(
  "resource://gre/modules/ExtensionCommon.jsm"
);

var { makeWidgetId } = ExtensionCommon;

const calendarItemActionMap = new WeakMap();

this.calendarItemAction = class extends ToolbarButtonAPI {
  static for(extension) {
    return calendarItemActionMap.get(extension);
  }

  onStartup() {
    // TODO this is only necessary in the experiment, can drop this when moving to core.
    let calendarItemAction = this.extension.manifest?.calendar_item_action;
    if (calendarItemAction) {
      let localize = this.extension.localize.bind(this.extension);

      if (calendarItemAction.default_popup) {
        calendarItemAction.default_popup = this.extension.getURL(localize(calendarItemAction.default_popup));
      }
      if (calendarItemAction.default_label) {
        calendarItemAction.default_label = localize(calendarItemAction.default_label);
      }
      if (calendarItemAction.default_title) {
        calendarItemAction.default_title = localize(calendarItemAction.default_title);
      }

      this.onManifestEntry("calendar_item_action");
    }

    // TODO this is only necessary in the experiment, can refactor this when moving to core.
    ExtensionSupport.registerWindowListener("ext-calendar-itemAction-" + this.extension.id, {
      chromeURLs: ["chrome://calendar/content/calendar-event-dialog.xhtml"],
      onLoadWindow: function(win) {
        let { document } = win;

        if (!document.getElementById("mainPopupSet")) {
          let mainPopupSet = document.createElementNS("http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul", "popupset");
          mainPopupSet.id = "mainPopupSet";
          let dialog = document.querySelector("dialog");
          dialog.insertBefore(mainPopupSet, dialog.firstElementChild);
        }
      }
    });
  }

  async onManifestEntry(entryName) {
    await super.onManifestEntry(entryName);
    calendarItemActionMap.set(this.extension, this);

    // Core code only works for one toolbox/toolbarId. Calendar uses different ones. When porting
    // you can leave all of this out by either using the same ids, or adapting parent class code to
    // deal with ids per window url.
    if (this.extension.startupReason == "ADDON_INSTALL") {
      // Add it to the messenger window, the other one is already covered by parent code.
      this.addToCurrentSet("chrome://messenger/content/messenger.xhtml", "event-tab-toolbar");
    }
  }

  addToCurrentSet(windowURL, toolbarId) {
    let currentSet = Services.xulStore.getValue(
      windowURL,
      toolbarId,
      "currentset"
    );
    if (!currentSet) {
      return;
    }
    currentSet = currentSet.split(",");
    if (currentSet.includes(this.id)) {
      return;
    }
    currentSet.push(this.id);
    Services.xulStore.setValue(
      windowURL,
      toolbarId,
      "currentset",
      currentSet.join(",")
    );
  }

  close() {
    super.close();
    calendarItemActionMap.delete(this.extension);
  }

  constructor(extension) {
    super(extension, ExtensionParent.apiManager.global);
    this.manifest_name = "calendar_item_action";
    this.manifestName = "calendarItemAction";
    this.windowURLs = [
      "chrome://messenger/content/messenger.xhtml",
      "chrome://calendar/content/calendar-event-dialog.xhtml"
    ];

    this.toolboxId = "event-toolbox";
    this.toolbarId = "event-toolbar";
  }

  // This is only necessary as part of the experiment, refactor when moving to core.
  paint(window) {
    if (window.location.href == "chrome://calendar/content/calendar-event-dialog.xhtml") {
      this.toolbarId = "event-toolbar";
    } else {
      this.toolbarId = "event-tab-toolbar";
    }
    return super.paint(window);
  }

  handleEvent(event) {
    super.handleEvent(event);
    let window = event.target.ownerGlobal;

    switch (event.type) {
      case "popupshowing": {
        const menu = event.target;
        const trigger = menu.triggerNode;
        const node = window.document.getElementById(this.id);
        const contexts = [
          "event-dialog-toolbar-context-menu",
        ];

        if (contexts.includes(menu.id) && node && node.contains(trigger)) {
          global.actionContextMenu({
            tab: window,
            pageUrl: window.browser.currentURI.spec,
            extension: this.extension,
            onComposeAction: true,
            menu,
          });
        }
        break;
      }
    }
  }

  onShutdown() {
    // TODO browserAction uses static onUninstall, this doesn't work in an experiment.
    let extensionId = this.extension.id;
    ExtensionSupport.unregisterWindowListener("ext-calendar-itemAction-" + extensionId);

    let widgetId = makeWidgetId(extensionId);
    let id = `${widgetId}-calendarItemAction-toolbarbutton`;

    let windowURLs = [
      "chrome://messenger/content/messenger.xhtml",
      "chrome://calendar/content/calendar-event-dialog.xhtml"
    ];

    for (let windowURL of windowURLs) {
      let currentSet = Services.xulStore.getValue(
        windowURL,
        "event-toolbar",
        "currentset"
      );
      currentSet = currentSet.split(",");
      let index = currentSet.indexOf(id);
      if (index >= 0) {
        currentSet.splice(index, 1);
        Services.xulStore.setValue(
          windowURL,
          "event-toolbar",
          "currentset",
          currentSet.join(",")
        );
      }
    }
  }
};

global.calendarItemActionFor = this.calendarItemAction.for;
