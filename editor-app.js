(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const state = {
    config: {},
    user: null,
    project: null,
    selectedAssetId: null,
    selectedClipId: null,
    activeTool: 'select',
    currentTime: 0,
    playing: false,
    raf: 0,
    lastTick: 0,
    pixelPerSecond: 90,
    dirty: false,
    autosaveTimer: 0,
    previewEls: new Map(),
    drag: null,
    proTab: 'transform',
    driveAccessToken: '',
    previewScale: 1
  };

  const els = {
    authScreen: $('#auth-screen'), authForm: $('#auth-form'), authName: $('#auth-name'), authEmail: $('#auth-email'), authPassword: $('#auth-password'), authError: $('#auth-error'), authSubmit: $('#auth-submit'), tabLogin: $('#tab-login'), tabRegister: $('#tab-register'),
    app: $('#app'), saveStatus: $('#save-status'), fileInput: $('#file-input'), btnDrive: $('#btn-drive'), btnExport: $('#btn-export'), btnLogout: $('#btn-logout'), btnNewProject: $('#btn-new-project'), previewQuality: $('#preview-quality'),
    assetList: $('#asset-list'), assetCount: $('#asset-count'), btnAddSelectedAsset: $('#btn-add-selected-asset'),
    previewStage: $('#preview-stage'), previewBg: $('#preview-bg'), previewLayers: $('#preview-layers'), previewEmpty: $('#preview-empty'), timeReadout: $('#time-readout'), btnPlay: $('#btn-play'), btnBack: $('#btn-back'), btnForward: $('#btn-forward'), btnPrevFrame: $('#btn-prev-frame'), btnNextFrame: $('#btn-next-frame'), btnFit: $('#btn-fit'), btnEditSelected: $('#btn-edit-selected'),
    trackLabels: $('#track-labels'), timelineScroll: $('#timeline-scroll'), timelineCanvas: $('#timeline-canvas'), trackRows: $('#track-rows'), ruler: $('#ruler'), playhead: $('#playhead'), zoom: $('#timeline-zoom'), duration: $('#project-duration'),
    btnSplit: $('#btn-split'), btnDelete: $('#btn-delete'), btnDuplicate: $('#btn-duplicate'), toolRazor: $('#tool-razor'), toolText: $('#tool-text'), toolAddVideoTrack: $('#tool-add-video-track'), toolAddAudioTrack: $('#tool-add-audio-track'), toolSettings: $('#tool-settings'),
    quickInspector: $('#quick-inspector-body'), selectedName: $('#selected-name'), btnOpenPro: $('#btn-open-pro-editor'),
    proModal: $('#pro-editor'), btnClosePro: $('#btn-close-pro'), proTitle: $('#pro-title'), proStage: $('#pro-preview-stage'), proBox: $('#pro-box'), proBoxContent: $('#pro-box-content'), proTabContent: $('#pro-tab-content'), btnResetClip: $('#btn-reset-clip'), btnAddKeyframe: $('#btn-add-keyframe'),
    settingsModal: $('#settings-modal'), btnCloseSettings: $('#btn-close-settings'), setName: $('#set-name'), setFps: $('#set-fps'), setAspect: $('#set-aspect'), setBg: $('#set-bg'),
    exportModal: $('#export-modal'), btnCloseExport: $('#btn-close-export'), btnExportFree: $('#btn-export-free'), btnExport720: $('#btn-export-720'), btnExport1080: $('#btn-export-1080'), exportCreditLine: $('#export-credit-line'),
    toast: $('#toast')
  };

  function toast(message, ms = 3200) {
    els.toast.textContent = message;
    els.toast.classList.remove('hidden');
    clearTimeout(els.toast._t);
    els.toast._t = setTimeout(() => els.toast.classList.add('hidden'), ms);
  }

  function setSaveStatus(text, cls = '') {
    els.saveStatus.textContent = text;
    els.saveStatus.className = 'save-status ' + cls;
  }

  async function api(path, options = {}) {
    const res = await fetch(path, {
      credentials: 'same-origin',
      headers: options.body instanceof FormData ? undefined : { 'content-type': 'application/json', ...(options.headers || {}) },
      ...options
    });
    const contentType = res.headers.get('content-type') || '';
    const data = contentType.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || data || 'Request failed');
    return data;
  }

  function secToTimecode(sec) {
    const fps = fpsValue();
    sec = Math.max(0, Number(sec) || 0);
    const totalFrames = Math.round(sec * fps);
    const f = totalFrames % fps;
    const totalSec = Math.floor(totalFrames / fps);
    const s = totalSec % 60;
    const m = Math.floor(totalSec / 60) % 60;
    const h = Math.floor(totalSec / 3600);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}:${String(f).padStart(2, '0')}`;
  }

  function fpsValue() { return Number(state.project?.settings?.fps || 30); }
  function frameSnap(t) { return Math.round(t * fpsValue()) / fpsValue(); }
  function projectDuration() { return Math.max(5, ...state.project.clips.map(c => (Number(c.start) || 0) + (Number(c.duration) || 0))) + 2; }
  function assetById(id) { return state.project.assets.find(a => a.id === id); }
  function clipById(id) { return state.project.clips.find(c => c.id === id); }
  function trackById(id) { return state.project.tracks.find(t => t.id === id); }
  function selectedClip() { return clipById(state.selectedClipId); }
  function selectedAsset() { return assetById(state.selectedAssetId); }
  function uid(prefix) { return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(16).slice(2, 8)}`; }
  function clamp(n, min, max) { n = Number(n); return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : min; }

  function canvasSize() {
    const aspect = state.project?.settings?.aspect || '16:9';
    if (aspect === '9:16') return { w: 720, h: 1280 };
    if (aspect === '1:1') return { w: 1080, h: 1080 };
    if (aspect === '4:5') return { w: 1080, h: 1350 };
    if (aspect === '21:9') return { w: 1920, h: 822 };
    return { w: 1280, h: 720 };
  }

  function applyProjectSettings() {
    const size = canvasSize();
    state.project.settings.width = size.w;
    state.project.settings.height = size.h;
    els.previewStage.style.aspectRatio = `${size.w}/${size.h}`;
    els.proStage.style.aspectRatio = `${size.w}/${size.h}`;
    els.previewBg.style.background = state.project.settings.backgroundColor || '#05070A';
    els.previewQuality.value = state.project.settings.previewQuality || 'auto';
  }

  function markDirty(reason = 'แก้ไขแล้ว') {
    if (!state.project) return;
    state.dirty = true;
    state.project.updatedAt = new Date().toISOString();
    setSaveStatus(`${reason} • กำลัง autosave...`, 'warn');
    localStorage.setItem('sowwan:lastDraft', JSON.stringify(state.project));
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(autosave, 850);
  }

  async function autosave() {
    if (!state.project || !state.dirty) return;
    try {
      const id = state.project.id;
      const data = await api(`/api/projects/${encodeURIComponent(id)}/autosave`, { method: 'POST', body: JSON.stringify({ project: state.project }) });
      state.project.autosavedAt = data.autosavedAt;
      state.dirty = false;
      setSaveStatus(`บันทึกอัตโนมัติแล้ว ${new Date().toLocaleTimeString('th-TH')}`, 'good');
    } catch (err) {
      setSaveStatus('Autosave ไม่สำเร็จ แต่เก็บ draft ในเครื่องแล้ว', 'bad');
      console.error(err);
    }
  }

  function renderAll() {
    if (!state.project) return;
    applyProjectSettings();
    renderAssets();
    renderTimeline();
    renderPreview();
    renderQuickInspector();
    updateTransport();
  }

  function renderAssets() {
    els.assetCount.textContent = `${state.project.assets.length} assets`;
    els.assetList.innerHTML = '';
    for (const asset of state.project.assets) {
      const card = document.createElement('div');
      card.className = 'asset-card' + (state.selectedAssetId === asset.id ? ' selected' : '');
      card.dataset.assetId = asset.id;
      const thumb = document.createElement('div');
      thumb.className = 'asset-thumb';
      if (asset.thumbnail) thumb.innerHTML = `<img src="${asset.thumbnail}" alt="">`;
      else if (asset.type === 'image' && asset.url) thumb.innerHTML = `<img src="${asset.url}" alt="">`;
      else thumb.textContent = asset.type === 'video' ? 'VIDEO' : asset.type === 'audio' ? 'AUDIO' : asset.type.toUpperCase();
      const meta = document.createElement('div');
      meta.className = 'asset-meta';
      meta.innerHTML = `<div class="asset-name">${escapeHtml(asset.name || 'asset')}</div><div class="asset-type">${asset.source || ''} • ${asset.type || ''}</div>`;
      card.append(thumb, meta);
      card.addEventListener('click', () => { state.selectedAssetId = asset.id; renderAssets(); });
      card.addEventListener('dblclick', () => addAssetToTimeline(asset));
      els.assetList.appendChild(card);
    }
  }

  function escapeHtml(str) {
    return String(str ?? '').replace(/[&<>'"]/g, s => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[s]));
  }

  function formatShort(sec) {
    sec = Math.max(0, Math.round(sec || 0));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function renderTimeline() {
    const pps = state.pixelPerSecond;
    const dur = projectDuration();
    const width = Math.max(1600, Math.ceil(dur * pps + 400));
    els.timelineCanvas.style.width = `${width}px`;
    els.duration.textContent = formatShort(dur);

    els.ruler.innerHTML = '';
    const step = pps < 70 ? 2 : 1;
    for (let t = 0; t <= dur; t += step) {
      const mark = document.createElement('div');
      mark.className = 'ruler-mark';
      mark.style.left = `${t * pps + 4}px`;
      mark.textContent = `${t}s`;
      els.ruler.appendChild(mark);
    }

    els.trackLabels.innerHTML = '';
    els.trackRows.innerHTML = '';
    state.project.tracks.forEach(track => {
      const label = document.createElement('div');
      label.className = 'track-label';
      label.innerHTML = `<span>${track.label}</span><small>${track.type}</small>`;
      els.trackLabels.appendChild(label);

      const row = document.createElement('div');
      row.className = 'track-row';
      row.dataset.trackId = track.id;
      row.addEventListener('pointerdown', onTrackPointerDown);
      for (const clip of state.project.clips.filter(c => c.trackId === track.id)) {
        row.appendChild(renderClip(clip));
      }
      els.trackRows.appendChild(row);
    });
    updatePlayhead();
  }

  function renderClip(clip) {
    const div = document.createElement('div');
    div.className = `clip ${clip.type}${clip.id === state.selectedClipId ? ' selected' : ''}`;
    div.dataset.clipId = clip.id;
    div.style.left = `${clip.start * state.pixelPerSecond}px`;
    div.style.width = `${Math.max(22, clip.duration * state.pixelPerSecond)}px`;
    div.innerHTML = `<span class="trim left" data-trim="left"></span><span class="clip-title">${escapeHtml(clipLabel(clip))}</span><span class="trim right" data-trim="right"></span>`;
    div.addEventListener('pointerdown', onClipPointerDown);
    div.addEventListener('dblclick', (e) => { e.preventDefault(); selectClip(clip.id); openProEditor(); });
    return div;
  }

  function clipLabel(clip) {
    if (clip.type === 'text') return clip.text || 'ข้อความ';
    const asset = assetById(clip.assetId);
    return asset?.name || clip.type;
  }

  function selectClip(id) {
    state.selectedClipId = id;
    state.project.lastOpenClipId = id;
    renderTimeline();
    renderPreview();
    renderQuickInspector();
  }

  function timelineTimeFromClientX(clientX) {
    const rect = els.timelineCanvas.getBoundingClientRect();
    return clamp((clientX - rect.left) / state.pixelPerSecond, 0, projectDuration());
  }

  function onTrackPointerDown(e) {
    if (e.target !== e.currentTarget) return;
    setCurrentTime(frameSnap(timelineTimeFromClientX(e.clientX)));
  }

  function onClipPointerDown(e) {
    const clipEl = e.currentTarget;
    const clip = clipById(clipEl.dataset.clipId);
    if (!clip) return;
    e.stopPropagation();
    if (state.activeTool === 'razor') {
      splitClipAt(clip, frameSnap(timelineTimeFromClientX(e.clientX)));
      return;
    }
    selectClip(clip.id);
    const trim = e.target.dataset.trim;
    const pointerId = e.pointerId;
    clipEl.setPointerCapture(pointerId);
    state.drag = {
      mode: trim ? `trim-${trim}` : 'move-clip',
      pointerId,
      clipId: clip.id,
      startX: e.clientX,
      origStart: clip.start,
      origDuration: clip.duration
    };
    clipEl.addEventListener('pointermove', onTimelinePointerMove);
    clipEl.addEventListener('pointerup', onTimelinePointerUp, { once: true });
    clipEl.addEventListener('pointercancel', onTimelinePointerUp, { once: true });
  }

  function onTimelinePointerMove(e) {
    const d = state.drag;
    if (!d || d.pointerId !== e.pointerId) return;
    const clip = clipById(d.clipId);
    if (!clip) return;
    const dt = (e.clientX - d.startX) / state.pixelPerSecond;
    if (d.mode === 'move-clip') {
      clip.start = Math.max(0, frameSnap(d.origStart + dt));
    } else if (d.mode === 'trim-right') {
      clip.duration = Math.max(1 / fpsValue(), frameSnap(d.origDuration + dt));
    } else if (d.mode === 'trim-left') {
      const newStart = Math.max(0, frameSnap(d.origStart + dt));
      const end = d.origStart + d.origDuration;
      clip.start = Math.min(newStart, end - 1 / fpsValue());
      clip.duration = Math.max(1 / fpsValue(), end - clip.start);
      clip.mediaStart = Math.max(0, Number(clip.mediaStart || 0) + (clip.start - d.origStart));
    }
    renderTimeline();
    renderPreview();
  }

  function onTimelinePointerUp() {
    if (!state.drag) return;
    state.drag = null;
    markDirty('Timeline');
  }

  function updatePlayhead() {
    els.playhead.style.left = `${state.currentTime * state.pixelPerSecond}px`;
    els.timeReadout.textContent = secToTimecode(state.currentTime);
    const x = state.currentTime * state.pixelPerSecond;
    const visibleLeft = els.timelineScroll.scrollLeft;
    const visibleRight = visibleLeft + els.timelineScroll.clientWidth;
    if (state.playing && (x < visibleLeft + 60 || x > visibleRight - 80)) els.timelineScroll.scrollLeft = Math.max(0, x - 160);
  }

  function setCurrentTime(t) {
    state.currentTime = clamp(frameSnap(t), 0, projectDuration());
    updatePlayhead();
    renderPreview();
    syncPreviewMedia(false);
  }

  function updateTransport() {
    els.btnPlay.textContent = state.playing ? '❚❚' : '▶';
    els.btnPlay.classList.toggle('playing', state.playing);
  }

  function play() {
    if (state.playing) return pause();
    state.playing = true;
    state.lastTick = performance.now();
    updateTransport();
    syncPreviewMedia(true);
    state.raf = requestAnimationFrame(tick);
  }

  function pause() {
    state.playing = false;
    cancelAnimationFrame(state.raf);
    for (const record of state.previewEls.values()) if (record.video) record.video.pause();
    updateTransport();
  }

  function tick(now) {
    if (!state.playing) return;
    const delta = Math.min(0.08, (now - state.lastTick) / 1000);
    state.lastTick = now;
    state.currentTime += delta;
    if (state.currentTime > projectDuration()) { state.currentTime = projectDuration(); pause(); }
    updatePlayhead();
    renderPreview(true);
    syncPreviewMedia(true);
    state.raf = requestAnimationFrame(tick);
  }

  function clipVisibleAt(clip, time) {
    return time >= Number(clip.start || 0) && time <= Number(clip.start || 0) + Number(clip.duration || 0);
  }

  function previewQualityForAsset(asset) {
    let q = els.previewQuality.value || state.project.settings.previewQuality || 'auto';
    if (q === 'auto') {
      const small = window.innerWidth < 900 || /iPad|iPhone|Android/i.test(navigator.userAgent);
      q = small ? '240p' : '360p';
    }
    if (q !== 'original' && asset.proxies && asset.proxies[q]) return asset.proxies[q].url;
    if (q !== 'original' && asset.proxies && asset.proxies['360p']) return asset.proxies['360p'].url;
    if (q !== 'original' && asset.proxies && asset.proxies['240p']) return asset.proxies['240p'].url;
    if (asset.source === 'upload') return asset.url;
    return asset.thumbnail || '';
  }

  function renderPreview(light = false) {
    const time = state.currentTime;
    const visible = state.project.clips.filter(c => clipVisibleAt(c, time) && !trackById(c.trackId)?.hidden);
    const visibleIds = new Set(visible.map(c => c.id));
    for (const [id, rec] of state.previewEls.entries()) {
      if (!visibleIds.has(id)) { rec.el.remove(); state.previewEls.delete(id); }
    }

    els.previewEmpty.style.display = visible.length ? 'none' : 'grid';
    const size = canvasSize();
    const rect = els.previewStage.getBoundingClientRect();
    const sx = rect.width / size.w;
    const sy = rect.height / size.h;
    state.previewScale = sx;

    for (const clip of visible) {
      let rec = state.previewEls.get(clip.id);
      if (!rec) {
        rec = createPreviewLayer(clip);
        state.previewEls.set(clip.id, rec);
        els.previewLayers.appendChild(rec.el);
      }
      updatePreviewLayer(rec, clip, sx, sy, light);
    }
  }

  function createPreviewLayer(clip) {
    const el = document.createElement('div');
    el.className = `preview-layer ${clip.type}`;
    el.dataset.clipId = clip.id;
    el.addEventListener('pointerdown', onPreviewPointerDown);
    el.addEventListener('dblclick', () => { selectClip(clip.id); openProEditor(); });
    const rec = { el, video: null, clipId: clip.id, lastMediaTime: -999, lastSrc: '' };
    if (clip.type === 'video') {
      const video = document.createElement('video');
      video.playsInline = true;
      video.muted = true;
      video.preload = 'metadata';
      video.disablePictureInPicture = true;
      el.appendChild(video);
      rec.video = video;
    } else if (clip.type === 'image') {
      el.appendChild(document.createElement('img'));
    }
    return rec;
  }

  function updatePreviewLayer(rec, clip, sx, sy, light) {
    rec.el.className = `preview-layer ${clip.type}${clip.id === state.selectedClipId ? ' selected' : ''}`;
    const x = Number(clip.x || 0) * sx;
    const y = Number(clip.y || 0) * sy;
    const scale = Number(clip.scale || 1);
    const rot = Number(clip.rotation || 0);
    const opacity = previewOpacity(clip, state.currentTime);
    rec.el.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale}) rotate(${rot}deg)`;
    rec.el.style.opacity = opacity;

    if (clip.type === 'text') {
      const fontSize = Math.max(8, Number(clip.fontSize || 48) * sx);
      rec.el.textContent = clip.text || 'ข้อความ';
      rec.el.style.fontFamily = clip.fontFamily || 'Kanit';
      rec.el.style.fontSize = `${fontSize}px`;
      rec.el.style.color = clip.color || '#fff';
      rec.el.style.fontWeight = clip.bold ? '800' : '600';
      rec.el.style.fontStyle = clip.italic ? 'italic' : 'normal';
      rec.el.style.webkitTextStroke = `${(clip.strokeWidth || 0) * sx}px ${clip.strokeColor || '#000'}`;
      rec.el.style.textShadow = clip.shadow ? `0 ${2 * sx}px ${clip.shadow * sx}px rgba(0,0,0,.9)` : 'none';
    } else {
      const asset = assetById(clip.assetId);
      if (!asset) return;
      const aw = asset.width || 1280;
      const ah = asset.height || 720;
      const w = Math.max(40, aw * sx);
      const h = Math.max(40, ah * sy);
      rec.el.style.width = `${w}px`;
      rec.el.style.height = `${h}px`;
      if (clip.type === 'image') {
        const img = rec.el.querySelector('img');
        if (img.src !== location.origin + asset.url && asset.url) img.src = asset.url;
        img.style.width = '100%'; img.style.height = '100%'; img.style.objectFit = 'contain';
      } else if (clip.type === 'video') {
        const src = previewQualityForAsset(asset);
        if (src && rec.lastSrc !== src) { rec.video.src = src; rec.lastSrc = src; rec.lastMediaTime = -999; }
        rec.video.style.width = '100%'; rec.video.style.height = '100%'; rec.video.style.objectFit = 'contain';
        rec.video.style.filter = cssFilter(clip);
      }
    }
  }

  function previewOpacity(clip, time) {
    let opacity = clamp(clip.opacity == null ? 1 : clip.opacity, 0, 1);
    const start = Number(clip.start || 0), end = start + Number(clip.duration || 0);
    const fade = Math.min(.35, Math.max(.01, Number(clip.duration || 1) / 3));
    if (clip.transitionIn && clip.transitionIn !== 'none' && time < start + fade) opacity *= clamp((time - start) / fade, 0, 1);
    if (clip.transitionOut && clip.transitionOut !== 'none' && time > end - fade) opacity *= clamp((end - time) / fade, 0, 1);
    return opacity;
  }

  function cssFilter(clip) {
    return `brightness(${100 + Number(clip.brightness || 0)}%) contrast(${100 + Number(clip.contrast || 0)}%) saturate(${100 + Number(clip.saturation || 0)}%)`;
  }

  function syncPreviewMedia(playNow) {
    for (const rec of state.previewEls.values()) {
      if (!rec.video) continue;
      const clip = clipById(rec.clipId);
      if (!clip) continue;
      const target = Math.max(0, Number(clip.mediaStart || 0) + (state.currentTime - Number(clip.start || 0)));
      if (Math.abs((rec.video.currentTime || 0) - target) > (playNow ? 0.25 : 0.04)) {
        try { rec.video.currentTime = target; } catch (_) {}
      }
      rec.lastMediaTime = target;
      if (playNow) rec.video.play().catch(() => {});
      else rec.video.pause();
    }
  }

  function onPreviewPointerDown(e) {
    const id = e.currentTarget.dataset.clipId;
    const clip = clipById(id);
    if (!clip || clip.type === 'audio') return;
    selectClip(id);
    e.currentTarget.setPointerCapture(e.pointerId);
    state.drag = { mode: 'preview-move', pointerId: e.pointerId, clipId: id, startX: e.clientX, startY: e.clientY, origX: Number(clip.x || 0), origY: Number(clip.y || 0) };
    e.currentTarget.addEventListener('pointermove', onPreviewPointerMove);
    e.currentTarget.addEventListener('pointerup', onPreviewPointerUp, { once: true });
    e.currentTarget.addEventListener('pointercancel', onPreviewPointerUp, { once: true });
  }

  function onPreviewPointerMove(e) {
    const d = state.drag;
    if (!d || d.mode !== 'preview-move' || d.pointerId !== e.pointerId) return;
    const clip = clipById(d.clipId);
    if (!clip) return;
    const size = canvasSize();
    const rect = els.previewStage.getBoundingClientRect();
    clip.x = d.origX + (e.clientX - d.startX) * (size.w / rect.width);
    clip.y = d.origY + (e.clientY - d.startY) * (size.h / rect.height);
    renderPreview();
    renderQuickInspector();
  }

  function onPreviewPointerUp() {
    if (state.drag && state.drag.mode === 'preview-move') markDirty('ตำแหน่งเลเยอร์');
    state.drag = null;
  }

  function splitClipAt(clip, time) {
    const start = Number(clip.start || 0);
    const end = start + Number(clip.duration || 0);
    if (time <= start + 1 / fpsValue() || time >= end - 1 / fpsValue()) { toast('หัวอ่านต้องอยู่กลางคลิปก่อนตัด'); return; }
    const leftDur = time - start;
    const rightDur = end - time;
    const newClip = JSON.parse(JSON.stringify(clip));
    newClip.id = uid('clip');
    newClip.start = time;
    newClip.duration = rightDur;
    newClip.mediaStart = Number(clip.mediaStart || 0) + leftDur;
    clip.duration = leftDur;
    state.project.clips.push(newClip);
    state.selectedClipId = newClip.id;
    renderAll();
    markDirty('ตัดคลิปด้วยกรรไกร');
  }

  function splitSelected() {
    const clip = selectedClip();
    if (!clip) return toast('เลือกคลิปก่อนตัด');
    splitClipAt(clip, state.currentTime);
  }

  function deleteSelected() {
    if (!state.selectedClipId) return;
    state.project.clips = state.project.clips.filter(c => c.id !== state.selectedClipId);
    state.selectedClipId = null;
    renderAll();
    markDirty('ลบคลิป');
  }

  function duplicateSelected() {
    const clip = selectedClip();
    if (!clip) return;
    const copy = JSON.parse(JSON.stringify(clip));
    copy.id = uid('clip');
    copy.start = clip.start + Math.max(.5, Math.min(2, clip.duration / 2));
    state.project.clips.push(copy);
    selectClip(copy.id);
    markDirty('Duplicate');
  }

  function firstTrack(type) {
    let t = state.project.tracks.find(t => t.type === type);
    if (!t) t = addTrack(type, false);
    return t;
  }

  function fitScaleForAsset(asset) {
    if (!asset || asset.type === 'audio') return 1;
    const size = canvasSize();
    const aw = asset.width || (asset.type === 'image' ? size.w : 1280);
    const ah = asset.height || (asset.type === 'image' ? size.h : 720);
    return Math.min(size.w / aw, size.h / ah, 1);
  }

  function addAssetToTimeline(asset = selectedAsset()) {
    if (!asset) return toast('เลือก asset ก่อน');
    const track = firstTrack(asset.type === 'audio' ? 'audio' : asset.type === 'image' ? 'image' : 'video');
    const duration = Math.max(1, Math.min(asset.duration || 5, 60));
    const clip = {
      id: uid('clip'), type: asset.type, assetId: asset.id, trackId: track.id,
      start: state.currentTime, duration, mediaStart: 0, x: 0, y: 0, scale: fitScaleForAsset(asset), rotation: 0, opacity: 1, volume: 1,
      brightness: 0, contrast: 0, saturation: 0, transitionIn: 'none', transitionOut: 'none', useAudio: asset.type === 'video' && asset.hasAudio === true,
      chroma: { enabled: false, color: '#00ff00', tolerance: .25, blend: .08 }, mask: { type: 'none' }, keyframes: []
    };
    state.project.clips.push(clip);
    selectClip(clip.id);
    markDirty('เพิ่มคลิป');
  }

  function addTextClip() {
    const track = firstTrack('text');
    const clip = {
      id: uid('clip'), type: 'text', trackId: track.id,
      start: state.currentTime, duration: 4, text: 'ข้อความใหม่', x: 0, y: 0, scale: 1, rotation: 0, opacity: 1,
      fontFamily: 'Kanit', fontSize: 58, color: '#ffffff', bold: true, italic: false, strokeColor: '#000000', strokeWidth: 2, shadow: 8,
      brightness: 0, contrast: 0, saturation: 0, transitionIn: 'fade', transitionOut: 'fade', preset: 'outline', keyframes: []
    };
    state.project.clips.push(clip);
    selectClip(clip.id);
    markDirty('เพิ่มข้อความ');
    openProEditor('text');
  }

  function addTrack(type, doRender = true) {
    const count = state.project.tracks.filter(t => t.type === type).length + 1;
    const prefix = type === 'audio' ? 'A' : type === 'text' ? 'T' : type === 'image' ? 'I' : 'V';
    const track = { id: uid(`t_${type}`), type, label: `${prefix}${count}`, height: 58, locked: false, muted: false, hidden: false };
    if (type === 'text') state.project.tracks.unshift(track);
    else state.project.tracks.push(track);
    if (doRender) { renderTimeline(); markDirty('เพิ่มแทร็ก'); }
    return track;
  }

  function renderQuickInspector() {
    const clip = selectedClip();
    els.selectedName.textContent = clip ? clipLabel(clip) : 'ยังไม่ได้เลือกคลิป';
    if (!clip) { els.quickInspector.innerHTML = '<div class="muted">เลือกคลิป หรือดับเบิ้ลคลิกเลเยอร์เพื่อแก้ไขแบบ Pro</div>'; return; }
    els.quickInspector.innerHTML = inspectorHtml(clip, false);
    bindInspectorInputs(els.quickInspector, clip);
  }

  function inputRow(label, prop, value, type = 'number', attrs = '') {
    return `<label>${label}<input data-prop="${prop}" type="${type}" value="${escapeHtml(value ?? '')}" ${attrs}></label>`;
  }

  function selectRow(label, prop, value, options) {
    return `<label>${label}<select data-prop="${prop}">${options.map(o => `<option value="${o}" ${o === value ? 'selected' : ''}>${o}</option>`).join('')}</select></label>`;
  }

  function inspectorHtml(clip, pro) {
    const common = `
      <div class="field"><h3>Timing</h3><div class="grid2">
        ${inputRow('Start', 'start', Number(clip.start || 0).toFixed(2), 'number', 'step="0.01"')}
        ${inputRow('Duration', 'duration', Number(clip.duration || 1).toFixed(2), 'number', 'step="0.01" min="0.03"')}
      </div></div>
      <div class="field"><h3>Transform</h3><div class="grid2">
        ${inputRow('X', 'x', Math.round(clip.x || 0), 'number')}
        ${inputRow('Y', 'y', Math.round(clip.y || 0), 'number')}
        ${inputRow('Scale', 'scale', clip.scale ?? 1, 'number', 'step="0.01" min="0.01"')}
        ${inputRow('Rotation', 'rotation', clip.rotation ?? 0, 'number', 'step="1"')}
      </div>
      <label>Opacity <input data-prop="opacity" type="range" min="0" max="1" step="0.01" value="${clip.opacity ?? 1}"></label></div>
      <div class="field"><h3>Transition</h3><div class="grid2">
        ${selectRow('In', 'transitionIn', clip.transitionIn || 'none', ['none','fade','cross-dissolve','slide-left','zoom'])}
        ${selectRow('Out', 'transitionOut', clip.transitionOut || 'none', ['none','fade','cross-dissolve','slide-right','zoom'])}
      </div></div>`;
    const text = clip.type === 'text' ? `
      <div class="field"><h3>Text Engine</h3>
        <label>ข้อความ<textarea data-prop="text">${escapeHtml(clip.text || '')}</textarea></label>
        <div class="grid2">
          ${selectRow('Font', 'fontFamily', clip.fontFamily || 'Kanit', ['Kanit','Prompt','Anuphan','Arial','serif','monospace'])}
          ${inputRow('Size', 'fontSize', clip.fontSize || 48, 'number')}
          ${inputRow('Color', 'color', clip.color || '#ffffff', 'color')}
          ${inputRow('Stroke', 'strokeColor', clip.strokeColor || '#000000', 'color')}
          ${inputRow('Stroke W', 'strokeWidth', clip.strokeWidth || 0, 'number')}
          ${inputRow('Shadow', 'shadow', clip.shadow || 0, 'number')}
        </div>
        <div class="row"><label><input data-prop="bold" type="checkbox" ${clip.bold ? 'checked' : ''}> Bold</label><label><input data-prop="italic" type="checkbox" ${clip.italic ? 'checked' : ''}> Italic</label></div>
        <div class="preset-row"><button class="preset" data-preset="neon">Neon</button><button class="preset" data-preset="outline">Outline</button><button class="preset" data-preset="pop">Pop Art</button></div>
      </div>` : '';
    const media = clip.type !== 'text' ? `
      <div class="field"><h3>Media</h3><div class="grid2">
        ${inputRow('Media Start', 'mediaStart', clip.mediaStart || 0, 'number', 'step="0.01"')}
        ${inputRow('Volume', 'volume', clip.volume ?? 1, 'number', 'step="0.01" min="0"')}
      </div><label><input data-prop="useAudio" type="checkbox" ${clip.useAudio ? 'checked' : ''}> ใช้เสียงจากวิดีโอ</label></div>` : '';
    const fx = `
      <div class="field"><h3>Color / FX</h3>
        <label>Brightness <input data-prop="brightness" type="range" min="-100" max="100" value="${clip.brightness || 0}"></label>
        <label>Contrast <input data-prop="contrast" type="range" min="-100" max="100" value="${clip.contrast || 0}"></label>
        <label>Saturation <input data-prop="saturation" type="range" min="-100" max="100" value="${clip.saturation || 0}"></label>
      </div>`;
    const chroma = clip.type === 'video' ? `
      <div class="field"><h3>Chroma Key</h3>
        <label><input data-nested="chroma.enabled" type="checkbox" ${clip.chroma?.enabled ? 'checked' : ''}> เปิดเจาะพื้นหลัง</label>
        <div class="grid2">
          ${nestedInput('Color', 'chroma.color', clip.chroma?.color || '#00ff00', 'color')}
          ${nestedInput('Tolerance', 'chroma.tolerance', clip.chroma?.tolerance ?? .25, 'number', 'step="0.01" min="0" max="1"')}
          ${nestedInput('Blend', 'chroma.blend', clip.chroma?.blend ?? .08, 'number', 'step="0.01" min="0" max="1"')}
        </div>
      </div>` : '';
    const mask = pro ? `<div class="field"><h3>Masking / Keyframe</h3>${selectRow('Mask', 'maskType', clip.mask?.type || 'none', ['none','rectangle','ellipse','free-pen'])}<button id="inline-keyframe" class="mini-btn">ล็อค Keyframe ตำแหน่งนี้</button><div class="muted">Keyframes: ${(clip.keyframes || []).length}</div></div>` : '';
    return common + media + text + fx + chroma + mask;
  }

  function nestedInput(label, prop, value, type, attrs = '') {
    return `<label>${label}<input data-nested="${prop}" type="${type}" value="${escapeHtml(value)}" ${attrs}></label>`;
  }

  function bindInspectorInputs(root, clip) {
    root.oninput = (e) => handleInspectorInput(e, clip);
    root.onchange = (e) => handleInspectorInput(e, clip);
    root.onclick = (e) => {
      const preset = e.target.dataset.preset;
      if (preset) { e.preventDefault(); applyTextPreset(clip, preset); }
      if (e.target.id === 'inline-keyframe') { e.preventDefault(); addKeyframe(); }
    };
  }

  function handleInspectorInput(e, clip) {
    const el = e.target;
    if (!clip) return;
    if (el.dataset.prop) {
      const prop = el.dataset.prop;
      if (prop === 'maskType') { clip.mask = clip.mask || {}; clip.mask.type = el.value; }
      else if (el.type === 'checkbox') clip[prop] = el.checked;
      else if (el.type === 'number' || el.type === 'range') clip[prop] = Number(el.value);
      else clip[prop] = el.value;
    }
    if (el.dataset.nested) {
      const [obj, prop] = el.dataset.nested.split('.');
      clip[obj] = clip[obj] || {};
      clip[obj][prop] = el.type === 'checkbox' ? el.checked : (el.type === 'number' || el.type === 'range' ? Number(el.value) : el.value);
    }
    renderTimeline();
    renderPreview();
    updateProBox();
    markDirty('Inspector');
  }

  function applyTextPreset(clip, name) {
    if (name === 'neon') Object.assign(clip, { color: '#67e8f9', strokeColor: '#0e7490', strokeWidth: 1, shadow: 24, bold: true, preset: name });
    if (name === 'outline') Object.assign(clip, { color: '#ffffff', strokeColor: '#000000', strokeWidth: 4, shadow: 8, bold: true, preset: name });
    if (name === 'pop') Object.assign(clip, { color: '#fde047', strokeColor: '#ec4899', strokeWidth: 3, shadow: 14, bold: true, preset: name });
    renderAll();
    if (!els.proModal.classList.contains('hidden')) renderProTab();
    markDirty('Text preset');
  }

  function openProEditor(preferTab) {
    const clip = selectedClip();
    if (!clip) return toast('เลือกเลเยอร์ก่อน');
    state.proTab = preferTab || (clip.type === 'text' ? 'text' : 'transform');
    els.proModal.classList.remove('hidden');
    els.proTitle.textContent = `Layer Editor • ${clipLabel(clip)}`;
    renderProTabs();
    updateProBox();
  }

  function closeProEditor() { els.proModal.classList.add('hidden'); }

  function renderProTabs() {
    $$('.tab', els.proModal).forEach(btn => btn.classList.toggle('active', btn.dataset.tab === state.proTab));
    renderProTab();
  }

  function renderProTab() {
    const clip = selectedClip();
    if (!clip) return;
    if (state.proTab === 'transition') {
      els.proTabContent.innerHTML = `<div class="field"><h3>Transitions</h3><div class="grid2">${selectRow('เข้า', 'transitionIn', clip.transitionIn || 'none', ['none','fade','cross-dissolve','slide-left','zoom'])}${selectRow('ออก', 'transitionOut', clip.transitionOut || 'none', ['none','fade','cross-dissolve','slide-right','zoom'])}</div><p class="muted">fade/cross-dissolve จะถูกนำไปใช้ตอน export ด้วย FFmpeg ส่วน slide/zoom เก็บ recipe ไว้พร้อมสำหรับต่อยอดเอฟเฟกต์ขั้นสูง</p></div>`;
    } else {
      els.proTabContent.innerHTML = inspectorHtml(clip, true);
    }
    bindInspectorInputs(els.proTabContent, clip);
  }

  function updateProBox() {
    const clip = selectedClip();
    if (!clip || els.proModal.classList.contains('hidden')) return;
    const size = canvasSize();
    const rect = els.proStage.getBoundingClientRect();
    const sx = rect.width / size.w;
    const sy = rect.height / size.h;
    const x = (clip.x || 0) * sx;
    const y = (clip.y || 0) * sy;
    els.proBox.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${clip.scale || 1}) rotate(${clip.rotation || 0}deg)`;
    els.proBox.style.opacity = clip.opacity ?? 1;
    if (clip.type === 'text') {
      els.proBox.style.width = 'auto'; els.proBox.style.height = 'auto';
      els.proBoxContent.textContent = clip.text || 'ข้อความ';
      els.proBoxContent.style.fontFamily = clip.fontFamily || 'Kanit';
      els.proBoxContent.style.fontSize = `${Math.max(12, (clip.fontSize || 48) * sx)}px`;
      els.proBoxContent.style.color = clip.color || '#fff';
      els.proBoxContent.style.fontWeight = clip.bold ? '800' : '600';
      els.proBoxContent.style.webkitTextStroke = `${(clip.strokeWidth || 0) * sx}px ${clip.strokeColor || '#000'}`;
      els.proBoxContent.style.textShadow = clip.shadow ? `0 ${2 * sx}px ${clip.shadow * sx}px rgba(0,0,0,.9)` : 'none';
    } else {
      const asset = assetById(clip.assetId) || {};
      const aw = asset.width || 1280, ah = asset.height || 720;
      els.proBox.style.width = `${aw * sx}px`; els.proBox.style.height = `${ah * sy}px`;
      if (clip.type === 'image') els.proBoxContent.innerHTML = `<img src="${asset.url || asset.thumbnail || ''}" style="width:100%;height:100%;object-fit:contain">`;
      else if (clip.type === 'video') els.proBoxContent.innerHTML = `<video src="${previewQualityForAsset(asset)}" muted playsinline style="width:100%;height:100%;object-fit:contain;filter:${cssFilter(clip)}"></video>`;
      else els.proBoxContent.textContent = clip.type;
    }
  }

  function onProBoxDown(e) {
    if (e.target.classList.contains('handle')) return;
    const clip = selectedClip(); if (!clip) return;
    els.proBox.setPointerCapture(e.pointerId);
    state.drag = { mode: 'pro-move', pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origX: Number(clip.x || 0), origY: Number(clip.y || 0) };
    els.proBox.addEventListener('pointermove', onProBoxMove);
    els.proBox.addEventListener('pointerup', onProBoxUp, { once: true });
    els.proBox.addEventListener('pointercancel', onProBoxUp, { once: true });
  }

  function onProHandleDown(e) {
    const clip = selectedClip(); if (!clip) return;
    e.stopPropagation();
    e.target.setPointerCapture(e.pointerId);
    state.drag = { mode: 'pro-scale', pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, origScale: Number(clip.scale || 1) };
    e.target.addEventListener('pointermove', onProBoxMove);
    e.target.addEventListener('pointerup', onProBoxUp, { once: true });
    e.target.addEventListener('pointercancel', onProBoxUp, { once: true });
  }

  function onProBoxMove(e) {
    const d = state.drag; const clip = selectedClip(); if (!d || !clip || d.pointerId !== e.pointerId) return;
    if (d.mode === 'pro-move') {
      const size = canvasSize(); const rect = els.proStage.getBoundingClientRect();
      clip.x = d.origX + (e.clientX - d.startX) * (size.w / rect.width);
      clip.y = d.origY + (e.clientY - d.startY) * (size.h / rect.height);
    } else if (d.mode === 'pro-scale') {
      const delta = (e.clientX - d.startX + e.clientY - d.startY) / 260;
      clip.scale = clamp(d.origScale + delta, .05, 8);
    }
    updateProBox(); renderPreview(); renderQuickInspector();
  }

  function onProBoxUp() { if (state.drag) markDirty('Pro editor'); state.drag = null; renderTimeline(); if (!els.proModal.classList.contains('hidden')) renderProTab(); }

  function addKeyframe() {
    const clip = selectedClip(); if (!clip) return;
    clip.keyframes = clip.keyframes || [];
    clip.keyframes.push({ time: state.currentTime, x: clip.x || 0, y: clip.y || 0, scale: clip.scale || 1, rotation: clip.rotation || 0, opacity: clip.opacity ?? 1 });
    renderProTab(); markDirty('Keyframe'); toast('ล็อค keyframe แล้ว');
  }

  function resetClip() {
    const clip = selectedClip(); if (!clip) return;
    Object.assign(clip, { x: 0, y: 0, scale: clip.type === 'text' ? 1 : fitScaleForAsset(assetById(clip.assetId)), rotation: 0, opacity: 1, brightness: 0, contrast: 0, saturation: 0 });
    renderAll(); updateProBox(); renderProTab(); markDirty('Reset layer');
  }

  async function handleUpload(files) {
    if (!files || !files.length) return;
    const form = new FormData();
    for (const file of files) form.append('files', file);
    toast('กำลังอัปโหลดและสร้าง proxy preview...');
    try {
      const data = await api('/api/upload', { method: 'POST', body: form });
      state.project.assets.push(...data.assets);
      state.selectedAssetId = data.assets[0]?.id || state.selectedAssetId;
      renderAssets(); markDirty('Upload media'); toast('อัปโหลดเสร็จแล้ว');
    } catch (err) { toast(err.message, 5000); }
    els.fileInput.value = '';
  }

  async function importFromDrive() {
    try {
      const picked = await window.SowwanDrivePicker.pick(state.config);
      state.driveAccessToken = picked.accessToken;
      toast('กำลังนำเข้า Drive และสร้าง proxy...');
      const quality = els.previewQuality.value === 'original' || els.previewQuality.value === 'auto' ? '360p' : els.previewQuality.value;
      const data = await api('/api/drive/import', { method: 'POST', body: JSON.stringify({ ...picked.file, accessToken: picked.accessToken, quality, createProxy: true }) });
      state.project.assets.push(data.asset);
      state.selectedAssetId = data.asset.id;
      renderAssets(); markDirty('เพิ่มไฟล์จาก Drive'); toast('นำเข้าไฟล์จาก Google Drive แล้ว');
    } catch (err) { toast(err.message, 6000); }
  }

  async function ensureDriveTokenForExport() {
    const hasDrive = state.project.assets.some(a => a.source === 'google_drive');
    if (!hasDrive) return '';
    if (state.driveAccessToken) return state.driveAccessToken;
    if (window.SowwanDrivePicker.connect) {
      toast('โปรเจกต์มีไฟล์ Drive กรุณาอนุญาต Google Drive อีกครั้งเพื่อ export');
      state.driveAccessToken = await window.SowwanDrivePicker.connect(state.config);
      return state.driveAccessToken;
    }
    throw new Error('ต้องเชื่อมต่อ Google Drive ก่อน export');
  }

  async function showExportModal() {
    try {
      const dash = await api('/api/dashboard');
      if (els.exportCreditLine) els.exportCreditLine.textContent = `เครดิตคงเหลือ: ${dash.user.credits} · ฟรีได้ 480p พร้อมลายน้ำ · 1080p ช่วงทดลองใช้ 5 เครดิต`;
    } catch (_) {}
    els.exportModal.classList.remove('hidden');
  }

  function closeExportModal() { els.exportModal.classList.add('hidden'); }

  async function exportProject(outputPreset = '480p') {
    try {
      closeExportModal();
      await autosave();
      const driveAccessToken = await ensureDriveTokenForExport();
      els.btnExport.disabled = true;
      els.btnExport.textContent = 'Rendering...';
      const quoteData = await api('/api/render/quote', { method: 'POST', body: JSON.stringify({ quality: outputPreset, projectId: state.project.id, platformJobId: state.project.platformJobId || '' }) });
      if (!quoteData.quote.canRender) throw new Error(`เครดิตไม่พอ ต้องใช้ ${quoteData.quote.cost} เครดิต`);
      const data = await api('/api/render-jobs', { method: 'POST', body: JSON.stringify({ project: state.project, driveAccessToken, outputPreset, platformJobId: state.project.platformJobId || '' }) });
      const jobId = data.jobId;
      toast(`เริ่ม Render ${data.quote.label}`, 3600);
      const poll = setInterval(async () => {
        try {
          const { job } = await api(`/api/render-jobs/${encodeURIComponent(jobId)}`);
          setSaveStatus(`Render: ${job.status}`, job.status === 'error' ? 'bad' : 'warn');
          if (job.status === 'done') {
            clearInterval(poll); els.btnExport.disabled = false; els.btnExport.textContent = 'Export'; setSaveStatus('Render เสร็จแล้ว', 'good');
            toast('Export เสร็จแล้ว กำลังเปิดไฟล์ดาวน์โหลด', 4500);
            window.open(job.result.url, '_blank');
          } else if (job.status === 'error') {
            clearInterval(poll); els.btnExport.disabled = false; els.btnExport.textContent = 'Export'; toast('Render error: ' + job.error, 8000);
          }
        } catch (err) { clearInterval(poll); els.btnExport.disabled = false; els.btnExport.textContent = 'Export'; toast(err.message, 8000); }
      }, 1200);
    } catch (err) { els.btnExport.disabled = false; els.btnExport.textContent = 'Export'; toast(err.message, 8000); }
  }

  async function loadProject() {
    const data = await api('/api/projects/last');
    state.project = data.project;
    state.currentTime = 0;
    state.selectedClipId = state.project.lastOpenClipId || state.project.clips[0]?.id || null;
    state.pixelPerSecond = Number(els.zoom.value || 90);
    setSaveStatus('โหลดโปรเจกต์แล้ว', 'good');
    renderAll();
  }

  async function newProject() {
    const name = prompt('ชื่อโปรเจกต์ใหม่', 'Untitled Sowwan Project');
    if (!name) return;
    const data = await api('/api/projects', { method: 'POST', body: JSON.stringify({ name }) });
    state.project = data.project; state.currentTime = 0; state.selectedClipId = state.project.clips[0]?.id || null;
    renderAll(); markDirty('สร้างโปรเจกต์');
  }

  function openSettings() {
    els.setName.value = state.project.name || '';
    els.setFps.value = String(state.project.settings.fps || 30);
    els.setAspect.value = state.project.settings.aspect || '16:9';
    els.setBg.value = state.project.settings.backgroundColor || '#05070A';
    els.settingsModal.classList.remove('hidden');
  }

  function updateSettings() {
    state.project.name = els.setName.value || state.project.name;
    state.project.settings.fps = Number(els.setFps.value || 30);
    state.project.settings.aspect = els.setAspect.value;
    state.project.settings.backgroundColor = els.setBg.value;
    renderAll(); markDirty('Project settings');
  }

  function setTool(tool) {
    state.activeTool = tool;
    $$('.tool').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
    els.btnSplit.classList.toggle('active', tool === 'razor');
    toast(tool === 'razor' ? 'โหมดกรรไกร: แตะ/คลิกบนคลิปเพื่อแบ่งคลิป' : 'โหมดเลือก');
  }

  async function showApp(user) {
    state.user = user;
    els.authScreen.classList.add('hidden');
    els.app.classList.remove('hidden');
    await loadProject();
  }

  function showAuth() {
    els.app.classList.add('hidden');
    els.authScreen.classList.remove('hidden');
  }

  let authMode = 'login';
  function setAuthMode(mode) {
    authMode = mode;
    els.tabLogin.classList.toggle('active', mode === 'login');
    els.tabRegister.classList.toggle('active', mode === 'register');
    els.authName.parentElement.style.display = mode === 'register' ? 'grid' : 'none';
    els.authSubmit.textContent = mode === 'register' ? 'สมัครบัญชี' : 'เข้าสู่ระบบ';
  }


  function bindEvents() {
    setAuthMode('login');
    els.tabLogin.addEventListener('click', () => setAuthMode('login'));
    els.tabRegister.addEventListener('click', () => setAuthMode('register'));
    els.authForm.addEventListener('submit', async (e) => {
      e.preventDefault(); els.authError.textContent = '';
      try {
        const path = authMode === 'register' ? '/api/auth/register' : '/api/auth/login';
        const data = await api(path, { method: 'POST', body: JSON.stringify({ name: els.authName.value, email: els.authEmail.value, password: els.authPassword.value }) });
        await showApp(data.user);
      } catch (err) { els.authError.textContent = err.message; }
    });
    els.btnLogout.addEventListener('click', async () => { await api('/api/auth/logout', { method: 'POST', body: '{}' }); location.reload(); });
    els.fileInput.addEventListener('change', (e) => handleUpload(e.target.files));
    els.btnDrive.addEventListener('click', importFromDrive);
    els.btnExport.addEventListener('click', showExportModal);
    els.btnCloseExport?.addEventListener('click', closeExportModal);
    els.btnExportFree?.addEventListener('click', () => exportProject('480p'));
    els.btnExport720?.addEventListener('click', () => exportProject('720p'));
    els.btnExport1080?.addEventListener('click', () => exportProject('1080p'));
    els.btnNewProject.addEventListener('click', newProject);
    els.btnAddSelectedAsset.addEventListener('click', () => addAssetToTimeline());
    els.toolText.addEventListener('click', addTextClip);
    els.toolAddVideoTrack.addEventListener('click', () => addTrack('video'));
    els.toolAddAudioTrack.addEventListener('click', () => addTrack('audio'));
    els.toolRazor.addEventListener('click', () => setTool(state.activeTool === 'razor' ? 'select' : 'razor'));
    $$('.tool[data-tool="select"]').forEach(b => b.addEventListener('click', () => setTool('select')));
    els.btnSplit.addEventListener('click', splitSelected);
    els.btnDelete.addEventListener('click', deleteSelected);
    els.btnDuplicate.addEventListener('click', duplicateSelected);
    els.zoom.addEventListener('input', () => { state.pixelPerSecond = Number(els.zoom.value); renderTimeline(); });
    els.previewQuality.addEventListener('change', () => { state.project.settings.previewQuality = els.previewQuality.value; renderPreview(); syncPreviewMedia(false); markDirty('Preview quality'); });
    els.btnPlay.addEventListener('click', play);
    els.btnBack.addEventListener('click', () => setCurrentTime(state.currentTime - 1));
    els.btnForward.addEventListener('click', () => setCurrentTime(state.currentTime + 1));
    els.btnPrevFrame.addEventListener('click', () => setCurrentTime(state.currentTime - 1 / fpsValue()));
    els.btnNextFrame.addEventListener('click', () => setCurrentTime(state.currentTime + 1 / fpsValue()));
    els.btnFit.addEventListener('click', () => renderPreview());
    els.btnEditSelected.addEventListener('click', openProEditor);
    els.btnOpenPro.addEventListener('click', openProEditor);
    els.btnClosePro.addEventListener('click', closeProEditor);
    els.btnResetClip.addEventListener('click', resetClip);
    els.btnAddKeyframe.addEventListener('click', addKeyframe);
    els.proBox.addEventListener('pointerdown', onProBoxDown);
    $$('.handle', els.proBox).forEach(h => h.addEventListener('pointerdown', onProHandleDown));
    $$('.tab', els.proModal).forEach(btn => btn.addEventListener('click', () => { state.proTab = btn.dataset.tab; renderProTabs(); }));
    els.toolSettings.addEventListener('click', openSettings);
    els.btnCloseSettings.addEventListener('click', () => els.settingsModal.classList.add('hidden'));
    [els.setName, els.setFps, els.setAspect, els.setBg].forEach(el => el.addEventListener('input', updateSettings));
    document.addEventListener('keydown', (e) => {
      if (e.target.matches('input,textarea,select')) return;
      if (e.code === 'Space') { e.preventDefault(); play(); }
      if (e.key === 'Delete' || e.key === 'Backspace') deleteSelected();
      if (e.key.toLowerCase() === 's' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); autosave(); }
      if (e.key.toLowerCase() === 'b') splitSelected();
      if (e.key === 'ArrowLeft') setCurrentTime(state.currentTime - (e.shiftKey ? 1 : 1 / fpsValue()));
      if (e.key === 'ArrowRight') setCurrentTime(state.currentTime + (e.shiftKey ? 1 : 1 / fpsValue()));
    });
    window.addEventListener('resize', () => renderPreview());
    window.addEventListener('beforeunload', () => { if (state.project) localStorage.setItem('sowwan:lastDraft', JSON.stringify(state.project)); });
  }

  async function init() {
    bindEvents();
    try {
      state.config = await api('/api/config');
      const me = await api('/api/me');
      if (me.user) await showApp(me.user); else showAuth();
    } catch (err) {
      console.error(err); showAuth();
    }
  }

  init();
})();
