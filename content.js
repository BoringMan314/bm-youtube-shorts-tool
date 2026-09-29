(function () {
	'use strict';

	const SPEEDS = [1, 1.5, 2, 3];
	const VOLUME_STEP_PERCENT = 5;
	const ROOT_ID = 'yts-speed-root';
	// Keep the toolbox just above the Shorts player. YouTube's menu/dialog
	// layers use a higher stacking level, so native right-click menus remain
	// interactive and visually on top.
	const TOOLBOX_TOP_Z = '4';
	const INSTANCE_KEY = '__bmYtsToolboxInstance__';
	const VIDEO_HOOK_KEY = 'bmYtsToolboxHooked';
	const CONTROLLER_ATTR = 'data-bm-yts-controller';
	const TOOLBOX_ROLE = 'toolbox';
	const SPEED3X_ROLE = 'speed';
	const COMMENTS_OPEN_ATTR = 'data-bm-yts-comments-open';
	const RESIZE_LOCK_ATTR = 'data-bm-yts-resize-lock';
	const WINDOW_RESIZE_HOLD_MS = 2000;
	const EXPLICIT_NAV_MS = 2000;
	const SPEED_STORAGE_KEY = 'bmYtsToolboxSpeed';
	const VOLUME_HOTKEY_STORAGE_KEY = 'bmYtsArrowVolumeEnabled';
	const PANEL_EXPAND_RIGHT_STORAGE_KEY = 'bmYtsPanelExpandRight';
	const STORAGE_KEY_DEFAULT_SPEED_INDEX = 'bmYts3xOptsDefaultSpeedIndex';
	const STORAGE_KEY_HOLD_SPEED_INDEX = 'bmYts3xOptsHoldSpeedIndex';
	const STORAGE_KEY_AUTO_NEXT = 'bmYtsToolboxAutoNextEnabled';
	const STORAGE_KEY_PLAY_COUNT_BEFORE_NEXT = 'bmYtsToolboxPlayCountBeforeNext';
	const FALLBACK_MESSAGES = {
		zhTW: {
			ariaDownload: '下載', ariaFrameStep: '逐幀播放', ariaPlaybackSpeed: '播放速度',
			ariaRecord: '錄製', ariaScreenshot: '截圖', ariaToolbox: '工具箱',
			captionDownload: '下載', captionFrameStep: '逐幀', captionRecord: '錄製',
			captionScreenshot: '截圖', captionSpeed: '速度', captionToolbox: '工具箱',
			downloadFailed: '下載啟動失敗。', screenshotFailed: '截圖失敗。',
			screenshotNoVideoSource: '目前抓不到可截圖的影片來源。',
		},
		zhCN: {
			ariaDownload: '下载', ariaFrameStep: '逐帧播放', ariaPlaybackSpeed: '播放速度',
			ariaRecord: '录制', ariaScreenshot: '截图', ariaToolbox: '工具箱',
			captionDownload: '下载', captionFrameStep: '逐帧', captionRecord: '录制',
			captionScreenshot: '截图', captionSpeed: '速度', captionToolbox: '工具箱',
			downloadFailed: '下载启动失败。', screenshotFailed: '截图失败。',
			screenshotNoVideoSource: '当前无法获取可截图的视频来源。',
		},
		en: {
			ariaDownload: 'Download', ariaFrameStep: 'Frame-by-frame playback', ariaPlaybackSpeed: 'Playback speed',
			ariaRecord: 'Record', ariaScreenshot: 'Screenshot', ariaToolbox: 'Toolbox',
			captionDownload: 'Download', captionFrameStep: 'Frame', captionRecord: 'Record',
			captionScreenshot: 'Screenshot', captionSpeed: 'Speed', captionToolbox: 'Toolbox',
			downloadFailed: 'Failed to start download.', screenshotFailed: 'Screenshot failed.',
			screenshotNoVideoSource: 'No video source is available for a screenshot.',
		},
		ja: {
			ariaDownload: 'ダウンロード', ariaFrameStep: 'コマ送り再生', ariaPlaybackSpeed: '再生速度',
			ariaRecord: '録画', ariaScreenshot: 'スクリーンショット', ariaToolbox: 'ツールボックス',
			captionDownload: '保存', captionFrameStep: 'コマ', captionRecord: '録画',
			captionScreenshot: '画像', captionSpeed: '速度', captionToolbox: 'ツール',
			downloadFailed: 'ダウンロードの開始に失敗しました。', screenshotFailed: 'スクリーンショットに失敗しました。',
			screenshotNoVideoSource: 'スクリーンショット用の動画ソースが見つかりません。',
		},
	};
	const w = window;
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
		const language = String(navigator.language || '').toLowerCase();
		const messages = language.startsWith('ja')
			? FALLBACK_MESSAGES.ja
			: language.startsWith('en')
				? FALLBACK_MESSAGES.en
				: /zh-(cn|sg)|hans/.test(language)
					? FALLBACK_MESSAGES.zhCN
					: FALLBACK_MESSAGES.zhTW;
		return messages[key] || key;
	}

	let currentIndex = 0;
	let holdActive = false;
	let holdPointerId = null;
	let holdSpeedIndex = 2;
	let autoNextEnabled = false;
	let playCountBeforeNext = 2;
	let playThroughCount = 0;
	let playThroughShortId = '';
	let lastPlayCompletionAt = 0;
	let lastAdvanceToNextAt = 0;
	let autoAdvancePendingUntil = 0;
	let autoAdvanceSourceShortId = '';
	let autoAdvanceMountNotBefore = 0;
	let autoAdvanceMountTimer = null;

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

	function clampPlayCount(n) {
		const v = Number(n);
		if (!Number.isFinite(v)) return 2;
		return Math.max(1, Math.min(999, Math.floor(v)));
	}

	function persistSpeedIndex() {
		try {
			sessionStorage.setItem(SPEED_STORAGE_KEY, String(currentIndex));
		} catch (_) {}
	}

	function persistDefaultSpeedIndex() {
		try {
			chrome.storage.local.set({
				[STORAGE_KEY_DEFAULT_SPEED_INDEX]: currentIndex,
			});
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
	let mutatingDom = false;
	let mountWorkScheduled = false;
	let lastAnchorFixAt = 0;
	let lastOverlayNeutralizeAt = 0;
	let layoutQuietUntil = 0;
	let layoutResumeTimer = null;
	let resizePinnedShortId = '';
	let urlLockShortId = '';
	let explicitShortNavUntil = 0;
	let explicitNavAt = 0;
	let resizePinnedSequenceId = '';
	let resizePinnedHost = null;
	let resizePinnedIndex = -1;
	let restorePinnedRetryTimer = null;
	let resizeHoldRaf = 0;
	let resizeScrollGuard = false;
	let shortsResizeObserver = null;
	let windowBoxObserver = null;
	let resizeUnlockTries = 0;
	let shortsResizeReady = false;
	let lastObservedShortsSize = '';
	let lastWindowResizeAt = 0;
	let windowLayoutBoxKey = `${window.innerWidth}x${window.innerHeight}|${window.outerWidth}x${window.outerHeight}`;
	let mainTickInterval = null;
	let commentsLiftSlotEl = null;
	let commentsWantedOpen = false;
	let commentsUserDismissedUntil = 0;
	let commentsRefreshTries = 0;
	let lastCommentsFollowShortId = '';
	let nativeAnchorObserver = null;
	let nativeAnchorObservedEls = [];
	let commentsAttrObserver = null;
	let nativeFollowUntil = 0;
	let nativeFollowRaf = 0;
	let lastNativeAnchorKey = '';
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
	let toolboxPanelWantedOpen = false;
	let volumeHoverHideTimer = null;
	let volumeHoverHostEl = null;
	let volumeHoverUntil = 0;
	let volumeHoverPct = 0;
	let volumeHoverPaintTimer = null;
	let volumeHoverFocusedEl = null;

	function loadArrowVolumeSetting() {
		try {
			chrome.storage.local.get(
				{
					[VOLUME_HOTKEY_STORAGE_KEY]: true,
					[PANEL_EXPAND_RIGHT_STORAGE_KEY]: true,
					[STORAGE_KEY_DEFAULT_SPEED_INDEX]: 0,
					[STORAGE_KEY_HOLD_SPEED_INDEX]: 2,
					[STORAGE_KEY_AUTO_NEXT]: false,
					[STORAGE_KEY_PLAY_COUNT_BEFORE_NEXT]: 2,
				},
				(res) => {
					if (chrome.runtime.lastError) return;
					leftRightVolumeEnabled = res[VOLUME_HOTKEY_STORAGE_KEY] !== false;
					panelExpandRightEnabled = res[PANEL_EXPAND_RIGHT_STORAGE_KEY] !== false;
					holdSpeedIndex = clampSpeedIndex(res[STORAGE_KEY_HOLD_SPEED_INDEX]);
					autoNextEnabled = res[STORAGE_KEY_AUTO_NEXT] === true;
					playCountBeforeNext = clampPlayCount(res[STORAGE_KEY_PLAY_COUNT_BEFORE_NEXT]);
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
				if (changes[STORAGE_KEY_AUTO_NEXT]) {
					autoNextEnabled = changes[STORAGE_KEY_AUTO_NEXT].newValue === true;
					if (!autoNextEnabled) {
						playThroughCount = 0;
						lastPlayCompletionAt = 0;
					}
				}
				if (changes[STORAGE_KEY_PLAY_COUNT_BEFORE_NEXT]) {
					playCountBeforeNext = clampPlayCount(changes[STORAGE_KEY_PLAY_COUNT_BEFORE_NEXT].newValue);
				}
				if (changes[STORAGE_KEY_DEFAULT_SPEED_INDEX]) {
					const next = clampSpeedIndex(changes[STORAGE_KEY_DEFAULT_SPEED_INDEX].newValue);
					if (next === currentIndex) return;
					currentIndex = next;
					persistSpeedIndex();
					updateSpeedUiLockedState();
					applyToAllLikelyVideos();
				}
			});
		} catch (_) {}
	}

	const SHADOW_STYLES = `
#${ROOT_ID}{--bm-btn-size:48px;--bm-item-height:92px;--bm-item-gap:0px;--bm-caption-color:var(--yt-spec-text-primary,#fff);--bm-btn-bg:rgba(255,255,255,.1);--bm-btn-fg:#fff;--bm-btn-bg-hover:rgba(255,255,255,.1);--bm-btn-bg-active:rgba(255,255,255,.2);--bm-btn-backdrop:blur(8px);--bm-icon-size:24px;--bm-caption-size:12px;--bm-caption-weight:500;--bm-top-row-offset:0px;--bm-row-speed:0px;--bm-row-frame:92px;--bm-row-screenshot:184px;--bm-row-record:276px;--bm-row-download:368px;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;width:var(--bm-btn-size);margin-bottom:0;flex-shrink:0;pointer-events:auto;row-gap:0;position:relative;overflow:visible;z-index:4}
#${ROOT_ID}[data-bm-theme="light"]{--bm-btn-bg:rgba(0,0,0,.05);--bm-btn-fg:#0f0f0f;--bm-btn-bg-hover:rgba(0,0,0,.1);--bm-btn-bg-active:rgba(0,0,0,.2);--bm-caption-color:#0f0f0f}
#${ROOT_ID}[data-bm-overlay-dark]{--bm-btn-bg:rgba(0,0,0,.3);--bm-btn-fg:#fff;--bm-btn-bg-hover:rgba(255,255,255,.1);--bm-btn-bg-active:rgba(255,255,255,.2);--bm-btn-backdrop:none;--bm-caption-color:#fff}
#${ROOT_ID} .yts-speed-btn{box-sizing:border-box;width:var(--bm-btn-size);height:var(--bm-btn-size);padding:0;margin:0;border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-family:Roboto,"YouTube Noto",Arial,sans-serif;font-size:13px;font-weight:600;line-height:1;letter-spacing:-0.02em;color:var(--bm-btn-fg,#fff);background-color:var(--bm-btn-bg,rgba(255,255,255,.1));backdrop-filter:var(--bm-btn-backdrop,blur(8px));-webkit-backdrop-filter:var(--bm-btn-backdrop,blur(8px));transition:none;position:relative;overflow:hidden}
#${ROOT_ID} .yts-speed-btn::after{content:"";position:absolute;inset:0;border-radius:inherit;background:transparent;pointer-events:none}
#${ROOT_ID}[data-bm-theme="dark"] .yts-speed-btn{color:var(--bm-btn-fg,#fff);background-color:var(--bm-btn-bg,rgba(255,255,255,.1))}
#${ROOT_ID}[data-bm-theme="light"] .yts-speed-btn{color:var(--bm-btn-fg,#0f0f0f);background-color:var(--bm-btn-bg,rgba(0,0,0,.05))}
#${ROOT_ID}[data-bm-overlay-dark] .yts-speed-btn{color:var(--bm-btn-fg,#fff);background-color:var(--bm-btn-bg,rgba(0,0,0,.3));backdrop-filter:none;-webkit-backdrop-filter:none}
#${ROOT_ID} .yts-speed-btn.yts-speed-locked{cursor:not-allowed;filter:saturate(.7)}
#${ROOT_ID} .yts-speed-btn.yts-speed-locked:hover{filter:saturate(.7)}
#${ROOT_ID} .yts-speed-lock-icon{display:none}
#${ROOT_ID} .yts-speed-btn.yts-speed-locked .yts-speed-lock-icon{display:block}
#${ROOT_ID} .yts-speed-btn.yts-speed-locked .yts-speed-value{display:none}
#${ROOT_ID} .yts-record-btn{position:relative;overflow:hidden}
#${ROOT_ID} .yts-record-btn.yts-recording-active{background-color:var(--yt-spec-static-brand-white,#fff);color:var(--yt-spec-static-brand-black,#000)}
#${ROOT_ID} .yts-record-btn.yts-recording-active .yts-toolbox-icon{display:none}
#${ROOT_ID} .yts-record-percent{display:none;font-size:16px;font-weight:700;line-height:1;color:currentColor;position:relative;z-index:1}
#${ROOT_ID} .yts-record-btn.yts-recording-active .yts-record-percent{display:block}
#${ROOT_ID} .yts-manual-record-btn.yts-recording-active{background-color:var(--yt-spec-static-brand-white,#fff);color:var(--yt-spec-static-brand-black,#000)}
#${ROOT_ID} .yts-frame-btn.yts-frame-active{background-color:var(--yt-spec-static-brand-white,#fff);color:var(--yt-spec-static-brand-black,#000)}
#${ROOT_ID} .yts-tool-main-btn{position:relative}
#${ROOT_ID} .yts-tool-main-btn .yts-toolbox-icon{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1}
#${ROOT_ID} .yts-speed-value{font-size:20px;font-weight:600;line-height:1;letter-spacing:-0.02em;position:relative;z-index:1}
#${ROOT_ID} .yts-speed-btn:hover{filter:none;background-color:var(--bm-btn-bg,rgba(255,255,255,.1))}
#${ROOT_ID} .yts-speed-btn:hover::after{background:var(--bm-btn-bg-hover,rgba(255,255,255,.1))}
#${ROOT_ID} .yts-speed-btn:active{filter:none;transform:none}
#${ROOT_ID} .yts-speed-btn:active::after{background:var(--bm-btn-bg-active,rgba(255,255,255,.2))}
#${ROOT_ID} .yts-speed-caption{margin-top:6px;max-width:56px;text-align:center;font-family:Roboto,"YouTube Noto",Arial,sans-serif;font-size:var(--bm-caption-size,12px);font-weight:var(--bm-caption-weight,500);line-height:1.2;color:var(--bm-caption-color,inherit)!important;opacity:1;white-space:nowrap}
#${ROOT_ID}[data-bm-theme="dark"] .yts-speed-caption{color:#fff!important}
#${ROOT_ID}[data-bm-theme="light"] .yts-speed-caption{color:#0f0f0f!important}
#${ROOT_ID}[data-bm-overlay-dark] .yts-speed-caption{color:#fff!important}
#${ROOT_ID} .yts-toolbox-icon{width:var(--bm-icon-size,24px);height:var(--bm-icon-size,24px);display:block;margin:0 auto;position:relative;z-index:1}
#${ROOT_ID} .yts-toolbox-panel{position:absolute;top:0;left:calc(100% + 8px);display:block;width:var(--bm-btn-size);min-height:calc(var(--bm-row-download) + var(--bm-item-height));opacity:0;transform:translateX(-4px) scale(.98);transform-origin:left top;pointer-events:none;transition:opacity .15s ease,transform .15s ease;z-index:4}
#${ROOT_ID}[data-open="1"] .yts-toolbox-panel{opacity:1;transform:translateX(0) scale(1);pointer-events:auto;z-index:4}
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
			querySelectorDeep('like-button-view-model button.yt-spec-button-shape-next', scope) ||
			querySelectorDeep('like-button-view-model button.ytSpecButtonShapeNextHost', scope) ||
			querySelectorDeep('like-button-view-model button', scope);
		if (!ref || !isInReelActionUi(ref)) return null;
		return ref;
	}

	function parseCssColor(s) {
		if (!s) return null;
		const m = String(s).match(
			/rgba?\(\s*([\d.]+)\s*[, ]\s*([\d.]+)\s*[, ]\s*([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)/i
		);
		if (!m) return null;
		let a = m[4] === undefined ? 1 : Number(m[4]);
		if (a > 1) a /= 100;
		return {
			r: Number(m[1]),
			g: Number(m[2]),
			b: Number(m[3]),
			a,
		};
	}

	function looksLightFrost(bg) {
		const c = parseCssColor(bg);
		return !!(c && c.r > 160 && c.g > 160 && c.b > 160 && c.a > 0.02 && c.a <= 0.28);
	}

	function looksDarkFill(bg) {
		const c = parseCssColor(bg);
		return !!(c && c.r < 48 && c.g < 48 && c.b < 48 && c.a >= 0.18);
	}

	function formatRgba(c) {
		if (!c) return '';
		const a = Math.round(c.a * 1000) / 1000;
		return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;
	}

	function mixCssColor(from, toward, amount) {
		if (!from || !toward) return from;
		return {
			r: from.r + (toward.r - from.r) * amount,
			g: from.g + (toward.g - from.g) * amount,
			b: from.b + (toward.b - from.b) * amount,
			a: from.a + (toward.a - from.a) * amount,
		};
	}

	function nativeButtonLooksOverlayDark(btn) {
		if (!(btn instanceof HTMLElement)) return false;
		if (btn.matches(':hover') || btn.matches(':active')) return false;
		const bg = readVisibleBackground(btn);
		if (looksLightFrost(bg)) return false;
		if (looksDarkFill(bg)) return true;
		const cls = `${btn.className || ''} ${btn.getAttribute('class') || ''}`;
		return /OverlayDark|overlay-dark/i.test(cls);
	}

	function readVisibleColor(el) {
		if (!(el instanceof HTMLElement)) return '';
		const cs = getComputedStyle(el);
		const color = cs.color;
		if (color && color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') return color;
		return '';
	}

	function readVisibleBackground(el) {
		if (!(el instanceof HTMLElement)) return '';
		if (el.matches(':hover') || el.matches(':active')) return '';
		const cs = getComputedStyle(el);
		let bg = cs.backgroundColor;
		const parsed = parseCssColor(bg);
		if (parsed && parsed.a > 0.02) return bg;
		const fill = el.querySelector(
			'.yt-spec-touch-feedback-shape__fill, .ytSpecTouchFeedbackShapeFill'
		);
		if (fill instanceof HTMLElement && !fill.matches(':hover')) {
			bg = getComputedStyle(fill).backgroundColor;
			const fillParsed = parseCssColor(bg);
			if (fillParsed && fillParsed.a > 0.02) return bg;
		}
		return '';
	}

	function deriveButtonHoverBg(bg, overlayDark) {
		if (overlayDark) return 'rgba(255, 255, 255, 0.1)';
		if (isYouTubeDarkTheme()) return 'rgba(255, 255, 255, 0.1)';
		return 'rgba(0, 0, 0, 0.1)';
	}

	function deriveButtonActiveBg(bg, overlayDark) {
		if (overlayDark) return 'rgba(255, 255, 255, 0.2)';
		if (isYouTubeDarkTheme()) return 'rgba(255, 255, 255, 0.2)';
		return 'rgba(0, 0, 0, 0.2)';
	}

	function getThemeFallbacks(overlayDark) {
		if (overlayDark) {
			return {
				btnBg: 'rgba(0, 0, 0, 0.3)',
				btnFg: '#fff',
				captionFg: '#fff',
				backdrop: 'none',
			};
		}
		if (isYouTubeDarkTheme()) {
			return {
				btnBg: 'rgba(255, 255, 255, 0.1)',
				btnFg: '#fff',
				captionFg: '#fff',
				backdrop: 'blur(8px)',
			};
		}
		return {
			btnBg: 'rgba(0, 0, 0, 0.05)',
			btnFg: '#0f0f0f',
			captionFg: '#0f0f0f',
			backdrop: 'blur(8px)',
		};
	}

	function findNativeLikeCaptionElement() {
		const likeInner = findLikeInner();
		if (!likeInner) return null;
		const row = findActionRowElement(likeInner);
		if (!(row instanceof HTMLElement)) return null;
		const nodes = row.querySelectorAll(
			'yt-formatted-string, .yt-core-attributed-string, .yt-spec-button-shape-next__button-text-content, span'
		);
		for (const el of nodes) {
			if (!(el instanceof HTMLElement)) continue;
			if (el.closest('button')) continue;
			if (!(el.textContent || '').trim()) continue;
			return el;
		}
		return null;
	}

	function syncSpeedUiWithNativeLike() {
		const root = speedRootEl;
		if (!root || !root.isConnected) return;
		const dark = isYouTubeDarkTheme();
		const ref = findVisibleNativeLikeButton() || findNativeLikeButtonForStyle();
		const overlayDark = nativeButtonLooksOverlayDark(ref);
		root.setAttribute('data-bm-theme', dark ? 'dark' : 'light');
		root.toggleAttribute('data-bm-overlay-dark', overlayDark);

		const fallbacks = getThemeFallbacks(overlayDark);
		let btnBg = fallbacks.btnBg;
		let btnFg = fallbacks.btnFg;
		let capFg = fallbacks.captionFg;
		let backdrop = fallbacks.backdrop;

		if (ref && ref.isConnected && !ref.matches(':hover') && !ref.matches(':active')) {
			const nativeBg = readVisibleBackground(ref);
			const nativeFg = readVisibleColor(ref);
			const nativeBackdrop =
				getComputedStyle(ref).backdropFilter || getComputedStyle(ref).webkitBackdropFilter || '';
			if (nativeBg) btnBg = nativeBg;
			if (nativeFg) btnFg = nativeFg;
			if (overlayDark) backdrop = 'none';
			else if (nativeBackdrop && nativeBackdrop !== 'none') backdrop = nativeBackdrop;
		} else if (overlayDark) {
			backdrop = 'none';
		}

		const captionEl = findNativeLikeCaptionElement();
		const nativeCapFg = readVisibleColor(captionEl);
		if (nativeCapFg) capFg = nativeCapFg;
		if (captionEl instanceof HTMLElement) {
			const capCs = getComputedStyle(captionEl);
			const size = parseFloat(capCs.fontSize);
			if (size >= 10 && size <= 16) root.style.setProperty('--bm-caption-size', `${size}px`);
			if (capCs.fontWeight) root.style.setProperty('--bm-caption-weight', capCs.fontWeight);
		}
		if (ref instanceof HTMLElement) {
			const icon =
				ref.querySelector('.ytIconWrapperHost, .yt-spec-button-shape-next__icon, svg') ||
				ref;
			const ir = icon.getBoundingClientRect();
			const iconSize = Math.round(Math.min(ir.width, ir.height));
			if (iconSize >= 16 && iconSize <= 32) {
				root.style.setProperty('--bm-icon-size', `${iconSize}px`);
			}
		}

		root.style.setProperty('--bm-btn-bg', btnBg);
		root.style.setProperty('--bm-btn-fg', btnFg);
		root.style.setProperty('--bm-btn-bg-hover', deriveButtonHoverBg(btnBg, overlayDark));
		root.style.setProperty('--bm-btn-bg-active', deriveButtonActiveBg(btnBg, overlayDark));
		root.style.setProperty('--bm-btn-backdrop', backdrop);
		root.style.setProperty('--bm-caption-color', capFg);
	}

	function startNativeAnchorFollow(ms = 480) {
		nativeFollowUntil = Math.max(nativeFollowUntil, Date.now() + ms);
		if (nativeFollowRaf) return;
		const loop = () => {
			nativeFollowRaf = 0;
			syncToolboxLayoutWithNative();
			syncCommentsOpenDocumentFlag();
			syncSpeedUiWithNativeLike();
			if (Date.now() < nativeFollowUntil) nativeFollowRaf = requestAnimationFrame(loop);
		};
		syncToolboxLayoutWithNative();
		syncCommentsOpenDocumentFlag();
		syncSpeedUiWithNativeLike();
		nativeFollowRaf = requestAnimationFrame(loop);
	}

	function stopNativeAnchorFollow() {
		nativeFollowUntil = 0;
		if (nativeFollowRaf) {
			cancelAnimationFrame(nativeFollowRaf);
			nativeFollowRaf = 0;
		}
	}

	function ensureNativeAnchorObserver() {
		const likeRow = findFallbackAnchorRow();
		if (!(likeRow instanceof HTMLElement) || typeof ResizeObserver !== 'function') return;
		if (!nativeAnchorObserver) {
			nativeAnchorObserver = new ResizeObserver(() => startNativeAnchorFollow(120));
		}
		const next = [likeRow];
		const bar = getReelActionBarFromNode(likeRow);
		if (bar instanceof HTMLElement) next.push(bar);
		const overlay = getHostOverlay(likeRow);
		if (overlay instanceof HTMLElement) next.push(overlay);
		const same =
			next.length === nativeAnchorObservedEls.length &&
			next.every((el, i) => el === nativeAnchorObservedEls[i]);
		if (same) return;
		nativeAnchorObservedEls.forEach((el) => {
			try {
				nativeAnchorObserver.unobserve(el);
			} catch (_) {}
		});
		next.forEach((el) => nativeAnchorObserver.observe(el));
		nativeAnchorObservedEls = next;
	}

	function ensureCommentsAttrObserver() {
		if (commentsAttrObserver) return;
		commentsAttrObserver = new MutationObserver(() => {
			const open = isCommentsPanelOpen();
			if (open && Date.now() >= commentsUserDismissedUntil) commentsWantedOpen = true;
			syncCommentsOpenDocumentFlag();
			startNativeAnchorFollow(560);
			if (pendingCommentsRefreshAfterAdvance) refreshCommentsPanelForCurrentShort();
			else rememberSettledCommentsIfCurrent();
		});
		const host =
			document.querySelector('ytd-page-manager') ||
			document.querySelector('ytd-app') ||
			document.body;
		if (!(host instanceof HTMLElement)) return;
		commentsAttrObserver.observe(host, {
			subtree: true,
			attributes: true,
			attributeFilter: ['visibility', 'hidden', 'target-id', 'video-id'],
		});
	}

	function isCommentsCloseClickFromEvent(e) {
		if (!e || typeof e.composedPath !== 'function') return false;
		for (const node of e.composedPath()) {
			if (!(node instanceof Element)) continue;
			const closeHost = node.closest
				? node.closest(
						'#visibility-button, #dismiss-button, ytd-engagement-panel-title-header-renderer'
					)
				: null;
			if (!closeHost) continue;
			const panel = closeHost.closest(
				'ytd-engagement-panel-section-list-renderer, ytd-comments-panel'
			);
			if (!(panel instanceof HTMLElement)) continue;
			const hint = `${panel.getAttribute('target-id') || ''} ${panel.id || ''}`;
			if (/comment/i.test(hint)) return true;
		}
		return false;
	}

	function noteCommentsDismissedByUser() {
		commentsWantedOpen = false;
		commentsUserDismissedUntil = Date.now() + 1600;
		pendingCommentsRefreshAfterAdvance = false;
		commentsRefreshInProgress = false;
		commentsSnapshotBeforeAdvance = '';
		commentsFollowUntil = 0;
		stopCommentsFollowLoop();
	}

	function isCommentsHeaderCloseFromEvent(e) {
		if (!e || typeof e.composedPath !== 'function') return false;
		for (const node of e.composedPath()) {
			if (!(node instanceof Element)) continue;
			if (!node.closest('#visibility-button, #dismiss-button')) continue;
			const panel = node.closest(
				'ytd-engagement-panel-section-list-renderer, ytd-comments-panel'
			);
			if (!(panel instanceof HTMLElement)) continue;
			const hint = `${panel.getAttribute('target-id') || ''} ${panel.id || ''}`;
			if (/comment/i.test(hint)) return true;
		}
		return false;
	}

	function getCommentsOverlayScrim() {
		const scrim = document.querySelector('#anchored-panel-scrim');
		return scrim instanceof HTMLElement ? scrim : null;
	}

	function isVisibleCommentsDismissScrim(scrim = getCommentsOverlayScrim()) {
		if (!(scrim instanceof HTMLElement)) return false;
		const cs = getComputedStyle(scrim);
		if (cs.display === 'none' || cs.visibility === 'hidden') return false;
		if (cs.pointerEvents === 'none') return false;
		const opacity = Number(cs.opacity);
		if (Number.isFinite(opacity) && opacity <= 0.02) return false;
		const r = scrim.getBoundingClientRect();
		return r.width >= 24 && r.height >= 24;
	}

	function commentsPanelOverlaysPlayer() {
		const panel = getOpenCommentsPanel();
		const video =
			getActiveShortsVideo() ||
			document.querySelector('#shorts-player') ||
			document.querySelector(
				'ytd-reel-video-renderer[is-active], ytd-reel-video-renderer[reel-active], ytd-reel-video-renderer'
			);
		if (!(panel instanceof HTMLElement) || !(video instanceof Element)) return false;
		const pr = panel.getBoundingClientRect();
		const vr = video.getBoundingClientRect();
		if (pr.width < 40 || pr.height < 40 || vr.width < 40 || vr.height < 40) return false;
		const overlapX = Math.min(pr.right, vr.right) - Math.max(pr.left, vr.left);
		const overlapY = Math.min(pr.bottom, vr.bottom) - Math.max(pr.top, vr.top);
		const overlap = Math.max(0, overlapX) * Math.max(0, overlapY);
		return overlap > vr.width * vr.height * 0.2;
	}

	function isCommentsSidePanelLayout() {
		if (commentsPanelOverlaysPlayer()) return false;
		const panel = getOpenCommentsPanel();
		const video = getActiveShortsVideo() || document.querySelector('#shorts-player');
		if (panel instanceof HTMLElement && video instanceof Element) {
			const pr = panel.getBoundingClientRect();
			const vr = video.getBoundingClientRect();
			if (pr.width >= 40 && vr.width >= 40 && pr.left >= vr.right - 16) return true;
		}
		if (isVisibleCommentsDismissScrim()) return false;
		const shorts = document.querySelector('ytd-shorts');
		return !!(shorts && shorts.hasAttribute('is-watch-while-mode'));
	}

	function shouldDismissCommentsOnOutsideClick(e) {
		if (!isCommentsPanelOpen()) return false;
		if (isCommentsSidePanelLayout()) return false;
		if (!e || typeof e.composedPath !== 'function') return false;
		const path = e.composedPath();
		for (const node of path) {
			if (!(node instanceof Element)) continue;
			if (node.id === ROOT_ID || (speedRootEl && (node === speedRootEl || speedRootEl.contains(node)))) {
				return false;
			}
			if (isInsideCommentsPanel(node)) return false;
			if (node.closest('reel-action-bar-view-model, .ytReelPlayerOverlayViewModelActionsContainer')) {
				return false;
			}
			const actions = node.closest('#actions');
			if (actions && !isWatchPageActions(actions) && !isInsideCommentsPanel(actions)) return false;
		}
		return path.some(
			(node) =>
				node instanceof Element &&
				(node.id === 'anchored-panel-scrim' ||
					!!node.closest(
						'#anchored-panel-scrim, #shorts-panel-container, ytd-shorts, #shorts-container, #shorts-player, ytd-reel-video-renderer'
					))
		);
	}

	function onCommentsUiPointer(e) {
		const toggle = isCommentsToggleClickFromEvent(e);
		const headerClose = isCommentsHeaderCloseFromEvent(e);
		const closeish = headerClose || isCommentsCloseClickFromEvent(e);
		if (toggle || closeish) {
			if (headerClose || (toggle && isCommentsPanelOpen())) noteCommentsDismissedByUser();
			else if (toggle) commentsWantedOpen = true;
			startNativeAnchorFollow(720);
			setTimeout(() => {
				if (!commentsWantedOpen) commentsWantedOpen = false;
				else commentsWantedOpen = isCommentsPanelOpen();
				syncCommentsOpenDocumentFlag();
				syncToolboxLayoutWithNative();
			}, 40);
			return;
		}
		if (e.type !== 'click') return;
		if (!shouldDismissCommentsOnOutsideClick(e)) return;
		noteCommentsDismissedByUser();
		const viaNativeScrim = e.composedPath().some(
			(node) =>
				node instanceof Element &&
				(node.id === 'anchored-panel-scrim' || node.closest('#anchored-panel-scrim'))
		);
		if (!viaNativeScrim) {
			if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
			e.stopPropagation();
			e.preventDefault();
			closeCommentsPanelIfOpen();
		}
		startNativeAnchorFollow(720);
		setTimeout(() => {
			syncCommentsOpenDocumentFlag();
			syncToolboxLayoutWithNative();
		}, 40);
	}

	function isOnScreenActionRect(rect) {
		if (!rect) return false;
		if (!(rect.width >= 24 && rect.height >= 24)) return false;
		if (rect.right <= 8 || rect.bottom <= 8) return false;
		if (rect.left >= window.innerWidth - 8 || rect.top >= window.innerHeight - 8) return false;
		return true;
	}

	function isMastheadGhostRect(rect) {
		if (!rect) return true;
		return rect.left < 72 && rect.top < 80;
	}

	function isButtonSizedActionRect(rect) {
		if (!isOnScreenActionRect(rect) || isMastheadGhostRect(rect)) return false;
		if (rect.width > 140 || rect.height > 180) return false;
		return true;
	}

	function isUsableActionAnchorRect(rect) {
		return isButtonSizedActionRect(rect);
	}

	function nativeItemPitch(root) {
		const raw = parseFloat(
			root instanceof HTMLElement
				? getComputedStyle(root).getPropertyValue('--bm-item-height')
				: ''
		);
		return Number.isFinite(raw) && raw >= 56 && raw <= 160 ? raw : 92;
	}

	function getRowAnchorRect(row) {
		if (!(row instanceof HTMLElement)) return null;
		const rr = row.getBoundingClientRect();
		// Prefer the whole rail item (button + caption), not just the 48px circle.
		if (isButtonSizedActionRect(rr) && rr.height >= 56) return rr;
		const btn =
			row.querySelector('button') ||
			(typeof querySelectorDeep === 'function' ? querySelectorDeep('button', row) : null);
		if (btn instanceof HTMLElement) {
			const br = btn.getBoundingClientRect();
			if (isButtonSizedActionRect(br)) {
				const pitch = nativeItemPitch(speedRootEl);
				return {
					left: br.left,
					top: br.top,
					width: br.width,
					height: pitch,
					right: br.left + br.width,
					bottom: br.top + pitch,
				};
			}
		}
		return isButtonSizedActionRect(rr) ? rr : null;
	}

	function scoreActionAnchorRect(rect) {
		if (!isUsableActionAnchorRect(rect)) return -1;
		let score = 1000;
		const video = getActiveShortsVideo();
		if (!(video instanceof HTMLElement)) return score;
		const vr = video.getBoundingClientRect();
		if (
			!(vr.width >= 40 && vr.height >= 40) ||
			vr.bottom <= 0 ||
			vr.top >= window.innerHeight ||
			vr.right <= 0 ||
			vr.left >= window.innerWidth
		) {
			return score;
		}
		const dx = Math.abs(rect.left - vr.right);
		const dy = Math.abs((rect.top + rect.bottom) / 2 - (vr.top + vr.bottom) / 2);
		score = 100000 - dx - dy;
		if (rect.bottom > vr.top && rect.top < vr.bottom) score += 5000;
		return score;
	}

	function toolboxHasStableFixedPosition(root) {
		if (!(root instanceof HTMLElement)) return false;
		const left = parseFloat(root.style.left);
		const top = parseFloat(root.style.top);
		const width = parseFloat(root.style.width) || 48;
		const height = parseFloat(root.style.height) || 48;
		if (!Number.isFinite(left) || !Number.isFinite(top)) return false;
		if (left <= -1000 || top <= -1000) return false;
		return isOnScreenActionRect({
			left,
			top,
			width,
			height,
			right: left + width,
			bottom: top + height,
		}) && !isMastheadGhostRect({ left, top, width, height, right: left + width, bottom: top + height });
	}

	function isParkedToolboxPosition(root) {
		if (!(root instanceof HTMLElement)) return true;
		const left = parseFloat(root.style.left);
		const top = parseFloat(root.style.top);
		return !Number.isFinite(left) || !Number.isFinite(top) || left <= -1000 || top <= -1000;
	}

	function keepToolboxPaintedOnShorts(root) {
		if (!(root instanceof HTMLElement)) return;
		if (!isOnShortsPath()) {
			root.style.visibility = 'hidden';
			return;
		}
		if (isParkedToolboxPosition(root)) return;
		root.style.visibility = 'visible';
		root.style.setProperty('pointer-events', 'auto', 'important');
		root.style.setProperty('z-index', TOOLBOX_TOP_Z, 'important');
		if (isCommentsPanelOpen()) raiseToolboxAboveComments();
	}

	function keepBodyToolboxVisibleOnShorts(root) {
		keepToolboxPaintedOnShorts(root);
	}

	function isVisibleNativeRailButton(btn) {
		if (!(btn instanceof HTMLElement)) return false;
		if (speedRootEl && speedRootEl.contains(btn)) return false;
		if (!isInReelActionUi(btn)) return false;
		const r = btn.getBoundingClientRect();
		if (r.width < 24 || r.height < 24 || r.width > 140 || r.height > 140) return false;
		if (r.bottom <= 0 || r.top >= window.innerHeight) return false;
		if (r.right <= 0 || r.left >= window.innerWidth) return false;
		if (r.left < 72 && r.top < 80) return false;
		const cs = getComputedStyle(btn);
		if (cs.display === 'none' || cs.visibility === 'hidden') return false;
		return true;
	}

	function findVisibleNativeLikeButton() {
		const scoped = findNativeLikeButtonForStyle();
		if (isVisibleNativeRailButton(scoped)) return scoped;

		const nodes = document.querySelectorAll(
			'like-button-view-model button, #like-button button, segmented-like-button-view-model button, reel-action-bar-view-model button'
		);
		let best = null;
		let bestScore = -1;
		const vh = window.innerHeight;
		const vw = window.innerWidth;
		nodes.forEach((btn) => {
			if (!isVisibleNativeRailButton(btn)) return;
			const label = `${btn.getAttribute('aria-label') || ''} ${btn.getAttribute('title') || ''}`;
			const isLike = /(like|喜歡|点赞|讚|いいね)/i.test(label);
			const host = btn.closest(
				'like-button-view-model, #like-button, segmented-like-button-view-model'
			);
			if (!isLike && !host) return;
			const r = btn.getBoundingClientRect();
			const iw = Math.min(r.right, vw) - Math.max(r.left, 0);
			const ih = Math.min(r.bottom, vh) - Math.max(r.top, 0);
			const cy = (r.top + r.bottom) / 2;
			const score = Math.max(0, iw) * Math.max(0, ih) * (1.2 - Math.abs(cy - vh / 2) / vh);
			if (score > bestScore) {
				bestScore = score;
				best = btn;
			}
		});
		return best;
	}

	function measureNativeRailPitch(btn) {
		const fallback = nativeItemPitch(speedRootEl);
		if (!(btn instanceof HTMLElement)) return fallback;
		const row = findActionRowElement(btn);
		const parent = (row && row.parentElement) || getReelActionBarFromNode(btn);
		if (!(parent instanceof HTMLElement)) return fallback;
		const buttons = [];
		for (const child of parent.children) {
			if (!(child instanceof HTMLElement)) continue;
			const b = child.querySelector('button');
			if (b instanceof HTMLElement) buttons.push(b);
		}
		let idx = -1;
		for (let i = 0; i < buttons.length; i++) {
			if (buttons[i] === btn || buttons[i].contains(btn) || btn.contains(buttons[i])) {
				idx = i;
				break;
			}
		}
		const next = idx >= 0 ? buttons[idx + 1] : null;
		if (next instanceof HTMLElement) {
			const a = btn.getBoundingClientRect();
			const b = next.getBoundingClientRect();
			const pitch = b.top - a.top;
			if (pitch >= 56 && pitch <= 180) return pitch;
		}
		return fallback;
	}

	function placeToolboxAgainstLikeButton(root, likeBtn) {
		if (!(root instanceof HTMLElement) || !(likeBtn instanceof HTMLElement)) return false;
		const br = likeBtn.getBoundingClientRect();
		if (!isVisibleNativeRailButton(likeBtn)) return false;
		const pitch = measureNativeRailPitch(likeBtn);
		const wantLeft = br.left;
		const wantTop = br.top - pitch;
		root.style.visibility = 'visible';
		root.style.setProperty('position', 'fixed', 'important');
		root.style.setProperty('left', `${wantLeft}px`, 'important');
		root.style.setProperty('top', `${wantTop}px`, 'important');
		root.style.setProperty('width', `${br.width}px`, 'important');
		root.style.setProperty('height', `${pitch}px`, 'important');
		root.style.setProperty('margin', '0px', 'important');
		root.style.setProperty('z-index', TOOLBOX_TOP_Z, 'important');
		root.style.setProperty('pointer-events', 'auto', 'important');
		root.style.setProperty('--bm-top-row-offset', '0px');
		const size = Math.max(br.width, br.height);
		if (size >= 32 && size <= 96) root.style.setProperty('--bm-btn-size', `${size}px`);
		if (pitch >= 56 && pitch <= 180) root.style.setProperty('--bm-item-height', `${pitch}px`);
		if (isCommentsPanelOpen()) raiseToolboxAboveComments();
		const mainBtn =
			root.querySelector('.yts-tool-item-main .yts-speed-btn') ||
			root.querySelector('.yts-speed-btn');
		if (mainBtn instanceof HTMLElement) {
			const mb = mainBtn.getBoundingClientRect();
			const dx = wantLeft - mb.left;
			const dy = wantTop - mb.top;
			if (Math.abs(dx) >= 0.2 || Math.abs(dy) >= 0.2) {
				root.style.setProperty('left', `${wantLeft + dx}px`, 'important');
				root.style.setProperty('top', `${wantTop + dy}px`, 'important');
			}
		}
		return true;
	}

	function syncToolboxLayoutWithNative() {
		const root = speedRootEl;
		if (!(root instanceof HTMLElement) || !root.isConnected) return;
		applyToolboxPanelOpenState(root);
		if (!isOnShortsPath()) {
			root.style.visibility = 'hidden';
			return;
		}

		const likeBtn = findVisibleNativeLikeButton();
		if (likeBtn instanceof HTMLElement) {
			placeToolboxAgainstLikeButton(root, likeBtn);
		} else {
			keepToolboxPaintedOnShorts(root);
			return;
		}

		const likeRow = findActionRowElement(likeBtn) || findFallbackAnchorRow();
		if (!(likeRow instanceof HTMLElement) || !likeRow.parentElement) {
			placeToolboxAgainstLikeButton(root, likeBtn);
			return;
		}

		const layoutHost = getToolboxLayoutHost();
		const hostOverlay = getHostOverlay(layoutHost);
		const bodyHosted = isToolboxOnBodyHost(root) || root.parentElement === document.body;
		const actionBar = getReelActionBarFromNode(likeRow);
		const posParent = actionBar && actionBar.parentElement;
		if (
			!bodyHosted &&
			posParent instanceof HTMLElement &&
			root.parentElement === posParent &&
			actionBar &&
			!actionBar.contains(root)
		) {
			const parentRect = posParent.getBoundingClientRect();
			const likeRect = likeRow.getBoundingClientRect();
			if (parentRect.width > 0 && likeRect.height > 0) {
				root.style.position = 'absolute';
				root.style.left = `${likeRect.left - parentRect.left}px`;
				root.style.top = `${likeRect.top - parentRect.top - likeRect.height}px`;
				root.style.width = `${likeRect.width}px`;
				root.style.height = `${likeRect.height}px`;
				root.style.margin = '0px';
				root.style.zIndex = '2';
				root.style.pointerEvents = 'auto';
			}
		}

		const rowRect = getRowAnchorRect(likeRow) || likeRow.getBoundingClientRect();
		const rowHeight = rowRect.height;

		const siblings = Array.from(likeRow.parentElement.children).filter(
			(el) =>
				el instanceof HTMLElement &&
				el !== root &&
				isInReelActionUi(el) &&
				!el.querySelector(`#${ROOT_ID}`) &&
				!!el.querySelector('button')
		);
		const idx = siblings.indexOf(likeRow);
		if (idx < 0 && Number.isFinite(rowHeight) && rowHeight >= 56 && rowHeight <= 160) {
			root.style.setProperty('--bm-item-height', `${rowHeight}px`);
			root.style.setProperty('--bm-item-gap', '0px');
		}
		root.style.setProperty('--bm-caption-color', isYouTubeDarkTheme() ? '#fff' : '#0f0f0f');
		root.style.setProperty('--bm-top-row-offset', '0px');

		const rowBtnCenter = (row) => {
			if (!(row instanceof HTMLElement)) return NaN;
			if (hostOverlay && !hostOverlay.contains(row)) return NaN;
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
				? Math.abs(dislikeCenter - likeCenter)
				: Math.max(56, rowHeight);

		if (Number.isFinite(fallbackPitch) && fallbackPitch >= 56 && fallbackPitch <= 160) {
			root.style.setProperty('--bm-item-height', `${fallbackPitch}px`);
		}

		placeToolboxAgainstLikeButton(root, likeBtn);

		const rootTop = root.getBoundingClientRect().top;
		const btnSizeRaw = parseFloat(getComputedStyle(root).getPropertyValue('--bm-btn-size'));
		const btnSize = Number.isFinite(btnSizeRaw) && btnSizeRaw > 0 ? btnSizeRaw : 48;
		const toTopByCenter = (centerY, fallbackMul) => {
			if (!Number.isFinite(centerY)) return fallbackPitch * fallbackMul;
			return Math.max(0, centerY - rootTop - btnSize / 2);
		};
		const mainBtn = root.querySelector('.yts-tool-item-main .yts-speed-btn');
		const mainTop =
			mainBtn instanceof HTMLElement
				? Math.max(0, mainBtn.getBoundingClientRect().top - rootTop)
				: 0;
		const speedTop = mainTop;
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
		ensureNativeAnchorObserver();
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
			'ytd-comments-panel, ytd-engagement-panel, ytd-engagement-panel-section, ytd-engagement-panel-section-list-renderer[target-id*="comment"], ytd-comment-renderer, ytd-comment-thread-renderer, ytd-comment-simplebox-renderer, ytd-comment-action-buttons-renderer, [target-id="engagement-panel-comments-section"], #engagement-panel'
		);
	}

	function isTypingTarget(el) {
		if (!(el instanceof Element)) return false;
		if (el.isContentEditable) return true;
		const tag = el.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
		return !!el.closest('input, textarea, select, [contenteditable="true"]');
	}

	function eventPathElements(e) {
		const out = [];
		try {
			const path = e && typeof e.composedPath === 'function' ? e.composedPath() : [];
			for (const n of path) {
				if (n instanceof Element) out.push(n);
			}
		} catch (_) {}
		if (e && e.target instanceof Element && !out.includes(e.target)) out.unshift(e.target);
		return out;
	}

	function eventTouchesCommentsUi(e) {
		for (const el of eventPathElements(e)) {
			if (isInsideCommentsPanel(el)) return true;
		}
		return false;
	}

	function eventTouchesShortsFeedNav(e) {
		if (eventTouchesCommentsUi(e)) return false;
		for (const el of eventPathElements(e)) {
			if (el.closest(`#${ROOT_ID}`)) return false;
			if (
				el.closest(
					'#navigation-button-down, #navigation-button-up, .navigation-container, #shorts-container, #shorts-player, ytd-reel-video-renderer'
				)
			) {
				return true;
			}
		}
		return false;
	}

	function isWatchPageActions(el) {
		return !!(
			el instanceof Element &&
			el.id === 'actions' &&
			el.closest('ytd-watch-metadata, ytd-watch-flexy')
		);
	}

	function findReelActionBar(scope) {
		if (!scope) return null;
		const accept = (host) => {
			if (!(host instanceof HTMLElement)) return null;
			if (isWatchPageActions(host)) return null;
			if (isInsideCommentsPanel(host)) return null;
			return host;
		};
		if (scope instanceof Element) {
			const extracted =
				accept(scope.closest('reel-action-bar-view-model')) ||
				accept(scope.querySelector('reel-action-bar-view-model'));
			if (extracted) return extracted;
			const actions = accept(scope.id === 'actions' ? scope : scope.querySelector('#actions'));
			if (actions) return actions;
		}
		return (
			accept(querySelectorDeep('reel-action-bar-view-model', scope)) ||
			accept(querySelectorDeep('#actions', scope))
		);
	}

	function getReelActionBarFromNode(node) {
		if (!(node instanceof Element)) return null;
		const extracted = node.closest('reel-action-bar-view-model');
		if (extracted instanceof HTMLElement) return extracted;
		const actions = node.closest('#actions');
		if (actions instanceof HTMLElement && !isWatchPageActions(actions)) return actions;
		return null;
	}

	function isInReelActionUi(el) {
		if (!el) return false;
		if (speedRootEl && (el === speedRootEl || (el instanceof Node && speedRootEl.contains(el)))) {
			return true;
		}
		if (isInsideCommentsPanel(el)) return false;
		return !!(
			el.closest('ytd-reel-player-overlay-renderer') ||
			el.closest('reel-action-bar-view-model') ||
			el.closest('#shorts-player')
		);
	}

	function isToolboxOnBodyHost(root = speedRootEl) {
		return !!(
			root instanceof HTMLElement &&
			root.isConnected &&
			root.dataset.ytsFixedHost === '1' &&
			(root.parentElement === document.body || root.parentElement === document.documentElement)
		);
	}

	function applyToolboxPanelOpenState(root = speedRootEl) {
		if (!(root instanceof HTMLElement)) return;
		root.dataset.open = toolboxPanelWantedOpen ? '1' : '0';
	}

	function getVisibleReelOverlays() {
		const out = [];
		document.querySelectorAll('ytd-reel-player-overlay-renderer').forEach((o) => {
			if (!(o instanceof HTMLElement) || isInsideCommentsPanel(o)) return;
			const r = o.getBoundingClientRect();
			if (r.width < 8 || r.height < 8) return;
			if (r.bottom <= 0 || r.top >= window.innerHeight) return;
			out.push({ el: o, area: r.width * r.height });
		});
		out.sort((a, b) => b.area - a.area);
		return out.map((x) => x.el);
	}

	function rendererHasShortId(renderer, id) {
		if (!(renderer instanceof HTMLElement)) return false;
		if (!id || id === 'short') return false;
		const attrs = [
			renderer.getAttribute('id'),
			renderer.getAttribute('reel-video-id'),
			renderer.getAttribute('video-id'),
			renderer.dataset.videoId,
		];
		for (const rid of attrs) {
			if (!rid || rid === 'reel-video-renderer') continue;
			if (rid === id || rid.includes(id)) return true;
		}
		const links = renderer.querySelectorAll('a[href*="/shorts/"]');
		for (const a of links) {
			if (!(a instanceof HTMLAnchorElement)) continue;
			if (a.closest('yt-reel-carousel-view-model, .ytReelCarouselViewModelHost')) continue;
			if (/\/hashtag\//i.test(a.getAttribute('href') || '')) continue;
			if (a.href.includes(`/shorts/${id}`)) return true;
		}
		const vi = `/vi/${id}/`;
		const media = renderer.querySelectorAll('[src*="/vi/"], [srcset*="/vi/"], [style*="/vi/"]');
		for (const el of media) {
			const blob = `${el.getAttribute('src') || ''} ${el.getAttribute('srcset') || ''} ${
				el.getAttribute('style') || ''
			}`;
			if (blob.includes(vi)) return true;
		}
		return false;
	}

	function rendererMatchesCurrentShort(renderer) {
		return rendererHasShortId(renderer, getCurrentShortId());
	}

	function hasUrlMatchedReelRenderer() {
		const id = getCurrentShortId();
		if (!id || id === 'short') return false;
		const all = document.querySelectorAll('ytd-reel-video-renderer');
		for (const r of all) {
			if (rendererMatchesCurrentShort(r)) return true;
		}
		return false;
	}

	function isLikelyActiveReelRenderer(renderer) {
		if (!(renderer instanceof HTMLElement)) return false;
		if (renderer.hasAttribute('is-active') || renderer.hasAttribute('reel-active')) return true;
		if (renderer.getAttribute('aria-hidden') === 'false') return true;
		const video = renderer.querySelector('video.html5-main-video, video');
		if (video instanceof HTMLVideoElement && !video.paused && !video.ended) {
			const r = renderer.getBoundingClientRect();
			const mid = window.innerHeight / 2;
			if (r.top < mid && r.bottom > mid) return true;
		}
		return false;
	}

	function canAttachToolboxToRow(row) {
		if (!(row instanceof Element)) return false;
		const renderer = row.closest('ytd-reel-video-renderer');
		if (!(renderer instanceof HTMLElement)) return true;
		if (rendererMatchesCurrentShort(renderer)) return true;
		// Never attach into a different Short when we can identify the URL's reel —
		// doing so makes YouTube activate that reel and change the URL.
		if (hasUrlMatchedReelRenderer()) return false;
		if (isLikelyActiveReelRenderer(renderer)) return true;
		// New Shorts UI often recycles a single renderer with no is-active flag.
		return document.querySelectorAll('ytd-reel-video-renderer').length === 1;
	}

	function getPreferredActiveReelRenderer() {
		const id = getCurrentShortId();
		const matches = [];
		if (id && id !== 'short') {
			document.querySelectorAll('ytd-reel-video-renderer').forEach((r) => {
				if (rendererMatchesCurrentShort(r)) matches.push(r);
			});
		}
		if (matches.length === 1) return matches[0];
		if (matches.length > 1) {
			const active = matches.find((r) => isLikelyActiveReelRenderer(r));
			if (active) return active;
			let best = null;
			let bestArea = -1;
			const vw = window.innerWidth;
			const vh = window.innerHeight;
			for (const r of matches) {
				const rect = r.getBoundingClientRect();
				const iw = Math.min(rect.right, vw) - Math.max(rect.left, 0);
				const ih = Math.min(rect.bottom, vh) - Math.max(rect.top, 0);
				const area = Math.max(0, iw) * Math.max(0, ih);
				if (area > bestArea) {
					bestArea = area;
					best = r;
				}
			}
			if (best) return best;
			return matches[0];
		}

		const byAttr =
			document.querySelector('ytd-reel-video-renderer[is-active]') ||
			document.querySelector('ytd-reel-video-renderer[reel-active]') ||
			document.querySelector("ytd-reel-video-renderer[aria-hidden='false']");
		if (byAttr instanceof HTMLElement) return byAttr;

		const playing = Array.from(
			document.querySelectorAll('ytd-reel-video-renderer video')
		).find((v) => v instanceof HTMLVideoElement && !v.paused && !v.ended);
		if (playing instanceof HTMLVideoElement) {
			const host = playing.closest('ytd-reel-video-renderer');
			if (host instanceof HTMLElement) return host;
		}
		return null;
	}

	function overlayFromRenderer(renderer) {
		if (!(renderer instanceof HTMLElement)) return null;
		const overlay =
			renderer.querySelector('ytd-reel-player-overlay-renderer') ||
			querySelectorDeep('ytd-reel-player-overlay-renderer', renderer);
		return overlay instanceof HTMLElement && !isInsideCommentsPanel(overlay) ? overlay : null;
	}

	function isLayoutSettling() {
		return Date.now() < layoutQuietUntil;
	}

	function isRecentWindowResize() {
		return Date.now() - lastWindowResizeAt < WINDOW_RESIZE_HOLD_MS;
	}

	function getWindowInnerBoxKey() {
		return `${window.innerWidth}x${window.innerHeight}|${window.outerWidth}x${window.outerHeight}`;
	}

	function windowSizeChangedFromSample() {
		return getWindowInnerBoxKey() !== windowLayoutBoxKey;
	}

	function isResizeHoldRunning() {
		return document.documentElement.hasAttribute(RESIZE_LOCK_ATTR);
	}

	function isStaleAgainstWindowResize(at) {
		return !!(at && lastWindowResizeAt && at <= lastWindowResizeAt);
	}

	function applyWindowSizeChange() {
		if (!windowSizeChangedFromSample()) return false;
		lastWindowResizeAt = Date.now();
		windowLayoutBoxKey = getWindowInnerBoxKey();
		if (isStaleAgainstWindowResize(explicitNavAt)) {
			explicitNavAt = 0;
			explicitShortNavUntil = 0;
		}
		beginResizeLock();
		return true;
	}

	function syncWindowSnapLock() {
		applyWindowSizeChange();
		if (isResizeHoldRunning() && !isExplicitShortNav()) holdPinnedShortInView();
	}

	function isBrowserZoomWheel(e) {
		if (!e || e.type !== 'wheel') return false;
		return !!(e.ctrlKey || e.metaKey);
	}

	function isExplicitShortNav() {
		applyWindowSizeChange();
		if (windowSizeChangedFromSample()) return false;
		if (isAutoAdvanceNavigation() && !isStaleAgainstWindowResize(lastAdvanceToNextAt)) {
			return true;
		}
		if (Date.now() >= explicitShortNavUntil) return false;
		if (isStaleAgainstWindowResize(explicitNavAt)) return false;
		return true;
	}

	function noteExplicitShortNav() {
		explicitNavAt = Date.now();
		explicitShortNavUntil = explicitNavAt + EXPLICIT_NAV_MS;
		abortResizeLockForUserNav();
	}

	function commitUrlLockFromLocation() {
		applyWindowSizeChange();
		if (!isExplicitShortNav() && urlLockShortId && urlLockShortId !== 'short') return;
		const id = getCurrentShortId();
		if (!id || id === 'short') return;
		urlLockShortId = id;
		resizePinnedShortId = id;
	}

	function isUnauthorizedShortChange() {
		if (isExplicitShortNav()) return false;
		if (!urlLockShortId || urlLockShortId === 'short') return false;
		const now = getCurrentShortId();
		return !!(now && now !== 'short' && now !== urlLockShortId);
	}

	function enforceUrlLock() {
		applyWindowSizeChange();
		if (!urlLockShortId || urlLockShortId === 'short') {
			const id = getCurrentShortId();
			if (id && id !== 'short' && !isResizeHoldRunning()) {
				urlLockShortId = id;
				resizePinnedShortId = id;
			}
			return;
		}
		if (isExplicitShortNav()) {
			commitUrlLockFromLocation();
			return;
		}
		resizePinnedShortId = urlLockShortId;
		holdPinnedShortInView();
		if (getCurrentShortId() !== urlLockShortId && !isResizeHoldRunning()) beginResizeLock();
	}

	function abortResizeLockForUserNav() {
		if (!isLayoutSettling() && !document.documentElement.hasAttribute(RESIZE_LOCK_ATTR)) return;
		stopResizeHoldLoop();
		setResizeLock(false);
		layoutQuietUntil = 0;
		lastWindowResizeAt = 0;
		resizeUnlockTries = 0;
		if (layoutResumeTimer) {
			clearTimeout(layoutResumeTimer);
			layoutResumeTimer = null;
		}
	}

	function noteLayoutSettling(ms = WINDOW_RESIZE_HOLD_MS) {
		layoutQuietUntil = Math.max(layoutQuietUntil, Date.now() + ms);
		if (layoutResumeTimer) clearTimeout(layoutResumeTimer);
		layoutResumeTimer = setTimeout(() => {
			layoutResumeTimer = null;
			endResizeLock();
		}, ms + 80);
	}

	function findSequenceHostForShortId(id) {
		if (!id || id === 'short') return null;
		const renderers = document.querySelectorAll('ytd-reel-video-renderer');
		for (const r of renderers) {
			if (!rendererHasShortId(r, id)) continue;
			const seq = r.closest('.reel-video-in-sequence-new, .reel-video-in-sequence');
			return seq instanceof HTMLElement ? seq : r;
		}
		const needle = `/shorts/${id}`;
		const vi = `/vi/${id}/`;
		const items = document.querySelectorAll(
			'.reel-video-in-sequence-new, .reel-video-in-sequence, ytd-reel-video-renderer'
		);
		for (const el of items) {
			if (!(el instanceof HTMLElement)) continue;
			if (el.querySelector(`a[href*="${needle}"]`)) return el;
			const thumb = el.querySelector('[style*="ytimg"], [src*="ytimg"], [srcset*="ytimg"]');
			const blob = `${el.getAttribute('style') || ''} ${
				thumb instanceof HTMLElement
					? `${thumb.getAttribute('style') || ''} ${thumb.getAttribute('src') || ''} ${
							thumb.getAttribute('srcset') || ''
						}`
					: ''
			}`;
			if (blob.includes(vi)) return el;
		}
		return null;
	}

	function getShortsScrollContainer() {
		const main = document.querySelector('#shorts-container');
		if (main instanceof HTMLElement) return main;
		const inner = document.querySelector('#shorts-inner-container');
		if (inner instanceof HTMLElement) return inner;
		const shorts = document.querySelector('ytd-shorts');
		return shorts instanceof HTMLElement ? shorts : null;
	}

	function allShortsScrollers() {
		const out = [];
		['#shorts-container', '#shorts-inner-container'].forEach((sel) => {
			const el = document.querySelector(sel);
			if (el instanceof HTMLElement && !out.includes(el)) out.push(el);
		});
		return out;
	}

	function listSequenceItems() {
		const inner = document.querySelector('#shorts-inner-container');
		const root = inner instanceof HTMLElement ? inner : getShortsScrollContainer();
		if (!(root instanceof HTMLElement)) return [];
		const direct = Array.from(
			root.querySelectorAll(
				':scope > .reel-video-in-sequence-new, :scope > .reel-video-in-sequence'
			)
		);
		if (direct.length) return direct;
		return Array.from(
			document.querySelectorAll('.reel-video-in-sequence-new, .reel-video-in-sequence')
		);
	}

	function shortIdFromHost(host) {
		if (!(host instanceof HTMLElement)) return '';
		const renderer =
			host.tagName === 'YTD-REEL-VIDEO-RENDERER'
				? host
				: host.querySelector('ytd-reel-video-renderer');
		if (renderer instanceof HTMLElement) {
			const attrs = [
				renderer.getAttribute('reel-video-id'),
				renderer.getAttribute('video-id'),
				renderer.dataset.videoId,
			];
			for (const rid of attrs) {
				if (rid && rid !== 'reel-video-renderer' && rid !== 'short') return rid;
			}
			const links = renderer.querySelectorAll('a[href*="/shorts/"]');
			for (const a of links) {
				if (!(a instanceof HTMLAnchorElement)) continue;
				if (a.closest('yt-reel-carousel-view-model, .ytReelCarouselViewModelHost')) continue;
				const m = `${a.getAttribute('href') || ''} ${a.href || ''}`.match(
					/\/shorts\/([^/?#]+)/
				);
				if (m && m[1] && m[1] !== 'short') return m[1];
			}
		}
		const blob = `${host.getAttribute('style') || ''} ${
			host.querySelector('[style*="/vi/"], [src*="/vi/"]')?.getAttribute('style') || ''
		} ${host.querySelector('[src*="/vi/"]')?.getAttribute('src') || ''}`;
		const tm = blob.match(/\/vi\/([^/]+)\//);
		return tm ? tm[1] : '';
	}

	function shortsViewportSizeKey() {
		const sc = getShortsScrollContainer();
		const box =
			sc instanceof HTMLElement
				? `${Math.round(sc.clientWidth)}x${Math.round(sc.clientHeight)}`
				: '0x0';
		return `${box}|${window.innerWidth}x${window.innerHeight}`;
	}

	function alignHostInScroller(sc, host) {
		if (!(sc instanceof HTMLElement) || !(host instanceof HTMLElement)) return;
		const scRect = sc.getBoundingClientRect();
		const hostRect = host.getBoundingClientRect();
		if (scRect.height < 8) return;
		const delta = hostRect.top - scRect.top;
		if (!Number.isFinite(delta) || Math.abs(delta) < 0.5) return;
		const next = Math.max(0, sc.scrollTop + delta);
		if (Math.abs(sc.scrollTop - next) < 0.5) return;
		try {
			sc.scrollTo({ top: next, behavior: 'instant' });
		} catch (_) {
			sc.scrollTop = next;
		}
	}

	function centerShortsHostInScroller(host) {
		if (!(host instanceof HTMLElement)) return;
		// Shorts may change every sequence item's height while the window is
		// resized. Index × previous item height can point at a different reel,
		// leaving the old audio playing against a detached/black video surface.
		// Align only from the current, rendered geometry instead.
		allShortsScrollers().forEach((el) => alignHostInScroller(el, host));
	}

	function captureVisibleShortPin() {
		const items = listSequenceItems();
		const sc = getShortsScrollContainer();
		let host = null;
		let idx = -1;
		if (sc instanceof HTMLElement && items.length) {
			const sr = sc.getBoundingClientRect();
			let best = -1;
			items.forEach((item, i) => {
				const r = item.getBoundingClientRect();
				const overlap = Math.max(
					0,
					Math.min(r.bottom, sr.bottom) - Math.max(r.top, sr.top)
				);
				if (overlap > best) {
					best = overlap;
					host = item;
					idx = i;
				}
			});
		}
		const id = (host && shortIdFromHost(host)) || getCurrentShortId();
		if (!id || id === 'short') return;
		resizePinnedShortId = id;
		if (host instanceof HTMLElement) {
			resizePinnedHost = host;
			resizePinnedSequenceId = host.getAttribute('id') || '';
			resizePinnedIndex = idx;
		}
	}

	function rememberLiveShortPin(force = false) {
		if (!isExplicitShortNav()) {
			if (urlLockShortId && urlLockShortId !== 'short') resizePinnedShortId = urlLockShortId;
			return;
		}
		if (
			!force &&
			isResizeHoldRunning() &&
			resizePinnedShortId &&
			resizePinnedShortId !== 'short'
		) {
			return;
		}
		captureVisibleShortPin();
		commitUrlLockFromLocation();
	}

	function findPinnedSequenceHost(pin) {
		const items = listSequenceItems();
		if (pin && pin !== 'short') {
			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				const renderer = item.querySelector('ytd-reel-video-renderer') || item;
				if (shortIdFromHost(item) === pin || rendererHasShortId(renderer, pin)) {
					resizePinnedHost = item;
					resizePinnedIndex = i;
					return item;
				}
			}
			const byShort = findSequenceHostForShortId(pin);
			if (byShort instanceof HTMLElement) {
				resizePinnedHost = byShort;
				return byShort;
			}
		}
		if (resizePinnedIndex >= 0 && items[resizePinnedIndex] instanceof HTMLElement) {
			resizePinnedHost = items[resizePinnedIndex];
			return items[resizePinnedIndex];
		}
		if (resizePinnedHost instanceof HTMLElement && resizePinnedHost.isConnected) {
			return resizePinnedHost;
		}
		if (!resizePinnedSequenceId) return null;
		let safe = resizePinnedSequenceId;
		try {
			safe = CSS.escape(resizePinnedSequenceId);
		} catch (_) {}
		const bySlot = document.querySelector(
			`.reel-video-in-sequence-new[id="${safe}"], .reel-video-in-sequence[id="${safe}"]`
		);
		return bySlot instanceof HTMLElement ? bySlot : null;
	}

	function resumePinnedShortMedia(host, pin) {
		// Never auto-play. Space, click-to-pause, and media keys must stay in charge.
		void host;
		void pin;
	}

	function holdPinnedShortInView() {
		if (resizeScrollGuard) return;
		resizeScrollGuard = true;
		try {
			const pin = resizePinnedShortId || getCurrentShortId();
			const host = findPinnedSequenceHost(pin);
			if (host instanceof HTMLElement) centerShortsHostInScroller(host);
			resumePinnedShortMedia(host, pin);
		} finally {
			resizeScrollGuard = false;
		}
	}

	function setResizeLock(on) {
		if (on) document.documentElement.setAttribute(RESIZE_LOCK_ATTR, '');
		else document.documentElement.removeAttribute(RESIZE_LOCK_ATTR);
	}

	function startResizeHoldLoop() {
		if (resizeHoldRaf) return;
		resizeHoldRaf = requestAnimationFrame(() => {
			resizeHoldRaf = 0;
			holdPinnedShortInView();
		});
	}

	function stopResizeHoldLoop() {
		if (resizeHoldRaf) {
			cancelAnimationFrame(resizeHoldRaf);
			resizeHoldRaf = 0;
		}
	}

	function beginResizeLock() {
		lastObservedShortsSize = shortsViewportSizeKey();
		if (urlLockShortId && urlLockShortId !== 'short') resizePinnedShortId = urlLockShortId;
		setResizeLock(true);
		noteLayoutSettling(WINDOW_RESIZE_HOLD_MS);
		ensureShortsResizeObserver();
		ensureWindowBoxObserver();
		startResizeHoldLoop();
		holdPinnedShortInView();
	}

	function endResizeLock() {
		const pin = urlLockShortId || resizePinnedShortId;
		if (pin && pin !== 'short') resizePinnedShortId = pin;
		holdPinnedShortInView();
		const stillOff = !!(pin && pin !== 'short' && getCurrentShortId() !== pin);
		if (stillOff && resizeUnlockTries < 20 && !isExplicitShortNav()) {
			resizeUnlockTries += 1;
			startResizeHoldLoop();
			noteLayoutSettling(180);
			return;
		}
		resizeUnlockTries = 0;
		restorePinnedShortAfterResize();
		stopResizeHoldLoop();
		setResizeLock(false);
		const recorrect = () => {
			if (isExplicitShortNav()) return;
			holdPinnedShortInView();
			restorePinnedShortAfterResize();
		};
		requestAnimationFrame(() => {
			recorrect();
			requestAnimationFrame(recorrect);
		});
		scheduleMountWork();
	}

	function ensureShortsResizeObserver() {
		if (typeof ResizeObserver !== 'function') return;
		if (!shortsResizeObserver) {
			shortsResizeObserver = new ResizeObserver(() => {
				syncWindowSnapLock();
				const key = shortsViewportSizeKey();
				if (!shortsResizeReady) {
					shortsResizeReady = true;
					lastObservedShortsSize = key;
					return;
				}
				if (key === lastObservedShortsSize) return;
				lastObservedShortsSize = key;
				if (isLayoutSettling() && isRecentWindowResize()) {
					holdPinnedShortInView();
					startResizeHoldLoop();
				}
			});
		}
		const sc = getShortsScrollContainer();
		const inner = document.querySelector('#shorts-inner-container');
		if (sc instanceof HTMLElement) shortsResizeObserver.observe(sc);
		if (inner instanceof HTMLElement) shortsResizeObserver.observe(inner);
	}

	function ensureWindowBoxObserver() {
		if (typeof ResizeObserver !== 'function') return;
		if (windowBoxObserver) return;
		windowBoxObserver = new ResizeObserver(() => syncWindowSnapLock());
		windowBoxObserver.observe(document.documentElement);
	}

	function isOnShortsPath() {
		return /\/shorts\//.test(location.pathname);
	}

	function revealActiveNativeRail() {
		if (!isOnShortsPath()) return;
		const preferred = getPreferredActiveReelRenderer();
		const keep =
			preferred ||
			document.querySelector('ytd-reel-video-renderer[extract-overlay], ytd-reel-video-renderer');
		if (!(keep instanceof HTMLElement)) return;
		const overlayRoot =
			keep.querySelector('#experiment-overlay') ||
			keep.querySelector('ytd-reel-player-overlay-renderer')?.closest('#experiment-overlay') ||
			keep.querySelector('ytd-reel-player-overlay-renderer');
		document.querySelectorAll('#experiment-overlay').forEach((el) => {
			if (!(el instanceof HTMLElement)) return;
			const isKeep = el === overlayRoot || keep.contains(el);
			if (isKeep) {
				el.style.setProperty('opacity', '1', 'important');
				el.style.setProperty('pointer-events', 'none', 'important');
				el.dataset.ytsOverlayRevealed = '1';
			} else if (el.dataset.ytsOverlayRevealed === '1') {
				el.style.removeProperty('opacity');
				el.style.removeProperty('pointer-events');
				delete el.dataset.ytsOverlayRevealed;
			}
		});
		const overlay = overlayFromRenderer(keep) || keep;
		const bar = findReelActionBar(overlay);
		const hosts = [bar, bar && bar.parentElement].filter(
			(el) => el instanceof HTMLElement
		);
		hosts.forEach((el) => {
			el.style.setProperty('visibility', 'visible', 'important');
			el.style.setProperty('opacity', '1', 'important');
			el.style.setProperty('pointer-events', 'auto', 'important');
			el.dataset.ytsRailRevealed = '1';
		});
		document.querySelectorAll('[data-yts-rail-revealed="1"]').forEach((el) => {
			if (!(el instanceof HTMLElement) || hosts.includes(el)) return;
			el.style.removeProperty('visibility');
			el.style.removeProperty('opacity');
			el.style.removeProperty('pointer-events');
			delete el.dataset.ytsRailRevealed;
		});
	}

	function isElementVisiblyOnScreen(el) {
		if (!(el instanceof Element)) return false;
		const r = el.getBoundingClientRect();
		if (r.width < 4 || r.height < 4) return false;
		if (r.bottom <= 0 || r.top >= window.innerHeight) return false;
		if (r.right <= 0 || r.left >= window.innerWidth) return false;
		return true;
	}

	function rowRenderer(row) {
		return row instanceof Element ? row.closest('ytd-reel-video-renderer') : null;
	}

	function scopeHasActionBar(scope) {
		if (!scope) return false;
		return !!(
			findReelActionBar(scope) ||
			querySelectorDeep('#like-button', scope) ||
			querySelectorDeep('like-button-view-model', scope) ||
			querySelectorDeep('segmented-like-dislike-button-view-model', scope)
		);
	}

	function getHostOverlay(el) {
		if (!(el instanceof Element)) return null;
		return el.closest('ytd-reel-player-overlay-renderer');
	}

	function getToolboxLayoutHost() {
		return speedRootEl;
	}

	function overlayIsUsableScope(overlay) {
		if (!(overlay instanceof HTMLElement) || isInsideCommentsPanel(overlay)) return false;
		if (!scopeHasActionBar(overlay)) return false;
		const r = overlay.getBoundingClientRect();
		if (r.width < 8 || r.height < 8) return false;
		if (r.bottom <= 0 || r.top >= window.innerHeight) return false;
		if (r.right <= 0 || r.left >= window.innerWidth) return false;
		return true;
	}

	function getShortsReelUiScopeRoot() {
		const preferred = getPreferredActiveReelRenderer();
		const preferredOverlay = overlayFromRenderer(preferred);
		if (overlayIsUsableScope(preferredOverlay)) return preferredOverlay;

		for (const overlay of getVisibleReelOverlays()) {
			if (preferred && preferred.contains(overlay) && overlayIsUsableScope(overlay)) {
				return overlay;
			}
		}
		for (const overlay of getVisibleReelOverlays()) {
			if (overlayIsUsableScope(overlay)) return overlay;
		}

		const extracted = document.querySelector('reel-action-bar-view-model');
		if (extracted instanceof HTMLElement && !isInsideCommentsPanel(extracted)) {
			const r = extracted.getBoundingClientRect();
			if (isUsableActionAnchorRect(r) || (r.width >= 24 && r.height >= 80 && r.left >= 72)) {
				return extracted;
			}
		}

		const overlay =
			document.querySelector('ytd-reel-player-overlay-renderer') ||
			querySelectorDeep('ytd-reel-player-overlay-renderer', document.documentElement);
		if (overlayIsUsableScope(overlay)) return overlay;

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

	function maybeNeutralizeBlockingOverlays() {
		// Do not alter YouTube overlay nodes.  Their action rail is rebuilt
		// dynamically, and changing a sibling's pointer handling can leave the
		// complete native button column unavailable after a rebuild.
		restoreNeutralizedOverlays();
	}

	function restoreNeutralizedOverlays() {
		document.querySelectorAll('[data-yts-toolbox-overlay-neutralized="1"]').forEach((el) => {
			if (!(el instanceof HTMLElement)) return;
			el.style.removeProperty('pointer-events');
			delete el.dataset.ytsToolboxOverlayNeutralized;
		});
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

		const bar = getReelActionBarFromNode(inner);
		if (bar) {
			const tagged = inner.closest(
				'like-button-view-model, dislike-button-view-model, comments-button-view-model, button-view-model'
			);
			if (tagged instanceof HTMLElement) {
				let row = tagged;
				while (row.parentElement && row.parentElement !== bar) {
					row = row.parentElement;
				}
				if (row.parentElement === bar) return row;
			}
		}

		// Never walk above the action rail itself; otherwise a flex-column
		// ancestor of the whole overlay could be picked and we would inject
		// the toolbox into the wrong container.
		const actionsBoundary = bar || inner.closest('#actions');
		let n = inner;
		for (let depth = 0; depth < 28 && n; depth++) {
			const p = n.parentElement;
			if (!p) break;
			if (actionsBoundary && !actionsBoundary.contains(p)) break;
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

	function isRootDockedBeforeRow(root, row) {
		return isToolboxOnBodyHost(root) && row instanceof Element;
	}

	function attachRootAtRow(root, row) {
		const bodyHost = root instanceof HTMLElement && root.dataset.ytsFixedHost === '1';
		if (!bodyHost && !canAttachToolboxToRow(row)) return false;
		if (row && (row.contains(root) || root.contains(row))) return false;
		if (isToolboxOnBodyHost(root)) {
			applyToolboxPanelOpenState(root);
			return true;
		}
		mutatingDom = true;
		try {
			// Host on document.body so the toolbox can paint above YouTube's
			// comments panel (a sibling of the player, not of the action rail).
			if (root.parentElement !== document.body) {
				document.body.appendChild(root);
			}
			root.dataset.ytsFixedHost = '1';
			delete root.dataset.ytsCommentsLift;
			applyToolboxPanelOpenState(root);
		} finally {
			mutatingDom = false;
		}
		return root.isConnected;
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
		if (isToolboxLiftedAboveComments()) return;
		if (isLayoutSettling()) return;
		if (!toolboxIsOnCurrentShort()) {
			forceToolboxOntoCurrentShort();
			return;
		}
		applyToolboxPanelOpenState();
		if (isToolboxOnBodyHost()) return;
		const likeRow = findFallbackAnchorRow();
		if (!likeRow || !likeRow.parentElement || !canAttachToolboxToRow(likeRow)) return;
		if (isRootDockedBeforeRow(speedRootEl, likeRow)) return;
		if (Date.now() - lastAnchorFixAt < 300) return;
		lastAnchorFixAt = Date.now();
		attachRootAtRow(speedRootEl, likeRow);
	}

	function findLikeByAriaFallback(scope) {
		if (!scope) return null;
		const actions = findReelActionBar(scope);
		if (!(actions instanceof HTMLElement)) return null;
		const buttons = querySelectorAllDeep('button', actions);
		for (const btn of buttons) {
			if (!(btn instanceof HTMLButtonElement)) continue;
			const label = (
				btn.getAttribute('aria-label') ||
				btn.getAttribute('title') ||
				btn.textContent ||
				''
			).toLowerCase();
			if (!/(like|喜歡|喜歡這|点赞|讚|いいね)/i.test(label)) continue;
			return (
				btn.closest('#like-button') ||
				btn.closest('like-button-view-model') ||
				btn.closest('segmented-like-dislike-button-view-model') ||
				btn
			);
		}
		return null;
	}

	function findLikeInner() {
		const scope = getShortsReelUiScopeRoot();
		if (!scope) return null;
		const hit =
			querySelectorDeep('#like-button', scope) ||
			querySelectorDeep('like-button-view-model', scope) ||
			querySelectorDeep('segmented-like-dislike-button-view-model', scope) ||
			findLikeByAriaFallback(scope);
		if (!hit || !isInReelActionUi(hit)) return null;
		return hit;
	}

	function findFirstActionBarRow(scope) {
		if (!scope) return null;
		const actions = findReelActionBar(scope);
		if (!(actions instanceof HTMLElement)) return null;
		for (const child of actions.children) {
			if (!(child instanceof HTMLElement)) continue;
			if (!isInReelActionUi(child)) continue;
			const btn = child.querySelector('button');
			if (!(btn instanceof HTMLButtonElement)) continue;
			return findActionRowElement(btn) || child;
		}
		return null;
	}

	function pushAnchorRowCandidate(rows, inner) {
		if (!(inner instanceof Element) || !inner.isConnected || !isInReelActionUi(inner)) return;
		const likeRow = findActionRowElement(inner);
		if (!(likeRow instanceof HTMLElement)) return;
		if (!rows.includes(likeRow)) rows.push(likeRow);
	}

	function collectLikeInnerFromScope(scope) {
		if (!scope) return null;
		const hit =
			querySelectorDeep('#like-button', scope) ||
			querySelectorDeep('like-button-view-model', scope) ||
			querySelectorDeep('segmented-like-dislike-button-view-model', scope) ||
			findLikeByAriaFallback(scope);
		return hit && isInReelActionUi(hit) ? hit : null;
	}

	function pickBestAnchorRow(rows) {
		let best = null;
		let bestScore = -1;
		for (const row of rows) {
			if (!(row instanceof HTMLElement)) continue;
			const rect = getRowAnchorRect(row);
			if (!rect) continue;
			const score = scoreActionAnchorRect(rect);
			if (score > bestScore) {
				bestScore = score;
				best = row;
			}
		}
		return best;
	}

	function findFallbackAnchorRow() {
		const rows = [];
		const preferred = getPreferredActiveReelRenderer();
		const preferredScope = preferred
			? overlayFromRenderer(preferred) || preferred
			: getShortsReelUiScopeRoot();
		pushAnchorRowCandidate(rows, collectLikeInnerFromScope(preferredScope));
		pushAnchorRowCandidate(rows, findLikeInner());
		const first = findFirstActionBarRow(preferredScope || getShortsReelUiScopeRoot());
		if (first instanceof HTMLElement && !rows.includes(first)) {
			rows.push(first);
		}

		let best = pickBestAnchorRow(rows);
		if (best) return best;

		for (const overlay of getVisibleReelOverlays()) {
			pushAnchorRowCandidate(rows, collectLikeInnerFromScope(overlay));
			const overlayFirst = findFirstActionBarRow(overlay);
			if (overlayFirst instanceof HTMLElement && !rows.includes(overlayFirst)) {
				rows.push(overlayFirst);
			}
		}
		document.querySelectorAll('reel-action-bar-view-model').forEach((bar) => {
			if (!(bar instanceof HTMLElement) || isInsideCommentsPanel(bar)) return;
			pushAnchorRowCandidate(rows, collectLikeInnerFromScope(bar));
			const barFirst = findFirstActionBarRow(bar);
			if (barFirst instanceof HTMLElement && !rows.includes(barFirst)) {
				rows.push(barFirst);
			}
		});
		return pickBestAnchorRow(rows);
	}

	function isCommentsPanelOpen() {
		const panels = document.querySelectorAll(
			'ytd-engagement-panel-section-list-renderer, ytd-comments-panel'
		);
		for (const panel of panels) {
			if (!(panel instanceof HTMLElement)) continue;
			const hint = `${panel.getAttribute('target-id') || ''} ${panel.id || ''} ${
				panel.getAttribute('panel-id') || ''
			} ${panel.tagName}`;
			if (!/comment/i.test(hint)) continue;
			if (panel.hasAttribute('hidden')) continue;
			const vis = panel.getAttribute('visibility');
			if (vis === 'ENGAGEMENT_PANEL_VISIBILITY_HIDDEN') continue;
			if (vis === 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') return true;
			if (vis && vis !== 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') continue;
		const cs = getComputedStyle(panel);
			if (cs.display === 'none' || cs.visibility === 'hidden') continue;
		const rect = panel.getBoundingClientRect();
			if (rect.width < 40 || rect.height < 40) continue;
			if (rect.right < 8 || rect.left > window.innerWidth - 8) continue;
			return true;
		}
		return false;
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
		const panel =
			getOpenCommentsPanel() ||
			document.querySelector(
				'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"], ytd-comments-panel'
		);
		if (!(panel instanceof Element)) return null;
		const visibilityBtn = querySelectorDeep('#visibility-button button', panel);
		if (visibilityBtn instanceof HTMLButtonElement) return visibilityBtn;
		const header = panel.querySelector('ytd-engagement-panel-title-header-renderer');
		if (header instanceof Element) {
			const headerButtons = querySelectorAllDeep('button', header);
			for (const btn of headerButtons) {
				if (!(btn instanceof HTMLButtonElement)) continue;
				const label = btn.getAttribute('aria-label') || btn.getAttribute('title') || '';
				if (/(close|關閉|关闭|閉じる)/i.test(label)) return btn;
			}
		}
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

	function isToolboxLiftedAboveComments() {
		return !!(speedRootEl && speedRootEl.dataset.ytsCommentsLift === '1');
	}

	function applyLiftedToolboxRect(rect) {
		if (!(speedRootEl instanceof HTMLElement) || !rect) return;
		speedRootEl.style.setProperty('position', 'fixed', 'important');
		speedRootEl.style.setProperty('left', `${rect.left}px`, 'important');
		speedRootEl.style.setProperty('top', `${rect.top}px`, 'important');
		speedRootEl.style.setProperty('width', `${rect.width}px`, 'important');
		speedRootEl.style.setProperty('z-index', TOOLBOX_TOP_Z, 'important');
		speedRootEl.style.setProperty('margin', '0', 'important');
		speedRootEl.style.setProperty('pointer-events', 'auto', 'important');
	}

	function clearToolboxLiftStyles() {
		if (!(speedRootEl instanceof HTMLElement)) return;
		delete speedRootEl.dataset.ytsCommentsLift;
	}

	const RAISED_RAIL_STYLE_KEYS = [
		'position',
		'top',
		'left',
		'right',
		'bottom',
		'width',
		'height',
		'z-index',
		'pointer-events',
		'isolation',
		'overflow',
	];

	function snapshotRaisedRailStyles(el) {
		if (!(el instanceof HTMLElement) || el.dataset.ytsRaisedStyle) return;
		const saved = {};
		for (const key of RAISED_RAIL_STYLE_KEYS) {
			saved[key] = el.style.getPropertyValue(key);
		}
		el.dataset.ytsRaisedStyle = JSON.stringify(saved);
	}

	function restoreRaisedRailStyles(el) {
		if (!(el instanceof HTMLElement)) return;
		const raw = el.dataset.ytsRaisedStyle;
		delete el.dataset.ytsRaisedStyle;
		delete el.dataset.ytsRaisedOverComments;
		delete el.dataset.ytsActionsRaised;
		if (!raw) {
			RAISED_RAIL_STYLE_KEYS.forEach((key) => el.style.removeProperty(key));
			return;
		}
		try {
			const saved = JSON.parse(raw);
			for (const key of RAISED_RAIL_STYLE_KEYS) {
				if (saved[key]) el.style.setProperty(key, saved[key]);
				else el.style.removeProperty(key);
			}
		} catch (_) {
			RAISED_RAIL_STYLE_KEYS.forEach((key) => el.style.removeProperty(key));
		}
	}

	function getCommentsStackZ() {
		let maxZ = 0;
		const nodes = [
			getOpenCommentsPanel(),
			document.querySelector('#shorts-panel-container'),
			document.querySelector('#anchored-panel'),
			document.querySelector('#anchored-panel-scrim'),
		];
		for (const start of nodes) {
			let n = start;
			for (let i = 0; n && i < 12; i++) {
				const zi = parseInt(getComputedStyle(n).zIndex, 10);
				if (Number.isFinite(zi) && zi > maxZ) maxZ = zi;
				if (n.id === 'content' || n.localName === 'ytd-app' || n === document.body) break;
				n = n.parentElement;
			}
		}
		return maxZ;
	}

	function getActionRailRaiseHost() {
		const likeRow = findFallbackAnchorRow();
		const bar = likeRow
			? getReelActionBarFromNode(likeRow)
			: findReelActionBar(getShortsReelUiScopeRoot());
		if (!(bar instanceof HTMLElement)) return null;
		return (
			bar.closest('.ytReelPlayerOverlayViewModelActionsContainer') ||
			bar.parentElement ||
			bar
		);
	}

	function clearRaisedActionRailStyles() {
		document.querySelectorAll('[data-yts-raised-over-comments="1"]').forEach((el) => {
			if (el instanceof HTMLElement) restoreRaisedRailStyles(el);
		});
		document.querySelectorAll('ytd-reel-player-overlay-renderer #actions').forEach((el) => {
			if (!(el instanceof HTMLElement)) return;
			if (el.dataset.ytsRaisedStyle) restoreRaisedRailStyles(el);
			else {
				el.style.removeProperty('position');
				el.style.removeProperty('z-index');
				el.style.removeProperty('isolation');
				delete el.dataset.ytsActionsRaised;
			}
		});
		restoreCommentsScrimPointerEvents();
	}

	function cleanupOrphanLiftSlots() {
		document.querySelectorAll('#yts-toolbox-lift-slot').forEach((el) => {
			if (el instanceof HTMLElement) el.remove();
		});
		commentsLiftSlotEl = null;
	}

	function remountToolboxToCurrentShort() {
		cleanupOrphanLiftSlots();
		if (speedRootEl instanceof HTMLElement) delete speedRootEl.dataset.ytsCommentsLift;
		clearRaisedActionRailStyles();
		if (isLayoutSettling()) {
			return toolboxIsOnCurrentShort();
		}
		return forceToolboxOntoCurrentShort();
	}

	function restoreToolboxFromCommentsLift() {
		cleanupOrphanLiftSlots();
		clearRaisedActionRailStyles();
		if (!isToolboxLiftedAboveComments()) return;
		clearToolboxLiftStyles();
		if (!speedRootEl || !isInReelActionUi(speedRootEl)) {
			remountToolboxToCurrentShort();
		} else {
			syncToolboxLayoutWithNative();
		}
	}

	function raiseToolboxAboveComments() {
		const root = speedRootEl;
		if (!(root instanceof HTMLElement) || !root.isConnected) return;
		// The toolbox is body-hosted only for stable fixed positioning. Do not
		// move it to the end of body or promote it to a popover: either action
		// places it above YouTube's own menus when comments are open, unlike the
		// native action-rail buttons.
		if (root.parentElement !== document.body) {
			document.body.appendChild(root);
			root.dataset.ytsFixedHost = '1';
		}
		if (root.hasAttribute('popover')) {
			try {
				if (typeof root.hidePopover === 'function' && root.matches(':popover-open')) {
					root.hidePopover();
				}
			} catch (_) {}
			root.removeAttribute('popover');
		}
		root.style.setProperty('position', 'fixed', 'important');
		root.style.setProperty('z-index', TOOLBOX_TOP_Z, 'important');
		root.style.setProperty('pointer-events', 'auto', 'important');
	}

	function restoreCommentsScrimPointerEvents() {
		const scrim = document.querySelector('#anchored-panel-scrim');
		if (!(scrim instanceof HTMLElement)) return;
		if (scrim.dataset.ytsScrimPassthrough === '1') {
			scrim.style.removeProperty('pointer-events');
			delete scrim.dataset.ytsScrimPassthrough;
		}
	}

	function raiseActionRailAboveComments() {
		raiseToolboxAboveComments();
		restoreCommentsScrimPointerEvents();
	}

	function syncCommentsOpenDocumentFlag() {
		const open = isCommentsPanelOpen();
		const was = document.documentElement.hasAttribute(COMMENTS_OPEN_ATTR);
		if (open) {
			document.documentElement.setAttribute(COMMENTS_OPEN_ATTR, '1');
			raiseActionRailAboveComments();
			if (Date.now() >= commentsUserDismissedUntil) commentsWantedOpen = true;
		} else {
			document.documentElement.removeAttribute(COMMENTS_OPEN_ATTR);
			restoreCommentsScrimPointerEvents();
		}
		if (open !== was) {
			startNativeAnchorFollow(560);
			syncSpeedUiWithNativeLike();
		}
	}

	function syncToolboxAboveComments() {
		syncCommentsOpenDocumentFlag();
		if (!speedRootEl || !speedRootEl.isConnected) return;
		applyToolboxPanelOpenState();
	}

	function closeCommentsPanelIfOpen() {
		if (!isCommentsPanelOpen()) return;
		const closeBtn = findCommentsPanelCloseButton();
		if (closeBtn instanceof HTMLButtonElement) {
			try {
			closeBtn.click();
			} catch (_) {}
			return;
		}
		const toggleBtn = findCommentsToggleButton();
		if (toggleBtn instanceof HTMLButtonElement) {
			try {
			toggleBtn.click();
			} catch (_) {}
		}
	}

	function openCommentsPanelForCurrentShort() {
		if (isCommentsPanelOpen()) return true;
		const toggleBtn = findCommentsToggleButton();
		if (!(toggleBtn instanceof HTMLButtonElement)) return false;
		try {
			toggleBtn.click();
		} catch (_) {
			return false;
		}
		return true;
	}

	/**
	 * Keep comments open across auto-next and make sure they belong to the new
	 * Short. YouTube normally reloads the open panel itself; we only step in
	 * when the panel is still showing the previous video's comments (or got
	 * closed) after the navigation settled.
	 */
	let pendingCommentsRefreshAfterAdvance = false;
	let commentsSnapshotBeforeAdvance = '';
	let commentsRefreshInProgress = false;
	let commentsRefreshTimer = null;
	let commentsFollowTimer = null;
	let commentsFollowUntil = 0;
	let commentsContentObserver = null;
	let commentsContentObsRaf = 0;
	let lastSettledCommentsSnapshot = '';
	let lastSettledCommentsShortId = '';

	function getOpenCommentsPanel() {
		const preferred = document.querySelector(
			'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-comments-section"]'
		);
		const panels = preferred
			? [preferred, ...document.querySelectorAll('ytd-engagement-panel-section-list-renderer, ytd-comments-panel')]
			: document.querySelectorAll('ytd-engagement-panel-section-list-renderer, ytd-comments-panel');
		const seen = new Set();
		for (const panel of panels) {
			if (!(panel instanceof HTMLElement) || seen.has(panel)) continue;
			seen.add(panel);
			if (panel.hasAttribute('hidden')) continue;
			const vis = panel.getAttribute('visibility');
			if (vis && vis !== 'ENGAGEMENT_PANEL_VISIBILITY_EXPANDED') continue;
			const hint = `${panel.getAttribute('target-id') || ''} ${panel.id || ''} ${
				panel.getAttribute('panel-id') || ''
			} ${panel.tagName}`;
			if (!/comment/i.test(hint)) continue;
			return panel;
		}
		return null;
	}

	function snapshotCommentsPanel() {
		const panel = getOpenCommentsPanel();
		if (!panel) return '';
		const bound = getCommentsBoundVideoId(panel);
		const header =
			panel.querySelector('ytd-comments-header-renderer, ytd-engagement-panel-title-header-renderer');
		const headerText = header ? (header.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 120) : '';
		const threads = panel.querySelectorAll('ytd-comment-thread-renderer');
		const firstTexts = [];
		for (let i = 0; i < Math.min(3, threads.length); i++) {
			const body = threads[i].querySelector('#content-text, yt-attributed-string');
			firstTexts.push(body ? (body.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80) : '');
		}
		return `${bound}|${headerText}|${threads.length}|${firstTexts.join('||')}`;
	}

	function commentsSnapshotLooksSettled(snap) {
		if (!snap) return false;
		const parts = String(snap).split('|');
		const headerText = parts[1] || '';
		const threadCount = Number(parts[2] || 0);
		if (threadCount > 0) return true;
		if (/還沒|尚無|沒有留言|no comments|be the first|成為第一|0\s*則/i.test(headerText)) {
			return true;
		}
		return headerText.length > 4 && /\d/.test(headerText);
	}

	function commentsPanelIsLoading(panel) {
		if (!(panel instanceof HTMLElement)) return false;
		const spinner = panel.querySelector(
			'#spinner, tp-yt-paper-spinner, yt-spinner, #continuations yt-icon'
		);
		if (!(spinner instanceof HTMLElement)) return false;
		const cs = getComputedStyle(spinner);
		if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
		const r = spinner.getBoundingClientRect();
		return r.width > 2 && r.height > 2;
	}

	function collectCommentsReloadHosts(panel) {
		const list = [];
		const add = (el) => {
			if (el instanceof HTMLElement && !list.includes(el)) list.push(el);
		};
		add(panel);
		if (!(panel instanceof HTMLElement)) return list;
		add(panel.querySelector('ytd-comments'));
		add(panel.querySelector('ytd-comment-section-renderer'));
		panel
			.querySelectorAll('ytd-item-section-renderer[section-identifier="comment-item-section"]')
			.forEach(add);
		return list;
	}

	function readHostVideoId(el) {
		if (!(el instanceof HTMLElement)) return '';
		const attr = el.getAttribute('video-id') || '';
		let prop = '';
		try {
			prop = el.videoId || '';
		} catch (_) {}
		let data = '';
		try {
			data = (el.__data && el.__data.videoId) || '';
		} catch (_) {}
		const vid = attr || prop || data || '';
		return vid && vid !== 'undefined' ? String(vid) : '';
	}

	function getCommentsBoundVideoId(panel = getOpenCommentsPanel()) {
		if (!(panel instanceof HTMLElement)) return '';
		for (const el of collectCommentsReloadHosts(panel)) {
			const vid = readHostVideoId(el);
			if (vid) return vid;
		}
		return '';
	}

	function commentsMatchCurrentShort() {
		const id = getCurrentShortId();
		if (!id || id === 'short') return false;
		if (!isCommentsPanelOpen()) return false;
		const panel = getOpenCommentsPanel();
		if (!(panel instanceof HTMLElement)) return false;
		if (commentsPanelIsLoading(panel)) return false;
		const bound = getCommentsBoundVideoId(panel);
		if (bound && bound !== id) return false;
		const snap = snapshotCommentsPanel();
		if (commentsSnapshotBeforeAdvance) {
			if (snap === commentsSnapshotBeforeAdvance) return false;
			return commentsSnapshotLooksSettled(snap);
		}
		if (bound === id) return commentsSnapshotLooksSettled(snap);
		return commentsSnapshotLooksSettled(snap);
	}

	function snapshotForPreviousShort(nextId) {
		if (
			lastSettledCommentsShortId &&
			nextId &&
			nextId !== 'short' &&
			lastSettledCommentsShortId !== nextId &&
			lastSettledCommentsSnapshot
		) {
			return lastSettledCommentsSnapshot;
		}
		return snapshotCommentsPanel();
	}

	function rememberSettledCommentsIfCurrent() {
		if (pendingCommentsRefreshAfterAdvance) return;
		if (!isCommentsPanelOpen()) return;
		const id = getCurrentShortId();
		if (!id || id === 'short') return;
		const bound = getCommentsBoundVideoId();
		if (bound && bound !== id) return;
		const snap = snapshotCommentsPanel();
		if (!commentsSnapshotLooksSettled(snap)) return;
		lastSettledCommentsSnapshot = snap;
		lastSettledCommentsShortId = id;
	}

	function finishCommentsFollow() {
		pendingCommentsRefreshAfterAdvance = false;
		commentsRefreshInProgress = false;
		const snap = snapshotCommentsPanel();
		commentsSnapshotBeforeAdvance = snap;
		if (commentsSnapshotLooksSettled(snap)) {
			lastSettledCommentsSnapshot = snap;
			const id = getCurrentShortId();
			if (id && id !== 'short') lastSettledCommentsShortId = id;
		}
		stopCommentsFollowLoop();
	}

	function stopCommentsFollowLoop() {
		commentsFollowUntil = 0;
		if (commentsFollowTimer) {
			clearTimeout(commentsFollowTimer);
			commentsFollowTimer = null;
		}
		if (commentsContentObsRaf) {
			cancelAnimationFrame(commentsContentObsRaf);
			commentsContentObsRaf = 0;
		}
		if (commentsContentObserver) commentsContentObserver.disconnect();
	}

	function ensureCommentsContentObserver() {
		const panel = getOpenCommentsPanel();
		if (!(panel instanceof HTMLElement)) return;
		if (!commentsContentObserver) {
			commentsContentObserver = new MutationObserver(() => {
				if (!pendingCommentsRefreshAfterAdvance) return;
				if (commentsContentObsRaf) return;
				commentsContentObsRaf = requestAnimationFrame(() => {
					commentsContentObsRaf = 0;
					if (commentsMatchCurrentShort()) finishCommentsFollow();
				});
			});
		}
		try {
			commentsContentObserver.disconnect();
			commentsContentObserver.observe(panel, {
				childList: true,
				subtree: true,
				characterData: true,
			});
				} catch (_) {}
			}

	function startCommentsFollowLoop() {
		if (!pendingCommentsRefreshAfterAdvance) return;
		commentsFollowUntil = Date.now() + 12000;
		ensureCommentsContentObserver();
		refreshCommentsPanelForCurrentShort();
		if (commentsFollowTimer) return;
		const step = () => {
			commentsFollowTimer = null;
			if (!pendingCommentsRefreshAfterAdvance) return;
			refreshCommentsPanelForCurrentShort();
			if (!pendingCommentsRefreshAfterAdvance) return;
			if (Date.now() < commentsFollowUntil) {
				ensureCommentsContentObserver();
				commentsFollowTimer = setTimeout(step, 80);
				return;
			}
			pendingCommentsRefreshAfterAdvance = false;
			commentsRefreshInProgress = false;
			stopCommentsFollowLoop();
		};
		commentsFollowTimer = setTimeout(step, 40);
	}

	function captureCommentsBeforeNavigate() {
		if (isLayoutSettling() && resizePinnedShortId) return;
		if (!(commentsWantedOpen || isCommentsPanelOpen())) return;
		commentsWantedOpen = true;
		commentsSnapshotBeforeAdvance = snapshotCommentsPanel() || lastSettledCommentsSnapshot;
		pendingCommentsRefreshAfterAdvance = true;
		commentsRefreshTries = 0;
		commentsFollowUntil = 0;
		startCommentsFollowLoop();
	}

	function markCommentsNeedFollow() {
		if (isLayoutSettling()) return;
		if (!(commentsWantedOpen || isCommentsPanelOpen())) return;
		commentsWantedOpen = true;
		pendingCommentsRefreshAfterAdvance = true;
		const id = getCurrentShortId();
		const prev = snapshotForPreviousShort(id);
		if (prev) commentsSnapshotBeforeAdvance = prev;
		else if (!commentsSnapshotBeforeAdvance) commentsSnapshotBeforeAdvance = snapshotCommentsPanel();
		commentsRefreshTries = 0;
		commentsFollowUntil = 0;
		startCommentsFollowLoop();
	}

	function noteCurrentShortForComments() {
		const id = getCurrentShortId();
		if (!id || id === 'short') return;
		if (lastCommentsFollowShortId && lastCommentsFollowShortId !== id) {
			markCommentsNeedFollow();
		} else {
			rememberSettledCommentsIfCurrent();
		}
		lastCommentsFollowShortId = id;
	}

	function refreshCommentsPanelForCurrentShort() {
		if (isLayoutSettling() && !isExplicitShortNav() && !isAutoAdvanceNavigation()) return;
		if (!pendingCommentsRefreshAfterAdvance) return;
		if (commentsRefreshInProgress) return;
		if (autoAdvanceSourceShortId && getCurrentShortId() === autoAdvanceSourceShortId) return;

		if (!isCommentsPanelOpen()) {
			if (!commentsWantedOpen) {
				finishCommentsFollow();
				pendingCommentsRefreshAfterAdvance = false;
				return;
			}
			if (!findCommentsToggleButton()) return;
			commentsRefreshInProgress = true;
			openCommentsPanelForCurrentShort();
			if (commentsRefreshTimer) clearTimeout(commentsRefreshTimer);
			commentsRefreshTimer = setTimeout(() => {
				commentsRefreshTimer = null;
				commentsRefreshInProgress = false;
				if (commentsMatchCurrentShort()) {
					finishCommentsFollow();
					return;
				}
				retryCommentsFollow();
			}, 120);
			return;
		}

		if (commentsMatchCurrentShort()) {
			finishCommentsFollow();
			return;
		}

		commentsRefreshInProgress = true;
		nudgeOpenCommentsReload();
		if (commentsRefreshTimer) clearTimeout(commentsRefreshTimer);
		commentsRefreshTimer = setTimeout(() => {
			commentsRefreshTimer = null;
			commentsRefreshInProgress = false;
			if (commentsMatchCurrentShort()) {
				finishCommentsFollow();
				return;
			}
			retryCommentsFollow();
		}, 140);
	}

	function retryCommentsFollow() {
		commentsRefreshTries += 1;
		if (commentsRefreshTries > 40) {
			pendingCommentsRefreshAfterAdvance = false;
			commentsRefreshInProgress = false;
			stopCommentsFollowLoop();
			return;
		}
		pendingCommentsRefreshAfterAdvance = true;
		refreshCommentsPanelForCurrentShort();
	}

	function bindCommentsHostVideoId(el, id) {
		if (!(el instanceof HTMLElement) || !id || id === 'short') return;
		try {
			el.setAttribute('video-id', id);
			} catch (_) {}
		try {
			el.videoId = id;
		} catch (_) {}
		try {
			if (typeof el.set === 'function') el.set('videoId', id);
		} catch (_) {}
		try {
			if (el.__data) {
				el.__data.videoId = id;
				if (typeof el.notifyPath === 'function') el.notifyPath('videoId', id);
			}
		} catch (_) {}
		try {
			if (typeof el.requestUpdate === 'function') el.requestUpdate();
		} catch (_) {}
	}

	function nudgeCommentsHost(el, id) {
		if (!(el instanceof HTMLElement)) return;
		bindCommentsHostVideoId(el, id);
		try {
			el.dispatchEvent(
				new CustomEvent('yt-reload-continuation', { bubbles: true, composed: true })
			);
		} catch (_) {}
		const methods = [
			'reload',
			'reset',
			'loadComments',
			'loadCommentSection',
			'resetContinuation',
		];
		for (const name of methods) {
			try {
				if (typeof el[name] === 'function') el[name]();
			} catch (_) {}
		}
	}

	function nudgeOpenCommentsReload() {
		const panel = getOpenCommentsPanel();
		if (!(panel instanceof HTMLElement)) return;
		const id = getCurrentShortId();
		for (const host of collectCommentsReloadHosts(panel)) {
			nudgeCommentsHost(host, id);
		}
	}

	function toolboxIsOnCurrentShort() {
		if (!(speedRootEl && speedRootEl.isConnected)) return false;
		if (isToolboxOnBodyHost()) return isOnShortsPath();
		if (!isInReelActionUi(speedRootEl)) return false;
		const rootRenderer = speedRootEl.closest('ytd-reel-video-renderer');
		if (rootRenderer && rendererMatchesCurrentShort(rootRenderer)) return true;
		if (rootRenderer && isLikelyActiveReelRenderer(rootRenderer) && !hasUrlMatchedReelRenderer()) {
			return true;
		}
		if (rootRenderer && document.querySelectorAll('ytd-reel-video-renderer').length === 1) {
			return true;
		}
		return false;
	}

	function forceToolboxOntoCurrentShort() {
		if (speedRootEl && speedRootEl.isConnected && isToolboxOnBodyHost(speedRootEl)) {
			applyToolboxPanelOpenState();
			syncToolboxLayoutWithNative();
			return toolboxIsOnCurrentShort();
		}
		const likeRow = findFallbackAnchorRow();
		if (!(likeRow instanceof HTMLElement) || !likeRow.parentElement) {
			return ensureMounted() && toolboxIsOnCurrentShort();
		}

		if (speedRootEl && speedRootEl.isConnected) {
			if (!isToolboxOnBodyHost(speedRootEl)) {
				lastAnchorFixAt = 0;
				attachRootAtRow(speedRootEl, likeRow);
			}
			applyToolboxPanelOpenState();
			syncToolboxLayoutWithNative();
			return toolboxIsOnCurrentShort();
		}

		return ensureMounted() && toolboxIsOnCurrentShort();
	}

	let postAdvanceRepairTimerIds = [];
	function clearPostAdvanceRepairTimers() {
		postAdvanceRepairTimerIds.forEach((id) => clearTimeout(id));
		postAdvanceRepairTimerIds = [];
	}

	function schedulePostAdvanceRepair() {
		clearPostAdvanceRepairTimers();
		const delays = [80, 200, 400, 700, 1100, 1800, 2800];
		delays.forEach((ms) => {
			const id = setTimeout(() => {
				// URL already changed — never keep blocking mount on the new short.
				if (autoAdvanceSourceShortId && getCurrentShortId() !== autoAdvanceSourceShortId) {
					autoAdvanceMountNotBefore = 0;
				}
				if (!toolboxIsOnCurrentShort()) forceToolboxOntoCurrentShort();
				scheduleMountWork();
				if (ms >= 200) refreshCommentsPanelForCurrentShort();
				if (toolboxIsOnCurrentShort()) {
					if (autoAdvanceSourceShortId && getCurrentShortId() !== autoAdvanceSourceShortId) {
						autoAdvanceSourceShortId = '';
						autoAdvancePendingUntil = 0;
						autoAdvanceMountNotBefore = 0;
					}
				}
			}, ms);
			postAdvanceRepairTimerIds.push(id);
		});
	}

	let commentTranslateMode = null;
	let syncingCommentTranslations = false;
	let commentTranslateObserver = null;
	let commentTranslateSyncTimer = null;

	function getCommentTranslateHostFromNode(node) {
		if (!(node instanceof Element)) return null;
		if (
			node.matches &&
			node.matches('ytd-tri-state-button-view-model.translate-button, .translate-button')
		) {
			return node;
		}
		return node.closest
			? node.closest('ytd-tri-state-button-view-model.translate-button, .translate-button')
			: null;
	}

	function getCommentTranslateHostFromEvent(e) {
		if (!e) return null;
		if (typeof e.composedPath === 'function') {
			for (const node of e.composedPath()) {
				const host = getCommentTranslateHostFromNode(node);
				if (host) return host;
			}
		}
		return getCommentTranslateHostFromNode(e.target instanceof Element ? e.target : null);
	}

	function getCommentTranslateButton(host) {
		if (!(host instanceof Element)) return null;
		const btn =
			host.querySelector('tp-yt-paper-button, button, [role="button"]') || host;
		return btn instanceof HTMLElement ? btn : null;
	}

	function isCommentTranslateOn(host) {
		if (!(host instanceof Element)) return false;
		const state = (host.getAttribute('state') || '').toLowerCase();
		if (state === 'toggled') return true;
		if (state === 'untoggled') return false;
		const label =
			(getCommentTranslateButton(host)?.textContent || host.textContent || '').trim();
		if (/(原文|original|オリジナル|原文を表示|顯示原文|显示原文)/i.test(label)) return true;
		if (/(翻譯|翻译|Translate|翻訳)/i.test(label)) return false;
		return false;
	}

	function collectCommentTranslateHosts(root = document.documentElement) {
		return querySelectorAllDeep(
			'ytd-tri-state-button-view-model.translate-button, ytd-tri-state-button-view-model.translate-button-view-model, .translate-button',
			root
		).filter((el) => el instanceof HTMLElement);
	}

	function syncAllCommentTranslations(mode, exceptHost = null) {
		if (!mode) return;
		if (syncingCommentTranslations) return;
		syncingCommentTranslations = true;
		try {
			const wantOn = mode === 'on';
			const hosts = collectCommentTranslateHosts();
			for (const host of hosts) {
				if (exceptHost && (host === exceptHost || host.contains(exceptHost) || exceptHost.contains(host))) {
					continue;
				}
				if (isCommentTranslateOn(host) === wantOn) continue;
				const btn = getCommentTranslateButton(host);
				if (!btn) continue;
				try {
					btn.click();
				} catch (_) {}
			}
		} finally {
			setTimeout(() => {
				syncingCommentTranslations = false;
			}, 50);
		}
	}

	function scheduleCommentTranslateSync() {
		if (!commentTranslateMode) return;
		if (commentTranslateSyncTimer) clearTimeout(commentTranslateSyncTimer);
		commentTranslateSyncTimer = setTimeout(() => {
			commentTranslateSyncTimer = null;
			syncAllCommentTranslations(commentTranslateMode);
		}, 120);
	}

	function ensureCommentTranslateObserver() {
		if (commentTranslateObserver) return;
		const root = document.documentElement || document.body;
		if (!root) return;
		commentTranslateObserver = new MutationObserver(() => {
			if (!commentTranslateMode) return;
			scheduleCommentTranslateSync();
		});
		commentTranslateObserver.observe(root, { childList: true, subtree: true });
	}

	function onDocumentClick(e) {
		if (syncingCommentTranslations) return;
		const host = getCommentTranslateHostFromEvent(e);
		if (!host) return;
		const currentlyOn = isCommentTranslateOn(host);
		const nextMode = currentlyOn ? 'off' : 'on';
		commentTranslateMode = nextMode;
		ensureCommentTranslateObserver();
		setTimeout(() => {
			syncAllCommentTranslations(nextMode, host);
			scheduleCommentTranslateSync();
		}, 30);
	}

	function getNativeYouTubePlayerApi(videoEl = null) {
		const isApi = (el) =>
			el &&
			typeof el.setVolume === 'function' &&
			typeof el.getVolume === 'function';
		if (videoEl instanceof HTMLVideoElement) {
			const closestPlayer = videoEl.closest(
				'.html5-video-player, #shorts-player, #movie_player'
			);
			if (isApi(closestPlayer)) return closestPlayer;
			const host =
				videoEl.closest('ytd-player, ytd-reel-video-renderer') || videoEl.parentElement;
			if (host instanceof HTMLElement) {
				const inner =
					host.querySelector('#shorts-player') ||
					host.querySelector('#movie_player') ||
					host.querySelector('.html5-video-player');
				if (isApi(inner)) return inner;
			}
		}
		const shortsPlayer = document.querySelector('#shorts-player');
		if (isApi(shortsPlayer)) return shortsPlayer;
		const activeRenderer =
			document.querySelector('ytd-reel-video-renderer[is-active]') ||
			document.querySelector('ytd-reel-video-renderer[reel-active]') ||
			document.querySelector("ytd-reel-video-renderer[aria-hidden='false']");
		if (activeRenderer instanceof HTMLElement) {
			const scoped =
				activeRenderer.querySelector('#shorts-player') ||
				activeRenderer.querySelector('#movie_player') ||
				activeRenderer.querySelector('.html5-video-player');
			if (isApi(scoped)) return scoped;
		}
		const direct = document.getElementById('movie_player');
		if (isApi(direct)) return direct;
		return null;
	}

	function findShortsVolumeHost() {
		return (
			querySelectorDeep('ytd-shorts-player-controls-cow volume-controls') ||
			querySelectorDeep('volume-controls.ytdVolumeControlsHost') ||
			querySelectorDeep('volume-controls')
		);
	}

	function canFocusNativeVolumeSlider() {
		const ae = document.activeElement;
		if (!(ae instanceof HTMLElement)) return true;
		if (ae.id === 'volume-input' || ae.classList.contains('ytdVolumeControlsNativeSlider')) {
			return true;
		}
		if (ae.closest('ytd-comment-simplebox-renderer, ytd-commentbox, ytd-engagement-panel-section-list-renderer')) {
			if (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable) return false;
		}
		const tag = ae.tagName;
		if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return false;
		if (ae.isContentEditable) return false;
		return true;
	}

	function applyNativeVolumeSliderValue(host, pct) {
		if (!(host instanceof HTMLElement)) return null;
		const input = host.querySelector('#volume-input, .ytdVolumeControlsNativeSlider');
		if (!(input instanceof HTMLElement)) return null;
		try {
			if ('value' in input) input.value = String(pct);
				} catch (_) {}
				try {
			input.setAttribute('aria-valuenow', String(pct));
			input.setAttribute('aria-valuetext', `${pct}%`);
			input.style.setProperty('--gradient-percent', `${pct}%`);
				} catch (_) {}
		return input;
	}

	function addNativeVolumeExpandedClasses(host) {
		if (!(host instanceof HTMLElement)) return;
		host
			.querySelector('.ytdVolumeControlsVolumeControlsContainer')
			?.classList.add('ytdVolumeControlsVolumeControlsContainerExpanded');
		host
			.querySelector('.ytdVolumeControlsSliderContainer')
			?.classList.add('ytdVolumeControlsSliderContainerExpanded');
		host
			.querySelector('.ytdVolumeControlsBackgroundScrim')
			?.classList.add('ytdVolumeControlsBackgroundScrimExpanded');
	}

	function removeNativeVolumeExpandedClasses(host) {
		if (!(host instanceof HTMLElement)) return;
		host
			.querySelector('.ytdVolumeControlsVolumeControlsContainer')
			?.classList.remove('ytdVolumeControlsVolumeControlsContainerExpanded');
		host
			.querySelector('.ytdVolumeControlsSliderContainer')
			?.classList.remove('ytdVolumeControlsSliderContainerExpanded');
		host
			.querySelector('.ytdVolumeControlsBackgroundScrim')
			?.classList.remove(
				'ytdVolumeControlsBackgroundScrimExpanded',
				'ytdVolumeControlsBackgroundScrimExpandedHoverState'
			);
	}

	function paintShortsVolumeHoverUi() {
		const host = findShortsVolumeHost();
		if (!(host instanceof HTMLElement)) return;
		volumeHoverHostEl = host;
		addNativeVolumeExpandedClasses(host);
		const input = host.querySelector('#volume-input, .ytdVolumeControlsNativeSlider');
		if (input instanceof HTMLInputElement && canFocusNativeVolumeSlider()) {
			try {
				if (document.activeElement !== input) input.focus({ preventScroll: true });
				volumeHoverFocusedEl = input;
			} catch (_) {}
		}
	}

	function stopVolumeHoverPersist() {
		volumeHoverUntil = 0;
		if (volumeHoverHideTimer) {
			clearTimeout(volumeHoverHideTimer);
			volumeHoverHideTimer = null;
		}
		if (volumeHoverPaintTimer) {
			clearTimeout(volumeHoverPaintTimer);
			volumeHoverPaintTimer = null;
		}
	}

	function hideNativeVolumeHoverUi() {
		stopVolumeHoverPersist();
		if (volumeHoverFocusedEl instanceof HTMLElement && document.activeElement === volumeHoverFocusedEl) {
			try {
				volumeHoverFocusedEl.blur();
			} catch (_) {}
		}
		volumeHoverFocusedEl = null;
		const host = volumeHoverHostEl;
		volumeHoverHostEl = null;
		if (host instanceof HTMLElement) removeNativeVolumeExpandedClasses(host);
		document.querySelectorAll('volume-controls, .ytdVolumeControlsHost').forEach((el) => {
			if (el instanceof HTMLElement) removeNativeVolumeExpandedClasses(el);
		});
	}

	function clampVolumePct(n) {
		const v = Number(n);
		if (!Number.isFinite(v)) return null;
		return Math.max(0, Math.min(100, Math.round(v)));
	}

	function findNativeVolumeSlider() {
		const host = findShortsVolumeHost();
		if (!(host instanceof HTMLElement)) return null;
		const input = host.querySelector('#volume-input, .ytdVolumeControlsNativeSlider');
		return input instanceof HTMLInputElement ? input : null;
	}

	function readNativeVolumePct() {
		const input = findNativeVolumeSlider();
		if (input) {
			const n = clampVolumePct(input.value);
			if (n !== null) return n;
		}
		const api = getNativeYouTubePlayerApi(getActiveShortsVideo());
		try {
			if (api && typeof api.getVolume === 'function') {
				const n = Number(api.getVolume());
				if (Number.isFinite(n)) return clampVolumePct(n);
			}
		} catch (_) {}
		return null;
	}

	function commitNativeVolumePct(pct) {
		const n = clampVolumePct(pct);
		if (n === null) return false;
		const input = findNativeVolumeSlider();
		if (input) {
			try {
				const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
				if (desc && typeof desc.set === 'function') desc.set.call(input, String(n));
				else input.value = String(n);
			} catch (_) {
				try {
					input.value = String(n);
				} catch (_) {}
			}
			try {
				input.setAttribute('aria-valuenow', String(n));
				input.setAttribute('aria-valuetext', `${n}% volume`);
				input.style.setProperty('--gradient-percent', `${n}%`);
			} catch (_) {}
			try {
				input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
				input.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
			} catch (_) {}
			showNativeVolumeHoverUi(n);
			return true;
		}
		const api = getNativeYouTubePlayerApi(getActiveShortsVideo());
		if (api && typeof api.setVolume === 'function') {
			try {
				api.setVolume(n);
				if (n > 0 && typeof api.isMuted === 'function' && api.isMuted() && typeof api.unMute === 'function') {
					api.unMute();
				}
		} catch (_) {}
			showNativeVolumeHoverUi(n);
		return true;
		}
		return false;
	}

	function showNativeVolumeHoverUi(nextPct) {
		if (Number.isFinite(nextPct)) {
			volumeHoverPct = Math.max(0, Math.min(100, Math.round(nextPct)));
		}
		volumeHoverUntil = Date.now() + 2500;
		paintShortsVolumeHoverUi();
		if (!volumeHoverPaintTimer) {
			const tick = () => {
				volumeHoverPaintTimer = null;
				if (Date.now() >= volumeHoverUntil) {
					hideNativeVolumeHoverUi();
					return;
				}
				paintShortsVolumeHoverUi();
				volumeHoverPaintTimer = setTimeout(tick, 200);
			};
			volumeHoverPaintTimer = setTimeout(tick, 50);
		}
		if (volumeHoverHideTimer) clearTimeout(volumeHoverHideTimer);
		volumeHoverHideTimer = setTimeout(() => {
			volumeHoverHideTimer = null;
			if (Date.now() >= volumeHoverUntil) hideNativeVolumeHoverUi();
		}, 2500);
	}

	function adjustVolumeBy(deltaPercent) {
		const step = Number(deltaPercent);
		if (!Number.isFinite(step) || step === 0) return false;
		const start = readNativeVolumePct();
		if (start === null) return false;
		return commitNativeVolumePct(Math.max(0, Math.min(100, start + step)));
	}

	function onDocumentKeydown(e) {
		if (!(e instanceof KeyboardEvent)) return;
		const k = e.key;
		if (k === 'Escape' && isCommentsPanelOpen()) {
			noteCommentsDismissedByUser();
		}
		if (
			k === 'ArrowUp' ||
			k === 'ArrowDown' ||
			k === 'MediaTrackNext' ||
			k === 'MediaTrackPrevious'
		) {
			if (
				(k === 'ArrowUp' || k === 'ArrowDown') &&
				(eventTouchesCommentsUi(e) || isTypingTarget(e.target))
			) {
				return;
			}
			noteExplicitShortNav();
			noteManualShortNavigation();
		}
		if (leftRightVolumeEnabled && (k === 'ArrowLeft' || k === 'ArrowRight')) {
			// Browsers emit repeat keydown events while held, so both a tap and a
			// held key use the exact same 5% step.
			const delta = k === 'ArrowRight' ? VOLUME_STEP_PERCENT : -VOLUME_STEP_PERCENT;
			if (!adjustVolumeBy(delta)) return;
			e.preventDefault();
			if (typeof e.stopImmediatePropagation === 'function') {
				e.stopImmediatePropagation();
			}
			e.stopPropagation();
			return;
		}
	}

	function isShortsNavControl(el) {
		if (!(el instanceof Element)) return false;
		if (el.closest(`#${ROOT_ID}`)) return false;
		if (isInsideCommentsPanel(el)) return false;
		return !!el.closest('#navigation-button-down, #navigation-button-up');
	}

	function isDontRecommendChannelAction(e) {
		const menuItemSelector =
			'[role="menuitem"], yt-list-item-view-model, ytd-menu-service-item-renderer, tp-yt-paper-item, ytd-menu-navigation-item-renderer';
		for (const el of eventPathElements(e)) {
			if (el.closest(`#${ROOT_ID}`)) return false;
			const item = el.closest(menuItemSelector);
			if (!(item instanceof HTMLElement)) continue;
			const label = [
				item.getAttribute('aria-label'),
				item.getAttribute('title'),
				item.textContent,
			]
				.filter(Boolean)
				.join(' ')
				.replace(/\s+/g, ' ')
				.trim();
			if (
				/(不要(?:向我)?推薦(?:這個|这个)?頻道|不再推薦(?:這個|这个)?頻道|不要(?:向我)?推荐(?:这个)?频道|不再推荐(?:这个)?频道|don't recommend (?:this )?channel|do not recommend (?:this )?channel|このチャンネルをおすすめに表示しない)/i.test(
					label
				)
			) {
				return true;
			}
		}
		return false;
	}

	function onManualShortNavGesture(e) {
		if (!e) return;
		if (e.type === 'wheel') {
			if (isBrowserZoomWheel(e)) return;
			if (Math.abs(e.deltaY || 0) < 8) return;
			if (Math.abs(e.deltaX || 0) > Math.abs(e.deltaY || 0)) return;
			if (eventTouchesCommentsUi(e)) {
				if (urlLockShortId) enforceUrlLock();
				return;
			}
			if (!eventTouchesShortsFeedNav(e)) return;
			noteExplicitShortNav();
			noteManualShortNavigation();
			return;
		}
		if (e.type === 'click' || e.type === 'pointerdown') {
			const t = e.target;
			if (!(t instanceof Element)) return;
			// This menu action removes the current Short and YouTube advances to a
			// replacement. Treat only this user-confirmed action as navigation, so
			// the resize/video lock does not restore the rejected Short.
			if (isDontRecommendChannelAction(e)) {
				noteExplicitShortNav();
				return;
			}
			if (isShortsNavControl(t)) {
				noteExplicitShortNav();
				noteManualShortNavigation();
			}
		}
	}

	function onExplicitShortNavSignal() {
		noteExplicitShortNav();
		noteManualShortNavigation();
	}

	function onYtNavigateStart() {
		syncWindowSnapLock();
		if (!isExplicitShortNav()) {
			enforceUrlLock();
			return;
		}
		abortResizeLockForUserNav();
		captureCommentsBeforeNavigate();
		rememberLiveShortPin(true);
	}

	function onShortNavigateFinish() {
		syncWindowSnapLock();
		if (!isExplicitShortNav()) {
			enforceUrlLock();
			startNativeAnchorFollow(720);
			return;
		}
		abortResizeLockForUserNav();
		commitUrlLockFromLocation();
		rememberLiveShortPin(true);
		noteCurrentShortForComments();
		startNativeAnchorFollow(720);
		startBootstrapRetries();
		if (!isAutoAdvanceNavigation()) {
			noteManualShortNavigation();
		} else {
			autoAdvanceMountNotBefore = 0;
			schedulePostAdvanceRepair();
			scheduleMountWork();
		}
		if (pendingCommentsRefreshAfterAdvance || commentsWantedOpen || isCommentsPanelOpen()) {
			if (commentsWantedOpen || isCommentsPanelOpen()) {
				commentsWantedOpen = true;
				pendingCommentsRefreshAfterAdvance = true;
				if (!commentsSnapshotBeforeAdvance) {
					commentsSnapshotBeforeAdvance = snapshotForPreviousShort(getCurrentShortId());
				}
			}
			schedulePostAdvanceRepair();
			startCommentsFollowLoop();
			refreshCommentsPanelForCurrentShort();
		}
		syncPlayThroughShortId();
	}

	function onYtPageDataUpdated() {
		if (!isExplicitShortNav()) {
			enforceUrlLock();
			return;
		}
		noteCurrentShortForComments();
		if (pendingCommentsRefreshAfterAdvance) {
			startCommentsFollowLoop();
			refreshCommentsPanelForCurrentShort();
			return;
		}
		rememberSettledCommentsIfCurrent();
	}

	function togglePanel() {
		toolboxPanelWantedOpen = !toolboxPanelWantedOpen;
		applyToolboxPanelOpenState();
		syncToolboxAboveComments();
	}

	function restorePinnedShortAfterResize() {
		const pin = urlLockShortId || resizePinnedShortId;
		const host = findPinnedSequenceHost(pin);
		if (host instanceof HTMLElement) centerShortsHostInScroller(host);
		if (!pin || pin === 'short' || getCurrentShortId() === pin) return;
		if (restorePinnedRetryTimer) return;
		restorePinnedRetryTimer = setTimeout(() => {
			restorePinnedRetryTimer = null;
			const again = findPinnedSequenceHost(pin);
			if (again instanceof HTMLElement) centerShortsHostInScroller(again);
			resumePinnedShortMedia(again, pin);
			scheduleMountWork();
		}, 160);
	}

	function onWindowLayoutSettle() {
		syncWindowSnapLock();
	}

	function onDocumentScrollForToolbox() {
		syncWindowSnapLock();
		if (!isExplicitShortNav() && urlLockShortId) {
			enforceUrlLock();
			if (!(speedRootEl && speedRootEl.isConnected)) return;
			syncToolboxLayoutWithNative();
			return;
		}
		rememberLiveShortPin();
		if (!(speedRootEl && speedRootEl.isConnected)) return;
		syncToolboxLayoutWithNative();
	}

	document.addEventListener('click', onDocumentClick, true);
	document.addEventListener('click', onCommentsUiPointer, true);
	document.addEventListener('click', onManualShortNavGesture, true);
	document.addEventListener('pointerdown', onCommentsUiPointer, true);
	document.addEventListener('bm-youtube-explicit-short-nav', onExplicitShortNavSignal, true);
	document.addEventListener('keydown', onDocumentKeydown, true);
	document.addEventListener('wheel', onManualShortNavGesture, { capture: true, passive: true });
	document.addEventListener('pointerdown', onManualShortNavGesture, true);
	document.addEventListener('scroll', onDocumentScrollForToolbox, { capture: true, passive: true });
	window.addEventListener('resize', onWindowLayoutSettle, { capture: true, passive: true });
	window.addEventListener('orientationchange', onWindowLayoutSettle, { capture: true, passive: true });
	if (window.visualViewport) {
		window.visualViewport.addEventListener('resize', onWindowLayoutSettle, { capture: true, passive: true });
	}
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
		const preferred = getPreferredActiveReelRenderer();
		if (preferred instanceof HTMLElement) {
			const preferredVideo = preferred.querySelector('video');
			if (preferredVideo instanceof HTMLVideoElement) return preferredVideo;
		}

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
		const urlId = getCurrentShortId();
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
				if (urlId && urlId !== 'short' && rendererMatchesCurrentShort(renderer)) {
					score *= 3;
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
		persistDefaultSpeedIndex();
		updateSpeedUiLockedState();
		applyToAllLikelyVideos();
	}

	function getCurrentShortId() {
		const m = location.pathname.match(/\/shorts\/([^/?#]+)/);
		return m ? m[1] : 'short';
	}

	function getActiveShortKey() {
		const id = getCurrentShortId();
		const v = getActiveShortsVideo();
		const renderer =
			(v instanceof HTMLVideoElement && v.closest('ytd-reel-video-renderer')) ||
			document.querySelector('ytd-reel-video-renderer[is-active]') ||
			document.querySelector('ytd-reel-video-renderer[reel-active]');
		const rid =
			renderer instanceof HTMLElement
				? renderer.getAttribute('id') ||
					renderer.getAttribute('reel-video-id') ||
					renderer.dataset.videoId ||
					''
				: '';
		// Only fall back to the media src when the URL carries no short id.
		// The src changes on quality switches, which used to reset the play count
		// and trigger a needless remount mid-video.
		const src =
			id === 'short' && v instanceof HTMLVideoElement ? v.currentSrc || v.src || '' : '';
		return `${id}|${rid}|${src}`;
	}

	function clearActiveVideoPlayCursor() {
		const v = getActiveShortsVideo();
		if (v instanceof HTMLVideoElement) {
			delete v.dataset.bmPrevPlayTime;
		}
	}

	function resetPlayThroughState(shortId) {
		playThroughShortId = shortId || getActiveShortKey();
		playThroughCount = 0;
		lastPlayCompletionAt = 0;
		clearActiveVideoPlayCursor();
	}

	function isAutoAdvanceNavigation() {
		return Date.now() < autoAdvancePendingUntil || Date.now() - lastAdvanceToNextAt < 1200;
	}

	function shouldDeferAutoAdvanceMount() {
		if (!autoAdvanceSourceShortId) return false;
		const currentShortId = getCurrentShortId();
		// Only defer while we are still on the pre-advance Short (avoid mounting
		// onto a reel that is about to unmount). Once the URL changes, mount ASAP.
		if (currentShortId === autoAdvanceSourceShortId) {
			return Date.now() < autoAdvancePendingUntil;
		}
		return false;
	}

	function scheduleDeferredAutoAdvanceMount() {
		if (!autoAdvanceSourceShortId || autoAdvanceMountTimer) return;
		const currentShortId = getCurrentShortId();
		const targetAt =
			currentShortId === autoAdvanceSourceShortId
				? autoAdvancePendingUntil
				: autoAdvanceMountNotBefore;
		const delay = Math.max(50, targetAt - Date.now());
		autoAdvanceMountTimer = setTimeout(() => {
			autoAdvanceMountTimer = null;
			scheduleMountWork();
		}, delay);
	}

	function noteManualShortNavigation() {
		if (isAutoAdvanceNavigation()) return;
		noteExplicitShortNav();
		playThroughCount = 0;
		lastPlayCompletionAt = 0;
		clearActiveVideoPlayCursor();
		const now = getCurrentShortId();
		if (now && now !== 'short' && now !== urlLockShortId) {
			rememberLiveShortPin(true);
			noteCurrentShortForComments();
		}
		const id = getActiveShortKey();
		if (id !== playThroughShortId) {
			playThroughShortId = id;
			remountToolboxToCurrentShort();
		}
	}

	function syncPlayThroughShortId() {
		if (!isExplicitShortNav() && urlLockShortId && getCurrentShortId() !== urlLockShortId) {
			enforceUrlLock();
			return;
		}
		if (isLayoutSettling() && !isExplicitShortNav()) return;
		if (shouldDeferAutoAdvanceMount()) {
			scheduleDeferredAutoAdvanceMount();
			return;
		}
		const id = getActiveShortKey();
		if (id === playThroughShortId) return;
		const prevUrl = String(playThroughShortId || '').split('|')[0];
		const nextUrl = getCurrentShortId();
		const wasAuto = isAutoAdvanceNavigation();
		resetPlayThroughState(id);
		if (!wasAuto) {
			playThroughCount = 0;
			lastPlayCompletionAt = 0;
		}
		const urlChanged = prevUrl !== nextUrl;
		if (urlChanged) noteCurrentShortForComments();
		if (
			!urlChanged &&
			speedRootEl &&
			speedRootEl.isConnected &&
			isInReelActionUi(speedRootEl)
		) {
			return;
		}
		remountToolboxToCurrentShort();
	}

	function goToNextShort() {
		applyWindowSizeChange();
		if (isResizeHoldRunning() && !isExplicitShortNav()) return;
		const now = Date.now();
		if (now - lastAdvanceToNextAt < 900) return;
		lastAdvanceToNextAt = now;
		autoAdvancePendingUntil = now + 2500;
		autoAdvanceSourceShortId = getCurrentShortId();
		autoAdvanceMountNotBefore = now + 120;
		// Remember open comments so we can reload them for the next Short (not leave them closed).
		pendingCommentsRefreshAfterAdvance = commentsWantedOpen || isCommentsPanelOpen();
		if (pendingCommentsRefreshAfterAdvance) commentsWantedOpen = true;
		commentsSnapshotBeforeAdvance = pendingCommentsRefreshAfterAdvance
			? snapshotCommentsPanel() || lastSettledCommentsSnapshot
			: '';
		commentsRefreshTries = 0;
		commentsRefreshInProgress = false;
		if (pendingCommentsRefreshAfterAdvance) {
			commentsFollowUntil = 0;
			startCommentsFollowLoop();
		}
		lastAnchorFixAt = 0;
		schedulePostAdvanceRepair();

		const btn =
			document.querySelector('#navigation-button-down button') ||
			document.querySelector('ytd-button-renderer#navigation-button-down button') ||
			querySelectorDeep('#navigation-button-down button');
		if (btn instanceof HTMLElement) {
			try {
				btn.click();
				return;
			} catch (_) {}
		}

		const evtInit = {
			key: 'ArrowDown',
			code: 'ArrowDown',
			keyCode: 40,
			which: 40,
			bubbles: true,
			cancelable: true,
		};
		// Dispatch exactly once. Every dispatch bubbles to document, so firing on
		// several targets made YouTube skip several Shorts at a time.
		const target =
			querySelectorDeep('#shorts-player') ||
			document.activeElement ||
			document.body ||
			document.documentElement;
		if (!target || typeof target.dispatchEvent !== 'function') return;
		try {
			target.dispatchEvent(new KeyboardEvent('keydown', evtInit));
			target.dispatchEvent(new KeyboardEvent('keyup', evtInit));
		} catch (_) {}
	}

	function onShortPlayCompleted() {
		applyWindowSizeChange();
		if (isResizeHoldRunning() && !isExplicitShortNav()) return;
		if (isLayoutSettling() && !isExplicitShortNav()) return;
		if (!autoNextEnabled) return;
		if (framePlaybackEnabled || recordingSession || manualRecordSession || suspendSpeedSync) return;
		const id = getCurrentShortId();
		const countKey = id && id !== 'short' ? id : getActiveShortKey();
		if (countKey !== playThroughShortId) {
			playThroughShortId = countKey;
			playThroughCount = 0;
		}
		const now = Date.now();
		if (now - lastPlayCompletionAt < 500) return;
		lastPlayCompletionAt = now;
		playThroughCount += 1;
		if (playThroughCount < playCountBeforeNext) return;
		playThroughCount = 0;
		goToNextShort();
	}

	function onHookedVideoTimeUpdate(v) {
		if (!(v instanceof HTMLVideoElement)) return;
		if (isLayoutSettling()) {
			v.dataset.bmPrevPlayTime = String(Number(v.currentTime) || 0);
			return;
		}
		const active = getActiveShortsVideo();
		if (active && active !== v) return;
		const dur = Number(v.duration);
		if (!Number.isFinite(dur) || dur < 0.4) return;
		const t = Number(v.currentTime) || 0;
		const prev = Number(v.dataset.bmPrevPlayTime || 0);
		if (prev > dur * 0.82 && t < Math.min(1.25, dur * 0.22)) {
			onShortPlayCompleted();
		}
		v.dataset.bmPrevPlayTime = String(t);
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
		if (!isOnShortsPath()) return false;
		const likeBtn = findVisibleNativeLikeButton();
		const anchorRow =
			(likeBtn && findActionRowElement(likeBtn)) ||
			findFallbackAnchorRow();
		if (!likeBtn && (!anchorRow || !anchorRow.parentElement)) return false;

		const root = document.createElement('div');
		root.id = ROOT_ID;
		root.setAttribute('data-open', toolboxPanelWantedOpen ? '1' : '0');
		root.dataset.ytsFixedHost = '1';
		root.dataset.bmYtsRole = TOOLBOX_ROLE;
		root.toggleAttribute('data-expand-up', !panelExpandRightEnabled);
		root.style.visibility = 'hidden';
		root.style.setProperty('position', 'fixed', 'important');
		root.style.setProperty('left', '-9999px', 'important');
		root.style.setProperty('top', '-9999px', 'important');

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

		if (!attachRootAtRow(root, anchorRow || document.body) || !root.isConnected) {
			// Anchor vanished between lookup and insert; try again on the next pass
			// instead of holding a detached root that blocks future mounts.
			return false;
		}

		const rn = root.getRootNode();
		speedRootEl = root;
		applyToolboxPanelOpenState(root);
		downloadBtnEl = downloadBtn;
		downloadPercentEl = recordPercent;
		recordBtnEl = recordBtn;
		updateFramePlaybackUi();
		updateSpeedUiLockedState();
		ensureStylesInShadowRoot(rn);
		syncToolboxLayoutWithNative();
		syncSpeedUiWithNativeLike();
		applyToAllLikelyVideos();
		return true;
	}

	function removeExternal3xWidgets() {
		const all = document.querySelectorAll(`#${ROOT_ID}`);
		all.forEach((el) => {
			if (!(el instanceof HTMLElement)) return;
			if (el === speedRootEl) return;
			if (el.dataset.bmYtsRole === TOOLBOX_ROLE) return;
			if (el.querySelector('.yts-toolbox-panel')) return;
			if (el.dataset.bmYtsRole === SPEED3X_ROLE) {
				el.remove();
				return;
			}
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
		v.addEventListener('timeupdate', () => onHookedVideoTimeUpdate(v));
		v.addEventListener('seeked', () => onHookedVideoTimeUpdate(v));
		v.addEventListener('ended', () => {
			const active = getActiveShortsVideo();
			if (active && active !== v) return;
			onShortPlayCompleted();
		});
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
			t.closest(
				'#actions, ytd-reel-player-overlay-renderer #actions, reel-action-bar-view-model, reel-action-bar-item-view-model, .ytReelPlayerOverlayViewModelActionsContainer'
			)
		)
			return false;

		const v = getActiveShortsVideo();
		if (!v) return false;
		const x = e.clientX;
		const y = e.clientY;
		const r = v.getBoundingClientRect();
		if (x < r.left || x > r.right || y < r.top || y > r.bottom) return false;

		const actions =
			document.querySelector('ytd-reel-player-overlay-renderer reel-action-bar-view-model') ||
			document.querySelector('ytd-reel-player-overlay-renderer #actions');
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

	function scheduleMountWork() {
		if (mountWorkScheduled || mutatingDom) return;
		mountWorkScheduled = true;
		requestAnimationFrame(() => {
			mountWorkScheduled = false;
			runMountWork();
		});
	}

	function runMountWork() {
		if (!isExplicitShortNav() && urlLockShortId && getCurrentShortId() !== urlLockShortId) {
			enforceUrlLock();
			syncCommentsOpenDocumentFlag();
			revealActiveNativeRail();
			syncToolboxLayoutWithNative();
			return;
		}
		if (isLayoutSettling() && isRecentWindowResize() && !isExplicitShortNav()) {
			syncCommentsOpenDocumentFlag();
			holdPinnedShortInView();
			revealActiveNativeRail();
			syncToolboxLayoutWithNative();
			return;
		}
		if (shouldDeferAutoAdvanceMount()) {
			scheduleDeferredAutoAdvanceMount();
			return;
		}
		restoreNeutralizedOverlays();
		removeExternal3xWidgets();
		if (!ensureMounted()) {
			syncControllerAttr();
			syncCommentsOpenDocumentFlag();
			// Keep retrying after auto-advance until the new short's rail exists.
			if (autoAdvanceSourceShortId) {
				scheduleDeferredAutoAdvanceMount();
				schedulePostAdvanceRepair();
			}
			return;
		}
		syncControllerAttr();
		ensureSpeedAnchorIntact();
		if (!toolboxIsOnCurrentShort()) forceToolboxOntoCurrentShort();
		if (toolboxIsOnCurrentShort()) {
			if (autoAdvanceSourceShortId && getCurrentShortId() !== autoAdvanceSourceShortId) {
				autoAdvanceSourceShortId = '';
				autoAdvanceMountNotBefore = 0;
				autoAdvancePendingUntil = 0;
			} else if (!autoAdvanceSourceShortId) {
				autoAdvanceMountNotBefore = 0;
			}
		} else if (autoAdvanceSourceShortId) {
			schedulePostAdvanceRepair();
		}
		if (!videoObserver) setupVideoHooks();
		scheduleReapply();
		applyToolboxPanelOpenState();
		rememberLiveShortPin();
		noteCurrentShortForComments();
		if (pendingCommentsRefreshAfterAdvance) refreshCommentsPanelForCurrentShort();
		revealActiveNativeRail();
		syncToolboxLayoutWithNative();
		syncToolboxAboveComments();
	}

	function isOwnMutationRecord(m) {
		const root = speedRootEl;
		const isOurs = (n) =>
			n instanceof Element && (n.id === ROOT_ID || (root && root.contains(n)));
		if (m.target instanceof Node && root && root.contains(m.target)) return true;
		const nodes = [...m.addedNodes, ...m.removedNodes];
		if (!nodes.length) return false;
		return nodes.every(isOurs);
	}

	function initObservers() {
		if (mountObserver) mountObserver.disconnect();
		mountObserver = new MutationObserver((records) => {
			if (mutatingDom) return;
			// The mutatingDom flag is already cleared by the time this callback
			// runs, so filter our own insert/remove records explicitly. Without
			// this, every re-dock re-triggered mount work in a tight loop.
			if (records.every(isOwnMutationRecord)) return;
			syncWindowSnapLock();
			if (!isExplicitShortNav() && urlLockShortId) {
				enforceUrlLock();
				return;
			}
			rememberLiveShortPin();
			if (!(speedRootEl && speedRootEl.isConnected)) speedRootEl = null;
			scheduleMountWork();
		});
		const observeRoot =
			document.querySelector('ytd-shorts') ||
			document.querySelector('#shorts-container') ||
			document.documentElement;
		mountObserver.observe(observeRoot, {
			childList: true,
			subtree: true,
		});
		ensureShortsResizeObserver();
		ensureWindowBoxObserver();
		ensureCommentsAttrObserver();
		ensureNativeAnchorObserver();
	}

	function startBootstrapRetries() {
		if (bootstrapRetryTimer) {
			clearInterval(bootstrapRetryTimer);
			bootstrapRetryTimer = null;
		}
		if (autoAdvanceMountTimer) {
			clearTimeout(autoAdvanceMountTimer);
			autoAdvanceMountTimer = null;
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
		if (autoAdvanceMountTimer) {
			clearTimeout(autoAdvanceMountTimer);
			autoAdvanceMountTimer = null;
		}
		if (layoutResumeTimer) {
			clearTimeout(layoutResumeTimer);
			layoutResumeTimer = null;
		}
		if (restorePinnedRetryTimer) {
			clearTimeout(restorePinnedRetryTimer);
			restorePinnedRetryTimer = null;
		}
		stopResizeHoldLoop();
		stopNativeAnchorFollow();
		hideNativeVolumeHoverUi();
		if (shortsResizeObserver) {
			shortsResizeObserver.disconnect();
			shortsResizeObserver = null;
		}
		if (windowBoxObserver) {
			windowBoxObserver.disconnect();
			windowBoxObserver = null;
		}
		if (nativeAnchorObserver) {
			nativeAnchorObserver.disconnect();
			nativeAnchorObserver = null;
			nativeAnchorObservedEls = [];
		}
		if (commentsAttrObserver) {
			commentsAttrObserver.disconnect();
			commentsAttrObserver = null;
		}
		setResizeLock(false);
		clearPostAdvanceRepairTimers();
		if (commentsRefreshTimer) {
			clearTimeout(commentsRefreshTimer);
			commentsRefreshTimer = null;
		}
		stopCommentsFollowLoop();
		if (commentsContentObserver) {
			commentsContentObserver.disconnect();
			commentsContentObserver = null;
		}
		pendingCommentsRefreshAfterAdvance = false;
		commentsSnapshotBeforeAdvance = '';
		commentsRefreshInProgress = false;
		lastSettledCommentsSnapshot = '';
		lastSettledCommentsShortId = '';
		if (mainTickInterval) {
			clearInterval(mainTickInterval);
			mainTickInterval = null;
		}
		document.removeEventListener('click', onDocumentClick, true);
		document.removeEventListener('click', onCommentsUiPointer, true);
		document.removeEventListener('click', onManualShortNavGesture, true);
		document.removeEventListener('pointerdown', onCommentsUiPointer, true);
		document.removeEventListener('bm-youtube-explicit-short-nav', onExplicitShortNavSignal, true);
		document.removeEventListener('keydown', onDocumentKeydown, true);
		document.removeEventListener('wheel', onManualShortNavGesture, true);
		document.removeEventListener('pointerdown', onManualShortNavGesture, true);
		document.removeEventListener('scroll', onDocumentScrollForToolbox, true);
		window.removeEventListener('resize', onWindowLayoutSettle, true);
		window.removeEventListener('orientationchange', onWindowLayoutSettle, true);
		if (window.visualViewport) {
			window.visualViewport.removeEventListener('resize', onWindowLayoutSettle, true);
		}
		restoreNeutralizedOverlays();
		if (commentTranslateObserver) {
			commentTranslateObserver.disconnect();
			commentTranslateObserver = null;
		}
		if (commentTranslateSyncTimer) {
			clearTimeout(commentTranslateSyncTimer);
			commentTranslateSyncTimer = null;
		}
		commentTranslateMode = null;
		if (runtimeMsgHandler) {
			chrome.runtime.onMessage.removeListener(runtimeMsgHandler);
			runtimeMsgHandler = null;
		}
		window.removeEventListener('pageshow', startBootstrapRetries);
		window.removeEventListener('yt-navigate-finish', onShortNavigateFinish);
		window.removeEventListener('yt-navigate-start', onYtNavigateStart);
		window.removeEventListener('yt-page-data-updated', onYtPageDataUpdated);
		document.removeEventListener('yt-page-data-updated', onYtPageDataUpdated);
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
		restoreToolboxFromCommentsLift();
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
		document.documentElement.removeAttribute(CONTROLLER_ATTR);
		document.documentElement.removeAttribute(COMMENTS_OPEN_ATTR);
		document.documentElement.removeAttribute(RESIZE_LOCK_ATTR);
	}

	function syncControllerAttr() {
		const mounted = !!(speedRootEl && speedRootEl.isConnected);
		const cur = document.documentElement.getAttribute(CONTROLLER_ATTR);
		if (mounted && cur !== TOOLBOX_ROLE) {
			document.documentElement.setAttribute(CONTROLLER_ATTR, TOOLBOX_ROLE);
		} else if (!mounted && cur === TOOLBOX_ROLE) {
			document.documentElement.removeAttribute(CONTROLLER_ATTR);
		}
	}

	/**
	 * Diagnostics: explain why the native action rail on the on-screen Short is
	 * not painted (opacity/visibility/display on it or an ancestor, and which
	 * reel YouTube itself marks active). Exposed via __BM_TOOLBOX_DIAG__().
	 */
	let lastRailDiag = null;
	let lastRailHiddenWarnKey = '';

	function collectRailDiag() {
		const urlId = getCurrentShortId();
		const renderers = Array.from(document.querySelectorAll('ytd-reel-video-renderer'));
		const describeRenderer = (r) => {
			const rect = r.getBoundingClientRect();
			return {
				id: r.getAttribute('id'),
				isActive: r.hasAttribute('is-active'),
				reelActive: r.hasAttribute('reel-active'),
				ariaHidden: r.getAttribute('aria-hidden'),
				matchesUrl: rendererMatchesCurrentShort(r),
				top: Math.round(rect.top),
				height: Math.round(rect.height),
				onScreen: isElementVisiblyOnScreen(r),
			};
		};
		const preferred = getPreferredActiveReelRenderer();
		const overlay = overlayFromRenderer(preferred);
		const actions = overlay ? findReelActionBar(overlay) : null;
		const chain = [];
		let hiddenBy = null;
		if (actions instanceof HTMLElement) {
			let n = actions;
			for (let depth = 0; n && depth < 12; depth++) {
				const cs = getComputedStyle(n);
				const entry = {
					tag: n.tagName.toLowerCase(),
					id: n.id || '',
					opacity: cs.opacity,
					visibility: cs.visibility,
					display: cs.display,
					transform: cs.transform === 'none' ? '' : cs.transform,
					pointerEvents: cs.pointerEvents,
				};
				chain.push(entry);
				if (
					!hiddenBy &&
					(cs.opacity === '0' || cs.visibility === 'hidden' || cs.display === 'none')
				) {
					hiddenBy = entry;
				}
				if (n.tagName === 'YTD-REEL-VIDEO-RENDERER') break;
				n = n.parentElement;
			}
		}
		const actionsRect = actions instanceof HTMLElement ? actions.getBoundingClientRect() : null;
		return {
			urlId,
			hasActions: !!actions,
			actionsRect: actionsRect
				? {
						left: Math.round(actionsRect.left),
						top: Math.round(actionsRect.top),
						width: Math.round(actionsRect.width),
						height: Math.round(actionsRect.height),
					}
				: null,
			hiddenBy,
			chain,
			toolboxDocked: toolboxIsOnCurrentShort(),
			toolboxInSameActions:
				!!(speedRootEl && actions instanceof HTMLElement && actions.contains(speedRootEl)),
			commentsOpen: isCommentsPanelOpen(),
			renderers: renderers.map(describeRenderer),
		};
	}

	function checkNativeRailHealth() {
		let diag = null;
		try {
			diag = collectRailDiag();
		} catch (_) {
			return;
		}
		lastRailDiag = diag;
		// YouTube hides the overlay/action rail while comments are open.
		// We un-hide it via CSS; do not treat that as a toolbox failure.
		if (diag.commentsOpen) return;
		if (
			document.querySelector(
				'ytd-reel-video-renderer[extract-overlay], ytd-reel-video-renderer[fade-overlay]'
			)
		) {
			return;
		}
		if (!diag.hasActions || !diag.hiddenBy) return;
		const key = `${diag.urlId}|${diag.hiddenBy.tag}#${diag.hiddenBy.id}|${diag.hiddenBy.opacity}|${diag.hiddenBy.visibility}|${diag.hiddenBy.display}`;
		if (key === lastRailHiddenWarnKey) return;
		lastRailHiddenWarnKey = key;
		console.warn(
			'[BM Shorts Toolbox] native action rail is hidden on the current Short — paste this in a bug report:',
			JSON.stringify(diag)
		);
	}

	function maybeFollowCommentsForCurrentShort() {
		const id = getCurrentShortId();
		if (!id || id === 'short') return;
		if (
			urlLockShortId &&
			urlLockShortId !== 'short' &&
			id !== urlLockShortId &&
			!isExplicitShortNav()
		) {
			return;
		}
		if (!(commentsWantedOpen || isCommentsPanelOpen())) {
			lastCommentsFollowShortId = id;
			return;
		}
		if (id !== lastCommentsFollowShortId) {
			noteCurrentShortForComments();
			return;
		}
		if (pendingCommentsRefreshAfterAdvance) {
			refreshCommentsPanelForCurrentShort();
			return;
		}
		const bound = getCommentsBoundVideoId();
		if (bound && bound !== id) {
			markCommentsNeedFollow();
			return;
		}
		rememberSettledCommentsIfCurrent();
	}

	function tick() {
		syncCommentsOpenDocumentFlag();
		if (!isExplicitShortNav() && urlLockShortId) enforceUrlLock();
		else if (isExplicitShortNav()) {
			const now = getCurrentShortId();
			if (now && now !== 'short' && now !== urlLockShortId) rememberLiveShortPin(true);
		} else {
			rememberLiveShortPin();
		}
		revealActiveNativeRail();
		runMountWork();
		syncPlayThroughShortId();
		maybeFollowCommentsForCurrentShort();
		checkNativeRailHealth();
		if (!(speedRootEl && speedRootEl.isConnected)) return;
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
		maybeNeutralizeBlockingOverlays();
		syncToolboxLayoutWithNative();
		syncToolboxAboveComments();
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
		rail: (() => {
			try {
				return collectRailDiag();
			} catch (_) {
				return lastRailDiag;
			}
		})(),
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
	commitUrlLockFromLocation();
	rememberLiveShortPin();
	window.addEventListener('pageshow', startBootstrapRetries);
	window.addEventListener('yt-navigate-finish', onShortNavigateFinish);
	window.addEventListener('yt-navigate-start', onYtNavigateStart);
	window.addEventListener('yt-page-data-updated', onYtPageDataUpdated);
	document.addEventListener('yt-page-data-updated', onYtPageDataUpdated);
	mainTickInterval = setInterval(tick, 2000);
	w[INSTANCE_KEY] = { destroy: destroyInstance };
})();
