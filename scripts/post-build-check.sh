#!/bin/bash
BASE_URL="https://appli.sunanddrive.com"
API="$BASE_URL/api/v1"
ERRORS=0
PASS=0

check() {
  local label=$1
  local url=$2
  local expected=$3
  local response=$(curl -s -o /dev/null -w "%{http_code}" "$url")
  if [ "$response" = "$expected" ]; then
    echo "✅ $label ($response)"
    ((PASS++))
  else
    echo "❌ $label — attendu $expected, reçu $response"
    ((ERRORS++))
  fi
}

echo "═══════════════════════════════════"
echo "  SunanddriveOS — Post-build check"
echo "═══════════════════════════════════"

# 1. Frontend accessible
check "Frontend" "$BASE_URL" "200"

# 2. Backend health
check "Backend health" "$API/health" "200"

# 3. Auth endpoint
check "Auth endpoint" "$API/auth/login" "400"

# 4. SuperAdmin plans
check "SuperAdmin plans" "$API/superadmin/plans" "401"

# 5. Onboarding endpoint
check "Onboarding step 1" "$BASE_URL/onboarding/step/1" "200"

# 6. Billing endpoint
check "Billing checkout" "$API/billing/create-checkout-session" "401"

# 7. Stripe webhook endpoint
check "Stripe webhook" "$API/billing/webhook" "400"

# 8. Vérifier containers Docker
echo ""
echo "📦 Containers Docker :"
docker ps --format "  {{.Names}} — {{.Status}}" | grep sunanddriveos

# 9. Dernières lignes de logs backend (erreurs seulement)
echo ""
echo "🔍 Erreurs backend (30 dernières secondes) :"
docker logs sunanddriveos-backend --since 30s 2>&1 | grep -i "error\|fatal\|crash" | head -10

echo ""
echo "═══════════════════════════════════"
echo "  Résultat : $PASS ✅  $ERRORS ❌"
echo "═══════════════════════════════════"

if [ $ERRORS -gt 0 ]; then
  echo "⚠️  Des erreurs ont été détectées — vérifier avant de passer en prod"
  exit 1
else
  echo "🚀 Tout est opérationnel !"
  exit 0
fi
