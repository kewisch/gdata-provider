/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

/* globals cal Services customElements MozXULElement */

// Wrap in a block to prevent leaking to window scope.
{
    /**
     * The calendar list used when adding a new calendar from a Google account. It appears in the
     * new calendar dialog. The list of calendars is subdivided into "Calendars" and "Task Lists".
     * This is done by including "mock" calendar rows that are just header rows for the sections.
     */
    class CalendarListTreeGdata extends customElements.get("calendar-list-tree") {
        connectedCallback() {
            if (this.delayConnectedCallback() || this.hasConnected) {
                return;
            }
            // this.hasConnected is set to true in super.connectedCallback.
            super.connectedCallback();

            this.mCalendarHeaderIndex = 0;
            this.mTasksHeaderIndex = 0;
        }

        get mockCalendarHeader() {
            const calmgr = cal.getCalendarManager();
            const uri = "dummy://calendar";
            const mem = calmgr.createCalendar("memory", Services.io.newURI(uri));
            mem.setProperty("disabled", true);
            mem.name = "Calendars";
            mem.id = cal.getUUID();
            return mem;
        }

        get mockTaskHeader() {
            const calmgr = cal.getCalendarManager();
            const uri = "dummy://tasks";
            const mem = calmgr.createCalendar("memory", Services.io.newURI(uri));
            mem.setProperty("disabled", true);
            mem.name = "Task Lists";
            mem.id = cal.getUUID();
            return mem;
        }

        set calendars(calendars) {
            calendars.forEach((calendar, index) => {
                const spec = calendar.uri.spec;
                if (calendar.type == "memory") {
                    if (spec == "dummy://calendar") {
                        this.mCalendarHeaderIndex = index;
                    } else if (spec == "dummy://tasks") {
                        this.mTasksHeaderIndex = index;
                    }
                }
                this.addCalendar(calendar);
            });
            return this.mCalendarList;
        }

        get calendars() {
            return this.mCalendarList;
        }

        removeCalendar(calendar) {
            const index = this.findIndexById(calendar.id);
            if (index < this.mCalendarHeaderIndex) {
                this.mCalendarHeaderIndex--;
            }
            if (index < this.mTasksHeaderIndex) {
                this.mTasksHeaderIndex--;
            }
            return this.__proto__.__proto__.removeCalendar.call(this, calendar);
        }

        clear() {
            const calendars = this.mCalendarList.concat([]);
            calendars.forEach(this.removeCalendar, this);
        }

        getRowProperties(row, props) {
            const calendar = this.getCalendar(row);
            let rowProps = this.__proto__.__proto__.getRowProperties.call(this, row, props);

            if (calendar.readOnly) {
                if (props) {
                    // For compatibility with old tree props code.
                    props.AppendElement(cal.getAtomFromService("checked"));
                } else {
                    rowProps += " checked";
                }
            }
            return rowProps;
        }

        isContainerEmpty(row) {
            return (row == this.mCalendarHeaderIndex &&
                    row + 1 == this.mTasksHeaderIndex) ||
                (row == this.mTasksHeaderIndex &&
                    row == this.mCalendarList.length);
        }

        isContainer(row) {
            const calendar = this.getCalendar(row);
            return (calendar.type == "memory" && calendar.uri.schemeIs("dummy"));
        }

        isContainerOpen(row) {
            return true;
        }

        getParentIndex(row) {
            const calendar = this.getCalendar(row);
            if (calendar.uri.path.includes("?calendar")) {
                return this.mCalendarHeaderIndex;
            } else if (calendar.uri.path.includes("?tasks")) {
                return this.mTasksHeaderIndex;
            } else {
                return -1;
            }
        }

        hasNextSibling(row, afterIndex) {
            if (row == this.mCalendarHeaderIndex) {
                return afterIndex < this.mTasksHeaderIndex;
            } else if (row == this.mTasksHeaderIndex) {
                return false;
            } else {
                return afterIndex != this.mCalendarHeaderIndex - 1 &&
                    afterIndex != this.mTasksHeaderIndex - 1;
            }
        }

        cycleCell(row, col) {
            const calendar = this.getCalendar(row);
            const composite = this.compositeCalendar;
            if (composite.getCalendarById(calendar.id)) {
                composite.removeCalendar(calendar);
            } else {
                composite.addCalendar(calendar);
            }
            this.tree.invalidateRow(row);
        }

        getLevel(row) {
            return this.isContainer(row) ? 0 : 1;
        }
    }

    customElements.define("calendar-list-tree-gdata", CalendarListTreeGdata, { "extends": "tree" });
}
