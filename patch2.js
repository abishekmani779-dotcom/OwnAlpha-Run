const fs = require('fs');

let code = fs.readFileSync('main.js', 'utf8');

// 1. Add magnet time tracking
code = code.replace('let boostTimeLeft = 0; // seconds remaining for boost', 'let boostTimeLeft = 0; // seconds remaining for boost\nlet magnetTimeLeft = 0; // seconds remaining for magnet');
code = code.replace('hasShield = false; outfitGroup.visible = false; boostTimeLeft = 0;', 'hasShield = false; outfitGroup.visible = false; boostTimeLeft = 0; magnetTimeLeft = 0;');

// 2. Add Magnet to THEMES/Objects Array as a pink floating ring
let spawnRepl = `
// Spawning Objects
const Z_SPAWN = -80; // Distance ahead objects spawn

// Helper to keep track of lanes that are "blocked" by obstacles to enforce Rule of Two
let lastSpawnZ = 0;
function spawnObject() {
    let spawnLvl = Math.floor((distance + 80) / 2000);
    let t = getTheme(spawnLvl);

    // Dynamic thresholds based on level
    let gapScale = spawnLvl === 0 ? 20 : (spawnLvl === 1 ? 12 : 8);
    let coinEnd = 0.6; // 60% coins
    let obstEnd = 0.9; // 30% obstacles
    let powerEnd = 1.0; // 10% powers (shield/boost/magnet)
    
    // Pick lane and enforce safe path
    let lane = [-1, 0, 1][Math.floor(Math.random() * 3)];
    let xPos = lane * LANE_WIDTH;
    let zPos = Z_SPAWN;
    
    let rand = Math.random();
    let isObstacle = (rand >= coinEnd && rand < obstEnd);
    
    // Check if we need to force a coin path to signify a blocked lane (Telegraphing)
    if (isObstacle && distance - lastSpawnZ < gapScale) {
        // Find safe lane to drop coins
        let safeLane = [-1, 0, 1].find(l => l !== lane);
        if (safeLane !== undefined) {
             let cX = safeLane * LANE_WIDTH;
             let cZ = zPos + 5; // Spawn slightly ahead of the block
             // Drop 3-coin string
             for(let i=0; i<3; i++) {
                 let cMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16), new THREE.MeshStandardMaterial({ color: 0xffdd00, emissive: 0x221100 }));
                 cMesh.rotation.x = Math.PI / 2; cMesh.position.set(cX, 0.5, cZ + (i*2));
                 scene.add(cMesh);
                 objects.push({ mesh: cMesh, box: new THREE.Box3(), isTrigger: true, isCoin: true, active: true });
             }
        }
    }
    
    if (isObstacle) lastSpawnZ = distance;

    let mesh, isTrigger = false, isCoin = false, isOutfit = false, isBooster = false, isMagnet = false;

    if (rand < coinEnd) { // 60%
        // Coin String
        for(let i=0; i<5; i++) {
            let cMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.25, 0.08, 16), new THREE.MeshStandardMaterial({ color: 0xffdd00, emissive: 0x221100 }));
            cMesh.rotation.x = Math.PI / 2; cMesh.position.set(xPos, 0.5, zPos + (i*1.5));
            scene.add(cMesh);
            objects.push({ mesh: cMesh, box: new THREE.Box3(), isTrigger: true, isCoin: true, active: true });
        }
        return; // Already spawned the string

    } else if (rand < obstEnd) { // 30% mapped by chance
        let oRand = Math.random();
        if (oRand < 0.5) { // 15% (Low - Jump)
             mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, LANE_WIDTH, 8), new THREE.MeshStandardMaterial({ color: 0x4a3219 }));
             mesh.rotation.z = Math.PI / 2; mesh.position.set(xPos, 0.4, zPos);
        } else if (oRand < 0.83) { // ~10% (High - Slide)
             mesh = new THREE.Mesh(new THREE.BoxGeometry(LANE_WIDTH, 0.4, 1), new THREE.MeshStandardMaterial({ color: 0x243314 }));
             mesh.position.set(xPos, 1.8, zPos);
        } else { // 5% (Blocker - Shift)
             mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 3, 1.2), new THREE.MeshStandardMaterial({ color: 0x555566 }));
             mesh.position.set(xPos, 1.5, zPos);
        }
        mesh.castShadow = true;
    } else { // 10% Power Ups
        let pRand = Math.random();
        if (pRand < 0.33) {
            // Outfit Synergy Pick-up
            mesh = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), new THREE.MeshStandardMaterial({ color: t.outfit, emissive: 0x110000, wireframe: true }));
            mesh.position.set(xPos, 1.0, zPos);
            isTrigger = true; isOutfit = true;
        } else if (pRand < 0.66) {
            // Booster Powerup: Neon Blue Bolt
            mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.2, 8), new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff }));
            mesh.rotation.x = Math.PI / 4; mesh.position.set(xPos, 1.0, zPos);
            isTrigger = true; isBooster = true;
        } else {
            // Magnet Powerup: Pink Torus
            mesh = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.1, 16, 16), new THREE.MeshStandardMaterial({ color: 0xff00ff, emissive: 0xaa00aa }));
            mesh.position.set(xPos, 1.0, zPos);
            isTrigger = true; isMagnet = true;
        }
    }

    if(mesh) {
        scene.add(mesh);
        objects.push({ mesh: mesh, box: new THREE.Box3(), isTrigger, isCoin, isOutfit, isBooster, isMagnet, active: true });
    }
}
`;
code = code.replace(/function spawnObject\(\) \{[\s\S]*?active: true\n    \}\);\n\}/, spawnRepl);

