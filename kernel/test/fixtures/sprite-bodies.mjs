// 精灵身体样本库 — 10 个「由智能体生成」的受限 SVG 身体。
// 硬约束(产品 §4.2):无 <text>、无脚本、无外链、有上限、静止即成立、恒可降级。
// 动画只用 CSS(不用 SMIL),类名一律以身体 id 作前缀 —— 内联进页面时不污染全局。
// 身体不知道页面主题:它自身必须在墨夜与冷瓷两种底上都成立;随主题变的只有界面画的那圈光晕。

const S = (id, css) => `<style>${css.replace(/&/g, '.' + id + '-')}</style>`

/* 1 · 可爱生物 / 中间调 —— 九尾狐 */
function xiaojiu() {
	let tails = ''
	const fur = ['#E8A33D', '#EBAE52', '#EEB866', '#F1C37B', '#F5CE90']
	for (let i = 0; i < 5; i++) {
		const a = -68 + i * 34,
			r = 46 - Math.abs(i - 2) * 4
		tails += `<g class="xj-t xj-t${i}" style="transform-origin:60px 108px"><path d="M60 108 C ${60 + Math.sin((a * Math.PI) / 180) * r * 0.5} ${108 - r * 0.55} ${60 + Math.sin((a * Math.PI) / 180) * r} ${104 - r * 0.8} ${60 + Math.sin((a * Math.PI) / 180) * r * 1.16} ${96 - r * 0.84} C ${60 + Math.sin((a * Math.PI) / 180) * r * 0.74} ${102 - r * 0.6} ${60 + Math.sin((a * Math.PI) / 180) * r * 0.3} ${106 - r * 0.3} 60 108 Z" fill="${fur[i]}"/><path d="M${(60 + Math.sin((a * Math.PI) / 180) * r * 1.16).toFixed(1)} ${(96 - r * 0.84).toFixed(1)} c -3 3 -5 6 -6 9 4 1 8 -1 10 -5 z" fill="#FBEBD2"/></g>`
	}
	return (
		S(
			'xj',
			`&t{animation:xjsway 5.4s ease-in-out infinite}&t0{animation-delay:-.1s}&t1{animation-delay:-.5s}&t2{animation-delay:-.9s}&t3{animation-delay:-1.3s}&t4{animation-delay:-1.7s}&ear{animation:xjear 6.2s ease-in-out infinite;transform-origin:60px 66px}@keyframes xjsway{0%,100%{transform:rotate(-3.2deg)}50%{transform:rotate(3.2deg)}}@keyframes xjear{0%,88%,100%{transform:rotate(0)}92%{transform:rotate(-4deg)}}`
		) +
		tails +
		`<g class="xj-ear"><path d="M45 68 L41 46 L57 60 Z" fill="#E8A33D"/><path d="M46 65 L44 52 L54 61 Z" fill="#F7DEC0"/><path d="M75 68 L79 46 L63 60 Z" fill="#E8A33D"/><path d="M74 65 L76 52 L66 61 Z" fill="#F7DEC0"/></g>` +
		`<ellipse cx="60" cy="110" rx="25" ry="21" fill="#EDB05A"/><ellipse cx="60" cy="118" rx="15" ry="12" fill="#FBEBD2"/>` +
		`<circle cx="60" cy="82" r="20" fill="#EDB05A"/><path d="M46 90 q14 12 28 0 q-14 8 -28 0 Z" fill="#FBEBD2"/><ellipse cx="60" cy="90" rx="9" ry="6.5" fill="#FBEBD2"/>` +
		`<path d="M50 79 q4 -4 8 0" stroke="#4A2E18" stroke-width="2.4" fill="none" stroke-linecap="round"/><path d="M62 79 q4 -4 8 0" stroke="#4A2E18" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
		`<ellipse cx="60" cy="88" rx="2.6" ry="1.9" fill="#5A3A22"/><path d="M60 90 v3" stroke="#5A3A22" stroke-width="1.4" stroke-linecap="round"/>` +
		`<ellipse cx="47" cy="128" rx="7" ry="4" fill="#F1C37B"/><ellipse cx="73" cy="128" rx="7" ry="4" fill="#F1C37B"/>`
	)
}

/* 2 · 机械 / 中间调 —— 黄铜小机器 */
function brass() {
	let rivets = ''
	for (let i = 0; i < 8; i++)
		rivets += `<circle cx="${32 + (i % 4) * 12}" cy="${64 + Math.floor(i / 4) * 26}" r="1.8" fill="#E8CFA0"/>`
	return (
		S(
			'br',
			`&hov{animation:brhov 4.6s ease-in-out infinite}&led{animation:brled 2.4s ease-in-out infinite}&iris{animation:briris 5.8s ease-in-out infinite;transform-origin:50px 38px}@keyframes brhov{0%,100%{transform:translateY(0)}50%{transform:translateY(-2.5px)}}@keyframes brled{0%,100%{opacity:.35}50%{opacity:1}}@keyframes briris{0%,42%,100%{transform:translateX(0)}55%,70%{transform:translateX(3.5px)}}`
		) +
		`<rect x="34" y="100" width="10" height="14" rx="3" fill="#8E6828"/><rect x="56" y="100" width="10" height="14" rx="3" fill="#8E6828"/><ellipse cx="39" cy="115" rx="8" ry="3.5" fill="#6E4F1C"/><ellipse cx="61" cy="115" rx="8" ry="3.5" fill="#6E4F1C"/>` +
		`<g class="br-hov"><rect x="26" y="54" width="48" height="50" rx="8" fill="#B8873C"/><rect x="32" y="62" width="36" height="34" rx="4" fill="#8E6828"/><rect x="36" y="70" width="28" height="4" rx="2" fill="#CFA560"/><rect x="36" y="78" width="18" height="4" rx="2" fill="#CFA560"/>${rivets}` +
		`<rect x="14" y="62" width="12" height="6" rx="3" fill="#A87C33"/><rect x="74" y="62" width="12" height="6" rx="3" fill="#A87C33"/><circle cx="14" cy="65" r="4.5" fill="#C99A4A"/><circle cx="86" cy="65" r="4.5" fill="#C99A4A"/>` +
		`<rect x="30" y="20" width="40" height="34" rx="7" fill="#C99A4A"/><rect x="30" y="20" width="40" height="9" rx="7" fill="#D8AC5E"/>` +
		`<circle cx="50" cy="38" r="11" fill="#22323F"/><circle cx="50" cy="38" r="8.5" fill="#2E4557"/><circle class="br-iris" cx="50" cy="38" r="4.2" fill="#7FD4C8"/><circle cx="47.5" cy="35" r="1.8" fill="#EAF7F4" opacity=".85"/>` +
		`<path d="M50 20 v-8" stroke="#A87C33" stroke-width="2.4" stroke-linecap="round"/><circle class="br-led" cx="50" cy="9" r="3.4" fill="#7FD4C8"/></g>`
	)
}

/* 3 · 植物 / 高瘦 viewBox —— 会走路的蕨 */
function fern() {
	let fronds = ''
	for (let i = 0; i < 8; i++) {
		const y = 138 - i * 13,
			len = 12 + i * 2.6,
			c = i % 2 ? '#79A06B' : '#4F7D4C'
		fronds += `<g class="fn-f fn-f${i % 4}" style="transform-origin:40px ${y}px"><path d="M40 ${y} q -${len * 0.6} -3 -${len} -9" stroke="${c}" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M40 ${y} q ${len * 0.6} -3 ${len} -9" stroke="${c}" stroke-width="2.2" fill="none" stroke-linecap="round"/>`
		for (let j = 1; j <= 3; j++) {
			const t = j / 3.4
			fronds += `<ellipse cx="${(40 - len * t).toFixed(1)}" cy="${(y - 9 * t - 1).toFixed(1)}" rx="3.4" ry="1.9" fill="${c}" transform="rotate(-28 ${(40 - len * t).toFixed(1)} ${(y - 9 * t - 1).toFixed(1)})"/><ellipse cx="${(40 + len * t).toFixed(1)}" cy="${(y - 9 * t - 1).toFixed(1)}" rx="3.4" ry="1.9" fill="${c}" transform="rotate(28 ${(40 + len * t).toFixed(1)} ${(y - 9 * t - 1).toFixed(1)})"/>`
		}
		fronds += `</g>`
	}
	return (
		S(
			'fn',
			`&f{animation:fnsway 6.8s ease-in-out infinite}&f1{animation-delay:-1.1s}&f2{animation-delay:-2.3s}&f3{animation-delay:-3.4s}&curl{animation:fncurl 11s ease-in-out infinite;transform-origin:40px 40px}&leg{animation:fnstep 3.6s ease-in-out infinite}&leg2{animation-delay:-1.8s}@keyframes fnsway{0%,100%{transform:rotate(-2.4deg)}50%{transform:rotate(2.4deg)}}@keyframes fncurl{0%,100%{transform:rotate(-7deg)}50%{transform:rotate(7deg)}}@keyframes fnstep{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.6px)}}`
		) +
		`<path class="fn-leg" d="M38 152 C 32 146 30 140 32 134" stroke="#6B7F4E" stroke-width="3" fill="none" stroke-linecap="round"/><path class="fn-leg fn-leg2" d="M44 152 C 50 146 52 140 50 134" stroke="#6B7F4E" stroke-width="3" fill="none" stroke-linecap="round"/><ellipse cx="34" cy="153" rx="6" ry="2.6" fill="#5A6B41"/><ellipse cx="48" cy="153" rx="6" ry="2.6" fill="#5A6B41"/>` +
		`<path d="M40 152 C 38 120 41 84 40 44" stroke="#5F8352" stroke-width="3.4" fill="none" stroke-linecap="round"/>` +
		fronds +
		`<g class="fn-curl"><path d="M40 44 C 40 32 52 28 54 36 C 56 43 48 46 46 41 C 45 38 48 37 49 39" stroke="#8FB27C" stroke-width="3" fill="none" stroke-linecap="round"/></g>` +
		`<circle cx="34" cy="126" r="2.2" fill="#2E3F26"/><circle cx="47" cy="126" r="2.2" fill="#2E3F26"/>`
	)
}

