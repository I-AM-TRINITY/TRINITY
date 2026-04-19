<!--
Trinity SDK / Planespace / Trinity Core
Copyright (c) 2026 James Chapman (XheCarpenXer)

Author: James Chapman
Alias: XheCarpenXer
Contact: xhecarpenxer@gmail.com

SPDX-License-Identifier: AGPL-3.0-or-later

This software is dual-licensed:
1. Open Source License: GNU Affero General Public License v3.0 or later (AGPLv3+).
2. Commercial / Government License: available for private, closed-source, warranty-backed,
   or separately negotiated terms beyond AGPL compliance.

See: LICENSE, COMMERCIAL-LICENSE.md, FEE-SCHEDULE.md, CLA.md, LEGAL-NOTES.md
THIS SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND.
-->

# Trinity Legal Notes

This file is a practical note for maintainers and contributors. It is not legal advice.

## Dual-Licensing Reality Check

Trinity is being published under `AGPL-3.0-or-later` plus a separate commercial license.

Important nuance:

- AGPL itself allows commercial use if the user complies with AGPL obligations
- The commercial license is the alternative path for organizations that need private, closed-source, warranty-backed, or negotiated terms instead of AGPL compliance

If the goal ever becomes "commercial use is forbidden unless paid" in all cases, AGPL is not the right open-source license for that policy. That would require a different custom source-available or proprietary licensing model.

## Contributor Control

The included `CLA.md` is important because dual licensing is much harder to maintain safely once outside contributions arrive without a relicense grant.

Recommended enforcement:

- Require CLA acceptance for every pull request
- Keep the PR template acknowledgment in `.github/PULL_REQUEST_TEMPLATE.md`
- Add an automated CLA workflow if this repository moves to a public forge

## Headers

Use `tools/apply-legal-headers.mjs` to manage legal headers.

The tool is designed to:

- Detect managed headers by normalized SHA-256 hash instead of brittle string matching
- Emit comment syntax appropriate to the file type
- Support multiple presets, including Trinity dual-license headers plus common templates such as MIT and Apache 2.0

## Appropriate Legal Notices

AGPL speaks about "Appropriate Legal Notices" for interactive interfaces. At minimum, public-facing landing pages and operator-facing documentation should clearly surface:

- Copyright and authorship
- No-warranty language
- Where to find the open-source license
- Where to request commercial licensing

## Future Hardening

If this project starts onboarding many external contributors or enterprise customers, consider:

- A CLA bot or signed contributor workflow
- Trademark guidance for "Trinity" and "Planespace"
- A dedicated `NOTICE` file for attribution and branding rules
