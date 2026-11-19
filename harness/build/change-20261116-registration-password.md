# Registration password policy

## Goal and requirements

Update FR-01 registration to accept passwords of 8–128 characters that include an uppercase letter, a digit, and a special character.

## Scope and design

The existing registration minimum is 15 characters. Apply the new rule in the web form, Auth service, and gateway OpenAPI contract. Use ASCII uppercase letters, digits, and punctuation for the required classes. Whitespace does not satisfy the punctuation rule.

## Security and compatibility

Apply the rule when selecting a password at registration. Existing accounts keep their hashes and sign in with their current passwords. The database needs no migration.

## Implementation and verification

1. Update the registration form, service validation, and contract.
2. Update test fixtures and add checks for the eight-character boundary and each missing class.
3. Run `make check`, `make compose-check`, `make verify-phase01`, and `make bootstrap` to verify the development stack.

## Acceptance criteria

The form and API accept a qualifying eight-character password, reject registrations missing any requirement, and preserve sign-in compatibility.

## Open questions

None.