/* 4 · 汉字 / 双描边保证明暗两底都成立 —— 「风」 */
function windglyph() {
	const st = (d, w, c) =>
		`<path d="${d}" stroke="${c}" stroke-width="${w}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`
	const strokes = [
		'M30 28 C 26 56 24 82 22 100',
		'M30 28 H 90 C 96 28 99 33 97 42 L 88 90 C 86 101 78 104 68 99',
		'M50 54 L 74 84',
		'M74 54 L 50 84'
	]
	let light = '',
		dark = ''
	strokes.forEach((d, i) => {
		const w = i < 2 ? 8.5 : 6
		light += st(d, w + 4, '#F2F5F9')
		dark += st(d, w, '#33496B')
	})
	let dashes = ''
	for (let i = 0; i < 3; i++)
		dashes += `<path class="wg-d wg-d${i}" d="M${8 + i * 4} ${34 + i * 26} h 14" stroke="#7E9CC4" stroke-width="3" stroke-linecap="round" fill="none"/>`
	return (
		S(
			'wg',
			`&d{animation:wgd 3.8s ease-in-out infinite}&d1{animation-delay:-1.2s}&d2{animation-delay:-2.5s}&g{animation:wgg 7.5s ease-in-out infinite;transform-origin:60px 64px}@keyframes wgd{0%{transform:translateX(0);opacity:0}25%{opacity:.9}100%{transform:translateX(22px);opacity:0}}@keyframes wgg{0%,100%{transform:rotate(-1.6deg) translateY(0)}50%{transform:rotate(1.6deg) translateY(-2px)}}`
		) +
		dashes +
		`<g class="wg-g">` +
		light +
		dark +
		`<circle cx="61" cy="69" r="4.6" fill="#F2F5F9"/><circle cx="61" cy="69" r="2.6" fill="#33496B"/></g>`
	)
}

