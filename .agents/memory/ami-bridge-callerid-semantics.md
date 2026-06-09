---
name: AMI Bridge CallerIDNum field semantics
description: Which callerIdNum slot maps to CLD vs CLI in Sippy/Asterisk Bridge events for this deployment.
---

## Rule
`callerIdNum2` = CLD (destination / B-party number, e.g. "923xxxxxxxx", "447xxxxxxxx", "1xxxxxxxxxx")
`callerIdNum1` = CLI (routing-prefix originating ANI, e.g. "2060923xxxxxxxxxx")

In the AMI Bridge event for this Sippy/Asterisk setup:
- Channel1 = SIP/sippy (vendor B-leg) → CallerIDNum1 = routing-prefix ANI passed to carrier
- Channel2 = PJSIP/sippy-endpoint (customer A-leg) → CallerIDNum2 = destination CLD

**Why:** Sippy sends the PJSIP endpoint the destination number as its CallerIDNum (possibly via the Request-URI / To user-part), and the outbound SIP/sippy B-leg receives the routing-prefix ANI as its CallerIDNum. Verified by DB sampling: callee column in governed_calls always holds recognizable destination numbers (923x=Pakistan, 447x=UK, 1xxx=NANP, 597x=Suriname, 249x=Sudan) and caller always holds 2060xxx routing prefix.

**How to apply:** Never attempt to "fix" this mapping using channelA/channelB identification — the CallerIDNum field assignment is Sippy-specific and counter-intuitive. Any attempt to derive CLD from the B-leg (SIP/sippy) CallerIDNum yields the routing prefix instead. Keep `callee = event.callerIdNum2` and `caller = event.callerIdNum1` as-is.
