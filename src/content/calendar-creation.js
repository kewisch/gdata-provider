/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2021 */

(async () => {
  for (let node of document.querySelectorAll("*[data-l10n-id]")) {
    node.textContent = messenger.i18n.getMessage(node.getAttribute("data-l10n-id"));
  }
  let sessions = await browser.runtime.sendMessage({ action: "getSessions" });
  let sessionContainer = document.getElementById("gdata-existing-sessions");

  for (let sessionId of sessions) {
    let label = document.createElement("label");
    let input = document.createElement("input");

    input.type = "radio";
    input.value = sessionId;
    label.appendChild(input);
    label.appendChild(document.createTextNode(sessionId));

    sessionContainer.appendChild(label);
  }

  document.getElementById("gdata-auth-session").addEventListener("click", async () => {
    let sessionId = document.getElementById("gdata-session-name").value; // TODO temporary
    let { calendars, tasks } = await messenger.runtime.sendMessage({
      action: "getCalendarsAndTasks",
      sessionId,
    });
    document.getElementById("gdata-session").setAttribute("hidden", "true");
    document.getElementById("gdata-calendars").removeAttribute("hidden");
    let list = document.getElementById("calendar-list");

    for (let calendar of calendars) {
      let listItem = list.appendChild(document.createElement("li"));
      let label = listItem.appendChild(document.createElement("label"));

      let check = document.createElement("input");
      check.type = "checkbox";
      check.value = calendar.id;
      label.appendChild(check);
      label.appendChild(document.createTextNode(calendar.summary));
    }
  });

  window.addEventListener("message", event => {
    if (event.data == "create") {
      let sessionId = document.getElementById("gdata-session-name").value; // TODO temporary
      let calendars = [...document.querySelectorAll("#calendar-list input:checked")].map(input => {
        return {
          name: input.nextSibling.nodeValue,
          id: input.value,
        };
      });
      messenger.runtime.sendMessage({ action: "createCalendars", sessionId, calendars });
    }
  });
})();
