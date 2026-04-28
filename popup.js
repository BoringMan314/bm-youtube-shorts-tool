'use strict';

const SPEEDS = [1, 1.5, 2, 3];
const STORAGE_KEY_ARROW_VOLUME = 'bmYtsArrowVolumeEnabled';
const STORAGE_KEY_PANEL_RIGHT = 'bmYtsPanelExpandRight';
const STORAGE_KEY_DEFAULT_SPEED_INDEX = 'bmYts3xOptsDefaultSpeedIndex';
const STORAGE_KEY_HOLD_SPEED_INDEX = 'bmYts3xOptsHoldSpeedIndex';

function t(key) {
	try {
		const msg = chrome.i18n.getMessage(key);
		return msg || key;
	} catch (_) {
		return key;
	}
}

function clampIndex(i) {
	const n = Number(i);
	if (!Number.isFinite(n)) return 0;
	return Math.max(0, Math.min(SPEEDS.length - 1, Math.floor(n)));
}

function formatSpeedLabel(s) {
	if (Number.isInteger(s)) return `${s}×`;
	const str = String(s).replace(/\.0+$/, '');
	return `${str}×`;
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
	const btnDef = document.getElementById('btnDefaultSpeed');
	const btnHold = document.getElementById('btnHoldSpeed');
	const lblDef = document.getElementById('lblDefaultSpeed');
	const lblHold = document.getElementById('lblHoldSpeed');
	if (
		!(toggleArrow instanceof HTMLInputElement) ||
		!(togglePanelRight instanceof HTMLInputElement) ||
		!(btnDef instanceof HTMLButtonElement) ||
		!(btnHold instanceof HTMLButtonElement) ||
		!(lblDef instanceof HTMLElement) ||
		!(lblHold instanceof HTMLElement)
	)
		return;

	let defaultIdx = 0;
	let holdIdx = 2;

	function syncSpeedLabels() {
		lblDef.textContent = formatSpeedLabel(SPEEDS[defaultIdx]);
		lblHold.textContent = formatSpeedLabel(SPEEDS[holdIdx]);
		btnDef.setAttribute('aria-label', t('popupAriaDefaultShortSpeedCycle'));
		btnHold.setAttribute('aria-label', t('popupAriaHoldSpeedCycle'));
	}

	chrome.storage.local.get(
		{
			[STORAGE_KEY_ARROW_VOLUME]: true,
			[STORAGE_KEY_PANEL_RIGHT]: true,
			[STORAGE_KEY_DEFAULT_SPEED_INDEX]: 0,
			[STORAGE_KEY_HOLD_SPEED_INDEX]: 2,
		},
		(res) => {
			if (chrome.runtime.lastError) return;
			toggleArrow.checked = res[STORAGE_KEY_ARROW_VOLUME] !== false;
			togglePanelRight.checked = res[STORAGE_KEY_PANEL_RIGHT] !== false;
			defaultIdx = clampIndex(res[STORAGE_KEY_DEFAULT_SPEED_INDEX]);
			holdIdx = clampIndex(res[STORAGE_KEY_HOLD_SPEED_INDEX]);
			syncSpeedLabels();
		}
	);

	toggleArrow.addEventListener('change', () => {
		chrome.storage.local.set({ [STORAGE_KEY_ARROW_VOLUME]: toggleArrow.checked });
	});
	togglePanelRight.addEventListener('change', () => {
		chrome.storage.local.set({ [STORAGE_KEY_PANEL_RIGHT]: togglePanelRight.checked });
	});
	btnDef.addEventListener('click', () => {
		defaultIdx = (defaultIdx + 1) % SPEEDS.length;
		syncSpeedLabels();
		chrome.storage.local.set({
			[STORAGE_KEY_DEFAULT_SPEED_INDEX]: defaultIdx,
		});
	});
	btnHold.addEventListener('click', () => {
		holdIdx = (holdIdx + 1) % SPEEDS.length;
		syncSpeedLabels();
		chrome.storage.local.set({
			[STORAGE_KEY_HOLD_SPEED_INDEX]: holdIdx,
		});
	});
}

document.addEventListener('DOMContentLoaded', init);
