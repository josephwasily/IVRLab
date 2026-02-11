#!/bin/bash
# Script to update ipoffice SIP trunk to a new IP address
# Usage: ./restore-ipoffice-endpoint.sh <NEW_IP>

CONF_PATH="asterisk/pjsip.conf"

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <NEW_IP>"
    exit 1
fi

NEW_IP="$1"

awk -v newip="$NEW_IP" '
BEGIN { in_ipoffice=0; in_identify=0 }
/\[ipoffice\]/ { in_ipoffice=1; in_identify=0; print; next }
/\[identify-ipoffice\]/ { in_ipoffice=0; in_identify=1; print; next }
/^\[/ && !/\[ipoffice\]/ && !/\[identify-ipoffice\]/ { in_ipoffice=0; in_identify=0 }
{
    if (in_ipoffice && $0 ~ /^contact=/) {
        print "contact=sip:" newip ":5060"
    } else if (in_identify && $0 ~ /^match=/) {
        print "match=" newip
    } else {
        print
    }
}' "$CONF_PATH" > "$CONF_PATH.tmp" && mv "$CONF_PATH.tmp" "$CONF_PATH"

if [ $? -eq 0 ]; then
    echo "Updated ipoffice SIP trunk to $NEW_IP in $CONF_PATH"
else
    echo "Failed to update $CONF_PATH"
    exit 1
fi