/* 5 · 几何抽象 / 极扁 viewBox(160×90)—— 棱 */
function prism() {
	const tri = (x, o, c) =>
		`<path class="pr-p pr-p${o}" d="M${x} 70 L ${x + 36} 16 L ${x + 72} 70 Z" fill="${c}"/>`
	return (
		S(
			'pr',
			`&p{animation:prb 7.2s ease-in-out infinite}&p1{animation-delay:-2.4s}&p2{animation-delay:-4.8s}&dot{animation:prd 5s ease-in-out infinite}@keyframes prb{0%,100%{opacity:.55}50%{opacity:.95}}@keyframes prd{0%,100%{transform:translateY(0)}50%{transform:translateY(-4px)}}`
		) +
		`<rect x="8" y="70" width="144" height="4" rx="2" fill="#5A4A8E"/>` +
		tri(6, 0, '#6E5AA8') +
		tri(44, 1, '#8E7BC4') +
		tri(82, 2, '#B7A8E0') +
		`<path d="M118 70 L 144 30 L 154 70 Z" fill="#5A4A8E" opacity=".8"/>` +
		`<circle class="pr-dot" cx="80" cy="42" r="6.5" fill="#EDE7FF"/><circle cx="80" cy="42" r="2.4" fill="#5A4A8E"/>` +
		`<rect x="26" y="74" width="18" height="10" rx="4" fill="#5A4A8E"/><rect x="116" y="74" width="18" height="10" rx="4" fill="#5A4A8E"/>`
	)
}

/* 6 · 极简(节点数几十)/ 深色为主 —— 圈 */
function minimal() {
	return (
		S(
			'mn',
			`&r{animation:mnr 26s linear infinite;transform-origin:30px 30px}&d{animation:mnd 4.4s ease-in-out infinite}@keyframes mnr{to{transform:rotate(360deg)}}@keyframes mnd{0%,100%{transform:translateY(0)}50%{transform:translateY(-1.6px)}}`
		) +
		`<circle class="mn-r" cx="30" cy="30" r="20" fill="none" stroke="#0D1321" stroke-width="3" stroke-linecap="round" stroke-dasharray="98 28"/>` +
		`<circle class="mn-d" cx="30" cy="24" r="4" fill="#0D1321"/>` +
		`<path d="M20 38 Q 30 45 40 38" stroke="#0D1321" stroke-width="3" fill="none" stroke-linecap="round"/>`
	)
}

