/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var { MailE10SUtils } = ChromeUtils.import("resource:///modules/MailE10SUtils.jsm");

var wpl = Ci.nsIWebProgressListener;

// Suppresses an error from LoginManagerPrompter where PopupNotifications is not defined. Taking it
// from the main window.
window.PopupNotifications = window.opener?.PopupNotifications;

var reporterListener = {
  _isBusy: false,

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
    document.getElementById("url-bar").textContent = aLocation.spec; // TB102 COMPAT
    document.getElementById("url-bar").value = aLocation.spec;
  },

  onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage) {},

  onSecurityChange: function(aWebProgress, aRequest, aState) {
    const wpl_security_bits = wpl.STATE_IS_SECURE | wpl.STATE_IS_BROKEN | wpl.STATE_IS_INSECURE;
    let browser = document.getElementById("request-frame");
    let icon = document.getElementById("security-icon");
    let level;

    switch (aState & wpl_security_bits) {
      case wpl.STATE_IS_SECURE:
        icon.setAttribute("src", "chrome://messenger/skin/icons/connection-secure.svg");
        icon.hidden = false;
        icon.setAttribute("level", "high");
        icon.classList.add("secure-connection-icon");
        break;
      case wpl.STATE_IS_BROKEN:
        icon.setAttribute("src", "chrome://messenger/skin/icons/connection-insecure.svg");
        icon.hidden = false;
        icon.setAttribute("level", "broken");
        icon.classList.add("secure-connection-icon");
        icon.classList.remove("secure-connection-icon");
        break;
      default:
        icon.hidden = true;
        icon.removeAttribute("src");
        icon.classList.remove("secure-connection-icon");
        break;
    }
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
  document.getElementById("url-bar").textContent = request.promptText;
  if (request.iconURI != "") {
    document.getElementById("security-icon").src = request.iconURI;
  }

  let browser = document.getElementById("request-frame");
  browser.addProgressListener(reporterListener, Ci.nsIWebProgress.NOTIFY_ALL);
  let url = request.url;
  if (url != "") {
    MailE10SUtils.loadURI(browser, url);
    document.getElementById("url-bar").textContent = url; // TB102 COMPAT
    document.getElementById("url-bar").value = url;
  }

  let dialogMessage = document.getElementById("dialog-message");
  if (request.description) {
    dialogMessage.textContent = request.description;
  } else {
    dialogMessage.setAttribute("hidden", "true");
  }
  request.loaded(window, browser.webProgress);
};
