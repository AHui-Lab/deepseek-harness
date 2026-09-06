/**
 * Updater module - checks for new versions of DeepSeek Harness
 * by querying the upstream GitHub repository releases.
 */

const https = require('https');

// Upstream repository to track for updates
const UPSTREAM_OWNER = 'deepseek-ai';
const UPSTREAM_REPO = 'deepseek-harness';

// Current version from package.json
function getCurrentVersion() {
  try {
    const pkg = require('../package.json');
    return pkg.version;
  } catch {
    return '0.0.0';
  }
}

/**
 * Simple semver comparison.
 * Returns:
 *   > 0 if v1 > v2
 *   < 0 if v1 < v2
 *   0   if v1 === v2
 */
function compareVersions(v1, v2) {
  // Strip leading 'v' if present
  const a = v1.replace(/^v/, '').split('.').map(Number);
  const b = v2.replace(/^v/, '').split('.').map(Number);

  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const av = a[i] || 0;
    const bv = b[i] || 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

/**
 * Make an HTTPS GET request and return parsed JSON.
 */
function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': 'DeepSeek-Harness-Desktop/1.0',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      timeout: 15000,
    }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`));
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (err) {
          reject(err);
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });
  });
}

/**
 * Check if a newer version is available on GitHub.
 */
async function checkForUpdates() {
  const currentVersion = getCurrentVersion();

  try {
    // Fetch the latest release from upstream
    const release = await fetchJson(
      `https://api.github.com/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/releases/latest`
    );

    const latestTag = release.tag_name || '';
    const latestVersion = latestTag.replace(/^v/, '');

    if (!latestVersion) {
      return {
        hasUpdate: false,
        currentVersion,
        error: 'Could not determine latest version',
      };
    }

    const cmp = compareVersions(latestVersion, currentVersion);
    const hasUpdate = cmp > 0;

    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      latestTag,
      releaseUrl: release.html_url || `https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/releases`,
      releaseNotes: release.body || '',
      publishedAt: release.published_at || '',
      prerelease: release.prerelease || false,
    };
  } catch (err) {
    // Fallback: try to get the version from package.json in the repo
    try {
      const pkgData = await fetchJson(
        `https://raw.githubusercontent.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/master/package.json`
      );
      const latestVersion = pkgData.version;
      const cmp = compareVersions(latestVersion, currentVersion);

      return {
        hasUpdate: cmp > 0,
        currentVersion,
        latestVersion,
        latestTag: `v${latestVersion}`,
        releaseUrl: `https://github.com/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/releases`,
        releaseNotes: '',
        publishedAt: '',
        prerelease: false,
      };
    } catch {
      return {
        hasUpdate: false,
        currentVersion,
        error: err.message,
      };
    }
  }
}

/**
 * List recent releases (up to 5).
 */
async function listRecentReleases() {
  try {
    const releases = await fetchJson(
      `https://api.github.com/repos/${UPSTREAM_OWNER}/${UPSTREAM_REPO}/releases?per_page=5`
    );

    return releases.map((r) => ({
      tag: r.tag_name,
      version: r.tag_name.replace(/^v/, ''),
      name: r.name,
      url: r.html_url,
      publishedAt: r.published_at,
      prerelease: r.prerelease,
      draft: r.draft,
    }));
  } catch (err) {
    return { error: err.message };
  }
}

module.exports = {
  getCurrentVersion,
  checkForUpdates,
  listRecentReleases,
  compareVersions,
};