/* 7 · 满上限(≈1500 节点 / ≈60KB)—— 织
   节点全部靠 class 取色与半径,这也是真实的生成式 SVG 在上限附近会长的样子。 */
function lattice() {
	const ramp = ['#2E6B52', '#3E7F5E', '#57946A', '#7FA96F', '#A8BC72', '#CFC97E', '#E0C27A']
	let css =
		'&s{animation:ltr 64s linear infinite;transform-origin:70px 70px}&c{animation:ltb 6.2s ease-in-out infinite;transform-origin:70px 70px}@keyframes ltr{to{transform:rotate(360deg)}}@keyframes ltb{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}'
	for (let i = 0; i < 7; i++) {
		css += `&a${i}{fill:${ramp[i]};r:.85;opacity:.5}&b${i}{fill:${ramp[i]};r:1.3;opacity:.34}`
		css += `&h${i}{stroke:${ramp[i]};stroke-width:.62;fill:none;opacity:.42}`
	}
	let s = ''
	for (let ring = 0; ring < 15; ring++) {
		const r = 11 + ring * 3.6,
			n = 40 + ring * 5,
			c = ring % 7
		for (let i = 0; i < n; i++) {
			const a = (i / n) * 6.2832 + ring * 0.14
			const x = (70 + Math.cos(a) * r).toFixed(1),
				y = (70 + Math.sin(a) * r * 0.94).toFixed(1)
			if (ring % 3 === 0) s += `<circle class="lt-b${c}" cx="${x}" cy="${y}"/>`
			else
				s += `<path class="lt-h${c}" d="M${x} ${y}l${(Math.cos(a) * 3.2).toFixed(1)} ${(Math.sin(a) * 3).toFixed(1)}"/>`
		}
	}
	for (let k = 0; k < 3; k++)
		for (let i = 0; i < 110; i++) {
			const a = (i / 110) * 6.2832,
				r = 66 - k * 2.4
			s += `<circle class="lt-a${6 - k}" cx="${(70 + Math.cos(a) * r).toFixed(1)}" cy="${(70 + Math.sin(a) * r * 0.94).toFixed(1)}"/>`
		}
	for (let i = 0; i < 30; i++) {
		const a = (i / 30) * 6.2832
		s += `<path class="lt-h${i % 7}" d="M70 70Q${(70 + Math.cos(a + 0.3) * 40).toFixed(1)} ${(70 + Math.sin(a + 0.3) * 38).toFixed(1)} ${(70 + Math.cos(a) * 62).toFixed(1)} ${(70 + Math.sin(a) * 58).toFixed(1)}"/>`
	}
	return (
		S('lt', css) +
		`<g class="lt-s">${s}</g>` +
		`<g class="lt-c"><path d="M70 44 C 84 60 88 74 82 86 C 76 97 64 97 58 86 C 52 74 56 60 70 44 Z" fill="#1F4F3E"/><path d="M70 52 C 79 63 82 74 78 83 C 74 91 66 91 62 83 C 58 74 61 63 70 52 Z" fill="#2E6B52"/><circle cx="64" cy="72" r="2.6" fill="#DCE9DF"/><circle cx="76" cy="72" r="2.6" fill="#DCE9DF"/><circle cx="64" cy="72" r="1.2" fill="#12271F"/><circle cx="76" cy="72" r="1.2" fill="#12271F"/></g>`
	)
}

/* 8 · 坏审美对照(配色刺眼、比例失衡)—— 闪闪 */
function garish() {
	return (
		S(
			'gr',
			`&j{animation:grj .42s steps(2,end) infinite}&z{animation:grz .9s linear infinite}@keyframes grj{0%{transform:translate(0,0) rotate(0)}50%{transform:translate(2.5px,-2px) rotate(2.5deg)}}@keyframes grz{0%,100%{fill:#FFFF00}50%{fill:#00FF7B}}`
		) +
		`<g class="gr-j">` +
		`<path d="M6 10 L 34 6 L 18 34 Z" fill="#FF7A00"/>` +
		`<line x1="30" y1="66" x2="6" y2="92" stroke="#00E5FF" stroke-width="9" stroke-linecap="butt"/><line x1="98" y1="62" x2="128" y2="86" stroke="#00E5FF" stroke-width="9" stroke-linecap="butt"/>` +
		`<rect x="58" y="70" width="15" height="28" fill="#14FF3C"/><rect x="52" y="94" width="12" height="6" fill="#7B00FF"/><rect x="70" y="94" width="12" height="6" fill="#7B00FF"/>` +
		`<circle cx="65" cy="38" r="36" fill="#FF14A0"/>` +
		`<circle cx="50" cy="30" r="13" class="gr-z" fill="#FFFF00"/><circle cx="84" cy="36" r="9" fill="#FFFF00"/>` +
		`<circle cx="53" cy="32" r="5.5" fill="#FF0000"/><circle cx="81" cy="34" r="4" fill="#FF0000"/>` +
		`<path d="M44 54 L 52 62 L 60 52 L 70 64 L 78 52 L 86 60" stroke="#7B00FF" stroke-width="5" fill="none"/>` +
		`<rect x="24" y="4" width="8" height="8" fill="#00FF7B"/><rect x="104" y="14" width="14" height="5" fill="#FFFF00"/>` +
		`</g>`
	)
}

