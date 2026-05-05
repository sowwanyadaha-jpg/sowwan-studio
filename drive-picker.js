(function () {
  'use strict';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if ([...document.scripts].some(s => s.src === src)) return resolve();
      const s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = resolve;
      s.onerror = () => reject(new Error('โหลด Google script ไม่สำเร็จ'));
      document.head.appendChild(s);
    });
  }

  async function ensureGoogle() {
    await loadScript('https://accounts.google.com/gsi/client');
    await loadScript('https://apis.google.com/js/api.js');
    await new Promise((resolve) => window.gapi.load('picker', resolve));
  }

  function getToken(clientId) {
    return new Promise((resolve, reject) => {
      if (!window.google || !window.google.accounts || !window.google.accounts.oauth2) {
        reject(new Error('Google Identity Services ไม่พร้อม'));
        return;
      }
      const tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: clientId,
        scope: 'https://www.googleapis.com/auth/drive.file',
        prompt: 'consent',
        callback: (response) => {
          if (response && response.access_token) resolve(response.access_token);
          else reject(new Error('ไม่ได้รับสิทธิ์จาก Google Drive'));
        }
      });
      tokenClient.requestAccessToken();
    });
  }

  async function connect(config) {
    if (!config || !config.googleClientId) throw new Error('ยังไม่ได้ตั้งค่า GOOGLE_CLIENT_ID บน server');
    await ensureGoogle();
    return getToken(config.googleClientId);
  }

  async function pick(config) {
    if (!config || !config.googleApiKey || !config.googleClientId) {
      throw new Error('ยังไม่ได้ตั้งค่า GOOGLE_API_KEY และ GOOGLE_CLIENT_ID บน server');
    }
    await ensureGoogle();
    const accessToken = await getToken(config.googleClientId);
    return new Promise((resolve, reject) => {
      const view = new google.picker.DocsView(google.picker.ViewId.DOCS)
        .setIncludeFolders(false)
        .setSelectFolderEnabled(false)
        .setMimeTypes('video/mp4,video/quicktime,video/webm,image/png,image/jpeg,image/webp,audio/mpeg,audio/mp4,audio/wav');

      const picker = new google.picker.PickerBuilder()
        .setDeveloperKey(config.googleApiKey)
        .setOAuthToken(accessToken)
        .setTitle('เลือกไฟล์สำหรับ Sowwan Studio')
        .addView(view)
        .enableFeature(google.picker.Feature.NAV_HIDDEN)
        .setCallback((data) => {
          if (data.action === google.picker.Action.PICKED) {
            const doc = data.docs && data.docs[0];
            resolve({
              accessToken,
              file: {
                fileId: doc.id,
                name: doc.name,
                mimeType: doc.mimeType,
                thumbnail: doc.thumbnails && doc.thumbnails[0] && doc.thumbnails[0].url
              }
            });
          } else if (data.action === google.picker.Action.CANCEL) {
            reject(new Error('ยกเลิกการเลือกไฟล์'));
          }
        });
      if (config.googleAppId) picker.setAppId(config.googleAppId);
      picker.build().setVisible(true);
    });
  }

  window.SowwanDrivePicker = { pick, connect };
})();
