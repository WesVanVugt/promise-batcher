# Changelog for promise-batcher

## 1.1.0 (2021-07-06)

- feature: Added idlePromise method.
- feature: Added idling property.
- misc: Removed comments from JS files.

## 1.0.3 (2021-07-05)

- misc: Updated dependencies.
- misc: Updated typings to be readonly where appropriate.
- misc: Removed "debug" dependency in favor of NodeJS builtin module "util".

## 1.0.2 (2019-02-11)

- bugfix: Corrected some error message text.
- misc: Updated dependencies.
- misc: Formatting changes.

## 1.0.1 (2018-04-19)

- bugfix: Replaced a dependency which had a reference to global Promise.defer method because it was causing deprecation
  warnings in some cases.

## 1.0.0 (2017-12-26)

- feature: Added send method
- feature: Added ability to retry requests

## 0.1.1 (2017-10-11)

- bugfix: Removed undeclared dependency on @types/debug

## 0.1.0 (2017-09-27)

- initial release
