# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

# This file is used to build the gdata provider without the rest of mozilla. To
# do so, you need to use trunk and the following mozconfig:

# # Options for client.mk.
# mk_add_options MOZ_OBJDIR=@TOPSRCDIR@/obj-gdata
#
# mk_add_options AVAILABLE_PROJECTS="gdata"
#
# # Needed to keep toolkit from building (if required)
# export LIBXUL_SDK=1

# # Extra modules and files
# mk_add_options MODULES_gdata="mozilla/config mozilla/build mozilla/probes mozilla/calendar/providers/gdata mozilla/calendar/locales/en-US/chrome/calendar/providers/gdata"
# mk_add_options MODULES_NS_gdata="mozilla/"


# # Options for 'configure' (same as command-line options).
# ac_add_options --enable-application=calendar/providers/gdata
# ac_add_options --disable-tests

TIERS += app
tier_app_dirs += calendar/providers/gdata
