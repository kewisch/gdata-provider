/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

window.addEventListener("message", (aEvent) => {
    if (aEvent.origin !== "chrome://lightning") {
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
                "button-url"
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
