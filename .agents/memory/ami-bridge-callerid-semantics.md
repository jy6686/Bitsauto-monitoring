---
name: AMI Bridge CallerIDNum field semantics
description: Which callerIdNum slot maps to CLD vs CLI in Sippy/Asterisk Bridge events for this deployment.
---

## Rule (CONFIRMED from production DB + log verification)
`callerIdNum1` = CLD (destination / B-party number with routing prefix)
`callerIdNum2` = CLI (originating A-party ANI, often North America +1)

In the AMI Bridge event for this Sippy/Asterisk setup:
- Channel1 = SIP/sippy (B-leg/vendor) → CallerIDNum1 = routed destination WITH routing prefix "2060"
  e.g. "2060923xxxxxxxxxx" = routing prefix 2060 + Pakistan 923...
       "20602917xxxxxxxx"  = routing prefix 2060 + Eritrea 291...
- Channel2 = PJSIP/sippy-endpoint (A-leg/customer) → CallerIDNum2 = originating CLI
  e.g. "+15145765095" = North America originating caller

**Storage in governed_calls:**
- `callee = callerIdNum1` (CLD with routing prefix)
- `caller = callerIdNum2` (originating CLI)

**Why:** Counter-intuitive because CallerIDNum1 carries the destination (not the caller).
Sippy routes the destination number as the B-leg CallerIDNum. Verified by:
1. Production DB sampling showing callee=923.../291... (Pakistan/Eritrea) for reconcile path
2. Bridge event logs showing rule "Eritrea" (dest="291") correctly matched after fixing to callerIdNum1→callee
3. BitsEye live-slice confirming actual destinations are PAKISTAN and ERITREA

**pickBestRule:** Must strip the "2060" routing prefix before destination prefix matching.
Strip condition: startsWith('2060') AND length >= 14 → slice(4)
e.g. "20602917848929".slice(4) = "2917848929" → matches dest="291" = Eritrea ✅

**resolveDestination (client LPM):** Same strip logic applied before LPM.
e.g. "2060923072431474" → "923072431474" → Pakistan ✅
     "20602917123378"   → "2917123378"   → Eritrea ✅

**WARNING:** Do NOT invert callerIdNum1/callerIdNum2 using channel A/B identification.
The assignment is Sippy-specific and counter-intuitive. Any "obvious" A/B swap will break it.
