Provider for Google Calendar
============================

[![Build Status](https://github.com/kewisch/gdata-provider/actions/workflows/legacy.yml/badge.svg)](https://github.com/kewisch/gdata-provider/actions/workflows/legacy.yml)
[![Active Users](https://img.shields.io/badge/dynamic/json?url=https%3A%2F%2Faddons.thunderbird.net%2Fapi%2Fv4%2Faddons%2Faddon%2Fprovider-for-google-calendar%2F&query=%24.average_daily_users&label=Active%20Users)](https://addons.thunderbird.net/thunderbird/addon/provider-for-google-calendar/)

These are the sources for the [Provider for Google Calendar](https://addons.thunderbird.net/thunderbird/addon/provider-for-google-calendar/).

Development
-----------

The main ways to test the provider are the [manual testing plan](./TESTING.md) and the linters.
While there is an automated test available, it is unfortunately not very reliable.


```bash
# Creating the packaged build in dist/gdata-provider.xpi
npm run build

# Running the linters
npm run lint

# Running the automated test harness. Build first because it uses dist/gdata-provider.xpi
npm run build
npm test

# Make sure you also run the manual test plan, or at least the parts you are changing
```
Commit messages should follow [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/#summary) with sentence case.

Translation
-----------

This project uses Weblate for its translations, you can contribute by visiting https://hosted.weblate.org/engage/provider-for-google-calendar/

Weblate is a continuous localization platform used by over 2,500 libre software projects. Learn more about Weblate at https://weblate.org/

Report Issues
-------------
First of all, make sure you are using the version of the Provider for Google Calendar that matches
your Thunderbird. If there is no such version available, please take the next lower release number.

For debugging, please enable calendar.debug.log and calendar.debug.log.verbose in the advanced
config editor (`Options > Advanced > General > Config Editor`) and check the logs in the error console
(`Tools > Error Console`) for what is happening when your error occurs.

Please check the [FAQ](https://github.com/kewisch/gdata-provider/wiki/FAQ) to see if your question may already be answered. If you have a support question, please visit [the support forum](https://groups.google.com/forum/#!forum/provider-for-google-calendar).

If you would like to file a development issue, please use the Github issue tracker.
