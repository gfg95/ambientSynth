// src/lib/midi.js
// Décodage des messages MIDI bruts + table de correspondance CC -> paramètre ambient.

export const MIDI = {
	NOTE_OFF: 0x80,
	NOTE_ON: 0x90,
	CONTROL_CHANGE: 0xb0,
	PITCH_BEND: 0xe0
};

// Mise à l'échelle linéaire d'une valeur MIDI (0..127) vers [min, max].
const lin = (v, min, max) => min + (max - min) * (v / 127);
// Mise à l'échelle exponentielle : mieux adaptée aux fréquences et aux temps.
const exp = (v, min, max) => min * Math.pow(max / min, v / 127);

/**
 * Table CC -> paramètre du synthé ambiant.
 *  param  : nom logique consommé par AmbientEngine.setParam() et par l'UI
 *  label  : libellé affiché
 *  unit   : unité affichée
 *  scale  : convertit une valeur MIDI 0..127 en valeur réelle
 *
 * Les CC choisis privilégient les gestes EXPRESSIFS de l'ambient : ouverture du
 * filtre, quantité de shimmer, réverbération, échos, respiration du LFO...
 * Numéros d'après les conventions courantes (74 = coupure, 71 = résonance,
 * 91 = reverb, 93 = chorus/mod). Adapte librement à ton contrôleur.
 */
export const CC_MAP = {
	7:  { param: 'volume',        label: 'Volume',      unit: 'dB', scale: (v) => (v === 0 ? -Infinity : lin(v, -40, 0)) },
	74: { param: 'cutoff',        label: 'Filtre',      unit: 'Hz', scale: (v) => exp(v, 120, 9000) },
	71: { param: 'resonance',     label: 'Résonance',   unit: '',   scale: (v) => lin(v, 0.5, 12) },
	1:  { param: 'shimmer',       label: 'Shimmer',     unit: '',   scale: (v) => lin(v, 0, 0.55) },   // mod wheel
	91: { param: 'reverb',        label: 'Reverb',      unit: '',   scale: (v) => lin(v, 0, 1) },
	93: { param: 'delayFeedback', label: 'Écho',        unit: '',   scale: (v) => lin(v, 0, 0.85) },
	94: { param: 'delayMix',      label: 'Écho mix',    unit: '',   scale: (v) => lin(v, 0, 0.6) },
	76: { param: 'lfoRate',       label: 'Respiration', unit: 'Hz', scale: (v) => exp(v, 0.01, 1.2) },
	77: { param: 'air',           label: 'Air',         unit: 'dB', scale: (v) => (v === 0 ? -Infinity : lin(v, -40, -3)) },
	73: { param: 'attack',        label: 'Attaque',     unit: 's',  scale: (v) => exp(v, 0.05, 8) },
	72: { param: 'release',       label: 'Release',     unit: 's',  scale: (v) => exp(v, 0.2, 12) }
};

/**
 * Décode un message MIDI brut (tableau d'octets) en objet exploitable.
 * @param {number[]} bytes  ex. [0x90, 60, 127]
 */
export function parseMidiMessage(bytes) {
	if (!bytes || bytes.length === 0) return { type: 'empty' };
	const status = bytes[0];

	// Messages temps réel : 0xF8 clock, 0xFA start, 0xFC stop, etc.
	if (status >= 0xf8) return { type: 'realtime', status };

	const command = status & 0xf0;
	const channel = status & 0x0f; // 0..15

	switch (command) {
		case MIDI.NOTE_ON: {
			const note = bytes[1];
			const velocity = bytes[2] ?? 0;
			// Note On à vélocité 0 = Note Off (convention MIDI standard).
			return velocity > 0
				? { type: 'noteon', channel, note, velocity }
				: { type: 'noteoff', channel, note, velocity: 0 };
		}
		case MIDI.NOTE_OFF:
			return { type: 'noteoff', channel, note: bytes[1], velocity: bytes[2] ?? 0 };
		case MIDI.CONTROL_CHANGE:
			return { type: 'cc', channel, controller: bytes[1], value: bytes[2] ?? 0 };
		case MIDI.PITCH_BEND: {
			// 14 bits : LSB puis MSB, centré sur 8192.
			const value = ((bytes[2] ?? 0) << 7) | (bytes[1] ?? 0);
			return { type: 'pitchbend', channel, value };
		}
		default:
			return { type: 'unknown', status };
	}
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Nom lisible d'une note MIDI (60 -> "C4"). */
export function noteName(note) {
	return NOTE_NAMES[note % 12] + (Math.floor(note / 12) - 1);
}