'use strict';

const { google } = require('googleapis');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { randomUUID } = require('crypto');

function isYouTubeConfigured() {
  return !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.YOUTUBE_REFRESH_TOKEN
  );
}

function getYouTubeAuth() {
  const auth = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    'urn:ietf:wg:oauth:2.0:oob'
  );
  auth.setCredentials({ refresh_token: process.env.YOUTUBE_REFRESH_TOKEN });
  return auth;
}

async function uploadToYouTube({ title, description = '', buffer }) {
  if (!isYouTubeConfigured()) {
    throw new Error('YouTube não configurado — adicione YOUTUBE_REFRESH_TOKEN no Render');
  }

  const tmpPath = path.join(os.tmpdir(), `${randomUUID()}.mp4`);
  fs.writeFileSync(tmpPath, buffer);

  try {
    const youtube = google.youtube({ version: 'v3', auth: getYouTubeAuth() });

    const response = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: {
          title,
          description,
          defaultLanguage: 'pt',
          defaultAudioLanguage: 'pt',
        },
        status: { privacyStatus: 'unlisted' },
      },
      media: {
        mimeType: 'video/mp4',
        body: fs.createReadStream(tmpPath),
      },
    });

    const videoId = response.data.id;
    return `https://www.youtube.com/watch?v=${videoId}`;
  } finally {
    try { fs.unlinkSync(tmpPath); } catch {}
  }
}

module.exports = { isYouTubeConfigured, uploadToYouTube };
