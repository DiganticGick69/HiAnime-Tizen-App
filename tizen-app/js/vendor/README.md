# Vendored scripts

## hls.min.js

- hls.js **1.5.13**, `dist/hls.min.js`, unmodified
- Source: official release asset https://github.com/video-dev/hls.js/releases/download/v1.5.13/release.zip
  (zip sha256 `c5ef2cf356b103bf7a19dd4d14257c9e00163551ed03bbf96bf22a12458a1250`)
- File sha256: `e5753b10fc65eae35f21883e684d22c43ce66de968d35166792585b9b8a3f1a2`
- License: Apache-2.0 (https://github.com/video-dev/hls.js/blob/master/LICENSE)

Only loaded by the HTML5 player fallback (desktop testing, or a TV without AVPlay).
It ships inside the .wgt instead of loading from a CDN, so nothing outside the
package can run code with the app's privileges. To update, replace the file from
a new release and update the version and hashes above.
