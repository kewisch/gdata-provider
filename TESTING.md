Provider for Google Calendar Manual Test Plan
=============================================

The legacy version of the Provider for Google Calendar happens to be the one
being released. However, there are no automated tests. In lieu of that, here is
a list of things to test if you are either making changes, or are releasing a
new version.

Before you start, [enable debugging](https://github.com/kewisch/gdata-provider/wiki#enabling-debugging). 
Generally, ensure there are no unepxected error console errors/warnings for any
step you take. If applicable, check that operations are correctly mirrored on 
Google Calendar.

## Subscribe to a new calendar
* Ensure the login dialog looks ok, with the message at the top, including the email.
* Ensure all event calendars and task lists are shown and you can select two to subscribe to at once.
* Ensure token is saved in the password manager

## Basic Event Operations
* Create an event in the calendar
  * It should have the "Default" privacy class
  * And the reminder value should also be "Default"
* Move the event to a different time
* Delete the event
* Create server-side conflicts for modify and delete and make sure they are handled

## Basic Task Operations
* Create a task in the your task list
* Set a different start/end date on the task
* Delete the task
* Create server-side conflicts for modify and delete and make sure they are handled

## Advanced Operations
* Idle time
  1. Open the console, disable screensaver, let the computer idle for at least 5 minutes.
  2. Ensure messages such as "Skipping refresh since user is idle"
  3. Move mouse and become active again, ensure next sync succeeds
* Freebusy
  1. Begin creating a new event and go to the attendee dialog
  2. Check freebusy for a user you have freebusy access to (e.g. within your org)
  3. Check freebusy for someone random
  4. Expected: Freebusy appears correctly, requests are made, and no errors
* Recurring Events
  1. Create a recurring event
  2. Modify an instance of the event (e.g. move to different time)
  3. Further modifications to the same instance should not throw up a dialog to ask if single/all events should be changed.

## Event Summary Dialog
* Check if the conference information is being displayed (only on standard events)

## Event Dialog
Test both the dialog variant, and the in-tab variant.

* Check if the conference information is being displayed (only on standard events)
* There should be an event privacy item (default/private/public) that works
  * In the menu  (options-->privacy)
  * In the toolbar (on by default)
  * In the status bar (if it is visible)
* Default Reminders
  * There is a "Default" item in the reminder dropdown
  * Saving a new event without changes keeps the default alarm (verify on Google as well)
  * Switching to the default alarm works
* When switching calendars, the dialog adapts based on calendar type (e.g. gdata vs local)
* OOO and focus time events
  * both should show a notification that they are such events
  * Not shown in OOO: location, category, alarm
  * Not showin in focus time: attendees, notification options
* Opening the event dialog on a Google Calendar event and then closing it does not trigger an item changed warning

## Event Reminder Dialog
* Try creating a reminder more than 28 days before the event, it should show an error
* Creating reminders past the start of the event should not work

## Task Dialog
* Ensure the task dialog is stripped down to just the supported fields. The following should not be visible:
  * Attachments, attendees, privacy, priority, freebusy, urls
  * Location, startdate, end timezone, link image, status, percent complete, recurrence, alarms
  * Time in the due date, categories

## Preferences and Calendar Properties
* Ensure that preferences are persisted
* Ensure that attendees are shown on the event when attendee syncing is on
* Ensure that no notifications are sent when notifications are off
* Ensure it is possible to set an email identity in the calendar preferences if email invitations are on.
* Ensure the minimum refresh interval is 30 minutes
* For a calendar marked readonly on Google Calendar, ensure the readonly checkbox cannot be unset in the calendar properties.

## Migration and Uninstall
* Subscribe to an ics link via the ICS provider, then check if installing this add-on will show the migration dialog
* When uninstalling/disabling the add-on, ensure that a dialog appears to remove calendars (and that it works for both cases).
