#!/usr/bin/env bash
# One-time wiring for: Twilio Elastic SIP trunk -> Azure Realtime SIP connector.
#
# Prerequisites (in .env at repo root):
#   AZURE_REALTIME_URL / AZURE_REALTIME_KEY  -> the East US 2 (or Sweden Central) resource
#   PUBLIC_VOICE_URL                         -> internet-reachable voice server URL
#   TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_NUMBER
#
# Usage:
#   bash scripts/azure-sip-setup.sh <azure-internal-id> [region]
#     <azure-internal-id>  Azure portal -> resource -> JSON View -> properties.internalId
#     [region]             eastus2 (default) or swedencentral
#
# Afterwards: put the printed AZURE_WEBHOOK_SECRET in .env, set AZURE_SIP_ENABLED=true,
# and restart the voice server.

set -euo pipefail
cd "$(dirname "$0")/.."
set -a; source .env; set +a

INTERNAL_ID="${1:?Usage: azure-sip-setup.sh <azure-internal-id> [region]}"
REGION="${2:-eastus2}"
PROJECT_ID="proj_${INTERNAL_ID}"
SIP_URI="sip:${PROJECT_ID}@${REGION}.sip.ai.azure.com;transport=tls"
HOST=$(echo "$AZURE_REALTIME_URL" | sed -E 's|https://([^/]+).*|\1|')
WEBHOOK_URL="${PUBLIC_VOICE_URL%/}/azure/incoming"

json_field() {
  node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);const v=('$1'.split('.').reduce((o,k)=>o?.[k],j));console.log(v??'')}catch{console.log('')}})"
}

echo "== 1/4 Registering realtime.call.incoming webhook on ${HOST}"
echo "       -> ${WEBHOOK_URL}"
WEBHOOK_JSON=$(curl -sf -X POST "https://${HOST}/openai/v1/dashboard/webhook_endpoints" \
  -H "api-key: ${AZURE_REALTIME_KEY}" -H "Content-Type: application/json" \
  -d "{\"name\":\"recepto-sip\",\"url\":\"${WEBHOOK_URL}\",\"event_types\":[\"realtime.call.incoming\"]}")
SECRET=$(echo "$WEBHOOK_JSON" | json_field signing_secret)
if [ -z "$SECRET" ]; then
  echo "Webhook creation response (no signing_secret found):"
  echo "$WEBHOOK_JSON"
  exit 1
fi
echo ""
echo "  *** SAVE NOW — shown only once ***"
echo "  AZURE_WEBHOOK_SECRET=${SECRET}"
echo ""

echo "== 2/4 Creating Twilio Elastic SIP trunk"
TRUNK_SID=$(curl -sf -X POST "https://trunking.twilio.com/v1/Trunks" \
  -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" \
  --data-urlencode "FriendlyName=recepto-azure-sip" | json_field sid)
echo "  Trunk: ${TRUNK_SID}"

echo "== 3/4 Pointing trunk origination at Azure"
echo "       -> ${SIP_URI}"
curl -sf -X POST "https://trunking.twilio.com/v1/Trunks/${TRUNK_SID}/OriginationUrls" \
  -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" \
  --data-urlencode "FriendlyName=azure-realtime" \
  --data-urlencode "SipUrl=${SIP_URI}" \
  --data-urlencode "Weight=1" \
  --data-urlencode "Priority=1" \
  --data-urlencode "Enabled=true" > /dev/null
echo "  Origination URL added."

echo "== 4/4 Moving ${TWILIO_NUMBER} onto the trunk"
NUMBER_SID=$(curl -sf -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" \
  "https://api.twilio.com/2010-04-01/Accounts/${TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers.json?PhoneNumber=${TWILIO_NUMBER}" \
  | json_field "incoming_phone_numbers.0.sid")
if [ -z "$NUMBER_SID" ]; then
  echo "Could not find ${TWILIO_NUMBER} on this Twilio account."; exit 1
fi
curl -sf -X POST "https://trunking.twilio.com/v1/Trunks/${TRUNK_SID}/PhoneNumbers" \
  -u "${TWILIO_ACCOUNT_SID}:${TWILIO_AUTH_TOKEN}" \
  --data-urlencode "PhoneNumberSid=${NUMBER_SID}" > /dev/null
echo "  Number attached."

echo ""
echo "Done. Final steps:"
echo "  1. Add to .env:  AZURE_SIP_ENABLED=true"
echo "  2. Add to .env:  AZURE_WEBHOOK_SECRET=${SECRET}"
echo "  3. Restart the voice server, then place a test call to ${TWILIO_NUMBER}."
echo ""
echo "Rollback (back to Media Streams): remove the number from the trunk in the"
echo "Twilio console and re-set its Voice webhook to ${PUBLIC_VOICE_URL%/}/twilio/incoming"
