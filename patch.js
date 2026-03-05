const fs = require('fs');

let code = fs.readFileSync('main.js', 'utf8');

// 1. Add THEMES array before SCENE SETUP
const themesCode = `
// --- THEMES ---
const THEMES = [
    { bg: 0x050815, path: 0x111622, border: 0x0a110a, outfit: 0x4a5d23 }, // Forest
    { bg: 0x110c1c, path: 0x1c1a24, border: 0x22222a, outfit: 0x4a5d23 }, // Graveyard
    { bg: 0x1a1005, path: 0x242424, border: 0x332211, outfit: 0x222222 }, // Industrial
    { bg: 0x2a1a10, path: 0x332a1a, border: 0x4a2c11, outfit: 0x225588 }  // Canyon
];
function getTheme(lvl) {
    let t = THEMES[lvl % 4];
    return { bg: lvl>=4 ? 0x020202 : t.bg, path: t.path, border: t.border, outfit: t.outfit, lvlType: lvl % 4 };
}
`;
code = code.replace('// --- SCENE SETUP ---', themesCode + '\n// --- SCENE SETUP ---');

// 2. Modify createTile to accept a level
code = code.replace(/function createTile\(zPos\) \{/g, 'function createTile(zPos, tileLevel = speedLevel) {');
code = code.replace(/const pathMat = new THREE\.MeshStandardMaterial\(\{ color: 0x111622, roughness: 0.8 \}\);/g, `const t = getTheme(tileLevel);\n    const pathMat = new THREE.MeshStandardMaterial({ color: t.path, roughness: 0.8 });\n    if(tileLevel > 0 && zPos === -80) { pathMat.color.setHex(0xffffff); } // Transition Warp Tile`);
code = code.replace(/const borderMat = new THREE\.MeshStandardMaterial\(\{ color: 0x0a110a \}\);/g, `const borderMat = new THREE.MeshStandardMaterial({ color: t.border });`);

// 3. Update activeTiles spawning
code = code.replace(/createTile\(-i \* tileLength\);/g, 'createTile(-i * tileLength, 0);');
code = code.replace(/tile.position.z \-= tileLength \* 4;/g, 'tile.position.z -= tileLength * 4;\n            // Refresh tile material based on future level\n            let tileFutureLvl = Math.floor((distance + 80) / 200);\n            const t = getTheme(tileFutureLvl);\n            tile.children[0].material.color.setHex((distance + 80) % 200 < 30 && tileFutureLvl > 0 ? 0x555555 : t.path); // Warp transition\n            tile.children.slice(1).forEach(c => c.material.color.setHex(t.border));');

// 4. Update spawnObject
let spawnRepl = `
function spawnObject() {
    let spawnLvl = Math.floor((distance + 80) / 200);
    let t = getTheme(spawnLvl);
    
    // Density increases by replacing empty space probability
    let emptyChance = Math.max(0.2, 0.6 - (spawnLvl * 0.05));
    if (Math.random() < emptyChance) return;

    const lane = [-1, 0, 1][Math.floor(Math.random() * 3)];
    const xPos = lane * LANE_WIDTH;
    const zPos = -80;

    const rand = Math.random();
    let mesh, isTrigger = false, isCoin = false, isOutfit = false;

    // Density bounds
    let coinEnd = Math.min(0.4, 0.2 + (spawnLvl * 0.02));
    let outfitEnd = coinEnd + Math.min(0.2, 0.1 + (spawnLvl * 0.01));

    if (rand < coinEnd) {
        mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16), new THREE.MeshStandardMaterial({ color: 0xffdd00, emissive: 0x221100 }));
        mesh.rotation.x = Math.PI / 2;
        mesh.position.set(xPos, 0.5, zPos);
        isTrigger = true; isCoin = true;
    } else if (rand < outfitEnd) {
        mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: t.outfit, emissive: 0x110000, wireframe: true })); 
        mesh.position.set(xPos, 1.0, zPos);
        isTrigger = true; isOutfit = true;
    } else {
        // Obstacle based on theme
        if (t.lvlType === 0) { // Forest Logs
            mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, LANE_WIDTH, 8), new THREE.MeshStandardMaterial({ color: 0x4a3219 }));
            mesh.rotation.z = Math.PI / 2; mesh.position.set(xPos, 0.4, zPos);
        } else if (t.lvlType === 1) { // Graveyard Tombstones
            mesh = new THREE.Mesh(new THREE.BoxGeometry(1.0, 1.5, 0.3), new THREE.MeshStandardMaterial({ color: 0x444444 }));
            mesh.position.set(xPos, 0.75, zPos);
        } else if (t.lvlType === 2) { // Industrial Pipes
            mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, LANE_WIDTH, 12), new THREE.MeshStandardMaterial({ color: 0x883311, metalness: 0.8 }));
            mesh.rotation.z = Math.PI / 2; mesh.position.set(xPos, 0.3, zPos);
        } else { // Canyon Rocks
            mesh = new THREE.Mesh(new THREE.DodecahedronGeometry(0.8), new THREE.MeshStandardMaterial({ color: 0xaa5533 }));
            mesh.position.set(xPos, 0.6, zPos);
        }
        mesh.castShadow = true;
    }
`;
code = code.replace(/function spawnObject\(\) \{[\s\S]*?mesh\.castShadow = true;\n    \}/, spawnRepl);

// 5. Update animate to lerp scene bg/fog colors
let animateRepl = `
    // Base Speed (15% cumulative increase)
    baseGameSpeed = 20 * Math.pow(1.15, speedLevel);
    
    // Lerp background and fog based on current level theme
    let currentT = getTheme(speedLevel);
    let targetBg = new THREE.Color(currentT.bg);
    scene.background.lerp(targetBg, 2*dt);
    scene.fog.color.lerp(targetBg, 2*dt);
    hemiLight.groundColor.lerp(targetBg, 2*dt);
`;
code = code.replace('// Base Speed (15% cumulative increase)\n    baseGameSpeed = 20 * Math.pow(1.15, speedLevel);', animateRepl);

fs.writeFileSync('main.js', code);
console.log("Patch applied correctly.");
