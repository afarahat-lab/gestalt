#!/bin/sh
# OIDC end-to-end flow — run from inside gestalt-server-1 where docker DNS
# resolves both 'gestalt-keycloak:8080' and 'localhost:3000' (the server's own port).
set -e
cd /tmp
rm -f cookies.txt kc-login.html step3.txt step4.txt

# Step 1: /auth/oidc/login → 302 with KC authorize URL in Location
KC_AUTHZ=$(curl -si -o /dev/null -w '%{redirect_url}\n' http://localhost:3000/auth/oidc/login)
echo "1. KC authorize URL (first 80 chars): ${KC_AUTHZ%%&*}"

# Step 2: GET KC login page (saves session cookie). Use --resolve so curl
# uses the same hostname Keycloak issues URLs as.
curl -sL -c cookies.txt -b cookies.txt -o kc-login.html "$KC_AUTHZ"
echo "2. KC login HTML size: $(wc -c < kc-login.html) bytes"

# Extract the form action URL from the HTML
FORM_ACTION=$(grep -oE 'action="[^"]+"' kc-login.html | head -1 | sed 's|action="||; s|"$||; s|&amp;|\&|g')
echo "3. Form action (first 80 chars): ${FORM_ACTION%%&*}"

# Step 3: POST credentials, don't follow redirect so we can capture Location
curl -si -c cookies.txt -b cookies.txt \
     -d "username=alice&password=alice123&credentialId=" \
     -X POST "$FORM_ACTION" > step3.txt 2>&1
LOCATION=$(grep -i "^Location:" step3.txt | head -1 | sed 's|^[lL]ocation: *||' | tr -d '\r\n')
echo "4. Callback URL from KC (first 100 chars): ${LOCATION:0:100}..."

# Step 4: GET callback → server exchanges code, issues JWT, redirects with token
curl -si -b cookies.txt "$LOCATION" > step4.txt 2>&1
FINAL=$(grep -i "^Location:" step4.txt | head -1 | sed 's|^[lL]ocation: *||' | tr -d '\r\n')
HTTP_LINE=$(head -1 step4.txt | tr -d '\r')
echo "5. Server callback response: $HTTP_LINE"
echo "6. Final redirect URL: ${FINAL:0:120}..."

# Extract the JWT from ?token=... in the final URL
JWT=$(echo "$FINAL" | sed 's|.*[?&]token=||' | sed 's|&.*||')
echo
echo "JWT (len ${#JWT}): ${JWT:0:60}..."
echo "$JWT" > /tmp/jwt.txt