/* 9 · 动画陷阱(静止帧很怪,只有动起来才成立)—— 群 */
function swarm() {
	const formed = [
		[60, 34],
		[50, 40],
		[70, 40],
		[40, 48],
		[80, 48],
		[30, 58],
		[90, 58],
		[24, 70],
		[96, 70],
		[46, 56],
		[74, 56],
		[60, 50],
		[52, 66],
		[68, 66],
		[60, 76],
		[44, 82],
		[76, 82],
		[60, 90],
		[34, 64],
		[86, 64],
		[56, 60],
		[64, 60],
		[48, 74],
		[72, 74],
		[60, 66],
		[60, 58]
	]
	const scattered = [
		[14, 96],
		[104, 22],
		[88, 104],
		[22, 18],
		[70, 12],
		[10, 54],
		[110, 62],
		[50, 108],
		[96, 88],
		[34, 100],
		[80, 30],
		[16, 76],
		[102, 44],
		[40, 14],
		[64, 110],
		[26, 40],
		[92, 14],
		[12, 32],
		[58, 20],
		[108, 96],
		[46, 92],
		[74, 100],
		[30, 82],
		[86, 70],
		[20, 62],
		[100, 76]
	]
	const dash = (p, cls) =>
		`<path class="${cls}" d="M${p[0] - 5} ${p[1]} l 10 -2.5" stroke="#46648A" stroke-width="3.2" stroke-linecap="round" fill="none"/>`
	return (
		S(
			'sw',
			`&a{animation:swa 3.4s ease-in-out infinite}&b{animation:swb 3.4s ease-in-out infinite}@keyframes swa{0%,18%{opacity:1}42%,72%{opacity:0}96%,100%{opacity:1}}@keyframes swb{0%,18%{opacity:0}42%,72%{opacity:1}96%,100%{opacity:0}}`
		) +
		`<g class="sw-a">${scattered.map((p) => dash(p, '')).join('')}</g>` +
		`<g class="sw-b">${formed.map((p) => dash(p, '')).join('')}<circle cx="60" cy="30" r="3.4" fill="#46648A"/></g>`
	)
}

/* 10 · 浅色为主(冷瓷底上的可见性陷阱)—— 小灯 */
function paperlamp() {
	let ribs = ''
	for (let i = 0; i < 5; i++)
		ribs += `<path d="M${28 + i * 8.5} 44 C ${24 + i * 9} 66 ${24 + i * 9} 78 ${28 + i * 8.5} 98" stroke="#E6DCC4" stroke-width="1.4" fill="none"/>`
	return (
		S(
			'pl',
			`&b{animation:plb 5.2s ease-in-out infinite}&g{animation:plg 4.1s ease-in-out infinite;transform-origin:45px 72px}@keyframes plb{0%,100%{transform:translateY(0)}50%{transform:translateY(-3px)}}@keyframes plg{0%,100%{opacity:.55;transform:scale(1)}50%{opacity:.95;transform:scale(1.12)}}`
		) +
		`<path d="M40 112 v 10" stroke="#CFC3A6" stroke-width="2.6" stroke-linecap="round"/><path d="M52 112 v 10" stroke="#CFC3A6" stroke-width="2.6" stroke-linecap="round"/><ellipse cx="39" cy="124" rx="6.5" ry="2.8" fill="#BEB199"/><ellipse cx="53" cy="124" rx="6.5" ry="2.8" fill="#BEB199"/>` +
		`<g class="pl-b"><path d="M45 20 v 10" stroke="#BEB199" stroke-width="2.2" stroke-linecap="round"/><rect x="34" y="28" width="22" height="7" rx="3" fill="#DCD0B4"/>` +
		`<path d="M28 44 C 22 62 22 88 28 106 C 34 113 56 113 62 106 C 68 88 68 62 62 44 C 56 37 34 37 28 44 Z" fill="#FAF6EC" stroke="#D8CCB0" stroke-width="1.6"/>${ribs}` +
		`<ellipse class="pl-g" cx="45" cy="72" rx="11" ry="14" fill="#F7CE8C"/>` +
		`<path d="M36 66 q4 -4 8 0" stroke="#7E6E52" stroke-width="2.2" fill="none" stroke-linecap="round"/><path d="M48 66 q4 -4 8 0" stroke="#7E6E52" stroke-width="2.2" fill="none" stroke-linecap="round"/><ellipse cx="46" cy="78" rx="3.4" ry="2.2" fill="#E0B889"/>` +
		`<rect x="32" y="104" width="26" height="7" rx="3" fill="#DCD0B4"/></g>`
	)
}

