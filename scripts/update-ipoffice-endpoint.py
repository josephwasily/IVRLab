#!/usr/bin/env python3
"""
Script to update the external IP address for the 'ipoffice' SIP trunk in asterisk/pjsip.conf.
- Updates both the [ipoffice] contact and [identify-ipoffice] match lines.
- Usage: python update-ipoffice-endpoint.py NEW_IP
"""
import sys
import re

CONF_PATH = 'asterisk/pjsip.conf'

if len(sys.argv) != 2:
    print('Usage: python update-ipoffice-endpoint.py <NEW_IP>')
    sys.exit(1)

new_ip = sys.argv[1]

with open(CONF_PATH, 'r', encoding='utf-8') as f:
    lines = f.readlines()

in_ipoffice = False
in_identify = False
for i, line in enumerate(lines):
    # Update [ipoffice] contact line
    if line.strip().startswith('[ipoffice]'):
        in_ipoffice = True
        in_identify = False
        continue
    if line.strip().startswith('[identify-ipoffice]'):
        in_ipoffice = False
        in_identify = True
        continue
    if line.strip().startswith('[') and not line.strip().startswith('[ipoffice]') and not line.strip().startswith('[identify-ipoffice]'):
        in_ipoffice = False
        in_identify = False
    # Update contact in [ipoffice]
    if in_ipoffice and line.strip().startswith('contact='):
        lines[i] = f'contact=sip:{new_ip}:5060\n'
    # Update match in [identify-ipoffice]
    if in_identify and line.strip().startswith('match='):
        lines[i] = f'match={new_ip}\n'

with open(CONF_PATH, 'w', encoding='utf-8') as f:
    f.writelines(lines)

print(f"Updated ipoffice SIP trunk to {new_ip} in {CONF_PATH}")
