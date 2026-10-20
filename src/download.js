'use strict';

const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const { pipeline } = require('node:stream/promises');
const { DownloadError } = require('./download-errors');

const MAX_REDIRECTS = 5;

/**
 * Download `url` to `destPath` (a file path inside the caller's staging
 * directory). Only http/https are followed; this is a second, independent
 * check behind MUGEN-6's own URL-shape validation, not a replacement for it.
 *
 * On any non-2xx response, a network error, or too many redirects, throws a
 * DownloadError carrying the url and a short reason string suitable for the
 * `download failed: <status/reason>` error form. The partial file (if any)
 * is removed so a failed download never leaves a truncated artifact behind
 * in the staging directory.
 *
 * Resolves with destPath on success.
 */
async function downloadToFile(url, destPath, { redirectsLeft = MAX_REDIRECTS } = {}) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch (err) {
    throw new DownloadError(url, `invalid URL: ${err.message}`);
  }

  const client = parsed.protocol === 'https:' ? https : parsed.protocol === 'http:' ? http : null;
  if (!client) {
    throw new DownloadError(url, `unsupported protocol "${parsed.protocol}"`);
  }

  const response = await new Promise((resolve, reject) => {
    const req = client.get(parsed, resolve);
    req.on('error', (err) => reject(new DownloadError(url, err.message)));
  });

  const { statusCode, headers } = response;

  if (statusCode >= 300 && statusCode < 400 && headers.location) {
    response.resume(); // discard body
    if (redirectsLeft <= 0) {
      throw new DownloadError(url, 'too many redirects');
    }
    const nextUrl = new URL(headers.location, url).toString();
    return downloadToFile(nextUrl, destPath, { redirectsLeft: redirectsLeft - 1 });
  }

  if (statusCode < 200 || statusCode >= 300) {
    response.resume(); // discard body
    throw new DownloadError(url, `HTTP ${statusCode} ${response.statusMessage || ''}`.trim());
  }

  try {
    await pipeline(response, fs.createWriteStream(destPath));
  } catch (err) {
    await fs.promises.rm(destPath, { force: true });
    throw new DownloadError(url, err.message);
  }

  return destPath;
}

module.exports = { downloadToFile };