/* 11 · 黑白同框(近黑 + 近白在同一具身体里)—— 大熊猫 */
function panda() {
	const W = '#F7F4EE',
		K = '#24272C',
		K2 = '#33373E'
	let leaves = ''
	;[
		[104, 62, -34],
		[112, 74, 26],
		[100, 84, -22]
	].forEach(([x, y, r]) => {
		leaves += `<ellipse cx="${x}" cy="${y}" rx="9" ry="3.4" fill="#5F8C4E" transform="rotate(${r} ${x} ${y})"/>`
	})
	return (
		S(
			'pd',
			`&h{animation:pdchew 3.8s ease-in-out infinite;transform-origin:65px 62px}&e{animation:pdear 7s ease-in-out infinite;transform-origin:65px 40px}&b{animation:pdbam 5.6s ease-in-out infinite;transform-origin:98px 116px}&bl{animation:pdblink 6.4s ease-in-out infinite}@keyframes pdchew{0%,100%{transform:scaleY(1)}46%{transform:scaleY(.985)}}@keyframes pdear{0%,84%,100%{transform:rotate(0)}90%{transform:rotate(-3deg)}}@keyframes pdbam{0%,100%{transform:rotate(-2.2deg)}50%{transform:rotate(2.2deg)}}@keyframes pdblink{0%,92%,100%{transform:scaleY(1)}96%{transform:scaleY(.15)}}`
		) +
		`<ellipse cx="65" cy="96" rx="31" ry="27" fill="${W}"/>` +
		`<ellipse cx="40" cy="118" rx="14" ry="8.5" fill="${K}"/><ellipse cx="90" cy="118" rx="14" ry="8.5" fill="${K}"/>` +
		`<ellipse cx="36" cy="93" rx="9.5" ry="16" fill="${K}" transform="rotate(14 36 93)"/>` +
		`<path d="M40 76 C 52 68 78 68 90 76 C 84 82 46 82 40 76 Z" fill="${K2}" opacity=".9"/>` +
		`<g class="pd-b"><path d="M98 120 C 100 100 101 78 100 56" stroke="#6E9455" stroke-width="4.2" fill="none" stroke-linecap="round"/><path d="M99 96 h 3" stroke="#4E6B3C" stroke-width="4.2" stroke-linecap="round"/><path d="M100 74 h 3" stroke="#4E6B3C" stroke-width="4.2" stroke-linecap="round"/>${leaves}</g>` +
		`<ellipse cx="94" cy="93" rx="9.5" ry="16" fill="${K}" transform="rotate(-14 94 93)"/>` +
		`<g class="pd-e"><circle cx="38" cy="32" r="13" fill="${K}"/><circle cx="92" cy="32" r="13" fill="${K}"/><circle cx="38" cy="32" r="6" fill="${K2}"/><circle cx="92" cy="32" r="6" fill="${K2}"/></g>` +
		`<g class="pd-h"><circle cx="65" cy="52" r="31" fill="${W}"/>` +
		`<ellipse cx="51" cy="48" rx="9.5" ry="12" fill="${K}" transform="rotate(-20 51 48)"/><ellipse cx="79" cy="48" rx="9.5" ry="12" fill="${K}" transform="rotate(20 79 48)"/>` +
		`<g class="pd-bl" style="transform-origin:65px 48px"><circle cx="52" cy="47" r="3.6" fill="${W}"/><circle cx="78" cy="47" r="3.6" fill="${W}"/><circle cx="52.8" cy="47.6" r="1.9" fill="#16181C"/><circle cx="77.2" cy="47.6" r="1.9" fill="#16181C"/></g>` +
		`<path d="M60 62 q5 -4 10 0 q-5 5 -10 0 Z" fill="${K}"/>` +
		`<path d="M65 66 v3" stroke="${K}" stroke-width="1.6" stroke-linecap="round"/><path d="M65 69 q-4 4 -8 1" stroke="${K}" stroke-width="1.6" fill="none" stroke-linecap="round"/><path d="M65 69 q4 4 8 1" stroke="${K}" stroke-width="1.6" fill="none" stroke-linecap="round"/></g>`
	)
}

