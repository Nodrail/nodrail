---
"@nodrail/policy-engine": patch
"@nodrail/client": patch
"@nodrail/cli": patch
---

Security hardening from the first CodeQL review of the public monorepo: local secret and evidence files are read through a checked file descriptor (no symlink or swap between check and read), receipt and Markdown parsing no longer use backtracking-prone patterns, and telemetry writes its status atomically and refuses redirects. First release built from Nodrail/nodrail.
