/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

var { MailE10SUtils } = ChromeUtils.import("resource:///modules/MailE10SUtils.jsm");

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
    document.getElementById("headerMessage").value = aLocation.spec;
  },

  onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage) {},

  onSecurityChange: function(aWebProgress, aRequest, aState) {
    const wpl = Ci.nsIWebProgressListener;
    const wpl_security_bits = wpl.STATE_IS_SECURE | wpl.STATE_IS_BROKEN | wpl.STATE_IS_INSECURE;
    let browser = document.getElementById("requestFrame");
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

function cancelRequest() {
  reportUserClosed();
  window.close();
}

function reportUserClosed() {
  let request = window.arguments[0].wrappedJSObject;
  if (request) {
    request.cancelled();
  }
}

function loadRequestedUrl() {
  let request = window.arguments[0].wrappedJSObject;
  if (!request) {
    return;
  }

  let dialogMessage = document.getElementById("dialog-message");
  if (request.description) {
    dialogMessage.textContent = request.description;
  } else {
    dialogMessage.setAttribute("hidden", "true");
  }

  document.getElementById("headerMessage").textContent = request.promptText;
  if (request.iconURI != "") {
    document.getElementById("security-icon").src = request.iconURI;
  }

  let browser = document.getElementById("requestFrame");
  browser.addProgressListener(reporterListener, Ci.nsIWebProgress.NOTIFY_ALL);

  let url = request.url;
  if (url != "") {
    MailE10SUtils.loadURI(browser, url);
    document.getElementById("headerMessage").value = url;
  }

  request.loaded(window, browser.webProgress);
}

window.addEventListener("load", loadRequestedUrl);
window.addEventListener("close", reportUserClosed);