export const BODIES = [
	{
		id: 'xiaojiu',
		kind: 'creature',
		vb: [120, 140],
		svg: xiaojiu(),
		symbol: '九',
		aura: { core: '#E8A33D', glow: '#F6DCA8' },
		name: { zh: '小九', en: 'Jiu' },
		essence: { zh: '记得每一片林子的方向。', en: 'Remembers the way to every grove.' },
		alt: {
			zh: '一只坐着的九尾狐，暖橙色毛，尾巴呈扇形展开。',
			en: 'A seated nine-tailed fox, warm amber fur, tails fanned out.'
		}
	},
	{
		id: 'brass',
		kind: 'machine',
		vb: [100, 120],
		svg: brass(),
		symbol: '铜',
		aura: { core: '#C08A3E', glow: '#8FD8CC' },
		name: { zh: '老铜', en: 'Brass' },
		essence: { zh: '上了发条就不会忘事。', en: 'Wound up, it forgets nothing.' },
		alt: {
			zh: '一台黄铜色的方形小机器，单个青绿色镜头眼，头顶有一根闪烁的天线。',
			en: 'A small brass machine with one teal lens eye and a blinking antenna.'
		}
	},
	{
		id: 'fern',
		kind: 'plant',
		vb: [80, 160],
		svg: fern(),
		symbol: '蕨',
		aura: { core: '#4F7D4C', glow: '#B7D6A4' },
		name: { zh: '蕨', en: 'Fiddle' },
		essence: { zh: '往有光的地方长。', en: 'Grows toward whatever light there is.' },
		alt: {
			zh: '一株细高的会走路的蕨，顶端有卷曲的新芽，两条茎当作腿。',
			en: 'A tall walking fern with a curled fiddlehead and two stem legs.'
		}
	},
	{
		id: 'wind',
		kind: 'glyph',
		vb: [120, 120],
		svg: windglyph(),
		symbol: '风',
		aura: { core: '#46648A', glow: '#AFC9E6' },
		name: { zh: '风', en: 'Feng' },
		essence: { zh: '不停在任何一棵树上。', en: 'Never settles on any one tree.' },
		alt: {
			zh: '汉字「风」的书法笔画构成的形体，浅色描边包住深色笔画。',
			en: 'The Chinese character for wind, drawn as strokes with a light outline.'
		}
	},
	{
		id: 'prism',
		kind: 'abstract',
		vb: [160, 90],
		svg: prism(),
		symbol: '◇',
		aura: { core: '#6E5AA8', glow: '#C9BCEC' },
		name: { zh: '棱', en: 'Prism' },
		essence: { zh: '把一束光拆成七种说法。', en: 'Splits one light into seven ways of saying it.' },
		alt: {
			zh: '一排紫色三角棱，横向铺开，中间悬着一个亮点。',
			en: 'A row of violet triangular prisms with a bright point suspended in the middle.'
		}
	},
	{
		id: 'minimal',
		kind: 'minimal',
		vb: [60, 60],
		svg: minimal(),
		symbol: '○',
		aura: { core: '#0D1321', glow: '#8FA6C0' },
		name: { zh: '圈', en: 'Ring' },
		essence: { zh: '留着一道缺口。', en: 'Keeps one gap open.' },
		alt: {
			zh: '一个带缺口的深色圆环，环上有一个点和一道弧。',
			en: 'A dark ring with a gap, one dot and one arc.'
		}
	},
	{
		id: 'lattice',
		kind: 'maxed',
		vb: [140, 140],
		svg: lattice(),
		symbol: '织',
		aura: { core: '#2E6B52', glow: '#D7C98A' },
		name: { zh: '织', en: 'Weave' },
		essence: { zh: '一千根线，一个念头。', en: 'A thousand threads, one thought.' },
		alt: {
			zh: '一枚水滴形的深绿色核心，外面裹着上千根线织成的同心光环。',
			en: 'A dark green droplet core wrapped in concentric lattices of a thousand threads.'
		}
	},
	{
		id: 'garish',
		kind: 'bad',
		vb: [130, 100],
		svg: garish(),
		symbol: '!',
		aura: { core: '#FF14A0', glow: '#B6FF00' },
		name: { zh: '闪闪', en: 'Blingo' },
		essence: { zh: '我最好看！', en: 'I am the prettiest!' },
		alt: {
			zh: '一个大头小身的荧光粉色角色，配色刺眼，比例失衡。',
			en: 'A neon pink figure with a huge head and tiny body, clashing colors.'
		}
	},
	{
		id: 'swarm',
		kind: 'trap',
		vb: [120, 120],
		svg: swarm(),
		symbol: '群',
		aura: { core: '#46648A', glow: '#9FB8D4' },
		name: { zh: '群', en: 'Swarm' },
		essence: { zh: '静下来就散了。', en: 'It scatters the moment it stops.' },
		alt: {
			zh: '二十多道短线，动起来时聚成一只飞鸟，静止时四散。',
			en: 'Two dozen dashes that form a bird in flight when moving, scattered when still.'
		}
	},
	{
		id: 'lamp',
		kind: 'light',
		vb: [90, 130],
		svg: paperlamp(),
		symbol: '灯',
		aura: { core: '#D9A05B', glow: '#F7EBD2' },
		name: { zh: '小灯', en: 'Lumen' },
		essence: { zh: '亮得刚好够看清脚下。', en: 'Bright enough to see one step ahead.' },
		alt: {
			zh: '一盏米白色纸灯笼形状的精灵，两条细腿，里面有一点暖光。',
			en: 'A cream paper-lantern sprite on two thin legs with a warm light inside.'
		}
	},
	{
		id: 'panda',
		kind: 'contrast',
		vb: [130, 130],
		svg: panda(),
		symbol: '团',
		aura: { core: '#6E9455', glow: '#DCE7C6' },
		name: { zh: '团团', en: 'Tuan' },
		essence: { zh: '慢一点，也走得到。', en: 'Slowly still gets there.' },
		alt: {
			zh: '一只坐着的大熊猫，抱着一根竹子，黑白相间。',
			en: 'A seated giant panda holding a bamboo stalk, black and white.'
		}
	}
]

