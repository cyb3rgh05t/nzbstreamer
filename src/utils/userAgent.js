// Mimic current real clients so indexers accept the requests. Keep these in
// step with the latest Prowlarr (search) / SABnzbd (download) releases.
//   - Prowlarr (Servarr) sends "{App}/{fullVersion} ({osName} {osVersion})".
//   - SABnzbd sends "SABnzbd/{version}" (no OS suffix).
const DEFAULT_SEARCH_UA = 'Prowlarr/2.6.5.5623 (ubuntu 24.04)';
const DEFAULT_DOWNLOAD_UA = 'SABnzbd/5.1.3';

function getDefaultSearchUserAgent() {
  return process.env.NZB_DEFAULT_SEARCH_USER_AGENT || DEFAULT_SEARCH_UA;
}

function getDefaultDownloadUserAgent() {
  return process.env.NZB_DEFAULT_DOWNLOAD_USER_AGENT || DEFAULT_DOWNLOAD_UA;
}

// Backward-compatible alias — returns the download UA. Existing callers that
// download NZB payloads continue to work unchanged.
function getRandomUserAgent() {
  return getDefaultDownloadUserAgent();
}

module.exports = {
  getRandomUserAgent,
  getDefaultSearchUserAgent,
  getDefaultDownloadUserAgent,
  DEFAULT_SEARCH_UA,
  DEFAULT_DOWNLOAD_UA,
};
