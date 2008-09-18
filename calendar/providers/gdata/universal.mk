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
# The Original Code is Sun Microsystems code.
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

ifndef OBJDIR
OBJDIR_PPC = $(MOZ_OBJDIR)/ppc
OBJDIR_X86 = $(MOZ_OBJDIR)/i386
DIST_PPC = $(OBJDIR_PPC)/dist
DIST_X86 = $(OBJDIR_X86)/dist
DIST_UNI = $(DIST_PPC)/universal
OBJDIR = $(OBJDIR_PPC)
endif

# This is fine as long as the gdata provider has no binary components.
postflight_all:
	mkdir -p $(DIST_UNI)/xpi-stage
	cp $(DIST_PPC)/xpi-stage/gdata-provider.xpi $(DIST_UNI)/xpi-stage
