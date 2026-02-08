#!/bin/bash

# IVR-Lab IP Address Update Script
# This script updates all configuration files when the host IP address changes
#
# Usage: ./update-ip.sh
# Or with specific IP: ./update-ip.sh 192.168.1.100

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color

# Get project root (parent of scripts directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Get new IP from argument or auto-detect
NEW_IP="$1"

if [ -z "$NEW_IP" ]; then
    # Auto-detect IP address (exclude loopback, docker, and link-local)
    NEW_IP=$(ip -4 addr show | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | grep -v '^127\.' | grep -v '^172\.17\.' | grep -v '^169\.254\.' | head -1)
    
    if [ -z "$NEW_IP" ]; then
        # Fallback: try hostname -I
        NEW_IP=$(hostname -I | awk '{print $1}')
    fi
    
    if [ -z "$NEW_IP" ]; then
        echo -e "${RED}Could not auto-detect IP address. Please provide IP as argument.${NC}"
        echo "Usage: $0 <IP_ADDRESS>"
        exit 1
    fi
fi

echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}IVR-Lab IP Address Update Script${NC}"
echo -e "${CYAN}========================================${NC}"
echo ""
echo -e "New IP Address: ${GREEN}$NEW_IP${NC}"
echo ""

# Get current IP from pjsip.conf
PJSIP_CONF="$PROJECT_ROOT/asterisk/pjsip.conf"
if [ -f "$PJSIP_CONF" ]; then
    OLD_IP=$(grep -oP 'external_media_address=\K[\d.]+' "$PJSIP_CONF" | head -1)
    if [ -n "$OLD_IP" ]; then
        echo -e "Current IP Address: ${YELLOW}$OLD_IP${NC}"
    else
        echo -e "${RED}Could not detect current IP from pjsip.conf${NC}"
        read -p "Enter the old IP address to replace: " OLD_IP
    fi
else
    echo -e "${RED}pjsip.conf not found${NC}"
    read -p "Enter the old IP address to replace: " OLD_IP
fi

if [ "$OLD_IP" == "$NEW_IP" ]; then
    echo ""
    echo -e "${GREEN}IP address is already up to date. No changes needed.${NC}"
    exit 0
fi

echo ""
echo -e "${CYAN}Updating configurations from $OLD_IP to $NEW_IP...${NC}"
echo ""

# Files to update
declare -a FILES=(
    "asterisk/pjsip.conf:Asterisk PJSIP Configuration"
    "asterisk/rtp.conf:Asterisk RTP Configuration"
    "docker-compose.yml:Docker Compose"
    "sbc/docker-compose.yml:SBC Docker Compose"
    "sbc/opensips/opensips.cfg:OpenSIPS Configuration"
    "sbc/opensips/kamailio.cfg:Kamailio Configuration"
)

UPDATED_COUNT=0
ERROR_COUNT=0

for entry in "${FILES[@]}"; do
    FILE_PATH="${entry%%:*}"
    DESCRIPTION="${entry##*:}"
    FULL_PATH="$PROJECT_ROOT/$FILE_PATH"
    
    if [ -f "$FULL_PATH" ]; then
        if grep -q "$OLD_IP" "$FULL_PATH" 2>/dev/null; then
            if sed -i "s/$OLD_IP/$NEW_IP/g" "$FULL_PATH" 2>/dev/null; then
                echo -e "${GREEN}[OK]${NC} $DESCRIPTION"
                echo -e "${GRAY}     $FILE_PATH${NC}"
                ((UPDATED_COUNT++))
            else
                echo -e "${RED}[ERR]${NC} $DESCRIPTION: Failed to update"
                ((ERROR_COUNT++))
            fi
        else
            echo -e "${GRAY}[--] $DESCRIPTION (no changes needed)${NC}"
        fi
    else
        echo -e "${GRAY}[--] $FILE_PATH (file not found)${NC}"
    fi
done

echo ""
echo -e "${CYAN}========================================${NC}"
echo -e "${CYAN}Summary${NC}"
echo -e "${CYAN}========================================${NC}"
echo -e "Files updated: ${GREEN}$UPDATED_COUNT${NC}"
if [ $ERROR_COUNT -gt 0 ]; then
    echo -e "Errors: ${RED}$ERROR_COUNT${NC}"
fi

echo ""
echo -e "${YELLOW}Next Steps:${NC}"
echo -e "${WHITE}1. Restart Asterisk container to apply changes:${NC}"
echo -e "${CYAN}   docker compose restart asterisk${NC}"
echo ""
echo -e "${WHITE}2. Verify PJSIP endpoint status:${NC}"
echo -e "${CYAN}   docker exec asterisk asterisk -rx 'pjsip show endpoints'${NC}"
echo ""

# Ask to restart containers
read -p "Restart Asterisk container now? (y/n): " RESTART
if [[ "$RESTART" =~ ^[Yy]$ ]]; then
    echo ""
    echo -e "${CYAN}Restarting Asterisk container...${NC}"
    cd "$PROJECT_ROOT"
    docker compose restart asterisk
    sleep 5
    echo ""
    echo -e "${CYAN}Checking endpoint status...${NC}"
    docker exec asterisk asterisk -rx "pjsip show endpoints"
fi

echo ""
echo -e "${GREEN}IP update complete!${NC}"
