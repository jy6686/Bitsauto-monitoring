# Deployment Checklist — monitoring platform (Replit)

**Why this exists.** On 2026-08-04 the Replit workspace was found holding **seven
unpushed commits**, including the AMI pong watchdog — production fixes existing in
exactly one container, one workspace reset from being lost. Replit commits
automatically on publish ("Published your App") but does **not** push. Publishing had
no defined "done", so the gap was invisible until someone looked.

Run every item, in order, after every publish.

## Checklist

- [ ] **1. Publish** in Replit
- [ ] **2. Push to GitHub** — `git push origin <branch>`; if rejected,
      `git pull --rebase origin <branch> && git push origin <branch>`
- [ ] **3. Verify the push landed** — from a second machine, or Replit's Git pane:
      the remote HEAD must equal the local HEAD. *A push that printed an error and
      scrolled away is the failure mode this step catches.*
- [ ] **4. Verify AMI connected** — `/api/call-governance/ami-status` returns
      `{"connected":true}`. **Check this specifically after publishing**: publishing
      can move the container to a new egress IP, which the Asterisk firewall will drop.
- [ ] **5. Verify the watchdog is armed** — the deploy log shows the governance client
      reaching `Logged in — listening for Bridge/Hangup events`
- [ ] **6. Verify the alert recipient** — `alertAdminEmail` is configured in settings,
      otherwise `[ami-alert] no alertAdminEmail configured` appears and outages stay
      silent

## Step 4 is the one that bites

Every AMI outage on 2026-08-04 traced to an egress rotation, and **publishing is what
rotates it**. The recovery move — restarting the app — can rotate it again. If step 4
fails, on the Asterisk host:

```bash
timeout 30 tcpdump -nn -i any "tcp[tcpflags] & tcp-syn != 0 and port 5038"
iptables -I INPUT -s <IP> -p tcp --dport 5038 -j ACCEPT && service iptables save
```

`service iptables save` is not optional — without it the rule dies at the next reboot.

**The permanent fix for steps 4's whole failure class is static egress** on the Replit
deployment. Once enabled, the IP stops changing and this step becomes a formality.

## Branch discipline

Two environments editing one branch caused an avoidable rebase. Going forward:

| Environment | Branch |
|---|---|
| Replit (implementation) | `main`, or a feature branch |
| Docs / specs / analysis | separate `docs/*` branches |

Merge deliberately. Never let both sides commit to the same branch by default.
