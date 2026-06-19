#!/bin/bash
# BitsAuto Backup Script
# Run this from the Replit Shell tab to create a DB dump you can download

DATE=$(date +%Y%m%d_%H%M)
BACKUP_FILE="bitsauto_db_${DATE}.dump"

echo "Creating database backup: $BACKUP_FILE"
pg_dump "$DATABASE_URL" \
  --format=custom \
  --compress=9 \
  --file="/home/runner/workspace/client/public/downloads/$BACKUP_FILE"

echo ""
echo "Done. Download your backup from:"
echo "  Files panel → client/public/downloads/$BACKUP_FILE"
echo "  or visit: /downloads/$BACKUP_FILE in the app preview"
echo ""
echo "File size:"
du -sh "/home/runner/workspace/client/public/downloads/$BACKUP_FILE"
