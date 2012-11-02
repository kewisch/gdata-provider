# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import sys
import re

# Converts a Lightning version to a matching gdata version:
#  Lightning 1.2 -> gdata-provider 0.11
#  Lightning 1.3a1 -> gdata-provider 0.12pre
v = re.search(r"(\d+\.\d+)([a-z]\d+)?", sys.argv[1])
print "{0:.2f}".format((float(v.group(1)) - 0.1)/10) + (v.lastindex == 2 and "pre" or "")
