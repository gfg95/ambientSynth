<script>
	import { onMount } from 'svelte';
	import { AmbientEngine } from '$lib/synth.js';
	import { CC_MAP, parseMidiMessage, noteName } from '$lib/midi.js';
	import { bus } from '$lib/bus.js';
	import Knob from '$lib/Knob.svelte';

	const engine = new AmbientEngine();

	// Config des potentiomètres (mêmes échelles que CC_MAP pour rester cohérent).
	const KNOBS = [
		{ param: 'cutoff',        label: 'Filtre',      cc: 74, kind: 'exp', min: 120,  max: 9000, def: 1400, accent: 'aqua',  fmt: hz },
		{ param: 'shimmer',       label: 'Shimmer',     cc: 1,  kind: 'lin', min: 0,    max: 0.55, def: 0.18, accent: 'lilac', fmt: (v) => pct(v, 0.55) },
		{ param: 'reverb',        label: 'Reverb',      cc: 91, kind: 'lin', min: 0,    max: 1,    def: 0.7,  accent: 'aqua',  fmt: (v) => pct(v, 1) },
		{ param: 'delayFeedback', label: 'Écho',        cc: 93, kind: 'lin', min: 0,    max: 0.85, def: 0.35, accent: 'aqua',  fmt: (v) => pct(v, 0.85) },
		{ param: 'lfoRate',       label: 'Respiration', cc: 76, kind: 'exp', min: 0.01, max: 1.2,  def: 0.08, accent: 'lilac', fmt: (v) => v.toFixed(2) + 'Hz' },
		{ param: 'air',           label: 'Air',         cc: 77, kind: 'lin', min: -40,  max: -3,   def: -15,  accent: 'aqua',  fmt: (v) => v.toFixed(0) + 'dB' },
		{ param: 'attack',        label: 'Attaque',     cc: 73, kind: 'exp', min: 0.05, max: 8,    def: 0.6,  accent: 'aqua',  fmt: sec },
		{ param: 'release',       label: 'Release',     cc: 72, kind: 'exp', min: 0.2,  max: 12,   def: 5.5,  accent: 'lilac', fmt: sec }
	];
	function hz(v) { return v >= 1000 ? (v / 1000).toFixed(1) + 'k' : Math.round(v) + ''; }
	function pct(v, max) { return Math.round((v / max) * 100) + '%'; }
	function sec(v) { return v < 1 ? (v * 1000).toFixed(0) + 'ms' : v.toFixed(1) + 's'; }
	const toV = (k, t) => (k.kind === 'lin' ? k.min + (k.max - k.min) * t : k.min * Math.pow(k.max / k.min, t));
	const toT = (k, v) => (k.kind === 'lin' ? (v - k.min) / (k.max - k.min) : Math.log(v / k.min) / Math.log(k.max / k.min));

	// État réactif
	let ready = $state(false);
	let tvals = $state(KNOBS.map((k) => toT(k, k.def))); // positions normalisées
	let baseNote = $state(48); // C3
	let held = $state(new Set());
	let glow = $state(0);
	let midiFlash = $state(false);
	let channel = $state(null); // null = omni (tous canaux), sinon 0..15

	function setKnob(i, t) {
		tvals[i] = Math.min(1, Math.max(0, t));
		if (ready) engine.setParam(KNOBS[i].param, toV(KNOBS[i], tvals[i]));
	}

	// Clavier visuel
	const WHITE = [0, 2, 4, 5, 7, 9, 11];
	const NUM_OCT = 2;
	const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12 };
	const whiteNotes = $derived(
		Array.from({ length: NUM_OCT * 12 + 1 }, (_, s) => baseNote + s).filter((n) => WHITE.includes((n - baseNote) % 12))
	);
	const blackNotes = $derived(
		Array.from({ length: NUM_OCT * 12 }, (_, s) => ({ note: baseNote + s, s })).filter((o) => !WHITE.includes(o.s % 12))
	);
	function blackLeft(s) {
		const map = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };
		const whiteW = 100 / whiteNotes.length;
		const idx = map[s % 12] + Math.floor(s / 12) * WHITE.length;
		return (idx + 1) * whiteW - whiteW * 0.28 + '%';
	}

	function press(note) {
		if (held.has(note)) return;
		held.add(note); held = held;
		engine.noteOn(note, 100);
	}
	function release(note) {
		if (!held.has(note)) return;
		held.delete(note); held = held;
		engine.noteOff(note);
	}
	function panic() { engine.panic(); held = new Set(); }
	function shiftOct(d) {
		held.forEach((n) => release(n));
		baseNote = Math.min(84, Math.max(12, baseNote + 12 * d));
	}

	async function wake() {
		await engine.start();
		KNOBS.forEach((k, i) => engine.setParam(k.param, toV(k, tvals[i])));
		ready = true;
	}

	onMount(() => {
		// Réception TabMidi
		const unsub = bus.onMidi((bytes) => {
			const m = parseMidiMessage(bytes);
			// Filtre de canal : en mode non-omni, on ignore ce qui n'est pas notre canal.
			if (channel !== null && 'channel' in m && m.channel !== channel) return;
			midiFlash = true; setTimeout(() => (midiFlash = false), 120);
			if (m.type === 'noteon') press(m.note);
			else if (m.type === 'noteoff') release(m.note);
			else if (m.type === 'pitchbend') engine.setPitchBend(m.value);
			else if (m.type === 'cc') {
				const cc = CC_MAP[m.controller];
				if (!cc) return;
				const v = cc.scale(m.value);
				engine.setParam(cc.param, v);
				const i = KNOBS.findIndex((k) => k.param === cc.param);
				if (i >= 0 && isFinite(v)) tvals[i] = Math.min(1, Math.max(0, toT(KNOBS[i], Math.min(KNOBS[i].max, Math.max(KNOBS[i].min, v)))));
			}
		});



		// Halo réactif
		let raf, target = 0, level = 0;
		const loop = () => { target = Math.min(1, held.size / 6); level += (target - level) * 0.06; glow = level; raf = requestAnimationFrame(loop); };
		loop();

		return () => { unsub(); cancelAnimationFrame(raf); };
	});
