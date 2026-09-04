// src/lib/synth.js
// Moteur de synthèse AMBIANT (nappes éthérées + shimmer) basé sur Tone.js.
//
// Philosophie : en ambient, la richesse ne vient pas de l'oscillateur mais de
// l'empilement, du mouvement lent et de l'ESPACE. La chaîne d'effets est
// l'instrument. Deux couches jouées ensemble, un filtre qui respire, un
// shimmer en branche PARALLÈLE (pas de boucle sur le chemin principal).
//
//   pad ─┐
//        ├─ input ─ chorus ─ filtre ─┬─ delay ─ reverb ─ master ─ limiter ─► out
//   air ─┘                           │                     ▲
//                                    └─ send ─ pitch+12 ───┘   (shimmer, sans cycle)
//
import * as Tone from 'tone';

// Plage de pitch bend, en demi-tons (± de part et d'autre du centre).
const PITCH_BEND_SEMITONES = 2;

export class AmbientEngine {
	constructor() {
		this.ready = false;
		this.pad = null;
		this.air = null;
	}

	/**
	 * Démarre l'AudioContext et construit toute la chaîne.
	 * DOIT être appelé depuis un geste utilisateur (clic), sinon le navigateur
	 * garde l'audio suspendu.
	 */
	async start() {
		if (this.ready) return;
		await Tone.start();

		// ── COUCHE 1 : le pad (corps de la nappe) ────────────────────────────
		this.pad = new Tone.PolySynth(Tone.Synth, {
			oscillator: { type: 'fatsawtooth', count: 2, spread: 24 },
			// Attaque volontairement courte pour que la moindre note s'entende ;
			// le potard Attaque monte jusqu'à 8 s pour les montées très lentes.
			envelope: { attack: 0.6, decay: 1.2, sustain: 0.85, release: 4.5 }
		});
		this.pad.maxPolyphony = 4;
		this.padVol = new Tone.Volume(-12);

		// ── COUCHE 2 : l'air (halo éthéré, une octave au-dessus) ──────────────
		this.air = new Tone.PolySynth(Tone.Synth, {
			oscillator: { type: 'fattriangle', count: 2, spread: 20 },
			envelope: { attack: 1.1, decay: 1.6, sustain: 0.7, release: 6 }
		});
		this.air.maxPolyphony = 4;
		this.airVol = new Tone.Volume(-18);

		// Somme des deux couches avant les effets.
		this.input = new Tone.Gain(1);
		this.pad.connect(this.padVol);
		this.air.connect(this.airVol);
		this.padVol.connect(this.input);
		this.airVol.connect(this.input);

		// ── MOUVEMENT : le filtre qui respire ────────────────────────────────
		this.filter = new Tone.Filter({ type: 'lowpass', frequency: 1400, Q: 1.2 });
		this.filterLFO = new Tone.LFO({ frequency: 0.08, min: 560, max: 1400 });
		this.filterLFO.connect(this.filter.frequency);
		this.filterLFO.start();

		// ── ESPACE : chorus → delay → reverb ─────────────────────────────────
		this.chorus = new Tone.Chorus({ frequency: 0.6, delayTime: 4, depth: 0.7, spread: 180, wet: 0.5 }).start();
		this.delay = new Tone.PingPongDelay({ delayTime: 0.5, feedback: 0.35, wet: 0.3 });
		this.reverb = new Tone.Reverb({ decay: 6, preDelay: 0.04, wet: 0.6 });
		if (typeof this.reverb.generate === 'function') {
			try {
				await this.reverb.generate();
			} catch (_) {
				/* la reverb garde un chemin sec (CrossFade) : le son passe quand même */
			}
		}

		this.master = new Tone.Volume(-3);
		this.limiter = new Tone.Limiter(-1);

		// Chaîne principale.
		this.input.chain(this.chorus, this.filter, this.delay, this.reverb, this.master, this.limiter, Tone.getDestination());

		// ── SHIMMER : branche PARALLÈLE, sans cycle ──────────────────────────
		// On prélève après le filtre, on remonte d'une octave, et le feedback
		// INTERNE du PitchShift fait remonter chaque répétition (+12, +24, ...)
		// → la queue scintillante qui s'élève. On envoie ça dans la reverb :
		// filtre → send → pitch → reverb. Aucun retour vers un nœud amont, donc
		// pas de boucle sur le chemin principal (plus de risque de NaN muet).
		this.shimmerSend = new Tone.Gain(0.18); // niveau du shimmer (potard/CC)
		this.pitchShift = new Tone.PitchShift({ pitch: 12, windowSize: 0.2, delayTime: 0.06, feedback: 0.35, wet: 1 });
		this.filter.connect(this.shimmerSend);
		this.shimmerSend.connect(this.pitchShift);
		this.pitchShift.connect(this.reverb);

		this.ready = true;
	}

