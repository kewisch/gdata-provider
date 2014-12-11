# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import sys
import re

# Converts a Lightning version to a matching gdata version:
#  Lightning 3.1 -> gdata-provider 1.0
#  Lightning 3.2b2 -> gdata-provider 1.1b2
#  Lightning 3.3a1 -> gdata-provider 1.2a1
def makeversion(x):
    v = re.search(r"(\d+\.\d+)([a-z]\d+)?", x)
    parts = v.group(1).split('.')
    major = int(parts[0]) - 2
    minor = int(parts[1]) - 1
    if minor < 0:
        minor = 10 + minor
        major = major - 1
    parts[0] = str(major)
    parts[1] = str(minor)
    return '.'.join(parts) + (v.group(2) or "")

if __name__ == '__main__':
    print(makeversion(sys.argv[1]))