export const KIND_LABEL = {
	creature: { zh: '可爱生物', en: 'Creature' },
	machine: { zh: '机械', en: 'Machine' },
	plant: { zh: '植物', en: 'Plant' },
	glyph: { zh: '汉字 · 符号', en: 'Glyph' },
	abstract: { zh: '几何抽象', en: 'Abstract' },
	minimal: { zh: '极简 · 深色为主', en: 'Minimal · dark' },
	maxed: { zh: '满上限 · 复杂度', en: 'Max complexity' },
	bad: { zh: '坏审美对照', en: 'Bad-taste control' },
	trap: { zh: '动画陷阱', en: 'Animation trap' },
	light: { zh: '浅色为主', en: 'Light-dominant' },
	contrast: { zh: '黑白同框', en: 'Black & white' }
}

export const KIND_NOTE = {
	creature: {
		zh: '中间调、轮廓清楚 —— 舞台的基准样本。',
		en: 'Mid-tone, clean silhouette — the baseline sample.'
	},
	machine: {
		zh: '硬边直角，验证光晕不会把机械感糊掉。',
		en: 'Hard edges; checks the aura does not smear the machined look.'
	},
	plant: {
		zh: '极高瘦 viewBox（1:2），验证按高归一化后的比例上限。',
		en: 'Very tall viewBox (1:2) — tests the height-normalised scale cap.'
	},
	glyph: {
		zh: '双描边：浅色外描 + 深色笔画，一具身体自带明暗两解。',
		en: 'Double stroke: light outline over dark strokes — one body, two backgrounds.'
	},
	abstract: {
		zh: '极扁 viewBox（16:9），触发按宽度归一化的分支。',
		en: 'Very wide viewBox (16:9) — triggers the width-normalised branch.'
	},
	minimal: {
		zh: '4 个节点，几乎全黑：墨夜底上必须靠光晕外缘才看得见。',
		en: 'Four nodes, near-black: only the aura rim keeps it visible on ink.'
	},
	maxed: {
		zh: '≈1500 节点，接近上限：4 具同框是移动端的帧率压测。',
		en: '≈1500 nodes, near the cap: four on screen is the mobile frame-rate test.'
	},
	bad: {
		zh: '刺眼配色 + 大头小身，故意难看。它是「会不会拉低整片林子」的对照组。',
		en: 'Clashing neon and a huge head — deliberately ugly. The control for "does one body ruin the grove".'
	},
	trap: {
		zh: '静止帧是一堆散线 —— 违反「静止即成立」，分享卡会出事。',
		en: 'Its still frame is a mess of dashes — it breaks "still frame must stand", and the share card suffers.'
	},
	light: {
		zh: '近乎米白：冷瓷底上必须靠光晕的暗侧描边才看得见。',
		en: "Almost cream: on porcelain only the aura's dark contour keeps it readable."
	},
	contrast: {
		zh: '近黑与近白在同一具身体里 —— 两种底色各难一半。光晕必须同时给出暗侧投影和亮侧边缘，只做一边就会缺一块。',
		en: 'Near-black and near-white in one body — each background breaks half of it. The aura has to supply both a dark contact shadow and a light rim, or half the sprite drops out.'
	}
}

export function nodeCount(svg) {
	return (svg.match(/<(?!\/|style)/g) || []).length
}
