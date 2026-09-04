<script>
	// Potentiomètre rotatif contrôlé (unidirectionnel).
	// Le parent détient la position normalisée `t` (0..1) et reçoit oninput(newT).
	let {
		label = '',
		cc = null,
		t = 0,
		min = 0,
		max = 1,
		kind = 'lin', // 'lin' | 'exp'
		format = (v) => v.toFixed(2),
		accent = 'aqua', // 'aqua' | 'lilac'
		def = null,
		oninput = () => {}
	} = $props();

	const A0 = -135, A1 = 135;
	const toV = (tt) => (kind === 'lin' ? min + (max - min) * tt : min * Math.pow(max / min, tt));
	const toT = (v) => (kind === 'lin' ? (v - min) / (max - min) : Math.log(v / min) / Math.log(max / min));

	const value = $derived(toV(t));
	const deg = $derived(A0 + (A1 - A0) * t);

	function polar(r, d) {
		const a = (d - 90) * Math.PI / 180;
		return [30 + r * Math.cos(a), 30 + r * Math.sin(a)];
	}
	function arc(r, d0, d1) {
		const [x0, y0] = polar(r, d0), [x1, y1] = polar(r, d1);
		const large = d1 - d0 <= 180 ? 0 : 1;
		return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
	}
	const ptr = $derived(polar(15, deg));

	let dragging = false, lastY = 0;
	function down(e) { dragging = true; lastY = e.touches ? e.touches[0].clientY : e.clientY; e.preventDefault(); }
	function move(e) {
		if (!dragging) return;
		const y = e.touches ? e.touches[0].clientY : e.clientY;
		oninput(Math.min(1, Math.max(0, t + (lastY - y) / 180)));
		lastY = y;
	}
	function up() { dragging = false; }
	function reset() { if (def != null) oninput(Math.min(1, Math.max(0, toT(def)))); }
	function key(e) {
		const step = e.shiftKey ? 0.1 : 0.02;
		if (e.key === 'ArrowUp' || e.key === 'ArrowRight') { oninput(Math.min(1, t + step)); e.preventDefault(); }
		else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') { oninput(Math.max(0, t - step)); e.preventDefault(); }
	}
</script>

<svelte:window onmousemove={move} onmouseup={up} ontouchmove={move} ontouchend={up} />

<div class="knob {accent}">
	<svg viewBox="0 0 60 60" role="slider" tabindex="0"
		aria-label={label} aria-valuemin={min} aria-valuemax={max}
		aria-valuenow={Math.round(value * 100) / 100} aria-valuetext={format(value)}
		onmousedown={down} ontouchstart={down} ondblclick={reset} onkeydown={key}>
		<path class="track" d={arc(22, A0, A1)} />
		<path class="arc" d={arc(22, A0, deg)} />
		<line class="pointer" x1="30" y1="30" x2={ptr[0]} y2={ptr[1]} />
	</svg>
	<div class="val">{format(value)}</div>
	<div class="lab">{label}</div>
	{#if cc != null}<div class="cc">CC {cc}</div>{/if}
</div>

<style>
	.knob { display:flex; flex-direction:column; align-items:center; gap:8px;
		padding:14px 6px 12px; border:1px solid var(--line); border-radius:14px;
		background:var(--panel); user-select:none; }
	svg { width:58px; height:58px; touch-action:none; cursor:ns-resize; display:block; border-radius:50%; }
	svg:focus-visible { outline:2px solid var(--aqua); outline-offset:3px; }
	.track { fill:none; stroke:rgba(150,175,215,.14); stroke-width:5; stroke-linecap:round; }
	.arc { fill:none; stroke:var(--aqua); stroke-width:5; stroke-linecap:round;
		filter:drop-shadow(0 0 5px rgba(116,234,214,.55)); }
	.lilac .arc { stroke:var(--lilac); filter:drop-shadow(0 0 5px rgba(179,162,255,.55)); }
	.pointer { stroke:#eaf1fb; stroke-width:2.4; stroke-linecap:round; }
	.lab { font-size:11px; letter-spacing:.08em; color:var(--dim); }
	.cc { font-size:9.5px; letter-spacing:.1em; color:var(--aqua); opacity:.6; }
	.lilac .cc { color:var(--lilac); }
	.val { font-size:12px; color:var(--ink); font-variant-numeric:tabular-nums; }
</style>