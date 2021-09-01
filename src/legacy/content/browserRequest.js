/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var { MailE10SUtils } = ChromeUtils.import(
  "resource:///modules/MailE10SUtils.jsm"
);

var wpl = Ci.nsIWebProgressListener;

// Suppresses an error from LoginManagerPrompter where PopupNotifications is not defined. Taking it
// from the main window.
window.PopupNotifications = window.opener?.PopupNotifications;

var reporterListener = {
  _isBusy: false,
  get securityButton() {
    delete this.securityButton;
    return (this.securityButton = document.getElementById("security-button"));
  },

  QueryInterface: ChromeUtils.generateQI(["nsIWebProgressListener", "nsISupportsWeakReference"]),

  onStateChange: function(aWebProgress, aRequest, aStateFlags, aStatus) {},

  onProgressChange: function(
    aWebProgress,
    aRequest,
    aCurSelfProgress,
    aMaxSelfProgress,
    aCurTotalProgress,
    aMaxTotalProgress
  ) {},

  onLocationChange: function(aWebProgress, aRequest, aLocation) {
    document.getElementById("headerMessage").textContent = aLocation.spec;
  },

  onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage) {},

  onSecurityChange: function(aWebProgress, aRequest, aState) {
    const wpl_security_bits = wpl.STATE_IS_SECURE | wpl.STATE_IS_BROKEN | wpl.STATE_IS_INSECURE;
    let browser = document.getElementById("requestFrame");
    let level;

    switch (aState & wpl_security_bits) {
      case wpl.STATE_IS_SECURE:
        level = "high";
        break;
      case wpl.STATE_IS_BROKEN:
        level = "broken";
        break;
    }
    if (level) {
      this.securityButton.setAttribute("level", level);
      this.securityButton.hidden = false;
    } else {
      this.securityButton.hidden = true;
      this.securityButton.removeAttribute("level");
    }
    this.securityButton.setAttribute("tooltiptext", browser.securityUI.tooltipText);
  },

  onContentBlockingEvent: function(aWebProgress, aRequest, aEvent) {},
};

window.cancelRequest = function() {
  window.reportUserClosed();
  window.close();
};

window.reportUserClosed = function() {
  let request = window.arguments[0].wrappedJSObject;
  request.cancelled();
};

window.loadRequestedUrl = function() {
  let request = window.arguments[0].wrappedJSObject;
  document.getElementById("headerMessage").textContent = request.promptText;
  if (request.iconURI != "") {
    document.getElementById("headerImage").src = request.iconURI;
  }

  let browser = document.getElementById("requestFrame");
  browser.addProgressListener(reporterListener, Ci.nsIWebProgress.NOTIFY_ALL);
  let url = request.url;
  if (url != "") {
    MailE10SUtils.loadURI(browser, url);
    document.getElementById("headerMessage").textContent = url;
  }

  let dialogMessage = document.getElementById("dialogMessage");
  if (request.description) {
    dialogMessage.textContent = request.description;
  } else {
    dialogMessage.setAttribute("hidden", "true");
  }
  request.loaded(window, browser.webProgress);
};
