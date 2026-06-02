#!/bin/sh
# SAML end-to-end flow — run from inside gestalt-server-1.
#
#   1. GET /auth/saml/login → 302 to Keycloak with SAMLRequest
#   2. GET KC URL → HTML login form
#   3. POST credentials → KC returns HTML containing auto-submit form to ACS
#   4. POST SAMLResponse to /auth/saml/callback → server validates, issues JWT, redirects
set -e
cd /tmp
rm -f saml-cookies.txt saml-kc.html saml-post.html saml-step3.txt saml-step4.txt

# Step 1: /auth/saml/login → 302 to KC SAML endpoint
KC_SAML=$(curl -si -o /dev/null -w '%{redirect_url}\n' http://localhost:3000/auth/saml/login)
echo "1. KC SAML URL (first 80): ${KC_SAML%%&*}"

# Step 2: GET KC login page
curl -sL -c saml-cookies.txt -b saml-cookies.txt -o saml-kc.html "$KC_SAML"
echo "2. KC HTML size: $(wc -c < saml-kc.html) bytes"
FORM_ACTION=$(grep -oE 'action="[^"]+"' saml-kc.html | head -1 | sed 's|action="||; s|"$||; s|&amp;|\&|g')
echo "3. Form action: ${FORM_ACTION%%&*}"

# Step 3: POST credentials — KC returns 200 with HTML that has a SAMLResponse <input> + auto-submit JS
curl -sL -c saml-cookies.txt -b saml-cookies.txt \
     -d "username=alice&password=alice123&credentialId=" \
     -X POST "$FORM_ACTION" \
     -o saml-post.html
echo "4. KC SAML post-response HTML size: $(wc -c < saml-post.html) bytes"

# Extract the SAMLResponse value from the auto-submit form
SAML_RESPONSE=$(grep -oE 'name="SAMLResponse"[^>]*value="[^"]+"' saml-post.html | head -1 | sed 's|.*value="||; s|"$||')
RELAY_STATE=$(grep -oE 'name="RelayState"[^>]*value="[^"]*"' saml-post.html | head -1 | sed 's|.*value="||; s|"$||')
ACS_URL=$(grep -oE 'action="[^"]+/auth/saml/callback"' saml-post.html | head -1 | sed 's|action="||; s|"$||')
echo "5. SAMLResponse (first 60): ${SAML_RESPONSE:0:60}..."
echo "   RelayState: ${RELAY_STATE}"
echo "   ACS URL: ${ACS_URL}"

# Step 4: POST SAMLResponse to /auth/saml/callback
curl -si -d "SAMLResponse=$(printf '%s' "$SAML_RESPONSE" | sed 's|+|%2B|g; s|/|%2F|g; s|=|%3D|g')&RelayState=$(printf '%s' "$RELAY_STATE" | sed 's|/|%2F|g')" \
     -X POST "$ACS_URL" > saml-step4.txt 2>&1

HTTP_LINE=$(head -1 saml-step4.txt | tr -d '\r')
FINAL=$(grep -i "^Location:" saml-step4.txt | head -1 | sed 's|^[lL]ocation: *||' | tr -d '\r\n')
echo
echo "6. Server callback response: $HTTP_LINE"
echo "7. Final redirect URL: ${FINAL:0:120}..."

JWT=$(echo "$FINAL" | sed 's|.*[?&]token=||' | sed 's|&.*||')
if [ -n "$JWT" ] && [ "${#JWT}" -gt 30 ]; then
  echo
  echo "JWT (len ${#JWT}): ${JWT:0:60}..."
  echo "$JWT" > /tmp/saml-jwt.txt
else
  echo "No JWT in response. Body:"
  sed -n '/^\r$/,$p' saml-step4.txt | tail -3
fi
