# ***** BEGIN LICENSE BLOCK *****
# Version: MPL 1.1/GPL 2.0/LGPL 2.1
#
# The contents of this file are subject to the Mozilla Public License Version
# 1.1 (the "License"); you may not use this file except in compliance with
# the License. You may obtain a copy of the License at
# http://www.mozilla.org/MPL/
#
# Software distributed under the License is distributed on an "AS IS" basis,
# WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
# for the specific language governing rights and limitations under the
# License.
#
# The Original Code is Google Calendar Provider code.
#
# The Initial Developer of the Original Code is
#   Philipp Kewisch <mozilla@kewis.ch>
# Portions created by the Initial Developer are Copyright (C) 2008
# the Initial Developer. All Rights Reserved.
#
# Contributor(s):
#
# Alternatively, the contents of this file may be used under the terms of
# either the GNU General Public License Version 2 or later (the "GPL"), or
# the GNU Lesser General Public License Version 2.1 or later (the "LGPL"),
# in which case the provisions of the GPL or the LGPL are applicable instead
# of those above. If you wish to allow use of your version of this file only
# under the terms of either the GPL or the LGPL, and not to allow others to
# use your version of this file under the terms of the MPL, indicate your
# decision by deleting the provisions above and replace them with the notice
# and other provisions required by the GPL or the LGPL. If you do not delete
# the provisions above, a recipient may use your version of this file under
# the terms of any one of the MPL, the GPL or the LGPL.
#
# ***** END LICENSE BLOCK *****

# This file is used to build the gdata provider without the rest of mozilla. To
# do so, you need to use trunk and the following mozconfig:

# # Options for client.mk.
# mk_add_options MOZ_OBJDIR=@TOPSRCDIR@/obj-gdata
#
# mk_add_options MOZ_CO_PROJECT="gdata"
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
