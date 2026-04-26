'use strict';

const STORAGE_KEY_ARROW_VOLUME = 'bmYtsArrowVolumeEnabled';
const STORAGE_KEY_PANEL_RIGHT = 'bmYtsPanelExpandRight';

function t(key) {
	try {
		const msg = chrome.i18n.getMessage(key);
		return msg || key;
	} catch (_) {
		return key;
	}
}

function applyI18n() {
	document.querySelectorAll('[data-i18n]').forEach((el) => {
		const key = el.getAttribute('data-i18n');
		if (!key) return;
		const msg = t(key);
		el.textContent = msg;
		if (el.tagName === 'TITLE') document.title = msg;
	});
	document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
		const key = el.getAttribute('data-i18n-aria-label');
		if (!key) return;
		el.setAttribute('aria-label', t(key));
	});
}

function init() {
	applyI18n();
	const toggleArrow = document.getElementById('toggleArrowVolume');
	const togglePanelRight = document.getElementById('togglePanelExpandRight');
	if (!(toggleArrow instanceof HTMLInputElement)) return;
	if (!(togglePanelRight instanceof HTMLInputElement)) return;

	chrome.storage.local.get(
		{
			[STORAGE_KEY_ARROW_VOLUME]: true,
			[STORAGE_KEY_PANEL_RIGHT]: true,
		},
		(res) => {
			if (chrome.runtime.lastError) return;
			toggleArrow.checked = res[STORAGE_KEY_ARROW_VOLUME] !== false;
			togglePanelRight.checked = res[STORAGE_KEY_PANEL_RIGHT] !== false;
		}
	);

	toggleArrow.addEventListener('change', () => {
		chrome.storage.local.set({ [STORAGE_KEY_ARROW_VOLUME]: toggleArrow.checked });
	});
	togglePanelRight.addEventListener('change', () => {
		chrome.storage.local.set({ [STORAGE_KEY_PANEL_RIGHT]: togglePanelRight.checked });
	});
}

document.addEventListener('DOMContentLoaded', init);
