# MUGEN-9: content fixtures and CLI acceptance-test contract

Delivered independently of the CLI implementation (MUGEN-6/7/8). This is
the published MUGEN-9 deliverable, landed in `brooswit-mugen/mugpacks-cli`
via PR #1 (head `3a83f567e9253d16352fb766c52e702435bcf104`). The fixtures
and acceptance-test contract are ready now; MUGEN-6/7/8 build the CLI
against this repository, and MUGEN-10 points the test harness described
in `tests/acceptance/cli-acceptance.test.js` at the real CLI once it
exists, turning each `test.todo(...)` there into a real assertion.

Built against the config/command/error contract from MUGEN-5 comment 49028
(`mugpacks.yaml`, `installDir`, `items[].{id,type,url,subpath}`).

## Layout

- `fixtures/content/characters/{fixture-fighter-a,fixture-fighter-b}/` — two
  synthetic characters (`.def`/`.cmd`/`.cns`/`.air` are plausible-but-fake
  MUGEN text; `.sff`/`.snd` are placeholder byte blobs, clearly labeled).
  No real third-party character data; names are generic fixture names, not
  references to any specific real character.
- `fixtures/content/stages/{fixture-stage-dojo,fixture-stage-arena}/` — two
  synthetic stages, same provenance note as above.
- `fixtures/archives/characters/*.zip`, `fixtures/archives/stages/*.zip` —
  the above content, zipped exactly as `valid-two-chars-two-stages.yaml`
  expects (char archives rooted under `<id>/`, matching `subpath:
  "<id>/"`; stage archives rooted at the zip root, matching `subpath: ""`).
- `fixtures/archives/malicious/` — deliberately unsafe or broken archives
  for the negative-path tests: `zip-slip-traversal.zip` (a `../../../`
  entry), `absolute-path.zip` (an absolute-path entry), `missing-subpath.zip`
  (valid zip, but lacking the subpath a config declares), `corrupt-archive.zip`
  (truncated, not a valid zip).
- `fixtures/config/*.yaml` — one config per scenario: the valid 2-char/2-stage
  install, and one fixture per MUGEN-5 error line (missing installDir,
  installDir not a directory, duplicate id, bad type, bad url, download
  404, each malicious archive, missing subpath, corrupt archive). Configs
  use two placeholders a test harness must substitute: `__INSTALL_DIR__`
  (a fresh temp copy of `fixtures/mugen-root`) and `__FIXTURE_SERVER__`
  (the base URL of a local server exposing `fixtures/archives/**`).
- `fixtures/mugen-root/` — a template "existing basic M.U.G.E.N. directory"
  (the CLI's `installDir`), pre-populated with an unrelated pre-existing
  character and a pre-existing `data/select.def`, used to assert that
  install/registration preserves what was already there. See its own
  README for the "always copy, never run in place" rule.
- `tests/fixtures/` — runs now, no CLI required: validates the fixtures
  themselves are structurally correct (def files have the sections the
  acceptance tests will assume, archives contain/lack the entries their
  scenario needs). `node --test tests/fixtures` — currently 10/10 passing.
- `tests/acceptance/` — the CLI acceptance contract, one `test.todo` per
  required behavior (happy path, each config/download/archive error, repeat-
  run idempotency, preserve-unrelated-content, fail-fast/no-partial-mutation
  on a mixed success+failure run). `node --test tests/acceptance` —
  currently 16/16 registering as `todo` (none failing). MUGEN-10 turns each
  `test.todo(...)` into a real assertion once MUGEN-8's pipeline exists,
  using the harness note at the top of that file.

## Known limitation

No symlink-based archive-traversal fixture is included (zip symlink entries
are platform/tool-dependent to author reliably); only `../` path entries and
absolute-path entries are covered. Flag this gap to whoever implements
MUGEN-7's extraction safety check.

## Provenance

All character/stage content here is synthetic, written for this ticket; it
is not an extraction, repackaging, or derivative of any specific real MUGEN
character or stage, and no third-party archive was downloaded or rehosted.