// 3. Update main loop to handle Magnet and Invincibility
let loopMods = `
    const baseTargetFov = 70; // Static unless boosted
    if (boostTimeLeft > 0) {
        boostTimeLeft -= dt;
        gameSpeed = baseGameSpeed * 2.0; // Level scaling + 2.0x boost directly stacked
        camera.fov = THREE.MathUtils.lerp(camera.fov, baseTargetFov + 15, 5 * dt); // Speed warp effect
        camera.updateProjectionMatrix();   
`;
code = code.replace(/const baseTargetFov = 70; \/\/ Static unless boosted[\s\S]*?camera.updateProjectionMatrix();/, loopMods);

let magnetLogic = `
    if (magnetTimeLeft > 0) {
        magnetTimeLeft -= dt;
    }
    
    // Move Tiles
`;
code = code.replace('// Move Tiles', magnetLogic);

let objLoopLogic = `
        if (obj.isCoin) {
            obj.mesh.rotation.z += 5 * dt;
            // Magnet physics
            if (magnetTimeLeft > 0 && obj.mesh.position.distanceTo(playerGroup.position) < 15) {
                // Fly to player
                obj.mesh.position.lerp(playerGroup.position, 10 * dt);
            }
        }
        if (obj.isMagnet) { obj.mesh.rotation.y += 4 * dt; }
        if (obj.isOutfit) { obj.mesh.rotation.x += 2 * dt; obj.mesh.rotation.y += 2 * dt; }
        if (obj.isBooster) { obj.mesh.rotation.x += 4 * dt; obj.mesh.rotation.y += 4 * dt; }

        obj.box.setFromObject(obj.mesh);

        // Collision Detection
        if (obj.active && obj.box.intersectsBox(playerPhys.box)) {
            obj.active = false;

            if (obj.isTrigger) {
                scene.remove(obj.mesh);
                if (obj.isCoin) {
                    coins++;
                    AudioEngine.playTone(800, 1000, 'sine', 0.1, 0.05);
                } else if (obj.isOutfit) {
                    hasShield = true;
                    outfitGroup.visible = true; // Transform applied!
                } else if (obj.isMagnet) {
                    magnetTimeLeft = 10.0;
                } else if (obj.isBooster) {
                    boostTimeLeft = 8.0; // 8 seconds of boost
                }
            } else {
                // Obstacle Hit
                if (boostTimeLeft > 0) {
                     // Invincible Ghost bypass
                     obj.active = true; // Keep object alive and don't take damage
                } else if (hasShield) {
`;

code = code.replace(/if \(obj\.isCoin\) obj\.mesh\.rotation\.z \+= 5 \* dt;[\s\S]*?\} else if \(hasShield\) \{/, objLoopLogic);

fs.writeFileSync('main.js', code);
console.log("Spawn patch applied.");
