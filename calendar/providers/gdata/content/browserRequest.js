/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

// Backwards compatibility with Thunderbird <60.
if (!("Cc" in this)) {
    // eslint-disable-next-line mozilla/no-define-cc-etc, no-unused-vars
    const { interfaces: Ci } = Components;
}

var { cal } = ChromeUtils.import("resource://gdata-provider/modules/calUtilsShim.jsm", null);

/* exported cancelRequest, loadRequestedUrl, reportUserClosed */

var wpl = Ci.nsIWebProgressListener;

var reporterListener = {
    _isBusy: false,
    get securityButton() {
        delete this.securityButton;
        return (this.securityButton = document.getElementById("security-button"));
    },

    QueryInterface: cal.generateQI([
        Ci.nsIWebProgressListener,
        Ci.nsISupportsWeakReference,
    ]),

    onStateChange: function(aWebProgress, aRequest, aStateFlags, aStatus) {
    },

    onProgressChange: function(aWebProgress, aRequest, aCurSelfProgress,
                               aMaxSelfProgress, aCurTotalProgress, aMaxTotalProgress) {
    },

    onLocationChange: function(aWebProgress, aRequest, aLocation) {
        document.getElementById("headerMessage").textContent = aLocation.spec;
    },

    onStatusChange: function(aWebProgress, aRequest, aStatus, aMessage) {
    },

    onSecurityChange: function(aWebProgress, aRequest, aState) {
        const wpl_security_bits = wpl.STATE_IS_SECURE |
                                    wpl.STATE_IS_BROKEN |
                                    wpl.STATE_IS_INSECURE |
                                    wpl.STATE_SECURE_HIGH |
                                    wpl.STATE_SECURE_MED |
                                    wpl.STATE_SECURE_LOW;
        let browser = document.getElementById("requestFrame");
        let level;

        switch (aState & wpl_security_bits) {
            case wpl.STATE_IS_SECURE | wpl.STATE_SECURE_HIGH:
                level = "high";
                break;
            case wpl.STATE_IS_SECURE | wpl.STATE_SECURE_MED:
            case wpl.STATE_IS_SECURE | wpl.STATE_SECURE_LOW:
                level = "low";
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
    }
};

function cancelRequest() {
    reportUserClosed();
    window.close();
}

function reportUserClosed() {
    let request = window.arguments[0].wrappedJSObject;
    request.cancelled();
}

function loadRequestedUrl() {
    let request = window.arguments[0].wrappedJSObject;
    document.getElementById("headerMessage").textContent = request.promptText;
    if (request.iconURI != "") {
        document.getElementById("headerImage").src = request.iconURI;
    }

    let browser = document.getElementById("requestFrame");
    browser.addProgressListener(reporterListener, Ci.nsIWebProgress.NOTIFY_ALL);
    let url = request.url;
    if (url != "") {
        browser.setAttribute("src", url);
        document.getElementById("headerMessage").textContent = url;
    }

    let dialogMessage = document.getElementById("dialogMessage");
    if (request.description) {
        dialogMessage.textContent = request.description;
    } else {
        dialogMessage.setAttribute("hidden", "true");
    }
    request.loaded(window, browser.webProgress);
}
