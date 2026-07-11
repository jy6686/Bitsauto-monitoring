# Production fixtures — DO NOT commit customer files here

This folder is **documentation only**. Never place real customer/vendor workbooks
in the repository (proprietary + PII/commercial risk).

## Turning a production workbook into a regression fixture
1. Reproduce the bug locally with the real file.
2. **Anonymize**: replace real prefixes/destinations/rates with synthetic values
   that still trigger the bug (keep the structural quirk — duplicate headers,
   merged cells, sheet order — not the data).
3. Save the anonymized workbook to `../regression/bug-NNN-<slug>.xlsx`.
4. Add a versioned baseline in `../expected/<slug>.json` if it needs output checks.
5. Register a self-test that loads it (tags: `regression`).

The bug then becomes a permanent, shareable regression test with no customer data.