	// ── Notes ────────────────────────────────────────────────────────────────

	noteOn(note, velocity = 100) {
		if (!this.ready) return;
		const v = Math.max(0.05, velocity / 127);
		const now = Tone.now();
		this.pad.triggerAttack(Tone.Frequency(note, 'midi').toFrequency(), now, v);
		this.air.triggerAttack(Tone.Frequency(note + 12, 'midi').toFrequency(), now, v * 0.6);
	}

	noteOff(note) {
		if (!this.ready) return;
		const now = Tone.now();
		this.pad.triggerRelease(Tone.Frequency(note, 'midi').toFrequency(), now);
		this.air.triggerRelease(Tone.Frequency(note + 12, 'midi').toFrequency(), now);
	}

	/** Coupe toutes les voix (bouton Panic). */
	panic() {
		if (!this.ready) return;
		this.pad.releaseAll();
		this.air.releaseAll();
	}

	// ── Paramètres (valeurs DÉJÀ mises à l'échelle, voir CC_MAP) ──────────────

	/**
	 * @param {string} param
	 * @param {number} value
	 */
	setParam(param, value) {
		if (!this.ready) return;
		switch (param) {
			case 'volume':
				if (isFinite(value)) this.master.volume.rampTo(value, 0.05);
				else this.master.volume.value = -Infinity;
				break;
			case 'cutoff':
				this.filterLFO.max = value;
				this.filterLFO.min = Math.max(80, value * 0.4);
				break;
			case 'resonance':
				this.filter.Q.rampTo(value, 0.05);
				break;
			case 'lfoRate':
				this.filterLFO.frequency.rampTo(value, 0.1);
				break;
			case 'shimmer':
				// Niveau d'envoi vers la branche shimmer (0 → ~0.55).
				this.shimmerSend.gain.rampTo(value, 0.1);
				break;
			case 'reverb':
				this.reverb.wet.rampTo(value, 0.1);
				break;
			case 'delayFeedback':
				this.delay.feedback.rampTo(value, 0.05);
				break;
			case 'delayMix':
				this.delay.wet.rampTo(value, 0.05);
				break;
			case 'chorusDepth':
				this.chorus.depth = value;
				break;
			case 'air':
				this.airVol.volume.rampTo(value, 0.1);
				break;
			case 'attack':
				this.pad.set({ envelope: { attack: value } });
				this.air.set({ envelope: { attack: value * 1.4 } });
				break;
			case 'release':
				this.pad.set({ envelope: { release: value } });
				this.air.set({ envelope: { release: value * 1.3 } });
				break;
		}
	}

	/**
	 * Pitch bend : valeur MIDI 14 bits (0..16383, centre 8192).
	 * @param {number} value14
	 */
	setPitchBend(value14) {
		if (!this.ready) return;
		const cents = ((value14 - 8192) / 8192) * (PITCH_BEND_SEMITONES * 100);
		this.pad.set({ detune: cents });
		this.air.set({ detune: cents });
	}

	dispose() {
		[
			this.pad, this.air, this.padVol, this.airVol, this.input,
			this.filter, this.filterLFO, this.chorus, this.delay, this.reverb,
			this.shimmerSend, this.pitchShift, this.master, this.limiter
		].forEach((n) => n?.dispose?.());
		this.ready = false;
	}
}