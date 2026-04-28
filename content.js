(function () {
	'use strict';

	const SPEEDS = [1, 1.5, 2, 3];
	const ROOT_ID = 'yts-speed-root';
	const INSTANCE_KEY = '__bmYtsToolboxInstance__';
	const VIDEO_HOOK_KEY = 'bmYtsToolboxHooked';
	const CONTROLLER_ATTR = 'data-bm-yts-controller';
	const SPEED_STORAGE_KEY = 'bmYtsToolboxSpeed';
	const VOLUME_HOTKEY_STORAGE_KEY = 'bmYtsArrowVolumeEnabled';
	const PANEL_EXPAND_RIGHT_STORAGE_KEY = 'bmYtsPanelExpandRight';
	const STORAGE_KEY_DEFAULT_SPEED_INDEX = 'bmYts3xOptsDefaultSpeedIndex';
	const STORAGE_KEY_HOLD_SPEED_INDEX = 'bmYts3xOptsHoldSpeedIndex';
	const w = window;
	document.documentElement.setAttribute(CONTROLLER_ATTR, 'toolbox');
	try {
		if (w[INSTANCE_KEY] && typeof w[INSTANCE_KEY].destroy === 'function') {
			w[INSTANCE_KEY].destroy();
		}
	} catch (_) {}

	function t(key) {
		try {
			const msg = chrome.i18n.getMessage(key);
			if (msg) return msg;
		} catch (_) {}
		return key;
	}

	let currentIndex = 0;
	let holdActive = false;
	let holdPointerId = null;
	let holdSpeedIndex = 2;

	function readSessionIndex() {
		try {
			const raw = sessionStorage.getItem(SPEED_STORAGE_KEY);
			if (raw === null || raw === '') return null;
			const value = Number(raw);
			if (!Number.isFinite(value)) return null;
			return Math.max(0, Math.min(SPEEDS.length - 1, Math.floor(value)));
		} catch (_) {
			return null;
		}
	}

	function clampSpeedIndex(i) {
		const n = Number(i);
		if (!Number.isFinite(n)) return 0;
		return Math.max(0, Math.min(SPEEDS.length - 1, Math.floor(n)));
	}

	function persistSpeedIndex() {
		try {
			sessionStorage.setItem(SPEED_STORAGE_KEY, String(currentIndex));
		} catch (_) {}
	}

	try {
		const sessInit = readSessionIndex();
		if (sessInit !== null) currentIndex = sessInit;
	} catch (_) {}

	let mountObserver = null;
	let videoObserver = null;
	let reapplyTimer = null;
	let bootstrapRetryTimer = null;
	let bootstrapRetryCount = 0;
	let mainTickInterval = null;
	let speedRootEl = null;
	let remixRowEl = null;
	let remixButtonEl = null;
	let btnLabel = null;
	let speedBtnEl = null;
	let speedLockIconEl = null;
	let recordingSession = null;
	let downloadBtnEl = null;
	let downloadPercentEl = null;
	let framePlayBtnEl = null;
	let manualRecordSession = null;
	let recordBtnEl = null;
	let runtimeMsgHandler = null;
	let bgRecordFallbackUsed = false;
	let suspendSpeedSync = false;
	const titleByShortId = new Map();
	let lastLayoutDiag = null;
	const FRAME_STEP_SECONDS = 1 / 30;
	let framePlaybackEnabled = false;
	let framePlaybackTimerId = null;
	let framePlaybackPrevMuted = false;
	let framePlaybackPrevSpeedIndex = 0;
	let framePlaybackPrevWasPaused = true;
	let leftRightVolumeEnabled = true;
	let panelExpandRightEnabled = true;

	function loadArrowVolumeSetting() {
		try {
			chrome.storage.local.get(
				{
					[VOLUME_HOTKEY_STORAGE_KEY]: true,
					[PANEL_EXPAND_RIGHT_STORAGE_KEY]: true,
					[STORAGE_KEY_DEFAULT_SPEED_INDEX]: 0,
					[STORAGE_KEY_HOLD_SPEED_INDEX]: 2,
				},
				(res) => {
					if (chrome.runtime.lastError) return;
					leftRightVolumeEnabled = res[VOLUME_HOTKEY_STORAGE_KEY] !== false;
					panelExpandRightEnabled = res[PANEL_EXPAND_RIGHT_STORAGE_KEY] !== false;
					holdSpeedIndex = clampSpeedIndex(res[STORAGE_KEY_HOLD_SPEED_INDEX]);
					const sess = readSessionIndex();
					if (sess !== null) {
						currentIndex = sess;
					} else {
						currentIndex = clampSpeedIndex(res[STORAGE_KEY_DEFAULT_SPEED_INDEX]);
						persistSpeedIndex();
					}
					if (speedRootEl instanceof HTMLElement && speedRootEl.isConnected) {
						speedRootEl.toggleAttribute('data-expand-up', !panelExpandRightEnabled);
					}
					updateSpeedUiLockedState();
					applyToAllLikelyVideos();
				}
			);
		} catch (_) {
			leftRightVolumeEnabled = true;
			panelExpandRightEnabled = true;
		}
	}

	function setupArrowVolumeSettingSync() {
		loadArrowVolumeSetting();
		try {
			chrome.storage.onChanged.addListener((changes, areaName) => {
				if (areaName !== 'local') return;
				if (!changes) return;
				if (changes[VOLUME_HOTKEY_STORAGE_KEY]) {
					const next = changes[VOLUME_HOTKEY_STORAGE_KEY].newValue;
					leftRightVolumeEnabled = next !== false;
				}
				if (changes[PANEL_EXPAND_RIGHT_STORAGE_KEY]) {
					const next = changes[PANEL_EXPAND_RIGHT_STORAGE_KEY].newValue;
					panelExpandRightEnabled = next !== false;
					if (speedRootEl instanceof HTMLElement && speedRootEl.isConnected) {
						speedRootEl.toggleAttribute('data-expand-up', !panelExpandRightEnabled);
					}
				}
				if (changes[STORAGE_KEY_HOLD_SPEED_INDEX]) {
					holdSpeedIndex = clampSpeedIndex(changes[STORAGE_KEY_HOLD_SPEED_INDEX].newValue);
					if (holdActive) applyToAllLikelyVideos();
				}
				if (changes[STORAGE_KEY_DEFAULT_SPEED_INDEX]) {
					currentIndex = clampSpeedIndex(changes[STORAGE_KEY_DEFAULT_SPEED_INDEX].newValue);
					persistSpeedIndex();
					updateSpeedUiLockedState();
					applyToAllLikelyVideos();
				}
			});
		} catch (_) {}
	}

	const SHADOW_STYLES = `
#${ROOT_ID}{--bm-btn-size:48px;--bm-item-height:92px;--bm-item-gap:0px;--bm-caption-color:var(--yt-spec-text-primary,#fff);--bm-top-row-offset:0px;--bm-row-speed:0px;--bm-row-frame:92px;--bm-row-screenshot:184px;--bm-row-record:276px;--bm-row-download:368px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;width:var(--bm-btn-size);margin-bottom:0;flex-shrink:0;pointer-events:auto;row-gap:0;position:relative;overflow:visible;z-index:2147483646}
#${ROOT_ID} .yts-speed-btn{box-sizing:border-box;width:var(--bm-btn-size);height:var(--bm-btn-size);padding:0;margin:0;border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:Roboto,"YouTube Noto",Arial,sans-serif;font-size:13px;font-weight:600;line-height:1;letter-spacing:-0.02em;color:var(--yt-spec-text-primary,#fff);background-color:var(--yt-spec-10-percent-layer,rgba(255,255,255,.1));backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:filter .12s ease,transform .1s ease}
#${ROOT_ID} .yts-speed-btn.yts-speed-locked{cursor:not-allowed;filter:saturate(.7)}
#${ROOT_ID} .yts-speed-lock-icon{display:none}
#${ROOT_ID} .yts-speed-btn.yts-speed-locked .yts-speed-lock-icon{display:block}
#${ROOT_ID} .yts-speed-btn.yts-speed-locked .yts-speed-value{display:none}
#${ROOT_ID} .yts-record-btn{position:relative;overflow:hidden}
#${ROOT_ID} .yts-record-btn.yts-recording-active{background-color:var(--yt-spec-static-brand-white,#fff);color:var(--yt-spec-static-brand-black,#000)}
#${ROOT_ID} .yts-record-btn.yts-recording-active .yts-toolbox-icon{display:none}
#${ROOT_ID} .yts-record-percent{display:none;font-size:16px;font-weight:700;line-height:1;color:currentColor}
#${ROOT_ID} .yts-record-btn.yts-recording-active .yts-record-percent{display:block}
#${ROOT_ID} .yts-manual-record-btn.yts-recording-active{background-color:var(--yt-spec-static-brand-white,#fff);color:var(--yt-spec-static-brand-black,#000)}
#${ROOT_ID} .yts-frame-btn.yts-frame-active{background-color:var(--yt-spec-static-brand-white,#fff);color:var(--yt-spec-static-brand-black,#000)}
#${ROOT_ID} .yts-tool-main-btn{position:relative}
#${ROOT_ID} .yts-tool-main-btn .yts-toolbox-icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)}
#${ROOT_ID} .yts-speed-value{font-size:20px;font-weight:600;line-height:1;letter-spacing:-0.02em}
#${ROOT_ID} .yts-speed-btn:hover{filter:brightness(1.14)}
#${ROOT_ID} .yts-speed-btn:active{filter:brightness(.92);transform:scale(.96)}
#${ROOT_ID} .yts-speed-caption{margin-top:6px;max-width:56px;text-align:center;font-family:Roboto,"YouTube Noto",Arial,sans-serif;font-size:12px;font-weight:500;line-height:1.2;color:var(--bm-caption-color,var(--yt-spec-text-primary,#fff))!important;opacity:1;white-space:nowrap}
#${ROOT_ID} .yts-toolbox-icon{width:25px;height:25px;display:block;margin:0 auto}
#${ROOT_ID} .yts-toolbox-panel{position:absolute;top:0;left:calc(100% + 8px);display:block;width:var(--bm-btn-size);min-height:calc(var(--bm-row-download) + var(--bm-item-height));opacity:0;transform:translateX(-4px) scale(.98);transform-origin:left top;pointer-events:none;transition:opacity .15s ease,transform .15s ease;z-index:2147483647}
#${ROOT_ID}[data-open="1"] .yts-toolbox-panel{opacity:1;transform:translateX(0) scale(1);pointer-events:auto}
#${ROOT_ID}[data-expand-up=""] .yts-toolbox-panel{top:auto;bottom:calc(100% + 8px);left:0;right:auto;display:flex;flex-direction:column-reverse;gap:10px;min-height:auto;transform:translateY(4px) scale(.98);transform-origin:center bottom}
#${ROOT_ID}[data-expand-up=""][data-open="1"] .yts-toolbox-panel{transform:translateY(0) scale(1)}
#${ROOT_ID}[data-expand-up=""] .yts-toolbox-panel .yts-tool-item{position:relative;left:auto;top:auto;height:auto}
#${ROOT_ID} .yts-tool-item{display:flex;flex-direction:column;align-items:center;justify-content:flex-start;width:var(--bm-btn-size);height:var(--bm-item-height)}
#${ROOT_ID} .yts-tool-item-main>.yts-speed-btn{margin-top:var(--bm-top-row-offset)}
#${ROOT_ID} .yts-toolbox-panel .yts-speed-btn{margin-top:0}
#${ROOT_ID} .yts-toolbox-panel .yts-tool-item{position:absolute;left:0;top:0}
#${ROOT_ID} .yts-toolbox-panel .yts-tool-item-speed{top:var(--bm-row-speed)}
#${ROOT_ID} .yts-toolbox-panel .yts-tool-item-frame{top:var(--bm-row-frame)}
#${ROOT_ID} .yts-toolbox-panel .yts-tool-item-screenshot{top:var(--bm-row-screenshot)}
#${ROOT_ID} .yts-toolbox-panel .yts-tool-item-record{top:var(--bm-row-record)}
#${ROOT_ID} .yts-toolbox-panel .yts-tool-item-download{top:var(--bm-row-download)}
#${ROOT_ID} .yts-remix-slot{width:var(--bm-btn-size);height:var(--bm-btn-size);display:flex;align-items:center;justify-content:center}
`;

	function findNativeLikeButtonForStyle() {
		const scope = getShortsReelUiScopeRoot();
		if (!scope) return null;
		const ref =
			querySelectorDeep(
				'#segmented-like-button button.yt-spec-button-shape-next--segmented-start',
				scope
			) ||
			querySelectorDeep(
				'segmented-like-dislike-button-view-model segmented-like-button button.yt-spec-button-shape-next',
				scope
			) ||
			querySelectorDeep(
				'segmented-like-dislike-button-view-model button.yt-spec-button-shape-next--segmented-start',
				scope
			) ||
			querySelectorDeep('#like-button button.yt-spec-button-shape-next', scope) ||
			querySelectorDeep('like-button-view-model button.yt-spec-button-shape-next', scope);
		if (!ref || !isInReelActionUi(ref)) return null;
		return ref;
	}

	function syncSpeedUiWithNativeLike() {
		const root = speedRootEl;
		if (!root || !root.isConnected) return;
		const btns = Array.from(root.querySelectorAll('.yts-speed-btn'));
		const stylableBtns = btns.filter(
			(btn) => btn instanceof HTMLElement && !btn.classList.contains('yts-recording-active')
		);
		if (!btns.length) return;

		const ref = findNativeLikeButtonForStyle();
		if (!ref || !ref.isConnected) {
			stylableBtns.forEach((btn) => {
				if (!(btn instanceof HTMLElement)) return;
				btn.style.removeProperty('background-color');
				btn.style.removeProperty('color');
			});
			return;
		}

		if (ref.getAttribute('aria-pressed') === 'true') {
			stylableBtns.forEach((btn) => {
				if (!(btn instanceof HTMLElement)) return;
				btn.style.removeProperty('background-color');
				btn.style.removeProperty('color');
			});
			return;
		}

		const cs = getComputedStyle(ref);
		let bg = cs.backgroundColor;
		if (!bg || bg === 'rgba(0, 0, 0, 0)' || bg === 'transparent') {
			const fill = ref.querySelector('.yt-spec-touch-feedback-shape__fill');
			if (fill instanceof HTMLElement) {
				bg = getComputedStyle(fill).backgroundColor;
			}
		}
		if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
			stylableBtns.forEach((btn) => {
				if (btn instanceof HTMLElement) btn.style.backgroundColor = bg;
			});
		}
		const fg = cs.color;
		if (fg) {
			stylableBtns.forEach((btn) => {
				if (btn instanceof HTMLElement) btn.style.color = fg;
			});
		}
	}

	function syncToolboxLayoutWithNative() {
		const root = speedRootEl;
		if (!(root instanceof HTMLElement) || !root.isConnected) return;
		const likeRow = findFallbackAnchorRow();
		if (!(likeRow instanceof HTMLElement) || !likeRow.parentElement) return;

		const likeBtn = findNativeLikeButtonForStyle();
		if (likeBtn instanceof HTMLElement) {
			const rect = likeBtn.getBoundingClientRect();
			const size = Math.round(Math.max(rect.width, rect.height));
			if (Number.isFinite(size) && size >= 32) {
				root.style.setProperty('--bm-btn-size', `${size}px`);
			}
		}

		const rowRect = likeRow.getBoundingClientRect();
		const rowHeight = Math.round(rowRect.height);
		const likeRowStyle = getComputedStyle(likeRow);
		root.style.height = `${Math.max(1, rowHeight)}px`;
		root.style.marginTop = likeRowStyle.marginTop || '0px';
		root.style.marginBottom = likeRowStyle.marginBottom || '0px';

		const siblings = Array.from(likeRow.parentElement.children).filter(
			(el) =>
				el instanceof HTMLElement &&
				el !== root &&
				isInReelActionUi(el) &&
				!el.querySelector(`#${ROOT_ID}`) &&
				!!el.querySelector('button')
		);
		const idx = siblings.indexOf(likeRow);
		if (idx < 0 && Number.isFinite(rowHeight) && rowHeight >= 56) {
			root.style.setProperty('--bm-item-height', `${rowHeight}px`);
			root.style.setProperty('--bm-item-gap', '0px');
		}
		root.style.setProperty('--bm-caption-color', isYouTubeDarkTheme() ? '#fff' : '#0f0f0f');
		const topOffset =
			likeBtn instanceof HTMLElement
				? Math.round(likeBtn.getBoundingClientRect().top - rowRect.top)
				: 0;
		root.style.setProperty('--bm-top-row-offset', `${Math.max(0, topOffset)}px`);

		const rootTop = root.getBoundingClientRect().top;
		const rowBtnCenter = (row) => {
			if (!(row instanceof HTMLElement)) return NaN;
			const btn = row.querySelector('button');
			if (!(btn instanceof HTMLElement)) return NaN;
			const r = btn.getBoundingClientRect();
			return r.top + r.height / 2;
		};
		const likeCenter = rowBtnCenter(siblings[idx]);
		const dislikeCenter = rowBtnCenter(siblings[idx + 1]);
		const commentCenter = rowBtnCenter(siblings[idx + 2]);
		const shareCenter = rowBtnCenter(siblings[idx + 3]);
		const beforeLikeCenter = rowBtnCenter(siblings[idx - 1]);
		const fallbackPitch =
			Number.isFinite(dislikeCenter) && Number.isFinite(likeCenter)
				? Math.round(Math.abs(dislikeCenter - likeCenter))
				: Math.max(56, rowHeight);

		const btnSizeRaw = parseFloat(getComputedStyle(root).getPropertyValue('--bm-btn-size'));
		const btnSize = Number.isFinite(btnSizeRaw) && btnSizeRaw > 0 ? btnSizeRaw : 48;
		const toTopByCenter = (centerY, fallbackMul) => {
			if (!Number.isFinite(centerY)) return Math.round(fallbackPitch * fallbackMul);
			return Math.max(0, Math.round(centerY - rootTop - btnSize / 2));
		};
		const speedTop = Number.isFinite(beforeLikeCenter)
			? toTopByCenter(beforeLikeCenter, 0)
			: Math.max(0, toTopByCenter(likeCenter, 1) - fallbackPitch);
		const frameTop = toTopByCenter(likeCenter, 1);
		const screenshotTop = toTopByCenter(dislikeCenter, 2);
		const recordTop = toTopByCenter(commentCenter, 3);
		const downloadTop = toTopByCenter(shareCenter, 4);
		root.style.setProperty('--bm-row-speed', `${speedTop}px`);
		root.style.setProperty('--bm-row-frame', `${frameTop}px`);
		root.style.setProperty('--bm-row-screenshot', `${screenshotTop}px`);
		root.style.setProperty('--bm-row-record', `${recordTop}px`);
		root.style.setProperty('--bm-row-download', `${downloadTop}px`);
		root.style.setProperty('--bm-item-gap', '0px');
		if (Number.isFinite(fallbackPitch) && fallbackPitch >= 56) {
			root.style.setProperty('--bm-item-height', `${fallbackPitch}px`);
		}

		root.style.setProperty('--bm-caption-color', isYouTubeDarkTheme() ? '#fff' : '#0f0f0f');
		lastLayoutDiag = {
			idx,
			rootTop: Math.round(rootTop),
			btnSize: Math.round(btnSize),
			centers: {
				beforeLike: Number.isFinite(beforeLikeCenter) ? Math.round(beforeLikeCenter) : null,
				like: Number.isFinite(likeCenter) ? Math.round(likeCenter) : null,
				dislike: Number.isFinite(dislikeCenter) ? Math.round(dislikeCenter) : null,
				comment: Number.isFinite(commentCenter) ? Math.round(commentCenter) : null,
				share: Number.isFinite(shareCenter) ? Math.round(shareCenter) : null,
			},
			tops: {
				speedTop,
				frameTop,
				screenshotTop,
				recordTop,
				downloadTop,
			},
			fallbackPitch,
			themeDark: isYouTubeDarkTheme(),
		};
		try {
			root.dataset.bmDiagBtnSize = String(Math.round(btnSize));
			root.dataset.bmDiagPitch = String(Math.round(fallbackPitch));
			root.dataset.bmDiagSpeedTop = String(Math.round(speedTop));
			root.dataset.bmDiagFrameTop = String(Math.round(frameTop));
			root.dataset.bmDiagShotTop = String(Math.round(screenshotTop));
			root.dataset.bmDiagRecordTop = String(Math.round(recordTop));
			root.dataset.bmDiagDownloadTop = String(Math.round(downloadTop));
			root.dataset.bmDiagLikeCenter = Number.isFinite(likeCenter)
				? String(Math.round(likeCenter))
				: '';
			root.dataset.bmDiagDislikeCenter = Number.isFinite(dislikeCenter)
				? String(Math.round(dislikeCenter))
				: '';
			root.dataset.bmDiagCommentCenter = Number.isFinite(commentCenter)
				? String(Math.round(commentCenter))
				: '';
			root.dataset.bmDiagThemeDark = isYouTubeDarkTheme() ? '1' : '0';
		} catch (_) {}
	}

	function isYouTubeDarkTheme() {
		const html = document.documentElement;
		if (html && (html.hasAttribute('dark') || html.getAttribute('dark') === 'true')) {
			return true;
		}
		const ytdApp = document.querySelector('ytd-app');
		if (ytdApp instanceof HTMLElement) {
			if (ytdApp.hasAttribute('dark') || ytdApp.getAttribute('dark') === 'true') return true;
		}
		return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
	}

	function applyPressedLikeVisualToButton(btn) {
		if (!(btn instanceof HTMLElement)) return;
		const likeBtn = findNativeLikeButtonForStyle();
		if (likeBtn instanceof HTMLElement && likeBtn.getAttribute('aria-pressed') === 'true') {
			const cs = getComputedStyle(likeBtn);
			const bg = cs.backgroundColor;
			const fg = cs.color;
			if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
				btn.style.backgroundColor = bg;
			} else {
				btn.style.backgroundColor = isYouTubeDarkTheme() ? '#fff' : '#000';
			}
			if (fg) {
				btn.style.color = fg;
			} else {
				btn.style.color = isYouTubeDarkTheme() ? '#000' : '#fff';
			}
			return;
		}
		btn.style.backgroundColor = isYouTubeDarkTheme() ? '#fff' : '#000';
		btn.style.color = isYouTubeDarkTheme() ? '#000' : '#fff';
	}

	function getSpeed() {
		return SPEEDS[currentIndex];
	}

	function getEffectivePlaybackRate() {
		if (framePlaybackEnabled) return getSpeed();
		if (recordingSession || manualRecordSession || suspendSpeedSync) return getSpeed();
		if (holdActive) return SPEEDS[holdSpeedIndex];
		return getSpeed();
	}

	function findSpeedIndexByRate(rate) {
		for (let i = 0; i < SPEEDS.length; i++) {
			if (Math.abs(SPEEDS[i] - rate) < 0.01) return i;
		}
		return -1;
	}

	function syncIndexFromObservedRate(rate) {
		if (holdActive) return false;
		const idx = findSpeedIndexByRate(rate);
		if (idx < 0 || idx === currentIndex) return false;
		currentIndex = idx;
		updateSpeedUiLockedState();
		return true;
	}

	function formatSpeedLabel(s) {
		if (Number.isInteger(s)) return `${s}×`;
		const t = String(s).replace(/\.0+$/, '');
		return `${t}×`;
	}

	function updateSpeedUiLockedState() {
		if (!(speedBtnEl instanceof HTMLButtonElement)) return;
		speedBtnEl.classList.toggle('yts-speed-locked', framePlaybackEnabled);
		speedBtnEl.setAttribute('aria-disabled', framePlaybackEnabled ? 'true' : 'false');
		if (btnLabel) {
			btnLabel.textContent = formatSpeedLabel(getSpeed());
		}
		if (speedLockIconEl instanceof SVGElement) {
			speedLockIconEl.style.display = framePlaybackEnabled ? 'block' : 'none';
		}
	}

	function updateFramePlaybackUi() {
		if (!(framePlayBtnEl instanceof HTMLElement)) return;
		framePlayBtnEl.classList.toggle('yts-frame-active', framePlaybackEnabled);
	}

	function forceSpeedTo1x() {
		currentIndex = 0;
		persistSpeedIndex();
		updateSpeedUiLockedState();
		applyToAllLikelyVideos();
	}

	function ensureFramePlaybackLoop() {
		if (framePlaybackTimerId) return;
		framePlaybackTimerId = setInterval(() => {
			if (!framePlaybackEnabled) return;
			const vv = getActiveShortsVideo();
			if (!(vv instanceof HTMLVideoElement)) return;
			try {
				vv.muted = true;
				vv.pause();
				let next = vv.currentTime + FRAME_STEP_SECONDS;
				if (Number.isFinite(vv.duration) && vv.duration > 0) {
					next = Math.min(vv.duration - 0.001, next);
					next = Math.max(0, next);
				}
				vv.currentTime = next;
			} catch (_) {}
		}, 1000);
	}

	function stopFramePlayback(options = {}) {
		const restoreMute = options.restoreMute !== false;
		const restoreSpeed = options.restoreSpeed !== false;
		const resumePlayback = options.resumePlayback !== false;
		framePlaybackEnabled = false;
		if (framePlaybackTimerId) {
			clearInterval(framePlaybackTimerId);
			framePlaybackTimerId = null;
		}
		if (restoreMute) {
			const v = getActiveShortsVideo();
			if (v instanceof HTMLVideoElement) {
				try {
					v.muted = framePlaybackPrevMuted;
				} catch (_) {}
			}
		}
		if (restoreSpeed) {
			currentIndex = Math.max(0, Math.min(SPEEDS.length - 1, framePlaybackPrevSpeedIndex));
			persistSpeedIndex();
			applyToAllLikelyVideos();
		}
		if (resumePlayback) {
			const v = getActiveShortsVideo();
			if (v instanceof HTMLVideoElement) {
				v.play().catch(() => {});
			}
		}
		updateFramePlaybackUi();
		updateSpeedUiLockedState();
	}

	function startFramePlayback() {
		const v = getActiveShortsVideo();
		if (!(v instanceof HTMLVideoElement)) return;
		if (framePlaybackTimerId) clearInterval(framePlaybackTimerId);
		framePlaybackEnabled = true;
		framePlaybackPrevMuted = !!v.muted;
		framePlaybackPrevSpeedIndex = currentIndex;
		framePlaybackPrevWasPaused = !!v.paused;
		currentIndex = 0;
		applyToAllLikelyVideos();
		try {
			v.muted = true;
			v.pause();
		} catch (_) {}
		ensureFramePlaybackLoop();
		updateFramePlaybackUi();
		updateSpeedUiLockedState();
	}

	function toggleFramePlayback() {
		if (framePlaybackEnabled) {
			stopFramePlayback();
			return;
		}
		startFramePlayback();
	}

	function createGearSvg() {
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');
		svg.classList.add('yts-toolbox-icon');
		const path = document.createElementNS(ns, 'path');
		path.setAttribute(
			'd',
			'M19.14 12.94c.04-.31.06-.63.06-.94s-.02-.63-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7.07 7.07 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.49-.42h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.57.23-1.11.54-1.62.94l-2.39-.96a.5.5 0 0 0-.61.22L2.7 8.84a.5.5 0 0 0 .12.64l2.03 1.58c-.05.31-.07.62-.07.94s.02.63.07.94L2.82 14.52a.5.5 0 0 0-.12.64l1.92 3.32c.13.23.4.32.61.22l2.39-.96c.5.4 1.05.72 1.62.94l.36 2.54c.04.24.24.42.49.42h3.84c.25 0 .45-.18.49-.42l.36-2.54c.58-.23 1.12-.54 1.63-.94l2.39.96c.22.1.47.01.6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58zM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7z'
		);
		path.setAttribute('fill', 'currentColor');
		svg.appendChild(path);
		return svg;
	}

	function createDownloadSvg() {
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');
		svg.classList.add('yts-toolbox-icon');
		const path = document.createElementNS(ns, 'path');
		path.setAttribute(
			'd',
			'M11 3h2v9.17l2.59-2.58L17 11l-5 5-5-5 1.41-1.41L11 12.17V3zm-6 14h14v2H5v-2z'
		);
		path.setAttribute('fill', 'currentColor');
		svg.appendChild(path);
		return svg;
	}

	function createScreenshotSvg() {
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');
		svg.classList.add('yts-toolbox-icon');
		const path = document.createElementNS(ns, 'path');
		path.setAttribute(
			'd',
			'M9 4l1.2-1.6c.2-.26.5-.4.8-.4h2c.3 0 .6.14.8.4L15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h3zm3 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0-1.8a2.2 2.2 0 1 1 0-4.4 2.2 2.2 0 0 1 0 4.4z'
		);
		path.setAttribute('fill', 'currentColor');
		svg.appendChild(path);
		return svg;
	}

	function createRecordSvg() {
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');
		svg.classList.add('yts-toolbox-icon');
		const circle = document.createElementNS(ns, 'circle');
		circle.setAttribute('cx', '12');
		circle.setAttribute('cy', '12');
		circle.setAttribute('r', '6');
		circle.setAttribute('fill', 'currentColor');
		svg.appendChild(circle);
		return svg;
	}

	function createLockSvg() {
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');
		svg.classList.add('yts-toolbox-icon', 'yts-speed-lock-icon');
		const path = document.createElementNS(ns, 'path');
		path.setAttribute(
			'd',
			'M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5zm-3 8V7a3 3 0 1 1 6 0v3H9zm3 4a2 2 0 0 1 1 3.73V19h-2v-1.27A2 2 0 0 1 12 14z'
		);
		path.setAttribute('fill', 'currentColor');
		svg.appendChild(path);
		return svg;
	}

	function createFrameStepSvg() {
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');
		svg.classList.add('yts-toolbox-icon');
		const path = document.createElementNS(ns, 'path');
		path.setAttribute(
			'd',
			'M5 4h2v2H5V4zm4 0h6v2H9V4zm8 0h2v2h-2V4zM5 9h2v6H5V9zm12 0h2v6h-2V9zM9 9l6 3-6 3V9zM5 18h2v2H5v-2zm4 0h6v2H9v-2zm8 0h2v2h-2v-2z'
		);
		path.setAttribute('fill', 'currentColor');
		svg.appendChild(path);
		return svg;
	}

	function createRemixSvg() {
		const ns = 'http://www.w3.org/2000/svg';
		const svg = document.createElementNS(ns, 'svg');
		svg.setAttribute('viewBox', '0 0 24 24');
		svg.setAttribute('aria-hidden', 'true');
		svg.classList.add('yts-toolbox-icon');
		const path = document.createElementNS(ns, 'path');
		path.setAttribute(
			'd',
			'M14 4a5 5 0 0 1 0 10H9.83l1.58 1.59L10 17l-4-4 4-4 1.41 1.41L9.83 12H14a3 3 0 0 0 0-6h-1V4h1zm4 3.5L14.5 11 11 7.5 12.41 6l2.09 2.09L16.59 6 18 7.5z'
		);
		path.setAttribute('fill', 'currentColor');
		svg.appendChild(path);
		return svg;
	}

	function closestAcrossShadow(startEl, selector) {
		let node = startEl;
		while (node) {
			if (node instanceof Element) {
				try {
					if (node.matches(selector)) return node;
				} catch (_) {}
			}
			if (node instanceof Element && node.parentElement) {
				node = node.parentElement;
				continue;
			}
			const root = node && node.getRootNode ? node.getRootNode() : null;
			if (root instanceof ShadowRoot && root.host) {
				node = root.host;
				continue;
			}
			break;
		}
		return null;
	}

	function findRemixActionItemContainer(remixInner) {
		if (!remixInner) return null;
		return closestAcrossShadow(
			remixInner,
			'reel-action-bar-item-view-model, reel-action-bar-item-renderer, ytd-reel-player-overlay-reel-item-renderer'
		);
	}

	function querySelectorDeep(selector, base = document.documentElement) {
		if (!base) return null;
		const stack = [base];
		while (stack.length) {
			const node = stack.pop();
			if (!node) continue;
			if (node instanceof Element) {
				try {
					if (node.matches(selector)) return node;
					const hit = node.querySelector(selector);
					if (hit) return hit;
				} catch (_) {}
				if (node.shadowRoot) stack.push(node.shadowRoot);
				for (let i = node.children.length - 1; i >= 0; i--) {
					stack.push(node.children[i]);
				}
			} else if (node instanceof ShadowRoot) {
				try {
					const hit = node.querySelector(selector);
					if (hit) return hit;
				} catch (_) {}
				for (let i = node.children.length - 1; i >= 0; i--) {
					stack.push(node.children[i]);
				}
			}
		}
		return null;
	}

	function querySelectorAllDeep(selector, base = document.documentElement) {
		if (!base) return [];
		const out = [];
		const seen = new Set();
		const stack = [base];
		while (stack.length) {
			const node = stack.pop();
			if (!node) continue;
			let list = null;
			if (node instanceof Element || node instanceof ShadowRoot) {
				try {
					list = node.querySelectorAll(selector);
				} catch (_) {
					list = null;
				}
			}
			if (list) {
				list.forEach((el) => {
					if (!seen.has(el)) {
						seen.add(el);
						out.push(el);
					}
				});
			}
			if (node instanceof Element) {
				if (node.shadowRoot) stack.push(node.shadowRoot);
				for (let i = node.children.length - 1; i >= 0; i--) {
					stack.push(node.children[i]);
				}
			} else if (node instanceof ShadowRoot) {
				for (let i = node.children.length - 1; i >= 0; i--) {
					stack.push(node.children[i]);
				}
			}
		}
		return out;
	}

	function isInsideCommentsPanel(el) {
		if (!el) return false;
		return !!el.closest(
			'ytd-comments-panel, ytd-engagement-panel, ytd-engagement-panel-section, ytd-comment-renderer, ytd-comment-thread-renderer, ytd-comment-simplebox-renderer, ytd-comment-action-buttons-renderer, #engagement-panel'
		);
	}

	function isInReelActionUi(el) {
		if (!el) return false;
		if (isInsideCommentsPanel(el)) return false;
		return !!(el.closest('ytd-reel-player-overlay-renderer') || el.closest('#shorts-player'));
	}

	function getShortsReelUiScopeRoot() {
		const overlay =
			document.querySelector('ytd-reel-player-overlay-renderer') ||
			querySelectorDeep('ytd-reel-player-overlay-renderer', document.documentElement);
		if (overlay && !isInsideCommentsPanel(overlay)) return overlay;

		const sp =
			document.querySelector('#shorts-player') ||
			querySelectorDeep('#shorts-player', document.documentElement);
		if (sp && !isInsideCommentsPanel(sp)) return sp;

		return null;
	}

	function rectIntersects(a, b) {
		if (!a || !b) return false;
		return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
	}

	function isLikelyBlockingOverlay(el) {
		if (!(el instanceof HTMLElement)) return false;
		if (el === speedRootEl) return false;
		if (speedRootEl && (el.contains(speedRootEl) || speedRootEl.contains(el))) return false;
		if (!isInReelActionUi(el)) return false;
		const idClass = `${el.id || ''} ${el.className || ''}`;
		if (/gradient|scrim|shade|overlay|veil|backdrop/i.test(idClass)) return true;
		const cs = getComputedStyle(el);
		if (cs.pointerEvents === 'none') return false;
		const positioned =
			cs.position === 'absolute' || cs.position === 'fixed' || cs.position === 'sticky';
		const hasOverlayBg =
			(cs.backgroundImage && cs.backgroundImage !== 'none') ||
			(cs.backgroundColor &&
				cs.backgroundColor !== 'rgba(0, 0, 0, 0)' &&
				cs.backgroundColor !== 'transparent');
		return positioned && hasOverlayBg;
	}

	function neutralizeOverlaysByHitTest() {
		if (!speedRootEl || !speedRootEl.isConnected) return;
		const targets = [speedRootEl];
		const panel = speedRootEl.querySelector('.yts-toolbox-panel');
		if (panel instanceof HTMLElement && speedRootEl.dataset.open === '1') {
			targets.push(panel);
		}
		for (const target of targets) {
			const r = target.getBoundingClientRect();
			if (r.width <= 0 || r.height <= 0) continue;
			const points = [
				[r.left + r.width * 0.5, r.top + r.height * 0.5],
				[r.left + 6, r.top + 6],
				[r.right - 6, r.top + 6],
				[r.left + 6, r.bottom - 6],
				[r.right - 6, r.bottom - 6],
			];
			for (const [x0, y0] of points) {
				const x = Math.max(1, Math.min(window.innerWidth - 1, Math.round(x0)));
				const y = Math.max(1, Math.min(window.innerHeight - 1, Math.round(y0)));
				const stack = document.elementsFromPoint(x, y);
				for (const el of stack) {
					if (!(el instanceof HTMLElement)) continue;
					if (el === target || el === speedRootEl || speedRootEl.contains(el)) break;
					if (!isLikelyBlockingOverlay(el)) continue;
					el.style.pointerEvents = 'none';
					el.dataset.ytsToolboxOverlayNeutralized = '1';
				}
			}
		}
	}

	function neutralizeBlockingOverlays() {
		if (!speedRootEl || !speedRootEl.isConnected) return;
		const scope = getShortsReelUiScopeRoot();
		if (!scope) return;
		const rootRect = speedRootEl.getBoundingClientRect();
		if (rootRect.width <= 0 || rootRect.height <= 0) return;
		const candidates = scope.querySelectorAll(
			'[id*="gradient"], [class*="gradient"], [id*="scrim"], [class*="scrim"], [id*="shade"], [class*="shade"]'
		);
		candidates.forEach((el) => {
			if (!(el instanceof HTMLElement)) return;
			if (el === speedRootEl || el.contains(speedRootEl) || speedRootEl.contains(el)) return;
			if (!isInReelActionUi(el)) return;
			const rect = el.getBoundingClientRect();
			if (rect.width <= 0 || rect.height <= 0) return;
			if (!rectIntersects(rect, rootRect)) return;
			el.style.pointerEvents = 'none';
			el.dataset.ytsToolboxOverlayNeutralized = '1';
		});
		neutralizeOverlaysByHitTest();
	}

	function ensureStylesInShadowRoot(shadowRoot) {
		if (!(shadowRoot instanceof ShadowRoot)) return;
		if (shadowRoot.querySelector('#yts-speed-style')) return;
		const s = document.createElement('style');
		s.id = 'yts-speed-style';
		s.textContent = SHADOW_STYLES;
		shadowRoot.prepend(s);
	}

	function findDirectFlexChild(column, inner) {
		let x = inner;
		while (x && x.parentElement && x.parentElement !== column) {
			x = x.parentElement;
		}
		return x;
	}

	function safeInsertBefore(parent, child, refNode = null) {
		if (!(parent instanceof Node) || !(child instanceof Node)) return false;
		if (parent === child) return false;
		if (child.contains(parent)) return false;
		if (refNode && refNode.parentNode !== parent) return false;
		try {
			parent.insertBefore(child, refNode);
			return true;
		} catch (_) {
			return false;
		}
	}

	function findActionRowElement(inner) {
		if (!inner) return null;
		const byItem =
			inner.closest('reel-action-bar-item-view-model') ||
			inner.closest('reel-action-bar-item-renderer');
		if (byItem && byItem.parentElement) return byItem;

		let n = inner;
		for (let depth = 0; depth < 28 && n; depth++) {
			const p = n.parentElement;
			if (!p) break;
			const cs = getComputedStyle(p);
			if (
				cs.display.includes('flex') &&
				(cs.flexDirection === 'column' || cs.flexDirection === 'column-reverse')
			) {
				const direct = findDirectFlexChild(p, inner);
				if (direct) return direct;
			}
			n = p;
		}
		return null;
	}

	function attachRootAtRow(root, row) {
		const column = row.parentElement;
		if (!column) return false;
		if (row.contains(root) || root.contains(row) || root.contains(column)) return false;
		if (!safeInsertBefore(column, root, row)) return false;
		const rn = root.getRootNode();
		if (rn instanceof ShadowRoot) {
			ensureStylesInShadowRoot(rn);
		}
		if (getComputedStyle(column).flexDirection === 'column-reverse') {
			const rr = root.getBoundingClientRect();
			const lr = row.getBoundingClientRect();
			if (!(rr.top < lr.top)) {
				if (row.nextSibling) {
					safeInsertBefore(column, root, row.nextSibling);
				} else {
					safeInsertBefore(column, root, null);
				}
				if (!(root.getBoundingClientRect().top < row.getBoundingClientRect().top)) {
					safeInsertBefore(column, root, row);
				}
			}
		}
		return true;
	}

	function isRemixText(s) {
		return /(remix|create|混音|重混音|建立|创建|リミックス|作成)/i.test(s || '');
	}

	function findRemixInner() {
		const scope = getShortsReelUiScopeRoot();
		if (!scope) return null;
		const buttons = querySelectorAllDeep('button', scope);
		for (const btn of buttons) {
			if (!(btn instanceof HTMLButtonElement)) continue;
			if (btn.closest(`#${ROOT_ID}`)) continue;
			if (!isInReelActionUi(btn)) continue;
			const label =
				btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.textContent || '';
			if (!isRemixText(label)) continue;
			const row = findActionRowElement(btn);
			if (!row) continue;
			return btn;
		}
		const rows = querySelectorAllDeep(
			'reel-action-bar-item-view-model, reel-action-bar-item-renderer, ytd-reel-player-overlay-reel-item-renderer',
			scope
		);
		for (const row of rows) {
			if (!(row instanceof HTMLElement)) continue;
			if (!isInReelActionUi(row)) continue;
			if (row.closest(`#${ROOT_ID}`)) continue;
			const rowText = row.textContent || '';
			if (!isRemixText(rowText)) continue;
			const btn = row.querySelector('button');
			if (btn instanceof HTMLButtonElement) return btn;
		}

		const likeRow = findFallbackAnchorRow();
		if (likeRow && likeRow.parentElement) {
			const column = likeRow.parentElement;
			const actionRows = Array.from(column.children).filter((el) => {
				if (!(el instanceof HTMLElement)) return false;
				if (el === speedRootEl) return false;
				if (!isInReelActionUi(el)) return false;
				if (el.querySelector(`#${ROOT_ID}`)) return false;
				return !!el.querySelector('button');
			});
			if (actionRows.length) {
				const likeIdx = actionRows.indexOf(likeRow);
				const rowsAfterLike = likeIdx >= 0 ? actionRows.slice(likeIdx + 1) : actionRows;
				const picked =
					(rowsAfterLike.length ? rowsAfterLike[rowsAfterLike.length - 1] : null) ||
					actionRows[actionRows.length - 1];
				const btn = picked.querySelector('button');
				if (btn instanceof HTMLButtonElement) return btn;
			}
		}
		return null;
	}

	function showOriginalRemixRow() {}

	function ensureSpeedAnchorIntact() {
		if (!speedRootEl || !speedRootEl.isConnected) return;
		if (!isInReelActionUi(speedRootEl)) {
			speedRootEl.remove();
			speedRootEl = null;
			remixRowEl = null;
			remixButtonEl = null;
			return;
		}
		const likeRow = findFallbackAnchorRow();
		if (!likeRow || !likeRow.parentElement) return;
		const column = likeRow.parentElement;
		if (speedRootEl.parentElement !== column || speedRootEl.nextSibling !== likeRow) {
			attachRootAtRow(speedRootEl, likeRow);
		}
	}

	function findLikeInner() {
		const scope = getShortsReelUiScopeRoot();
		if (!scope) return null;
		const hit =
			querySelectorDeep('#like-button', scope) ||
			querySelectorDeep('like-button-view-model', scope) ||
			querySelectorDeep('segmented-like-dislike-button-view-model', scope);
		if (!hit || !isInReelActionUi(hit)) return null;
		return hit;
	}

	function findFallbackAnchorRow() {
		const likeInner = findLikeInner();
		if (!likeInner || !likeInner.isConnected) return null;
		return findActionRowElement(likeInner);
	}

	function isCommentsPanelOpen() {
		const panel = document.querySelector(
			'ytd-engagement-panel-section-list-renderer, ytd-comments-panel'
		);
		if (!(panel instanceof HTMLElement)) return false;
		if (panel.hasAttribute('hidden')) return false;
		const cs = getComputedStyle(panel);
		if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') {
			return false;
		}
		const rect = panel.getBoundingClientRect();
		return rect.width > 0 && rect.height > 0;
	}

	function isCommentsText(s, allowClose = false) {
		const text = s || '';
		if (/(comment|comments|留言|评论|評論|コメント)/i.test(text)) return true;
		if (!allowClose) return false;
		return /(close|關閉|关闭|閉じる)/i.test(text);
	}

	function isActionBarButton(btn) {
		if (!(btn instanceof HTMLButtonElement)) return false;
		if (!isInReelActionUi(btn)) return false;
		if (btn.closest(`#${ROOT_ID}`)) return false;
		return !!findActionRowElement(btn);
	}

	function matchesCommentsToggleByStructure(btn) {
		if (!isActionBarButton(btn)) return false;
		const ctl = btn.getAttribute('aria-controls') || '';
		if (/engagement-panel|comment/i.test(ctl)) return true;
		if (
			btn.closest('#comments-button') ||
			btn.closest('comments-button-view-model') ||
			btn.closest('ytd-comment-button-renderer')
		) {
			return true;
		}
		return false;
	}

	function findCommentsPanelCloseButton() {
		const panel = document.querySelector(
			'ytd-engagement-panel-section-list-renderer, ytd-comments-panel'
		);
		if (!(panel instanceof Element)) return null;
		const closeBtn =
			querySelectorDeep('#dismiss-button button', panel) ||
			querySelectorDeep('ytd-engagement-panel-title-header-renderer #button', panel) ||
			querySelectorDeep('ytd-comments-header-renderer #button', panel);
		return closeBtn instanceof HTMLButtonElement ? closeBtn : null;
	}

	function findCommentsToggleButton() {
		const scope = getShortsReelUiScopeRoot();
		if (!scope) return null;
		const allowClose = isCommentsPanelOpen();
		const buttons = querySelectorAllDeep('button', scope);
		for (const btn of buttons) {
			if (!(btn instanceof HTMLButtonElement)) continue;
			if (matchesCommentsToggleByStructure(btn)) return btn;
		}
		for (const btn of buttons) {
			if (!(btn instanceof HTMLButtonElement)) continue;
			if (!isActionBarButton(btn)) continue;
			const label =
				btn.getAttribute('aria-label') || btn.getAttribute('title') || btn.textContent || '';
			if (!isCommentsText(label, allowClose)) continue;
			return btn;
		}
		return null;
	}

	function isCommentsToggleClickFromEvent(e) {
		if (!e || typeof e.composedPath !== 'function') return false;
		const allowClose = isCommentsPanelOpen();
		const path = e.composedPath();
		for (const node of path) {
			if (!(node instanceof HTMLButtonElement)) continue;
			if (matchesCommentsToggleByStructure(node)) return true;
			if (!isActionBarButton(node)) continue;
			const label =
				node.getAttribute('aria-label') || node.getAttribute('title') || node.textContent || '';
			if (isCommentsText(label, allowClose)) return true;
		}
		return false;
	}

	function closeCommentsPanelIfOpen() {
		if (!isCommentsPanelOpen()) return;
		const closeBtn = findCommentsPanelCloseButton();
		if (closeBtn instanceof HTMLButtonElement) {
			closeBtn.click();
			return;
		}
		const toggleBtn = findCommentsToggleButton();
		if (toggleBtn instanceof HTMLButtonElement) {
			toggleBtn.click();
			return;
		}
	}

	function onDocumentClick(e) {}

	function getNativeYouTubePlayerApi(videoEl = null) {
		if (videoEl instanceof HTMLVideoElement) {
			const renderer = videoEl.closest('ytd-reel-video-renderer');
			if (renderer instanceof HTMLElement) {
				const scopedByVideo = renderer.querySelector('#movie_player');
				if (
					scopedByVideo &&
					typeof scopedByVideo.setVolume === 'function' &&
					typeof scopedByVideo.getVolume === 'function'
				) {
					return scopedByVideo;
				}
			}
		}
		const activeRenderer =
			document.querySelector('ytd-reel-video-renderer[is-active]') ||
			document.querySelector('ytd-reel-video-renderer[reel-active]') ||
			document.querySelector("ytd-reel-video-renderer[aria-hidden='false']");
		if (activeRenderer instanceof HTMLElement) {
			const scoped = activeRenderer.querySelector('#movie_player');
			if (
				scoped &&
				typeof scoped.setVolume === 'function' &&
				typeof scoped.getVolume === 'function'
			) {
				return scoped;
			}
		}
		const direct = document.getElementById('movie_player');
		if (
			direct &&
			typeof direct.setVolume === 'function' &&
			typeof direct.getVolume === 'function'
		) {
			return direct;
		}
		const shortsPlayer = document.querySelector('#shorts-player #movie_player');
		if (
			shortsPlayer &&
			typeof shortsPlayer.setVolume === 'function' &&
			typeof shortsPlayer.getVolume === 'function'
		) {
			return shortsPlayer;
		}
		return null;
	}

	function adjustVolumeBy(delta) {
		const v = getActiveShortsVideo();
		if (!(v instanceof HTMLVideoElement)) return false;
		const nudgePlayerVolumeUi = (upward) => {
			const key = upward ? 'ArrowUp' : 'ArrowDown';
			const evtInit = {
				key,
				code: key,
				bubbles: false,
				cancelable: true,
				composed: false,
			};
			const targets = [
				getNativeYouTubePlayerApi(v),
				querySelectorDeep('.html5-video-player'),
				querySelectorDeep('#movie_player'),
				v,
			].filter((el) => el && typeof el.dispatchEvent === 'function');
			for (const t of targets) {
				try {
					t.dispatchEvent(new KeyboardEvent('keydown', evtInit));
					t.dispatchEvent(new KeyboardEvent('keyup', evtInit));
				} catch (_) {}
			}
		};
		const wakePlayerControls = () => {
			const player =
				querySelectorDeep('#movie_player') ||
				querySelectorDeep('.html5-video-player') ||
				querySelectorDeep('#shorts-player');
			if (!(player instanceof HTMLElement)) return;
			const r = player.getBoundingClientRect();
			const x = r.left + Math.min(Math.max(12, r.width * 0.2), Math.max(12, r.width - 12));
			const y = r.top + Math.min(Math.max(12, r.height * 0.85), Math.max(12, r.height - 12));
			const evt = {
				bubbles: true,
				cancelable: true,
				composed: true,
				clientX: x,
				clientY: y,
			};
			try {
				player.dispatchEvent(new MouseEvent('mousemove', evt));
			} catch (_) {}
		};

		const syncAnyVolumeControls = (nextPct) => {
			const pct = Math.max(0, Math.min(100, Math.round(nextPct)));
			const selectors = [
				'.ytp-volume-panel',
				"input[type='range'][aria-label*='音量']",
				"input[type='range'][aria-label*='Volume']",
				"input[type='range'][name*='volume']",
				"[aria-valuenow][aria-label*='音量']",
				"[aria-valuenow][aria-label*='Volume']",
			];
			const all = [];
			selectors.forEach((sel) => {
				querySelectorAllDeep(sel).forEach((el) => {
					if (el instanceof HTMLElement && !all.includes(el)) all.push(el);
				});
			});
			all.forEach((el) => {
				try {
					if ('value' in el && (el.tagName === 'INPUT' || el.tagName === 'TP-YT-PAPER-SLIDER')) {
						el.value = String(pct);
					}
				} catch (_) {}
				try {
					el.setAttribute('aria-valuenow', String(pct));
					el.setAttribute('aria-valuetext', `${pct}%`);
				} catch (_) {}
				try {
					el.dispatchEvent(new Event('input', { bubbles: true }));
					el.dispatchEvent(new Event('change', { bubbles: true }));
				} catch (_) {}
			});
		};

		const simulateNativeVolumeSlider = (nextPct) => {
			const pct = Math.max(0, Math.min(100, Math.round(nextPct)));
			const slider =
				querySelectorDeep('.ytp-volume-slider') || querySelectorDeep('.ytp-volume-area');
			if (!(slider instanceof HTMLElement)) return;
			const rect = slider.getBoundingClientRect();
			if (!rect || rect.width <= 0 || rect.height <= 0) return;
			const x = rect.left + (rect.width * pct) / 100;
			const y = rect.top + rect.height / 2;
			const common = {
				bubbles: true,
				cancelable: true,
				composed: true,
				clientX: x,
				clientY: y,
			};
			try {
				if (typeof PointerEvent === 'function') {
					slider.dispatchEvent(new PointerEvent('pointerdown', common));
					slider.dispatchEvent(new PointerEvent('pointermove', common));
					slider.dispatchEvent(new PointerEvent('pointerup', common));
				}
			} catch (_) {}
			try {
				slider.dispatchEvent(new MouseEvent('mousedown', common));
				slider.dispatchEvent(new MouseEvent('mousemove', common));
				slider.dispatchEvent(new MouseEvent('mouseup', common));
				slider.dispatchEvent(new MouseEvent('click', common));
			} catch (_) {}
		};

		const syncNativeVolumeUi = (nextPct) => {
			const pct = Math.max(0, Math.min(100, Math.round(nextPct)));
			wakePlayerControls();
			const panel = querySelectorDeep('.ytp-volume-panel');
			const slider = querySelectorDeep('.ytp-volume-slider');
			const sliderHandle = querySelectorDeep('.ytp-volume-slider-handle');
			const sliderTrack = querySelectorDeep('.ytp-volume-slider-active');
			const muteBtn = querySelectorDeep('.ytp-mute-button');
			const muted = pct <= 0;
			if (panel instanceof HTMLElement) {
				panel.setAttribute('aria-valuenow', String(pct));
				panel.setAttribute('aria-valuetext', `${pct}%`);
				panel.setAttribute('aria-label', muted ? '解除靜音' : `音量 ${pct}%`);
				panel.dispatchEvent(new Event('input', { bubbles: true }));
				panel.dispatchEvent(new Event('change', { bubbles: true }));
			}
			if (muteBtn instanceof HTMLElement) {
				muteBtn.setAttribute('aria-label', muted ? '解除靜音' : '靜音');
			}
			if (slider instanceof HTMLElement)
				slider.style.setProperty('--ytp-volume-ratio', String(pct / 100));
			if (sliderHandle instanceof HTMLElement) {
				sliderHandle.style.left = `${pct}%`;
				sliderHandle.dispatchEvent(new Event('input', { bubbles: true }));
				sliderHandle.dispatchEvent(new Event('change', { bubbles: true }));
			}
			if (sliderTrack instanceof HTMLElement) {
				sliderTrack.style.transform = `scaleX(${pct / 100})`;
				sliderTrack.style.transformOrigin = 'left center';
				sliderTrack.style.width = `${pct}%`;
			}
			simulateNativeVolumeSlider(pct);
			syncAnyVolumeControls(pct);
		};

		const api = getNativeYouTubePlayerApi(v);
		if (api) {
			const curPct = Number(api.getVolume());
			const basePct = Number.isFinite(curPct) ? curPct : Math.round((v.volume || 0) * 100);
			const nextPct = Math.max(0, Math.min(100, basePct + Math.round(delta * 100)));
			try {
				api.setVolume(nextPct);
				if (nextPct > 0 && typeof api.isMuted === 'function' && api.isMuted()) {
					if (typeof api.unMute === 'function') api.unMute();
				}
				if (typeof api.setMuted === 'function' && nextPct > 0) api.setMuted(false);
			} catch (_) {}
			try {
				v.volume = Number((nextPct / 100).toFixed(2));
				v.muted = nextPct <= 0;
				v.dispatchEvent(new Event('volumechange', { bubbles: true }));
				document.dispatchEvent(new Event('volumechange', { bubbles: true }));
				syncNativeVolumeUi(nextPct);
				nudgePlayerVolumeUi(delta > 0);
			} catch (_) {}
			return true;
		}
		const next = Math.max(0, Math.min(1, (Number(v.volume) || 0) + delta));
		const nextPct = Math.round(next * 100);
		try {
			v.volume = Number(next.toFixed(2));
			v.muted = nextPct <= 0;
			v.dispatchEvent(new Event('volumechange', { bubbles: true }));
			document.dispatchEvent(new Event('volumechange', { bubbles: true }));
			syncNativeVolumeUi(nextPct);
			nudgePlayerVolumeUi(delta > 0);
		} catch (_) {}
		return true;
	}

	function onDocumentKeydown(e) {
		if (!(e instanceof KeyboardEvent)) return;
		const k = e.key;
		if (leftRightVolumeEnabled && (k === 'ArrowLeft' || k === 'ArrowRight')) {
			const delta = k === 'ArrowRight' ? 0.05 : -0.05;
			if (!adjustVolumeBy(delta)) return;
			e.preventDefault();
			if (typeof e.stopImmediatePropagation === 'function') {
				e.stopImmediatePropagation();
			}
			e.stopPropagation();
			return;
		}
	}

	function togglePanel() {
		if (!speedRootEl) return;
		const nextOpen = speedRootEl.dataset.open === '1' ? '0' : '1';
		if (nextOpen === '1') closeCommentsPanelIfOpen();
		speedRootEl.dataset.open = nextOpen;
	}

	document.addEventListener('click', onDocumentClick, true);
	document.addEventListener('keydown', onDocumentKeydown, true);
	runtimeMsgHandler = (msg) => {
		if (!msg || !msg.type) return;
		if (msg.type === 'BM_BG_RECORD_DONE') {
			if (recordingSession && recordingSession.progressTimerId)
				clearInterval(recordingSession.progressTimerId);
			if (recordingSession && recordingSession.watchdogId)
				clearTimeout(recordingSession.watchdogId);
			const currentId = getCurrentShortId();
			const shouldShowDone =
				!recordingSession || !recordingSession.shortId || recordingSession.shortId === currentId;
			recordingSession = null;
			if (shouldShowDone) {
				updateDownloadRecordingUi(1, true);
				setTimeout(() => hardResetDownloadRecordingUi(), 350);
			} else {
				hardResetDownloadRecordingUi();
			}
			return;
		}
		if (msg.type === 'BM_BG_RECORD_ERROR') {
			if (recordingSession && recordingSession.progressTimerId)
				clearInterval(recordingSession.progressTimerId);
			if (recordingSession && recordingSession.watchdogId)
				clearTimeout(recordingSession.watchdogId);
			recordingSession = null;
			hardResetDownloadRecordingUi();
			const err = msg.payload && msg.payload.error ? msg.payload.error : 'unknown';
			console.warn('[BM Shorts Toolbox]', `${t('downloadFailed')} (${err})`);
			if (
				!bgRecordFallbackUsed &&
				(err === 'ui_watchdog_timeout' ||
					err === 'background_tab_closed' ||
					err === 'background_record_timeout')
			) {
				bgRecordFallbackUsed = true;
				startRecorderFallback();
			}
		}
	};
	chrome.runtime.onMessage.addListener(runtimeMsgHandler);

	function getActiveShortsVideo() {
		const activeRendererVideo =
			document.querySelector('ytd-reel-video-renderer[is-active] video') ||
			document.querySelector('ytd-reel-video-renderer[reel-active] video') ||
			document.querySelector("ytd-reel-video-renderer[aria-hidden='false'] video");
		if (activeRendererVideo instanceof HTMLVideoElement) {
			return activeRendererVideo;
		}

		const selectors = ['ytd-reel-video-renderer video', 'ytd-shorts video', '#shorts-player video'];
		const seen = new Set();
		const candidates = [];
		for (const sel of selectors) {
			document.querySelectorAll(sel).forEach((v) => {
				if (v instanceof HTMLVideoElement && !seen.has(v)) {
					seen.add(v);
					candidates.push(v);
				}
			});
		}
		let best = null;
		let bestScore = -1;
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		for (const v of candidates) {
			const r = v.getBoundingClientRect();
			const iw = Math.min(r.right, vw) - Math.max(r.left, 0);
			const ih = Math.min(r.bottom, vh) - Math.max(r.top, 0);
			const area = Math.max(0, iw) * Math.max(0, ih);
			if (area <= 0) continue;
			const centerX = (r.left + r.right) / 2;
			const centerY = (r.top + r.bottom) / 2;
			const centerDist = Math.abs(centerX - vw / 2) / vw;
			const centerDistY = Math.abs(centerY - vh / 2) / vh;
			let score = area * (1 - centerDist * 0.35) * (1 - centerDistY * 0.2);
			const renderer = v.closest('ytd-reel-video-renderer');
			if (renderer instanceof HTMLElement) {
				if (renderer.hasAttribute('is-active') || renderer.hasAttribute('reel-active')) {
					score *= 2.2;
				}
			}
			if (!v.paused && !v.ended && v.readyState >= 2) score *= 1.45;
			if (score > bestScore) {
				bestScore = score;
				best = v;
			}
		}
		return best;
	}

	function applyPlaybackRateTo(video) {
		if (!video) return;
		const rate = getEffectivePlaybackRate();
		try {
			video.playbackRate = rate;
			video.defaultPlaybackRate = rate;
		} catch (_) {}
	}

	function applyToAllLikelyVideos() {
		const primary = getActiveShortsVideo();
		applyPlaybackRateTo(primary);
	}

	function scheduleReapply() {
		if (reapplyTimer) clearTimeout(reapplyTimer);
		reapplyTimer = setTimeout(() => {
			reapplyTimer = null;
			applyToAllLikelyVideos();
		}, 50);
	}

	function cycleSpeed() {
		if (framePlaybackEnabled) return;
		currentIndex = (currentIndex + 1) % SPEEDS.length;
		persistSpeedIndex();
		updateSpeedUiLockedState();
		applyToAllLikelyVideos();
	}

	function getCurrentShortId() {
		const m = location.pathname.match(/\/shorts\/([^/?#]+)/);
		return m ? m[1] : 'short';
	}

	function getActiveShortsRenderer() {
		const v = getActiveShortsVideo();
		if (v instanceof HTMLVideoElement) {
			const byVideo = v.closest('ytd-reel-video-renderer');
			if (byVideo instanceof HTMLElement) return byVideo;
		}
		const byAttr =
			document.querySelector('ytd-reel-video-renderer[is-active]') ||
			document.querySelector('ytd-reel-video-renderer[reel-active]');
		if (byAttr instanceof HTMLElement) return byAttr;
		const first = document.querySelector('ytd-reel-video-renderer');
		return first instanceof HTMLElement ? first : null;
	}

	function buildDownloadFilename() {
		return `${getCurrentVideoTitleSafe()}.webm`;
	}

	function buildRecordingFilename() {
		const base = getCurrentVideoTitleSafe();
		const now = new Date();
		const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
			now.getDate()
		).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(
			now.getMinutes()
		).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
		return `${base}-${stamp}.webm`;
	}

	function getCurrentVideoTitleSafe() {
		const pickText = (sel, base = document) => {
			const el = base.querySelector(sel);
			return el && typeof el.textContent === 'string' ? el.textContent.trim() : '';
		};
		const pickFromList = (base, selectors) => {
			if (!base || typeof base.querySelector !== 'function') return '';
			for (const sel of selectors) {
				const txt = pickText(sel, base);
				if (txt) return txt;
			}
			return '';
		};
		const shortId = getCurrentShortId();
		const activeRenderer = getActiveShortsRenderer();
		const activeHeader =
			activeRenderer &&
			(activeRenderer.querySelector('ytd-reel-player-header-renderer') ||
				activeRenderer.querySelector('ytd-reel-player-overlay-renderer'));
		const globalHeader =
			document.querySelector('ytd-reel-player-header-renderer') ||
			document.querySelector('ytd-reel-player-overlay-renderer');
		const og =
			(document.querySelector('meta[property="og:title"]') &&
				document.querySelector('meta[property="og:title"]').getAttribute('content')) ||
			'';
		const candidates = [
			pickFromList(activeRenderer, [
				'h1',
				'h2',
				'#video-title',
				'yt-formatted-string#title',
				'yt-formatted-string[aria-label]',
			]),
			pickFromList(activeHeader, [
				'h1',
				'h2',
				'#video-title',
				'yt-formatted-string#title',
				'yt-formatted-string[aria-label]',
			]),
			pickFromList(globalHeader, ['h1', 'h2', '#video-title', 'yt-formatted-string#title']),
			og,
			document.title || '',
		];
		const cleanTitle = (raw) =>
			String(raw || '')
				.replace(/\s*-\s*YouTube\s*$/i, '')
				.replace(/\s*#shorts\s*$/i, '')
				.replace(/[\\/:*?"<>|]/g, '_')
				.replace(/\s+/g, ' ')
				.trim();
		for (const c of candidates) {
			const cleaned = cleanTitle(c);
			if (cleaned && cleaned.length >= 2) {
				titleByShortId.set(shortId, cleaned);
				return cleaned;
			}
		}
		const cached = titleByShortId.get(shortId);
		if (cached) {
			return cached;
		}
		const now = new Date();
		const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
			now.getDate()
		).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(
			now.getMinutes()
		).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
		return `youtube-shorts-${shortId}-${stamp}`;
	}

	function parseSignatureCipher(cipher) {
		if (!cipher) return '';
		try {
			const p = new URLSearchParams(cipher);
			const baseUrl = p.get('url') || '';
			const sig = p.get('sig') || p.get('signature') || '';
			const sp = p.get('sp') || 'signature';
			if (!baseUrl) return '';
			if (!sig) return baseUrl;
			const u = new URL(baseUrl);
			u.searchParams.set(sp, sig);
			return u.toString();
		} catch (_) {
			return '';
		}
	}

	function pickBestMuxedFormat(formats) {
		if (!Array.isArray(formats) || !formats.length) return null;
		const usable = formats.filter((f) => {
			const mime = String(f && f.mimeType ? f.mimeType : '');
			return /video\//.test(mime) && /audio\//.test(mime);
		});
		const source = usable.length ? usable : formats;
		source.sort((a, b) => {
			const ah = Number(a && a.height ? a.height : 0);
			const bh = Number(b && b.height ? b.height : 0);
			const abrA = Number(
				a && a.averageBitrate ? a.averageBitrate : a && a.bitrate ? a.bitrate : 0
			);
			const abrB = Number(
				b && b.averageBitrate ? b.averageBitrate : b && b.bitrate ? b.bitrate : 0
			);
			if (bh !== ah) return bh - ah;
			return abrB - abrA;
		});
		return source[0] || null;
	}

	function pickBestVideoFormat(formats) {
		if (!Array.isArray(formats) || !formats.length) return null;
		const source = formats.filter((f) => /video\//.test(String(f && f.mimeType ? f.mimeType : '')));
		if (!source.length) return null;
		source.sort((a, b) => {
			const ah = Number(a && a.height ? a.height : 0);
			const bh = Number(b && b.height ? b.height : 0);
			const abrA = Number(a && a.bitrate ? a.bitrate : 0);
			const abrB = Number(b && b.bitrate ? b.bitrate : 0);
			if (bh !== ah) return bh - ah;
			return abrB - abrA;
		});
		return source[0] || null;
	}

	function collectPlayerResponses() {
		const out = [];
		const wpr = window.ytInitialPlayerResponse;
		if (wpr && typeof wpr === 'object') out.push(wpr);
		try {
			const raw =
				window.ytplayer &&
				window.ytplayer.config &&
				window.ytplayer.config.args &&
				window.ytplayer.config.args.raw_player_response;
			if (raw) {
				const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
				if (parsed && typeof parsed === 'object') out.push(parsed);
			}
		} catch (_) {}
		const activeRenderer =
			document.querySelector('ytd-reel-video-renderer[is-active]') ||
			document.querySelector('ytd-reel-video-renderer');
		if (activeRenderer) {
			const candidates = [
				activeRenderer.playerResponse,
				activeRenderer.data && activeRenderer.data.playerResponse,
			];
			candidates.forEach((c) => {
				if (c && typeof c === 'object') out.push(c);
			});
		}
		return out;
	}

	function extractDownloadUrlFromPlayerResponse() {
		const responses = collectPlayerResponses();
		for (const pr of responses) {
			const sd = pr && pr.streamingData;
			if (!sd) continue;
			const formats = Array.isArray(sd.formats) ? sd.formats : [];
			const best = pickBestMuxedFormat(formats);
			if (!best) continue;
			const direct = best.url || parseSignatureCipher(best.signatureCipher || best.cipher || '');
			if (direct) return direct;
		}
		return '';
	}

	function extractRecordingUrlFromPlayerResponse() {
		const responses = collectPlayerResponses();
		for (const pr of responses) {
			const sd = pr && pr.streamingData;
			if (!sd) continue;
			const adaptive = Array.isArray(sd.adaptiveFormats) ? sd.adaptiveFormats : [];
			const formats = Array.isArray(sd.formats) ? sd.formats : [];
			const bestVideo = pickBestVideoFormat(adaptive);
			if (bestVideo) {
				const u =
					bestVideo.url ||
					parseSignatureCipher(bestVideo.signatureCipher || bestVideo.cipher || '');
				if (u) return u;
			}
			const bestMuxed = pickBestMuxedFormat(formats);
			if (bestMuxed) {
				const u =
					bestMuxed.url ||
					parseSignatureCipher(bestMuxed.signatureCipher || bestMuxed.cipher || '');
				if (u) return u;
			}
		}
		return '';
	}

	function startRecorderFallback() {
		if (recordingSession && typeof recordingSession.stop === 'function') {
			recordingSession.stop();
			return;
		}
		const fail = (code, detail = '') => {
			const suffix = detail ? ` (${code}: ${detail})` : ` (${code})`;
			console.warn('[BM Shorts Toolbox]', `${t('downloadFailed')}${suffix}`);
		};
		const watchVideo = getActiveShortsVideo();
		if (!(watchVideo instanceof HTMLVideoElement)) {
			fail('no_active_video');
			return;
		}
		if (typeof MediaRecorder === 'undefined') {
			fail('mediarecorder_unsupported');
			return;
		}
		const recordUrl =
			watchVideo.currentSrc || watchVideo.src || extractRecordingUrlFromPlayerResponse() || '';
		if (!recordUrl) {
			fail('no_record_url');
			return;
		}

		const hiddenVideo = document.createElement('video');
		hiddenVideo.muted = true;
		hiddenVideo.playsInline = true;
		hiddenVideo.preload = 'auto';
		hiddenVideo.style.cssText =
			'position:fixed;left:-99999px;top:-99999px;width:1px;height:1px;opacity:0;pointer-events:none;';
		hiddenVideo.src = recordUrl;
		(document.body || document.documentElement).appendChild(hiddenVideo);

		const cleanupHidden = () => {
			try {
				hiddenVideo.pause();
			} catch (_) {}
			hiddenVideo.removeAttribute('src');
			hiddenVideo.load();
			hiddenVideo.remove();
		};
		const waitForPlayable = () =>
			new Promise((resolve) => {
				if (hiddenVideo.readyState >= 2) return resolve();
				let done = false;
				const finish = () => {
					if (done) return;
					done = true;
					hiddenVideo.removeEventListener('loadedmetadata', finish);
					hiddenVideo.removeEventListener('canplay', finish);
					resolve();
				};
				hiddenVideo.addEventListener('loadedmetadata', finish, { once: true });
				hiddenVideo.addEventListener('canplay', finish, { once: true });
				setTimeout(finish, 2500);
			});
		const seekToStart = () =>
			new Promise((resolve) => {
				let done = false;
				const finish = () => {
					if (done) return;
					done = true;
					hiddenVideo.removeEventListener('seeked', finish);
					resolve();
				};
				hiddenVideo.addEventListener('seeked', finish, { once: true });
				try {
					hiddenVideo.currentTime = 0;
				} catch (_) {}
				setTimeout(finish, 1200);
			});
		const waitForVideoTrack = (stream) =>
			new Promise((resolve) => {
				const hasTrack = () => stream.getVideoTracks().length > 0;
				if (hasTrack()) return resolve(true);
				let tries = 0;
				const timer = setInterval(() => {
					tries += 1;
					if (hasTrack()) {
						clearInterval(timer);
						resolve(true);
						return;
					}
					if (tries >= 30) {
						clearInterval(timer);
						resolve(false);
					}
				}, 100);
			});

		(async () => {
			try {
				if (typeof hiddenVideo.captureStream !== 'function') {
					cleanupHidden();
					fail('capture_stream_unsupported');
					return;
				}
				await hiddenVideo.play().catch(() => {});
				await waitForPlayable();
				await seekToStart();
				hiddenVideo.playbackRate = 1;
				hiddenVideo.defaultPlaybackRate = 1;
				await hiddenVideo.play().catch(() => {});
				const stream = hiddenVideo.captureStream();
				const trackReady = await waitForVideoTrack(stream);
				if (!trackReady) {
					cleanupHidden();
					fail('no_video_track');
					return;
				}

				const chunks = [];
				const createRecorder = (s) => {
					try {
						return new MediaRecorder(s, { mimeType: 'video/webm;codecs=vp9,opus' });
					} catch (_) {
						try {
							return new MediaRecorder(s, { mimeType: 'video/webm' });
						} catch (_) {
							return null;
						}
					}
				};
				const waitMs = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
				let recorder = createRecorder(stream);
				if (!recorder) {
					cleanupHidden();
					fail('recorder_create_failed');
					return;
				}

				recorder.addEventListener('dataavailable', (ev) => {
					if (ev.data && ev.data.size > 0) chunks.push(ev.data);
				});
				recorder.addEventListener('stop', () => {
					if (!chunks.length) {
						cleanupHidden();
						fail('no_recorded_chunks');
						return;
					}
					const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
					const url = URL.createObjectURL(blob);
					const ok = saveUrlViaAnchor(url, buildDownloadFilename());
					setTimeout(() => URL.revokeObjectURL(url), 10000);
					cleanupHidden();
					if (!ok) fail('save_anchor_failed');
				});

				const stop = () => {
					if (recorder && recorder.state !== 'inactive') recorder.stop();
					hiddenVideo.removeEventListener('ended', stop);
					if (recordingSession && recordingSession.stop === stop) {
						if (recordingSession.progressTimerId) clearInterval(recordingSession.progressTimerId);
						if (recordingSession.timeoutId) clearTimeout(recordingSession.timeoutId);
						recordingSession = null;
						updateDownloadRecordingUi(0, false);
					}
				};

				hiddenVideo.addEventListener('ended', stop, { once: true });
				hiddenVideo.addEventListener('error', stop, { once: true });
				hiddenVideo.addEventListener('abort', stop, { once: true });

				let started = false;
				let startErrorDetail = '';
				for (let i = 0; i < 3 && !started; i++) {
					try {
						recorder.start(250);
						started = true;
					} catch (err) {
						startErrorDetail = err && err.message ? err.message : String(err || 'unknown');
						await waitMs(200);
						const retryStream = hiddenVideo.captureStream();
						const retryReady = await waitForVideoTrack(retryStream);
						if (!retryReady) continue;
						recorder = createRecorder(retryStream);
						if (!recorder) continue;
						recorder.addEventListener('dataavailable', (ev) => {
							if (ev.data && ev.data.size > 0) chunks.push(ev.data);
						});
						recorder.addEventListener('stop', () => {
							if (!chunks.length) {
								cleanupHidden();
								fail('no_recorded_chunks_retry');
								return;
							}
							const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
							const url = URL.createObjectURL(blob);
							const ok = saveUrlViaAnchor(url, buildDownloadFilename());
							setTimeout(() => URL.revokeObjectURL(url), 10000);
							cleanupHidden();
							if (!ok) fail('save_anchor_failed_retry');
						});
					}
				}
				if (!started) {
					cleanupHidden();
					fail('mediarecorder_start_failed', startErrorDetail);
					return;
				}
				const totalSec =
					Number.isFinite(hiddenVideo.duration) && hiddenVideo.duration > 0
						? Math.max(1, hiddenVideo.duration)
						: 0;
				const autoStopMs = totalSec
					? Math.min(Math.ceil((totalSec + 2) * 1000), 30 * 60 * 1000)
					: 30 * 60 * 1000;
				const startedAt = Date.now();
				const timeoutId = setTimeout(stop, autoStopMs);
				const progressTimerId = setInterval(() => {
					if (!recordingSession) return;
					let ratio = 0;
					if (
						Number.isFinite(hiddenVideo.duration) &&
						hiddenVideo.duration > 0 &&
						Number.isFinite(hiddenVideo.currentTime)
					) {
						ratio = hiddenVideo.currentTime / hiddenVideo.duration;
					} else {
						ratio = (Date.now() - startedAt) / autoStopMs;
					}
					updateDownloadRecordingUi(Math.max(0, Math.min(1, ratio)), true);
				}, 120);
				recordingSession = { stop, timeoutId, progressTimerId };
				updateDownloadRecordingUi(0, true);
			} catch (_) {
				cleanupHidden();
				fail('unexpected_exception');
			}
		})();
	}

	function updateDownloadRecordingUi(progressRatio, active) {
		if (!(downloadBtnEl instanceof HTMLElement) || !downloadBtnEl.isConnected) {
			const fallbackBtn = document.querySelector(`#${ROOT_ID} .yts-record-btn`);
			downloadBtnEl = fallbackBtn instanceof HTMLElement ? fallbackBtn : null;
			const fallbackPct = fallbackBtn ? fallbackBtn.querySelector('.yts-record-percent') : null;
			downloadPercentEl = fallbackPct instanceof HTMLElement ? fallbackPct : null;
		}
		if (!(downloadBtnEl instanceof HTMLElement)) return;
		if (!active) {
			downloadBtnEl.classList.remove('yts-recording-active');
			if (downloadPercentEl) downloadPercentEl.textContent = '';
			syncSpeedUiWithNativeLike();
			return;
		}
		const ratio = Math.max(0, Math.min(1, progressRatio));
		const pct = Math.round(ratio * 100);
		downloadBtnEl.style.removeProperty('background-color');
		downloadBtnEl.style.removeProperty('color');
		downloadBtnEl.classList.add('yts-recording-active');
		applyPressedLikeVisualToButton(downloadBtnEl);
		if (downloadPercentEl) downloadPercentEl.textContent = `${pct}%`;
	}

	function hardResetDownloadRecordingUi() {
		updateDownloadRecordingUi(0, false);
		document.querySelectorAll(`#${ROOT_ID} .yts-record-btn`).forEach((el) => {
			if (!(el instanceof HTMLElement)) return;
			el.classList.remove('yts-recording-active');
			const txt = el.querySelector('.yts-record-percent');
			if (txt instanceof HTMLElement) txt.textContent = '';
		});
	}

	function triggerVideoDownload() {
		if (framePlaybackEnabled) stopFramePlayback({ restoreMute: true, restoreSpeed: false });
		forceSpeedTo1x();
		if (recordingSession && typeof recordingSession.stop === 'function') {
			recordingSession.stop();
			return;
		}
		const v = getActiveShortsVideo();
		if (!(v instanceof HTMLVideoElement) || typeof v.captureStream !== 'function') {
			console.warn('[BM Shorts Toolbox]', `${t('downloadFailed')} (no_active_video)`);
			return;
		}

		const createRecorder = (stream) => {
			try {
				return new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
			} catch (_) {
				try {
					return new MediaRecorder(stream, { mimeType: 'video/webm' });
				} catch (_) {
					return null;
				}
			}
		};

		const lock1x = () => {
			try {
				if (Math.abs(v.playbackRate - 1) > 0.001) v.playbackRate = 1;
				if (Math.abs(v.defaultPlaybackRate - 1) > 0.001) v.defaultPlaybackRate = 1;
			} catch (_) {}
		};

		const begin = async () => {
			try {
				v.currentTime = 0;
			} catch (_) {}
			suspendSpeedSync = true;
			lock1x();
			v.addEventListener('ratechange', lock1x);
			await v.play().catch(() => {});

			const stream = v.captureStream();
			if (!stream.getVideoTracks().length) {
				v.removeEventListener('ratechange', lock1x);
				suspendSpeedSync = false;
				applyToAllLikelyVideos();
				console.warn('[BM Shorts Toolbox]', `${t('downloadFailed')} (no_video_track)`);
				return;
			}
			const recorder = createRecorder(stream);
			if (!recorder) {
				v.removeEventListener('ratechange', lock1x);
				suspendSpeedSync = false;
				applyToAllLikelyVideos();
				console.warn('[BM Shorts Toolbox]', `${t('downloadFailed')} (recorder_create_failed)`);
				return;
			}

			const chunks = [];
			recorder.addEventListener('dataavailable', (ev) => {
				if (ev.data && ev.data.size > 0) chunks.push(ev.data);
			});
			recorder.addEventListener('stop', () => {
				v.removeEventListener('ratechange', lock1x);
				suspendSpeedSync = false;
				applyToAllLikelyVideos();
				hardResetDownloadRecordingUi();
				recordingSession = null;
				if (!chunks.length) {
					console.warn('[BM Shorts Toolbox]', `${t('downloadFailed')} (no_recorded_chunks)`);
					return;
				}
				const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
				const url = URL.createObjectURL(blob);
				const ok = saveUrlViaAnchor(url, buildDownloadFilename());
				setTimeout(() => URL.revokeObjectURL(url), 10000);
				if (!ok) {
					console.warn('[BM Shorts Toolbox]', `${t('downloadFailed')} (save_anchor_failed)`);
				}
			});

			let stopRequested = false;
			const stop = () => {
				if (stopRequested) return;
				stopRequested = true;
				try {
					if (recorder.state === 'recording') {
						try {
							recorder.requestData();
						} catch (_) {}
						setTimeout(() => {
							try {
								if (recorder.state !== 'inactive') recorder.stop();
							} catch (_) {
								v.removeEventListener('ratechange', lock1x);
								suspendSpeedSync = false;
								applyToAllLikelyVideos();
								hardResetDownloadRecordingUi();
								recordingSession = null;
							}
						}, 220);
						return;
					}
					if (recorder.state !== 'inactive') recorder.stop();
				} catch (_) {
					v.removeEventListener('ratechange', lock1x);
					suspendSpeedSync = false;
					applyToAllLikelyVideos();
					hardResetDownloadRecordingUi();
					recordingSession = null;
				}
			};

			v.addEventListener('ended', stop, { once: true });
			try {
				recorder.start(250);
			} catch (_) {
				v.removeEventListener('ratechange', lock1x);
				suspendSpeedSync = false;
				applyToAllLikelyVideos();
				console.warn('[BM Shorts Toolbox]', `${t('downloadFailed')} (recorder_start_failed)`);
				return;
			}

			const totalSec = Number.isFinite(v.duration) && v.duration > 0 ? v.duration : 0;
			const autoStopMs = totalSec
				? Math.min(Math.ceil((totalSec + 2) * 1000), 30 * 60 * 1000)
				: 30 * 60 * 1000;
			const startedAt = Date.now();
			const progressTimerId = setInterval(() => {
				if (!recordingSession) return;
				if (Number.isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 0.12) {
					if (recordingSession.stop) recordingSession.stop();
					return;
				}
				let ratio = 0;
				if (Number.isFinite(v.duration) && v.duration > 0) ratio = v.currentTime / v.duration;
				else ratio = (Date.now() - startedAt) / autoStopMs;
				updateDownloadRecordingUi(Math.max(0, Math.min(0.99, ratio)), true);
			}, 120);
			const timeoutId = setTimeout(stop, autoStopMs);
			recordingSession = {
				stop,
				timeoutId,
				progressTimerId,
				shortId: getCurrentShortId(),
				startedAt,
				autoStopMs,
				mediaStream: stream,
			};
			updateDownloadRecordingUi(0, true);
		};

		begin();
	}

	function buildManualRecordFilename() {
		const base = getCurrentVideoTitleSafe();
		const now = new Date();
		const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
			now.getDate()
		).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(
			now.getMinutes()
		).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
		return `${base}-${stamp}.webm`;
	}

	function updateManualRecordUi(active) {
		if (!(recordBtnEl instanceof HTMLElement)) return;
		if (active) {
			recordBtnEl.style.removeProperty('background-color');
			recordBtnEl.style.removeProperty('color');
			recordBtnEl.classList.add('yts-recording-active');
			applyPressedLikeVisualToButton(recordBtnEl);
			return;
		}
		recordBtnEl.classList.remove('yts-recording-active');
		syncSpeedUiWithNativeLike();
	}

	function stopManualRecording() {
		if (!manualRecordSession) return;
		const v = manualRecordSession.video;
		try {
			if (manualRecordSession.recorder && manualRecordSession.recorder.state !== 'inactive') {
				manualRecordSession.recorder.stop();
			}
		} catch (_) {}
		if (v && manualRecordSession.onEnded) {
			v.removeEventListener('ended', manualRecordSession.onEnded);
		}
		if (manualRecordSession.tailGuardId) {
			clearInterval(manualRecordSession.tailGuardId);
		}
		if (manualRecordSession.maxStopId) {
			clearTimeout(manualRecordSession.maxStopId);
		}
		if (!recordingSession && !framePlaybackEnabled) {
			try {
				if (v && !v.paused) v.pause();
			} catch (_) {}
		}
		manualRecordSession = null;
		updateManualRecordUi(false);
	}

	function toggleManualRecording() {
		if (manualRecordSession) {
			stopManualRecording();
			return;
		}
		const v = getActiveShortsVideo();
		if (!(v instanceof HTMLVideoElement) || typeof v.captureStream !== 'function') {
			console.warn('[BM Shorts Toolbox]', t('downloadFailed'), '(manual_record_unavailable)');
			return;
		}
		if (framePlaybackEnabled) {
			stopFramePlayback({ restoreMute: true, restoreSpeed: true, resumePlayback: true });
		}
		const stream =
			recordingSession && recordingSession.mediaStream
				? new MediaStream(recordingSession.mediaStream.getTracks().map((t) => t.clone()))
				: v.captureStream();
		if (!stream.getVideoTracks().length) {
			console.warn('[BM Shorts Toolbox]', t('downloadFailed'), '(manual_record_no_track)');
			return;
		}
		const chunks = [];
		let recorder = null;
		try {
			recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8,opus' });
		} catch (_) {
			try {
				recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
			} catch (_) {
				console.warn('[BM Shorts Toolbox]', t('downloadFailed'), '(manual_record_recorder_failed)');
				return;
			}
		}
		recorder.addEventListener('dataavailable', (ev) => {
			if (ev.data && ev.data.size > 0) chunks.push(ev.data);
		});
		recorder.addEventListener('stop', () => {
			if (!chunks.length) return;
			const blob = new Blob(chunks, { type: recorder.mimeType || 'video/webm' });
			const url = URL.createObjectURL(blob);
			saveUrlViaAnchor(url, buildManualRecordFilename());
			setTimeout(() => URL.revokeObjectURL(url), 10000);
		});
		const onEnded = () => stopManualRecording();
		v.addEventListener('ended', onEnded, { once: true });
		try {
			recorder.start(250);
		} catch (_) {
			v.removeEventListener('ended', onEnded);
			console.warn('[BM Shorts Toolbox]', t('downloadFailed'), '(manual_record_start_failed)');
			return;
		}
		if (v.paused && !framePlaybackEnabled) {
			v.play().catch(() => {});
		}
		const tailGuardId = setInterval(() => {
			if (!manualRecordSession) return;
			if (Number.isFinite(v.duration) && v.duration > 0 && v.currentTime >= v.duration - 0.12) {
				stopManualRecording();
			}
		}, 120);
		const maxStopMs =
			Number.isFinite(v.duration) && v.duration > 0
				? Math.min(Math.ceil((v.duration + 2) * 1000), 30 * 60 * 1000)
				: 30 * 60 * 1000;
		const maxStopId = setTimeout(() => stopManualRecording(), maxStopMs);
		manualRecordSession = {
			recorder,
			video: v,
			onEnded,
			tailGuardId,
			maxStopId,
		};
		updateManualRecordUi(true);
	}

	function buildScreenshotFilename() {
		const base = getCurrentVideoTitleSafe();
		const v = getActiveShortsVideo();
		const sec = v && Number.isFinite(v.currentTime) ? Math.max(0, Math.floor(v.currentTime)) : 0;
		const hh = String(Math.floor(sec / 3600)).padStart(2, '0');
		const mm = String(Math.floor((sec % 3600) / 60)).padStart(2, '0');
		const ss = String(sec % 60).padStart(2, '0');
		const pos = `${hh}-${mm}-${ss}`;
		const now = new Date();
		const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
			now.getDate()
		).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}${String(
			now.getMinutes()
		).padStart(2, '0')}${String(now.getSeconds()).padStart(2, '0')}`;
		return `${base}-${pos}-${stamp}.png`;
	}

	function triggerFrameScreenshot() {
		const v = getActiveShortsVideo();
		if (!(v instanceof HTMLVideoElement) || !v.videoWidth || !v.videoHeight) {
			console.warn('[BM Shorts Toolbox]', t('screenshotNoVideoSource'));
			return;
		}
		const canvas = document.createElement('canvas');
		canvas.width = v.videoWidth;
		canvas.height = v.videoHeight;
		const ctx = canvas.getContext('2d');
		if (!ctx) {
			console.warn('[BM Shorts Toolbox]', t('screenshotFailed'));
			return;
		}
		ctx.drawImage(v, 0, 0, canvas.width, canvas.height);
		const dataUrl = canvas.toDataURL('image/png');
		const filename = buildScreenshotFilename();
		const directOk = saveUrlViaAnchor(dataUrl, filename);
		if (directOk) return;
		chrome.runtime.sendMessage(
			{
				type: 'BM_TOOLBOX_DOWNLOAD',
				payload: {
					url: dataUrl,
					filename,
				},
			},
			(resp) => {
				if (chrome.runtime.lastError) {
					console.warn('[BM Shorts Toolbox]', chrome.runtime.lastError.message);
					return;
				}
				if (!resp || !resp.ok) {
					console.warn(
						'[BM Shorts Toolbox]',
						resp && resp.error ? resp.error : t('screenshotFailed')
					);
				}
			}
		);
	}

	function saveUrlViaAnchor(url, filename) {
		try {
			const a = document.createElement('a');
			a.href = url;
			a.download = filename;
			a.rel = 'noopener';
			a.style.display = 'none';
			(document.body || document.documentElement).appendChild(a);
			a.click();
			a.remove();
			return true;
		} catch (_) {
			return false;
		}
	}

	function ensureMounted() {
		if (speedRootEl && speedRootEl.isConnected) return true;
		const anchorRow = findFallbackAnchorRow();
		if (!anchorRow || !anchorRow.parentElement) return false;

		const root = document.createElement('div');
		root.id = ROOT_ID;
		root.setAttribute('data-open', '0');
		root.toggleAttribute('data-expand-up', !panelExpandRightEnabled);

		const mainItem = document.createElement('div');
		mainItem.className = 'yts-tool-item yts-tool-item-main';
		const mainBtn = document.createElement('button');
		mainBtn.type = 'button';
		mainBtn.className = 'yts-speed-btn';
		mainBtn.classList.add('yts-tool-main-btn');
		mainBtn.setAttribute('aria-label', t('ariaToolbox'));
		mainBtn.appendChild(createGearSvg());
		mainBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			togglePanel();
		});
		const mainCaption = document.createElement('span');
		mainCaption.className = 'yts-speed-caption';
		mainCaption.textContent = t('captionToolbox');
		mainItem.appendChild(mainBtn);
		mainItem.appendChild(mainCaption);

		const panel = document.createElement('div');
		panel.className = 'yts-toolbox-panel';

		const speedItem = document.createElement('div');
		speedItem.className = 'yts-tool-item yts-tool-item-speed';
		const speedBtn = document.createElement('button');
		speedBtn.type = 'button';
		speedBtn.className = 'yts-speed-btn';
		speedBtn.setAttribute('aria-label', t('ariaPlaybackSpeed'));
		speedBtnEl = speedBtn;
		btnLabel = document.createElement('span');
		btnLabel.className = 'yts-speed-value';
		btnLabel.textContent = formatSpeedLabel(getSpeed());
		speedBtn.appendChild(btnLabel);
		speedLockIconEl = createLockSvg();
		speedBtn.appendChild(speedLockIconEl);
		speedBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			cycleSpeed();
		});
		const speedCaption = document.createElement('span');
		speedCaption.className = 'yts-speed-caption';
		speedCaption.textContent = t('captionSpeed');
		speedItem.appendChild(speedBtn);
		speedItem.appendChild(speedCaption);

		const frameItem = document.createElement('div');
		frameItem.className = 'yts-tool-item yts-tool-item-frame';
		const frameBtn = document.createElement('button');
		frameBtn.type = 'button';
		frameBtn.className = 'yts-speed-btn yts-frame-btn';
		frameBtn.setAttribute('aria-label', t('ariaFrameStep'));
		frameBtn.appendChild(createFrameStepSvg());
		frameBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			toggleFramePlayback();
		});
		const frameCaption = document.createElement('span');
		frameCaption.className = 'yts-speed-caption';
		frameCaption.textContent = t('captionFrameStep');
		frameItem.appendChild(frameBtn);
		frameItem.appendChild(frameCaption);
		framePlayBtnEl = frameBtn;

		const screenshotItem = document.createElement('div');
		screenshotItem.className = 'yts-tool-item yts-tool-item-screenshot';
		const screenshotBtn = document.createElement('button');
		screenshotBtn.type = 'button';
		screenshotBtn.className = 'yts-speed-btn';
		screenshotBtn.setAttribute('aria-label', t('ariaScreenshot'));
		screenshotBtn.appendChild(createScreenshotSvg());
		screenshotBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			triggerFrameScreenshot();
		});
		const screenshotCaption = document.createElement('span');
		screenshotCaption.className = 'yts-speed-caption';
		screenshotCaption.textContent = t('captionScreenshot');
		screenshotItem.appendChild(screenshotBtn);
		screenshotItem.appendChild(screenshotCaption);

		const recordItem = document.createElement('div');
		recordItem.className = 'yts-tool-item yts-tool-item-record';
		const recordBtn = document.createElement('button');
		recordBtn.type = 'button';
		recordBtn.className = 'yts-speed-btn';
		recordBtn.classList.add('yts-manual-record-btn');
		recordBtn.setAttribute('aria-label', t('ariaRecord'));
		recordBtn.appendChild(createRecordSvg());
		recordBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			toggleManualRecording();
		});
		const recordCaption = document.createElement('span');
		recordCaption.className = 'yts-speed-caption';
		recordCaption.textContent = t('captionRecord');
		recordItem.appendChild(recordBtn);
		recordItem.appendChild(recordCaption);

		const downloadItem = document.createElement('div');
		downloadItem.className = 'yts-tool-item yts-tool-item-download';
		const downloadBtn = document.createElement('button');
		downloadBtn.type = 'button';
		downloadBtn.className = 'yts-speed-btn';
		downloadBtn.classList.add('yts-record-btn');
		downloadBtn.setAttribute('aria-label', t('ariaDownload'));
		downloadBtn.appendChild(createDownloadSvg());
		const recordPercent = document.createElement('span');
		recordPercent.className = 'yts-record-percent';
		recordPercent.textContent = '';
		downloadBtn.appendChild(recordPercent);
		downloadBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			triggerVideoDownload();
		});
		const downloadCaption = document.createElement('span');
		downloadCaption.className = 'yts-speed-caption';
		downloadCaption.textContent = t('captionDownload');
		downloadItem.appendChild(downloadBtn);
		downloadItem.appendChild(downloadCaption);

		panel.appendChild(speedItem);
		panel.appendChild(frameItem);
		panel.appendChild(screenshotItem);
		panel.appendChild(recordItem);
		panel.appendChild(downloadItem);
		root.appendChild(mainItem);
		root.appendChild(panel);

		attachRootAtRow(root, anchorRow);

		const rn = root.getRootNode();
		speedRootEl = root;
		downloadBtnEl = downloadBtn;
		downloadPercentEl = recordPercent;
		recordBtnEl = recordBtn;
		updateFramePlaybackUi();
		updateSpeedUiLockedState();
		ensureStylesInShadowRoot(rn);
		syncSpeedUiWithNativeLike();
		applyToAllLikelyVideos();
		return true;
	}

	function removeExternal3xWidgets() {
		const all = document.querySelectorAll(`#${ROOT_ID}`);
		all.forEach((el) => {
			if (!(el instanceof HTMLElement)) return;
			if (el === speedRootEl) return;
			if (el.querySelector('.yts-toolbox-panel')) return;
			el.remove();
		});
	}

	function teardownVideoHooks() {
		if (videoObserver) {
			videoObserver.disconnect();
			videoObserver = null;
		}
	}

	function hookVideoElement(v) {
		if (!(v instanceof HTMLVideoElement) || v.dataset[VIDEO_HOOK_KEY]) return;
		v.dataset[VIDEO_HOOK_KEY] = '1';
		v.addEventListener('ratechange', () => {
			if (suspendSpeedSync) return;
			const want = getEffectivePlaybackRate();
			if (Math.abs(v.playbackRate - want) > 0.01) {
				applyPlaybackRateTo(v);
			}
		});
		v.addEventListener('loadedmetadata', scheduleReapply);
		v.addEventListener('playing', scheduleReapply);
	}

	function hookAllVideosUnder(root) {
		root.querySelectorAll('video').forEach(hookVideoElement);
	}

	function setupVideoHooks() {
		teardownVideoHooks();
		const shortsRoot =
			document.querySelector('ytd-shorts') ||
			document.querySelector('#shorts-container') ||
			document.body;
		hookAllVideosUnder(shortsRoot);
		videoObserver = new MutationObserver((muts) => {
			for (const m of muts) {
				m.addedNodes.forEach((n) => {
					if (n instanceof HTMLVideoElement) hookVideoElement(n);
					else if (n instanceof Element) hookAllVideosUnder(n);
				});
			}
			scheduleReapply();
		});
		videoObserver.observe(shortsRoot, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: ['hidden', 'class', 'style'],
		});
	}

	function playbackHoldGestureAllowed() {
		if (framePlaybackEnabled) return false;
		if (recordingSession) return false;
		if (manualRecordSession) return false;
		if (suspendSpeedSync) return false;
		return true;
	}

	function shouldStartHold(e) {
		if (!playbackHoldGestureAllowed()) return false;
		if (!e.isPrimary) return false;
		if (e.pointerType === 'mouse' && e.button !== 0) return false;
		const t = e.target;
		if (!(t instanceof Element)) return false;
		if (t.closest('input, textarea, select, [contenteditable="true"]')) return false;
		if (t.closest('#' + ROOT_ID)) return false;
		if (isInsideCommentsPanel(t)) return false;
		if (
			t.closest('#actions, ytd-reel-player-overlay-renderer #actions, reel-action-bar-item-view-model')
		)
			return false;

		const v = getActiveShortsVideo();
		if (!v) return false;
		const x = e.clientX;
		const y = e.clientY;
		const r = v.getBoundingClientRect();
		if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;

		const actions = document.querySelector('ytd-reel-player-overlay-renderer #actions');
		if (actions) {
			const ar = actions.getBoundingClientRect();
			if (x >= ar.left && x <= ar.right && y >= ar.top && y <= ar.bottom) return false;
		}
		return true;
	}

	const HOLD_ACTIVATE_MS = 200;

	let holdListenersInstalled = false;
	function installHoldListeners() {
		if (holdListenersInstalled) return;
		holdListenersInstalled = true;

		let pendingPointerId = null;
		let pendingTimer = null;

		function tearDownReleaseListeners() {
			window.removeEventListener('pointerup', onRelease, true);
			window.removeEventListener('pointercancel', onRelease, true);
			window.removeEventListener('blur', onBlurWhilePendingOrHold, false);
		}

		function suppressSyntheticClickAfterHold() {
			function blockClick(ev) {
				ev.preventDefault();
				ev.stopImmediatePropagation();
				document.removeEventListener('click', blockClick, true);
			}
			document.addEventListener('click', blockClick, true);
		}

		function deactivateHoldPlayback() {
			if (!holdActive) return;
			holdActive = false;
			holdPointerId = null;
			applyToAllLikelyVideos();
		}

		function activateHoldPlayback(pid) {
			holdActive = true;
			holdPointerId = pid;
			applyToAllLikelyVideos();
		}

		function cancelPendingHold() {
			if (pendingTimer !== null) {
				clearTimeout(pendingTimer);
				pendingTimer = null;
			}
			pendingPointerId = null;
		}

		function onBlurWhilePendingOrHold() {
			cancelPendingHold();
			tearDownReleaseListeners();
			deactivateHoldPlayback();
		}

		function onRelease(e) {
			if (pendingPointerId === null) return;
			if (e && e.pointerId !== undefined && e.pointerId !== pendingPointerId) return;

			const hadAccelerated = holdActive;

			cancelPendingHold();
			tearDownReleaseListeners();

			if (hadAccelerated) {
				deactivateHoldPlayback();
				suppressSyntheticClickAfterHold();
			}
		}

		document.documentElement.addEventListener(
			'pointerdown',
			(e) => {
				if (holdActive || pendingPointerId !== null) return;
				if (!shouldStartHold(e)) return;

				pendingPointerId = e.pointerId;
				pendingTimer = setTimeout(() => {
					pendingTimer = null;
					activateHoldPlayback(pendingPointerId);
				}, HOLD_ACTIVATE_MS);

				window.addEventListener('pointerup', onRelease, true);
				window.addEventListener('pointercancel', onRelease, true);
				window.addEventListener('blur', onBlurWhilePendingOrHold, false);
			},
			true
		);
	}

	function initObservers() {
		if (mountObserver) mountObserver.disconnect();
		mountObserver = new MutationObserver(() => {
			if (!(speedRootEl && speedRootEl.isConnected)) {
				speedRootEl = null;
				if (ensureMounted()) setupVideoHooks();
			} else {
				ensureSpeedAnchorIntact();
				scheduleReapply();
			}
		});
		mountObserver.observe(document.documentElement, {
			childList: true,
			subtree: true,
		});
	}

	function startBootstrapRetries() {
		if (bootstrapRetryTimer) {
			clearInterval(bootstrapRetryTimer);
			bootstrapRetryTimer = null;
		}
		bootstrapRetryCount = 0;
		bootstrapRetryTimer = setInterval(() => {
			bootstrapRetryCount += 1;
			tick();
			if ((speedRootEl && speedRootEl.isConnected) || bootstrapRetryCount >= 60) {
				clearInterval(bootstrapRetryTimer);
				bootstrapRetryTimer = null;
			}
		}, 250);
	}

	function destroyInstance() {
		if (mountObserver) {
			mountObserver.disconnect();
			mountObserver = null;
		}
		teardownVideoHooks();
		if (bootstrapRetryTimer) {
			clearInterval(bootstrapRetryTimer);
			bootstrapRetryTimer = null;
		}
		if (mainTickInterval) {
			clearInterval(mainTickInterval);
			mainTickInterval = null;
		}
		document.removeEventListener('click', onDocumentClick, true);
		document.removeEventListener('keydown', onDocumentKeydown, true);
		if (runtimeMsgHandler) {
			chrome.runtime.onMessage.removeListener(runtimeMsgHandler);
			runtimeMsgHandler = null;
		}
		window.removeEventListener('pageshow', startBootstrapRetries);
		window.removeEventListener('yt-navigate-finish', startBootstrapRetries);
		if (speedRootEl && speedRootEl.isConnected) {
			speedRootEl.remove();
		}
		stopFramePlayback({ restoreMute: true });
		speedRootEl = null;
		speedBtnEl = null;
		speedLockIconEl = null;
		framePlayBtnEl = null;
		downloadBtnEl = null;
		downloadPercentEl = null;
		recordBtnEl = null;
		stopManualRecording();
		if (recordingSession && recordingSession.progressTimerId) {
			clearInterval(recordingSession.progressTimerId);
		}
		if (recordingSession && recordingSession.watchdogId) {
			clearTimeout(recordingSession.watchdogId);
		}
		recordingSession = null;
		remixRowEl = null;
		remixButtonEl = null;
		if (w[INSTANCE_KEY] && w[INSTANCE_KEY].destroy === destroyInstance) {
			delete w[INSTANCE_KEY];
		}
	}

	function tick() {
		document.documentElement.setAttribute(CONTROLLER_ATTR, 'toolbox');
		removeExternal3xWidgets();
		if (!ensureMounted()) return;
		if (recordingSession) {
			if (recordingSession.shortId === getCurrentShortId()) {
				const ratio = Math.max(
					0,
					Math.min(0.99, (Date.now() - recordingSession.startedAt) / recordingSession.autoStopMs)
				);
				updateDownloadRecordingUi(ratio, true);
			} else {
				updateDownloadRecordingUi(0, false);
			}
		} else {
			updateDownloadRecordingUi(0, false);
		}
		neutralizeBlockingOverlays();
		ensureSpeedAnchorIntact();
		if (!videoObserver) setupVideoHooks();
		scheduleReapply();
		syncToolboxLayoutWithNative();
		syncSpeedUiWithNativeLike();
	}

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', () => {
			tick();
			startBootstrapRetries();
		});
	} else {
		tick();
		startBootstrapRetries();
	}
	setupArrowVolumeSettingSync();
	installHoldListeners();
	w.__BM_TOOLBOX_DIAG__ = () => ({
		hasRoot: !!(speedRootEl && speedRootEl.isConnected),
		rootVars:
			speedRootEl && speedRootEl.isConnected
				? {
						btnSize: getComputedStyle(speedRootEl).getPropertyValue('--bm-btn-size').trim(),
						itemHeight: getComputedStyle(speedRootEl).getPropertyValue('--bm-item-height').trim(),
						rowSpeed: getComputedStyle(speedRootEl).getPropertyValue('--bm-row-speed').trim(),
						rowFrame: getComputedStyle(speedRootEl).getPropertyValue('--bm-row-frame').trim(),
						rowScreenshot: getComputedStyle(speedRootEl)
							.getPropertyValue('--bm-row-screenshot')
							.trim(),
						rowRecord: getComputedStyle(speedRootEl).getPropertyValue('--bm-row-record').trim(),
						rowDownload: getComputedStyle(speedRootEl).getPropertyValue('--bm-row-download').trim(),
						captionColor: getComputedStyle(speedRootEl)
							.getPropertyValue('--bm-caption-color')
							.trim(),
					}
				: null,
		layout: lastLayoutDiag,
	});
	initObservers();
	window.addEventListener('pageshow', startBootstrapRetries);
	window.addEventListener('yt-navigate-finish', startBootstrapRetries);
	mainTickInterval = setInterval(tick, 2000);
	w[INSTANCE_KEY] = { destroy: destroyInstance };
})();
