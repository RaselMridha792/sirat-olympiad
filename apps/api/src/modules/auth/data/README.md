# Common passwords list

`common-passwords-10k.txt` is `Passwords/Common-Credentials/10k-most-common.txt` from
[SecLists](https://github.com/danielmiessler/SecLists) (MIT, see `LICENSE-SecLists`), unchanged.

- Retrieved 2026-10-30; 10,001 lines, LF, printable ASCII, unique case-insensitively.
- SHA-256 `68782d6a4a19a4768d5f15dd66bd534e7a33055cc755411e33f16d18c50fdcce`.
- Used by `../password-policy.ts`: a new password whose lower-cased form is on this list is refused (owner, A2
  approval: "top 10k common passwords rejected"). Entries shorter than 8 characters are already refused by length.
- Copied into `dist` by `nest-cli.json` (`assets`); the API refuses to start if the file is missing or truncated.
