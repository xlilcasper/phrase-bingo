// /js/leaves.js
(() => {
    const layer = document.getElementById('leaf-layer');
    if (!layer || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const COUNT = 28;                         // try 18–40
    const rand  = (a,b) => Math.random()*(b-a)+a;
    const pick  = a => a[(Math.random()*a.length)|0];
    const TYPES = ['type-1','type-2','type-3'];
    const COLORS= ['color-1','color-2','color-3','color-4','color-5'];

    for (let i=0;i<COUNT;i++){
        const leaf = document.createElement('div');
        leaf.className = `leaf ${pick(TYPES)} ${pick(COLORS)}`;

        // per-leaf randomness
        leaf.style.setProperty('--left',     `${rand(0,100)}vw`);
        leaf.style.setProperty('--size',     `${rand(14,34)}px`);
        leaf.style.setProperty('--opacity',  rand(0.55,0.9).toFixed(2));
        leaf.style.setProperty('--swayAmp',  `${rand(14,48)}px`);
        leaf.style.setProperty('--fall',     `${rand(28,60)}s`);
        leaf.style.setProperty('--sway',     `${rand(4,11)}s`);
        leaf.style.setProperty('--spin',     `${rand(8,18)}s`);
        leaf.style.setProperty('--delay',    `-${rand(0,60)}s`);

        // structure for layered transforms
        const sway   = document.createElement('div');
        sway.className = 'sway';
        const sprite = document.createElement('div');
        sprite.className = 'sprite';
        sway.appendChild(sprite);
        leaf.appendChild(sway);

        // after each full fall, respawn at a new horizontal position
        leaf.addEventListener('animationiteration', (e) => {
            if (e.animationName === 'leaf-fall') {
                leaf.style.setProperty('--left', `${rand(0,100)}vw`);
            }
        });

        layer.appendChild(leaf);
    }
})();
