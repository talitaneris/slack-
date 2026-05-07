'use strict';

function isZoomConfigured() {
  return !!(
    process.env.ZOOM_ACCOUNT_ID &&
    process.env.ZOOM_CLIENT_ID &&
    process.env.ZOOM_CLIENT_SECRET
  );
}

async function getZoomAccessToken() {
  const { ZOOM_ACCOUNT_ID, ZOOM_CLIENT_ID, ZOOM_CLIENT_SECRET } = process.env;
  const credentials = Buffer.from(`${ZOOM_CLIENT_ID}:${ZOOM_CLIENT_SECRET}`).toString('base64');

  const response = await fetch(
    `https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${ZOOM_ACCOUNT_ID}`,
    {
      method: 'POST',
      headers: {
        Authorization: `Basic ${credentials}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    }
  );

  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.access_token) {
    throw new Error(data.reason || data.message || `Zoom OAuth ${response.status}`);
  }

  return data.access_token;
}

async function criarReuniaoZoom({ topic = 'Reunião', startTime, duration = 60, agenda = '' } = {}) {
  if (!isZoomConfigured()) throw new Error('Zoom não configurado');

  const token = await getZoomAccessToken();

  const body = {
    topic,
    type: startTime ? 2 : 1, // 1 = instantânea, 2 = agendada
    duration,
    agenda,
    settings: {
      waiting_room: false,
      join_before_host: true,
      mute_upon_entry: false,
      auto_recording: 'cloud',
    },
  };

  if (startTime) {
    body.start_time = startTime; // ex: "2025-05-12T19:00:00"
    body.timezone = 'America/Sao_Paulo';
  }

  const response = await fetch('https://api.zoom.us/v2/users/me/meetings', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.message || `Zoom API ${response.status}`);
  }

  return {
    meetingId: data.id,
    joinUrl: data.join_url,
    startUrl: data.start_url,
    password: data.password,
    topic: data.topic,
    startTime: data.start_time,
  };
}

async function buscarGravacaoZoom(meetingId) {
  if (!isZoomConfigured()) throw new Error('Zoom não configurado');

  const token = await getZoomAccessToken();

  const response = await fetch(`https://api.zoom.us/v2/meetings/${meetingId}/recordings`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (response.status === 404) return [];

  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || `Zoom recordings ${response.status}`);

  const files = data.recording_files || [];
  return files.filter(f => f.file_type === 'MP4' && f.status === 'completed');
}

async function downloadRecording(downloadUrl, accessToken) {
  const url = `${downloadUrl}?access_token=${accessToken}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Download gravação ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

module.exports = { isZoomConfigured, getZoomAccessToken, criarReuniaoZoom, buscarGravacaoZoom, downloadRecording };
