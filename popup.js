'use strict';

const SPEEDS = [1, 1.5, 2, 3];
const STORAGE_KEY_ARROW_VOLUME = 'bmYtsArrowVolumeEnabled';
const STORAGE_KEY_PANEL_RIGHT = 'bmYtsPanelExpandRight';
const STORAGE_KEY_DEFAULT_SPEED_INDEX = 'bmYts3xOptsDefaultSpeedIndex';
const STORAGE_KEY_HOLD_SPEED_INDEX = 'bmYts3xOptsHoldSpeedIndex';
const STORAGE_KEY_AUTO_NEXT = 'bmYtsToolboxAutoNextEnabled';
const STORAGE_KEY_LOOP_COUNT = 'bmYtsToolboxPlayCountBeforeNext';
const STORAGE_KEY_REMEMBER_VOLUME = 'bmYtsRememberVolumeEnabled';
const STORAGE_KEY_REMEMBERED_VOLUME = 'bmYtsRememberedVolume';
const STORAGE_KEY_REMEMBERED_MUTED = 'bmYtsRememberedMuted';
const PROFILE_SETTINGS_VERSION_KEY = 'bmYtsSettingsSchema';
const PROFILE_SETTINGS_VERSION = 1;

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

function profileStorageKey(key, isIncognito) {
	return isIncognito ? `${key}_incognito` : key;
}

async function loadProfileSettings(defaults, isIncognito) {
	const keys = Object.fromEntries(
		Object.keys(defaults).map((key) => [key, profileStorageKey(key, isIncognito)])
	);
	const allProfileDefaults = {};
	for (const [key, value] of Object.entries(defaults)) {
		allProfileDefaults[key] = value;
		allProfileDefaults[profileStorageKey(key, true)] = value;
	}
	const profileDefaults = Object.fromEntries(
		Object.entries(defaults).map(([key, value]) => [keys[key], value])
	);
	try {
		const stored = await chrome.storage.local.get(PROFILE_SETTINGS_VERSION_KEY);
		if (stored[PROFILE_SETTINGS_VERSION_KEY] !== PROFILE_SETTINGS_VERSION) {
			await chrome.storage.local.set({
				...allProfileDefaults,
				[PROFILE_SETTINGS_VERSION_KEY]: PROFILE_SETTINGS_VERSION,
			});
		}
		return { keys, values: await chrome.storage.local.get(profileDefaults) };
	} catch (_) {
		return { keys, values: profileDefaults };
	}
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

async function init() {
	applyI18n();
	const toggleArrow = document.getElementById('toggleArrowVolume');
	const toggleRememberVolume = document.getElementById('toggleRememberVolume');
	const togglePanelRight = document.getElementById('togglePanelExpandRight');
	const toggleAutoNext = document.getElementById('toggleAutoNext');
	const btnDef = document.getElementById('btnDefaultSpeed');
	const btnHold = document.getElementById('btnHoldSpeed');
	const lblDef = document.getElementById('lblDefaultSpeed');
	const lblHold = document.getElementById('lblHoldSpeed');
	const inputLoopCount = document.getElementById('inputLoopCount');
	if (
		!(toggleArrow instanceof HTMLInputElement) ||
		!(toggleRememberVolume instanceof HTMLInputElement) ||
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
	const isIncognito = chrome.extension?.inIncognitoContext === true;
	const { keys, values } = await loadProfileSettings(
		{
			[STORAGE_KEY_ARROW_VOLUME]: true,
			[STORAGE_KEY_REMEMBER_VOLUME]: true,
			[STORAGE_KEY_REMEMBERED_VOLUME]: null,
			[STORAGE_KEY_REMEMBERED_MUTED]: null,
			[STORAGE_KEY_PANEL_RIGHT]: true,
			[STORAGE_KEY_DEFAULT_SPEED_INDEX]: 0,
			[STORAGE_KEY_HOLD_SPEED_INDEX]: 2,
			[STORAGE_KEY_AUTO_NEXT]: true,
			[STORAGE_KEY_LOOP_COUNT]: 2,
		},
		isIncognito
	);

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
		chrome.storage.local.set({ [keys[STORAGE_KEY_LOOP_COUNT]]: n });
	}

	toggleArrow.checked = values[keys[STORAGE_KEY_ARROW_VOLUME]] !== false;
	toggleRememberVolume.checked = values[keys[STORAGE_KEY_REMEMBER_VOLUME]] !== false;
	togglePanelRight.checked = values[keys[STORAGE_KEY_PANEL_RIGHT]] !== false;
	toggleAutoNext.checked = values[keys[STORAGE_KEY_AUTO_NEXT]] === true;
	defaultIdx = clampIndex(values[keys[STORAGE_KEY_DEFAULT_SPEED_INDEX]]);
	holdIdx = clampIndex(values[keys[STORAGE_KEY_HOLD_SPEED_INDEX]]);
	inputLoopCount.value = String(clampLoopCount(values[keys[STORAGE_KEY_LOOP_COUNT]]));
	syncSpeedLabels();
	syncLoopCountEnabled();

	toggleArrow.addEventListener('change', () => {
		chrome.storage.local.set({ [keys[STORAGE_KEY_ARROW_VOLUME]]: toggleArrow.checked });
	});
	toggleRememberVolume.addEventListener('change', () => {
		chrome.storage.local.set({ [keys[STORAGE_KEY_REMEMBER_VOLUME]]: toggleRememberVolume.checked });
	});
	togglePanelRight.addEventListener('change', () => {
		chrome.storage.local.set({ [keys[STORAGE_KEY_PANEL_RIGHT]]: togglePanelRight.checked });
	});
	toggleAutoNext.addEventListener('change', () => {
		chrome.storage.local.set({ [keys[STORAGE_KEY_AUTO_NEXT]]: toggleAutoNext.checked });
		syncLoopCountEnabled();
	});
	btnDef.addEventListener('click', () => {
		defaultIdx = (defaultIdx + 1) % SPEEDS.length;
		syncSpeedLabels();
		chrome.storage.local.set({
			[keys[STORAGE_KEY_DEFAULT_SPEED_INDEX]]: defaultIdx,
		});
	});
	chrome.storage.onChanged.addListener((changes, areaName) => {
		const key = keys[STORAGE_KEY_DEFAULT_SPEED_INDEX];
		if (areaName !== 'local' || !changes[key]) return;
		defaultIdx = clampIndex(changes[key].newValue);
		syncSpeedLabels();
	});
	btnHold.addEventListener('click', () => {
		holdIdx = (holdIdx + 1) % SPEEDS.length;
		syncSpeedLabels();
		chrome.storage.local.set({
			[keys[STORAGE_KEY_HOLD_SPEED_INDEX]]: holdIdx,
		});
	});
	inputLoopCount.addEventListener('change', persistLoopCount);
	inputLoopCount.addEventListener('blur', persistLoopCount);
}

document.addEventListener('DOMContentLoaded', init);
