'use strict';

// Raised for every user-facing config/CLI validation failure. The CLI
// prints `error: <message>` and exits non-zero for any ConfigError; any
// other thrown error is a bug and is allowed to propagate as a crash.
class ConfigError extends Error {}

module.exports = { ConfigError };
