'use strict';

const SPEEDS = [1, 1.5, 2, 3];
const STORAGE_KEY_ARROW_VOLUME = 'bmYtsArrowVolumeEnabled';
const STORAGE_KEY_PANEL_RIGHT = 'bmYtsPanelExpandRight';
const STORAGE_KEY_DEFAULT_SPEED_INDEX = 'bmYts3xOptsDefaultSpeedIndex';
const STORAGE_KEY_HOLD_SPEED_INDEX = 'bmYts3xOptsHoldSpeedIndex';
const STORAGE_KEY_AUTO_NEXT = 'bmYtsToolboxAutoNextEnabled';
const STORAGE_KEY_LOOP_COUNT = 'bmYtsToolboxPlayCountBeforeNext';

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

function clampLoopCount(n) {
	const v = Number(n);
	if (!Number.isFinite(v)) return 2;
	return Math.max(1, Math.min(999, Math.floor(v)));
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
	const toggleAutoNext = document.getElementById('toggleAutoNext');
	const btnDef = document.getElementById('btnDefaultSpeed');
	const btnHold = document.getElementById('btnHoldSpeed');
	const lblDef = document.getElementById('lblDefaultSpeed');
	const lblHold = document.getElementById('lblHoldSpeed');
	const inputLoopCount = document.getElementById('inputLoopCount');
	if (
		!(toggleArrow instanceof HTMLInputElement) ||
		!(togglePanelRight instanceof HTMLInputElement) ||
		!(toggleAutoNext instanceof HTMLInputElement) ||
		!(btnDef instanceof HTMLButtonElement) ||
		!(btnHold instanceof HTMLButtonElement) ||
		!(lblDef instanceof HTMLElement) ||
		!(lblHold instanceof HTMLElement) ||
		!(inputLoopCount instanceof HTMLInputElement)
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

	function syncLoopCountEnabled() {
		inputLoopCount.disabled = !toggleAutoNext.checked;
	}

	function persistLoopCount() {
		const n = clampLoopCount(inputLoopCount.value);
		inputLoopCount.value = String(n);
		chrome.storage.local.set({ [STORAGE_KEY_LOOP_COUNT]: n });
	}

	chrome.storage.local.get(
		{
			[STORAGE_KEY_ARROW_VOLUME]: true,
			[STORAGE_KEY_PANEL_RIGHT]: true,
			[STORAGE_KEY_DEFAULT_SPEED_INDEX]: 0,
			[STORAGE_KEY_HOLD_SPEED_INDEX]: 2,
			[STORAGE_KEY_AUTO_NEXT]: false,
			[STORAGE_KEY_LOOP_COUNT]: 2,
		},
		(res) => {
			if (chrome.runtime.lastError) return;
			toggleArrow.checked = res[STORAGE_KEY_ARROW_VOLUME] !== false;
			togglePanelRight.checked = res[STORAGE_KEY_PANEL_RIGHT] !== false;
			toggleAutoNext.checked = res[STORAGE_KEY_AUTO_NEXT] === true;
			defaultIdx = clampIndex(res[STORAGE_KEY_DEFAULT_SPEED_INDEX]);
			holdIdx = clampIndex(res[STORAGE_KEY_HOLD_SPEED_INDEX]);
			inputLoopCount.value = String(clampLoopCount(res[STORAGE_KEY_LOOP_COUNT]));
			syncSpeedLabels();
			syncLoopCountEnabled();
		}
	);

	toggleArrow.addEventListener('change', () => {
		chrome.storage.local.set({ [STORAGE_KEY_ARROW_VOLUME]: toggleArrow.checked });
	});
	togglePanelRight.addEventListener('change', () => {
		chrome.storage.local.set({ [STORAGE_KEY_PANEL_RIGHT]: togglePanelRight.checked });
	});
	toggleAutoNext.addEventListener('change', () => {
		chrome.storage.local.set({ [STORAGE_KEY_AUTO_NEXT]: toggleAutoNext.checked });
		syncLoopCountEnabled();
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
	inputLoopCount.addEventListener('change', persistLoopCount);
	inputLoopCount.addEventListener('blur', persistLoopCount);
}

document.addEventListener('DOMContentLoaded', init);