</script>

<div class="aurora" style="--g:{glow}">
	<b class="b1"></b><b class="b2"></b><b class="b3"></b>
</div>

<div class="stage">
	<header>
		<div class="brand">
			<div class="mark"><span class="dot"></span> TABMIDI · INSTRUMENT</div>
			<h1>nebula <span>/ ambient shimmer synth</span></h1>
		</div>
		<div class="status">
			<label class="chan">canal
				<select bind:value={channel} aria-label="Canal MIDI de réception">
					<option value={null}>tous</option>
					{#each Array(16) as _, i}<option value={i}>{i + 1}</option>{/each}
				</select>
			</label>
			<div class="midi" class:on={midiFlash}><i></i> MIDI in</div>
			<div class="live" class:on={ready}>{ready ? 'en vie' : 'endormi'}</div>
		</div>
	</header>

	<div class="rack">
		<div class="knobs">
			{#each KNOBS as k, i}
				<Knob label={k.label} cc={k.cc} t={tvals[i]} min={k.min} max={k.max} kind={k.kind}
					def={k.def} accent={k.accent} format={k.fmt} oninput={(t) => setKnob(i, t)} />
			{/each}
		</div>

		<div class="kbd-wrap">
			<div class="keys">
				{#each whiteNotes as note}
					<div class="key white" class:on={held.has(note)}
						onmousedown={(e) => { e.preventDefault(); press(note); }}
						onmouseup={() => release(note)}
						onmouseleave={(e) => { if (e.buttons) release(note); }}
						ontouchstart={(e) => { e.preventDefault(); press(note); }}
						ontouchend={() => release(note)}
						role="button" tabindex="-1" aria-label={noteName(note)}></div>
				{/each}
				{#each blackNotes as o}
					<div class="key black" class:on={held.has(o.note)} style="left:{blackLeft(o.s)}"
						onmousedown={(e) => { e.preventDefault(); press(o.note); }}
						onmouseup={() => release(o.note)}
						ontouchstart={(e) => { e.preventDefault(); press(o.note); }}
						ontouchend={() => release(o.note)}
						role="button" tabindex="-1" aria-label={noteName(o.note)}></div>
				{/each}
			</div>
		</div>

		<div class="row">
			<div class="oct">
				<button class="ctl" onclick={() => shiftOct(-1)}>octave −</button>
				<span>{noteName(baseNote)}</span>
				<button class="ctl" onclick={() => shiftOct(1)}>octave +</button>
				
			</div>
			<button class="ctl panic" onclick={panic}>panic</button>
		</div>

		<div class="ccref">
			<span class="ccref-lab">Config clavier distant · CC MIDI</span>
			<span>Volume <b>7</b></span>
			<span>Résonance <b>71</b></span>
			<span>Écho mix <b>94</b></span>
			<span class="sep">·</span>
			<span>Notes : Note On/Off, tous canaux</span>
			<span>Pitch bend : ±2 demi-tons</span>
		</div>
	</div>
</div>

{#if !ready}
	<div class="veil">
		<div class="card">
			<h2>nebula</h2>
			<p>Un synthé de nappes éthérées, piloté au clavier ou par les autres onglets via TabMidi. L'audio démarre sur ton geste.</p>
			<button class="wake" onclick={wake}>Éveiller le son</button>
		</div>
	</div>
{/if}

<style>
	:global(:root) {
		--bg:#070a12; --ink:#d3ddef; --dim:#5a6b86; --line:rgba(150,175,215,.12);
		--aqua:#74ead6; --lilac:#b3a2ff; --panel:rgba(140,170,220,.035);
	}
	:global(body) { margin:0; background:var(--bg); color:var(--ink);
		font-family:ui-monospace,"SF Mono","JetBrains Mono",Menlo,Consolas,monospace; overflow:hidden; }

	.aurora { position:fixed; inset:-25%; z-index:0; pointer-events:none; filter:blur(70px);
		opacity:calc(.30 + var(--g) * .55); transition:opacity .4s ease; }
	.aurora b { position:absolute; border-radius:50%; mix-blend-mode:screen; transform:scale(calc(.9 + var(--g) * .4)); }
	.b1 { width:52vw; height:52vw; left:6%; top:2%; background:radial-gradient(circle,var(--aqua),transparent 62%); animation:d1 34s ease-in-out infinite; }
	.b2 { width:46vw; height:46vw; right:4%; top:20%; background:radial-gradient(circle,var(--lilac),transparent 62%); animation:d2 41s ease-in-out infinite; }
	.b3 { width:40vw; height:40vw; left:34%; bottom:-6%; background:radial-gradient(circle,#4f7ad6,transparent 64%); animation:d1 47s ease-in-out infinite reverse; }
	@keyframes d1 { 50% { transform:translate(6%,4%); } }
	@keyframes d2 { 50% { transform:translate(-5%,6%); } }
	@media (prefers-reduced-motion:reduce) { .b1,.b2,.b3 { animation:none; } }

	.stage { position:relative; z-index:1; height:100vh; display:flex; flex-direction:column;
		max-width:1080px; margin:0 auto; padding:clamp(18px,3vw,34px); }
	header { display:flex; align-items:flex-end; justify-content:space-between; gap:20px; flex-wrap:wrap; }
	.mark { display:flex; align-items:center; gap:10px; color:var(--dim); font-size:12.5px; letter-spacing:.14em; }
	.dot { width:7px; height:7px; border-radius:50%; background:var(--aqua); box-shadow:0 0 10px var(--aqua); }
	h1 { margin:6px 0 0; font-weight:400; letter-spacing:-.01em; line-height:1; font-size:clamp(26px,4.6vw,44px); color:#eaf1fb; }
	h1 span { color:var(--dim); }
	.status { display:flex; gap:18px; align-items:center; font-size:12px; color:var(--dim); }
	.chan { display:flex; align-items:center; gap:7px; letter-spacing:.06em; }
	.chan select { font:inherit; font-size:12px; color:var(--ink); background:transparent;
		border:1px solid var(--line); border-radius:8px; padding:4px 8px; cursor:pointer; }
	.chan select:focus-visible { outline:2px solid var(--aqua); outline-offset:2px; }
	.chan option { background:#0b1020; color:var(--ink); }
	.midi { display:flex; align-items:center; gap:8px; }
	.midi i { width:8px; height:8px; border-radius:2px; background:#26324a; transition:background .1s, box-shadow .1s; }
	.midi.on i { background:var(--lilac); box-shadow:0 0 12px var(--lilac); }
	.live { padding:4px 10px; border:1px solid var(--line); border-radius:999px; letter-spacing:.12em; }
	.live.on { color:var(--aqua); border-color:rgba(116,234,214,.4); }

	.rack { margin-top:auto; display:flex; flex-direction:column; gap:clamp(16px,2.4vw,26px); }
	.knobs { display:grid; grid-template-columns:repeat(8,1fr); gap:12px; }
	@media (max-width:820px) { .knobs { grid-template-columns:repeat(4,1fr); } }

	.kbd-wrap { border:1px solid var(--line); border-radius:16px; background:var(--panel); padding:12px; }
	.keys { position:relative; display:flex; height:clamp(120px,18vh,168px); }
	.key { position:relative; flex:1; border-radius:0 0 7px 7px; cursor:pointer;
		border:1px solid rgba(10,15,26,.9); border-top:none; background:linear-gradient(#e9eef7,#c3cddd); transition:filter .08s; }
	.key.black { position:absolute; top:0; width:5.6%; height:62%; z-index:2;
		background:linear-gradient(#1b2233,#0b1120); border-radius:0 0 5px 5px; box-shadow:0 3px 6px rgba(0,0,0,.5); }
	.key.white.on { background:linear-gradient(var(--aqua),#9fe6db); }
	.key.black.on { background:linear-gradient(var(--lilac),#7a68d6); }

	.row { display:flex; align-items:center; justify-content:space-between; gap:14px; flex-wrap:wrap; }
	.oct { display:flex; align-items:center; gap:10px; color:var(--dim); font-size:12px; }
	.ctl { font:inherit; color:var(--ink); background:transparent; cursor:pointer;
		border:1px solid var(--line); border-radius:9px; padding:7px 13px; letter-spacing:.05em; transition:border-color .15s; }
	.ctl:hover { border-color:rgba(150,175,215,.35); }
	.ctl:focus-visible { outline:2px solid var(--aqua); outline-offset:2px; }
	.panic { color:#ffb4b4; border-color:rgba(255,120,120,.3); }
	.hint { color:var(--dim); font-size:11.5px; }

	.ccref { display:flex; flex-wrap:wrap; align-items:center; gap:6px 16px;
		padding-top:6px; font-size:11px; color:var(--dim); letter-spacing:.03em; }
	.ccref b { color:var(--ink); font-weight:400; }
	.ccref-lab { color:var(--aqua); opacity:.75; letter-spacing:.1em; }
	.ccref .sep { opacity:.4; }

	.veil { position:fixed; inset:0; z-index:5; display:grid; place-items:center;
		background:radial-gradient(circle at 50% 40%,rgba(11,16,32,.6),rgba(7,10,18,.95)); backdrop-filter:blur(2px); }
	.card { text-align:center; display:flex; flex-direction:column; align-items:center; gap:18px; }
	h2 { margin:0; font-weight:400; font-size:clamp(20px,3vw,28px); color:#eaf1fb; }
	.card p { margin:0; max-width:34ch; color:var(--dim); font-size:13px; line-height:1.6; }
	.wake { font:inherit; cursor:pointer; color:#06121a; letter-spacing:.06em;
		background:linear-gradient(120deg,var(--aqua),var(--lilac)); border:none; border-radius:999px;
		padding:13px 30px; font-size:15px; box-shadow:0 0 30px rgba(116,234,214,.35); }
	.wake:focus-visible { outline:2px solid #fff; outline-offset:3px; }
</style>