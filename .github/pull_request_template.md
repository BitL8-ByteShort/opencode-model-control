## Outcome

<!-- What user-visible or operational outcome does this change deliver? -->

## Verification

<!-- List the exact checks run and their results. -->

## Safety and compatibility

- [ ] Free and legacy verified-price Paid still reject unknown pricing; configured Paid still checks connection identity, availability, and capabilities.
- [ ] Paid routing remains an explicit user choice and cannot bypass capability gates.
- [ ] No credentials, private prompts, customer data, absolute user paths, or generated local settings are included.
- [ ] OpenCode config writes are explicit, receipt-owned, recoverable, and preserve unrelated settings.
- [ ] New behavior includes failure-path coverage where relevant.
- [ ] I signed off my commits according to the DCO in `CONTRIBUTING.md`.
